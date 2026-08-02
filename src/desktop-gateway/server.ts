import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

import {
  GatewayAuthenticationError,
  NonceReplayCache,
  authenticateGatewayRequest,
  signGatewayResponse,
  createPromptCommitment,
  type GatewayCapability,
  type GatewayRole,
} from "./auth.js";
import { parseGatewayRequest, type DesktopGatewayController, type DesktopGatewayResponse, type GatewayEndpointKind } from "./contracts.js";
import { desktopGatewayControlPrompts, parseJsonWithoutDuplicateKeys } from "./protocol.js";

export interface GatewayTokenSpec { keyId: string; role: GatewayRole; filePath: string }
export interface WindowsTokenAclRule {
  sid: string; type: "allow" | "deny"; rights: number; inherited: boolean;
}
export interface WindowsTokenAclReport {
  ownerSid: string; currentUserSid: string; protected: boolean; rules: readonly WindowsTokenAclRule[];
}
export interface GatewayTokenLoaderOptions {
  platform?: NodeJS.Platform; inspectWindowsAcl?: (filePath: string) => Promise<WindowsTokenAclReport>;
}

const execFileAsync = promisify(execFile);
const windowsAclScript = String.raw`
$ErrorActionPreference = 'Stop'
$tokenPath = [Environment]::GetEnvironmentVariable('CHAT2CODEX_GATEWAY_ACL_PATH', 'Process')
if ([string]::IsNullOrWhiteSpace($tokenPath)) { throw 'Missing ACL inspection path' }
$acl = Get-Acl -LiteralPath $tokenPath
$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Convert-ToSid([System.Security.Principal.IdentityReference]$identity) {
  try { return $identity.Translate([Security.Principal.SecurityIdentifier]).Value }
  catch { return $identity.Value }
}
$owner = New-Object Security.Principal.NTAccount($acl.Owner)
$result = [ordered]@{
  ownerSid = Convert-ToSid $owner
  currentUserSid = $currentUserSid
  protected = [bool]$acl.AreAccessRulesProtected
  rules = @($acl.Access | ForEach-Object {
    [ordered]@{
      sid = Convert-ToSid $_.IdentityReference
      type = $_.AccessControlType.ToString().ToLowerInvariant()
      rights = [int]$_.FileSystemRights
      inherited = [bool]$_.IsInherited
    }
  })
}
$result | ConvertTo-Json -Depth 5 -Compress
`;

export async function inspectWindowsTokenAcl(filePath: string): Promise<WindowsTokenAclReport> {
  if (process.platform !== "win32") throw new Error("Windows ACL inspection requires Windows");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", windowsAclScript,
  ], {
    windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024, encoding: "utf8",
    env: { ...process.env, CHAT2CODEX_GATEWAY_ACL_PATH: filePath },
  });
  const parsed = JSON.parse(stdout) as Partial<WindowsTokenAclReport>;
  if (typeof parsed.ownerSid !== "string" || typeof parsed.currentUserSid !== "string" ||
      typeof parsed.protected !== "boolean" || !Array.isArray(parsed.rules))
    throw new Error("Windows Gateway token ACL inspection returned malformed data");
  const rules = parsed.rules.map((rule) => {
    if (!rule || typeof rule.sid !== "string" || (rule.type !== "allow" && rule.type !== "deny") ||
        !Number.isSafeInteger(rule.rights) || typeof rule.inherited !== "boolean")
      throw new Error("Windows Gateway token ACL inspection returned malformed rules");
    return { sid: rule.sid, type: rule.type, rights: rule.rights, inherited: rule.inherited };
  });
  return { ownerSid: parsed.ownerSid, currentUserSid: parsed.currentUserSid, protected: parsed.protected, rules };
}

const roleEndpoints: Readonly<Record<GatewayRole, readonly GatewayEndpointKind[]>> = {
  prompt_hook: ["user_prompt_submit"], stop_hook: ["stop_wake"],
  desktop_mcp: ["status", "desktop_heartbeat", "takeover_desktop", "release_bridge"],
};

export async function loadGatewayCapabilities(
  specs: readonly GatewayTokenSpec[],
  options: GatewayTokenLoaderOptions = {},
): Promise<GatewayCapability[]> {
  if (specs.length !== 3 || new Set(specs.map((spec) => spec.role)).size !== 3)
    throw new Error("Gateway requires one token file for every scoped role");
  const normalizedPaths = new Set<string>();
  const materials = new Set<string>();
  const loaded: GatewayCapability[] = [];
  for (const spec of specs) {
    if (!path.isAbsolute(spec.filePath)) throw new Error("Gateway token path must be absolute");
    const absolute = path.resolve(spec.filePath);
    const normalized = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (normalizedPaths.has(normalized)) throw new Error("Gateway token paths must be distinct");
    normalizedPaths.add(normalized);
    const fileInfo = await statNoFollow(absolute);
    if (fileInfo.symbolic) throw new Error("Gateway token path must not be a symbolic link");
    if (!fileInfo.regular) throw new Error("Gateway token path must be a regular file");
    const resolved = await realpath(absolute);
    if (path.resolve(resolved).toLowerCase() !== absolute.toLowerCase())
      throw new Error("Gateway token path must not traverse a symbolic link");
    if ((options.platform ?? process.platform) === "win32") {
      requireOwnerOnlyWindowsTokenAcl(await (options.inspectWindowsAcl ?? inspectWindowsTokenAcl)(absolute));
    }
    const handle = await open(absolute, "r");
    let temporary = Buffer.alloc(0);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== fileInfo.dev || opened.ino !== fileInfo.ino)
        throw new Error("Gateway token file changed while opening");
      temporary = await handle.readFile();
      if (temporary.byteLength > 128) throw new Error("Gateway token must be one bounded base64url key");
      const value = temporary.toString("utf8");
      if (!/^[A-Za-z0-9_-]{43}\r?\n?$/u.test(value))
        throw new Error("Gateway token must contain exactly one 256-bit base64url key");
      const encoded = value.trim();
      const decoded = Buffer.from(encoded, "base64url");
      if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded)
        throw new Error("Gateway token must contain exactly one 256-bit base64url key");
      const fingerprint = decoded.toString("hex");
      if (materials.has(fingerprint)) throw new Error("Gateway token files contain duplicate key material");
      materials.add(fingerprint);
      loaded.push({ keyId: spec.keyId, role: spec.role, endpoints: roleEndpoints[spec.role], secret: Uint8Array.from(decoded) });
      decoded.fill(0);
    } finally {
      temporary.fill(0);
      await handle.close();
    }
  }
  return loaded;
}

async function statNoFollow(filePath: string): Promise<{ symbolic: boolean; regular: boolean; dev: number; ino: number }> {
  const { lstat } = await import("node:fs/promises");
  const value = await lstat(filePath);
  return { symbolic: value.isSymbolicLink(), regular: value.isFile(), dev: value.dev, ino: value.ino };
}

const broadReadSids = new Set(["S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-32-546"]);
const privilegedSids = new Set(["S-1-5-18", "S-1-5-32-544"]);
export function requireOwnerOnlyWindowsTokenAcl(report: WindowsTokenAclReport): void {
  if (!report.protected || report.ownerSid !== report.currentUserSid)
    throw new Error("Gateway token ACL must be owner-only and protected");
  for (const rule of report.rules) {
    if (rule.type === "allow" && rule.rights !== 0 &&
      (!privilegedSids.has(rule.sid) && rule.sid !== report.currentUserSid ||
        rule.inherited || broadReadSids.has(rule.sid)))
      throw new Error("Gateway token ACL grants broad or inherited read access");
  }
}

export interface DurableMutationReplay {
  checkAndRecord(
    requestId: string,
    bodySha256: string,
    request: ReturnType<typeof parseGatewayRequest>,
  ): Promise<"new" | "idempotent" | "conflict">;
}
export interface GatewayDecisionLog {
  requestId: string; role: GatewayRole | "unknown"; endpoint: GatewayEndpointKind | "unknown";
  decision: string; latencyMs: number; errorCode: string | undefined;
}
export interface DesktopGatewayServerOptions {
  port: number; capabilities: readonly GatewayCapability[]; controller: DesktopGatewayController;
  mutationReplay: DurableMutationReplay; nonceCache?: NonceReplayCache; expectedHost?: string;
  maxBodyBytes?: number; maxConcurrentRequests?: number; requestDeadlineMs?: number;
  now?: () => number; onDecision?: (entry: GatewayDecisionLog) => void;
}

export class DesktopGatewayServer {
  private server: http.Server | undefined;
  private accepting = true;
  private active = 0;
  private readonly nonceCache: NonceReplayCache;
  private readonly maxBodyBytes: number;
  private readonly maxConcurrentRequests: number;
  private readonly requestDeadlineMs: number;
  constructor(private readonly options: DesktopGatewayServerOptions) {
    this.nonceCache = options.nonceCache ?? new NonceReplayCache();
    this.maxBodyBytes = positiveInteger(options.maxBodyBytes ?? 64 * 1024, "maxBodyBytes");
    this.maxConcurrentRequests = positiveInteger(options.maxConcurrentRequests ?? 16, "maxConcurrentRequests");
    this.requestDeadlineMs = positiveInteger(options.requestDeadlineMs ?? 2_000, "requestDeadlineMs");
  }

  async start(): Promise<{ host: "127.0.0.1"; port: number }> {
    if (this.server) throw new Error("Desktop Gateway server is already started");
    this.accepting = true;
    const server = http.createServer((request, response) => {
      if (!this.accepting) { this.sendUnsigned(response, 503); return; }
      void this.handle(request, response);
    });
    server.requestTimeout = this.requestDeadlineMs;
    server.headersTimeout = this.requestDeadlineMs;
    server.keepAliveTimeout = 1_000;
    server.maxHeadersCount = 32;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError); server.once("listening", onListening);
      server.listen(this.options.port, "127.0.0.1");
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
      await this.stop(); throw new Error("Desktop Gateway did not bind IPv4 loopback");
    }
    return { host: "127.0.0.1", port: address.port };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.accepting = false;
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") resolve();
      else reject(error);
    }));
    this.server = undefined;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (this.active >= this.maxConcurrentRequests) { this.sendUnsigned(response, 503); return; }
    this.active++;
    const startedAt = this.options.now?.() ?? Date.now();
    let requestId = "unknown"; let role: GatewayRole | "unknown" = "unknown";
    let endpoint: GatewayEndpointKind | "unknown" = "unknown";
    let decision = "authentication_failed"; let errorCode: string | undefined;
    try {
      const peer = request.socket.remoteAddress;
      if (peer !== "127.0.0.1") throw new HttpFailure(403, "non_loopback_peer");
      const headers = uniqueHeaders(request.rawHeaders);
      const expectedHost = this.options.expectedHost ?? `127.0.0.1:${this.boundPort()}`;
      if (headers.host !== expectedHost) throw new HttpFailure(400, "invalid_host");
      if (headers["content-type"] !== "application/json") throw new HttpFailure(415, "invalid_content_type");
      if (headers.origin || headers.forwarded || headers.via ||
        Object.keys(headers).some((name) => name.startsWith("x-forwarded-")))
        throw new HttpFailure(400, "browser_or_proxy_headers");
      const method = request.method ?? ""; const route = request.url ?? "";
      if (method !== "POST") throw new HttpFailure(405, "method_not_allowed");
      const body = await this.readBoundedBody(request);
      const authenticated = await authenticateGatewayRequest({
        method, path: route, headers: request.rawHeaders, body, capabilities: this.options.capabilities,
        nonceCache: this.nonceCache, now: this.options.now,
      });
      requestId = authenticated.requestId; role = authenticated.role; endpoint = authenticated.endpoint;
      const parsed = parseGatewayRequest(parseJsonWithoutDuplicateKeys(body));
      if (parsed.kind !== endpoint) throw new HttpFailure(400, "route_body_mismatch");
      if (("requestId" in parsed ? parsed.requestId : parsed.eventId) !== requestId)
        throw new HttpFailure(400, "request_id_mismatch");
      if (parsed.kind === "user_prompt_submit" && parsed.controlKind) {
        const expectedCommitment = createPromptCommitment(
          authenticated.capability.secret, desktopGatewayControlPrompts[parsed.controlKind],
        );
        if (!constantTimeCommitmentEqual(expectedCommitment, parsed.promptCommitment))
          throw new GatewayAuthenticationError("invalid_signature");
      }
      if (endpoint !== "status") {
        const replay = await this.options.mutationReplay.checkAndRecord(requestId, authenticated.bodySha256, parsed);
        if (replay === "conflict") throw new HttpFailure(409, "integrity_conflict");
      }
      const reply = await deadline(
        dispatch(this.options.controller, parsed), this.requestDeadlineMs,
      );
      if (reply.requestId !== requestId) throw new HttpFailure(500, "controller_response_mismatch");
      decision = reply.decision;
      const replyBody = Buffer.from(JSON.stringify(reply), "utf8");
      const signed = signGatewayResponse({
        response: reply, body: replyBody, requestNonce: authenticated.nonce,
        timestamp: new Date(this.options.now?.() ?? Date.now()).toISOString(),
        capability: authenticated.capability,
      });
      response.writeHead(200, { "content-type": "application/json", "content-length": replyBody.byteLength, ...signed.headers });
      response.end(replyBody);
    } catch (error) {
      const failure = classifyFailure(error); decision = failure.decision; errorCode = failure.code;
      if (!response.headersSent) this.sendUnsigned(response, failure.status); else response.destroy();
    } finally {
      this.active--;
      this.options.onDecision?.({
        requestId, role, endpoint, decision,
        latencyMs: Math.max(0, (this.options.now?.() ?? Date.now()) - startedAt), errorCode,
      });
    }
  }

  private boundPort(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") throw new Error("Gateway is not listening");
    return address.port;
  }
  private async readBoundedBody(request: IncomingMessage): Promise<Buffer> {
    const declared = request.headers["content-length"];
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > this.maxBodyBytes))
      throw new HttpFailure(413, "body_too_large");
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk as Uint8Array); length += bytes.byteLength;
      if (length > this.maxBodyBytes) throw new HttpFailure(413, "body_too_large");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, length);
  }
  private sendUnsigned(response: ServerResponse, status: number): void {
    response.writeHead(status, { "content-type": "application/json", "content-length": 2 }); response.end("{}");
  }
}

function uniqueHeaders(rawHeaders: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]!.toLowerCase();
    if (result[name] !== undefined) throw new HttpFailure(400, "duplicate_header");
    result[name] = rawHeaders[index + 1]!;
  }
  return result;
}

async function dispatch(
  controller: DesktopGatewayController, request: ReturnType<typeof parseGatewayRequest>,
): Promise<DesktopGatewayResponse> {
  switch (request.kind) {
    case "status": return controller.status(request);
    case "desktop_heartbeat": return controller.heartbeat(request);
    case "takeover_desktop": return controller.takeover(request);
    case "release_bridge": return controller.release(request);
    case "user_prompt_submit": return controller.submitPrompt(request);
    case "stop_wake": return controller.wake(request);
  }
}

class HttpFailure extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function classifyFailure(error: unknown): { status: number; code: string; decision: string } {
  if (error instanceof HttpFailure) return { status: error.status, code: error.code, decision: error.code === "integrity_conflict" ? "integrity_conflict" : "authentication_failed" };
  if (error instanceof GatewayAuthenticationError) return { status: 401, code: error.publicCode, decision: "authentication_failed" };
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) return { status: 400, code: "malformed_request", decision: "authentication_failed" };
  if (error instanceof Error && error.message === "request_deadline") return { status: 408, code: "request_deadline", decision: "authentication_failed" };
  return { status: 500, code: "internal_error", decision: "authentication_failed" };
}
async function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("request_deadline")), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`); return value;
}
function constantTimeCommitmentEqual(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "hex");
  const valid = /^[0-9a-f]{64}$/u.test(supplied);
  const suppliedBytes = valid ? Buffer.from(supplied, "hex") : Buffer.alloc(32);
  return timingSafeEqual(expectedBytes, suppliedBytes) && valid;
}
