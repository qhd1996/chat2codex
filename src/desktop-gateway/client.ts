import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { parseGatewayResponse, type DesktopGatewayResponse, type GatewayEndpointKind, type GatewayRequest } from "./contracts.js";

const PROTOCOL_VERSION = "1";
const MAX_TOKEN_FILE_BYTES = 128;
const FRESHNESS_MS = 30_000;

export type DesktopGatewayRole = "prompt_hook" | "stop_hook" | "desktop_mcp";
export type GatewayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface WindowsTokenAclRule { sid: string; type: "allow" | "deny"; rights: number; inherited: boolean; }
export interface WindowsTokenAclReport { ownerSid: string; currentUserSid: string; protected: boolean; rules: readonly WindowsTokenAclRule[]; }
export interface TokenFileOptions { platform?: NodeJS.Platform; inspectWindowsAcl?: (tokenPath: string) => Promise<WindowsTokenAclReport>; }

export async function loadScopedTokenFile(tokenPath: string, options: TokenFileOptions = {}): Promise<Buffer> {
  if (!path.isAbsolute(tokenPath)) throw new Error("Desktop Gateway token path must be absolute");
  const link = await lstat(tokenPath);
  if (link.isSymbolicLink()) throw new Error("Desktop Gateway token file must not be a symbolic link");
  if (!link.isFile()) throw new Error("Desktop Gateway token path must be a regular file");
  if (path.resolve(await realpath(tokenPath)).toLowerCase() !== path.resolve(tokenPath).toLowerCase()) throw new Error("Desktop Gateway token path must not traverse a symbolic link");
  if (link.size < 40 || link.size > MAX_TOKEN_FILE_BYTES) throw new Error("Desktop Gateway token file must contain one bounded base64url key");
  const handle = await open(tokenPath, "r");
  let raw: Buffer;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== link.dev || opened.ino !== link.ino) throw new Error("Desktop Gateway token file changed while opening");
    raw = await handle.readFile();
  } finally { await handle.close(); }
  try {
    const value = raw.toString("utf8");
    if (!/^[A-Za-z0-9_-]{43}\r?\n?$/u.test(value)) throw new Error("Desktop Gateway token file must contain one 256-bit base64url key");
    const encoded = value.replace(/\r?\n$/u, "");
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.length !== 32 || decoded.toString("base64url") !== encoded) throw new Error("Desktop Gateway token file contains malformed base64url");
    if ((options.platform ?? process.platform) === "win32") requireOwnerOnlyAcl(await (options.inspectWindowsAcl ?? inspectWindowsTokenFile)(tokenPath));
    return Buffer.from(decoded);
  } finally { raw.fill(0); }
}

async function inspectWindowsTokenFile(tokenPath: string): Promise<WindowsTokenAclReport> {
  const script = "$a=Get-Acl -LiteralPath $env:CHAT2CODEX_GATEWAY_ACL_PATH; $u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; function S($x){try{$x.Translate([Security.Principal.SecurityIdentifier]).Value}catch{$x.Value}}; [ordered]@{ownerSid=S (New-Object Security.Principal.NTAccount($a.Owner));currentUserSid=$u;protected=[bool]$a.AreAccessRulesProtected;rules=@($a.Access|%{[ordered]@{sid=S $_.IdentityReference;type=$_.AccessControlType.ToString().ToLowerInvariant();rights=[int]$_.FileSystemRights;inherited=[bool]$_.IsInherited}})}|ConvertTo-Json -Depth 5 -Compress";
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: { ...process.env, CHAT2CODEX_GATEWAY_ACL_PATH: tokenPath } });
  const chunks: Buffer[] = []; let length = 0;
  child.stdout.on("data", (chunk: Buffer) => { length += chunk.byteLength; if (length <= 64 * 1024) chunks.push(chunk); else child.kill(); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0 || length > 64 * 1024) throw new Error("Desktop Gateway token ACL inspection failed");
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as WindowsTokenAclReport;
  if (typeof parsed.ownerSid !== "string" || typeof parsed.currentUserSid !== "string" || typeof parsed.protected !== "boolean" || !Array.isArray(parsed.rules)) throw new Error("Desktop Gateway token ACL inspection failed");
  return parsed;
}

const broadReadSids = new Set(["S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-32-546"]);
function requireOwnerOnlyAcl(report: WindowsTokenAclReport): void {
  if (!report.protected || report.ownerSid !== report.currentUserSid) throw new Error("Desktop Gateway token file ACL is not owner-only");
  for (const rule of report.rules) {
    if (!rule || typeof rule.sid !== "string" || (rule.type !== "allow" && rule.type !== "deny") || !Number.isSafeInteger(rule.rights) || typeof rule.inherited !== "boolean") throw new Error("Desktop Gateway token file ACL is not owner-only");
    if (rule.type === "allow" && rule.rights !== 0 && (rule.sid !== report.currentUserSid || rule.inherited || broadReadSids.has(rule.sid))) throw new Error("Desktop Gateway token file ACL is not owner-only");
  }
}

export function computePromptCommitment(secret: Uint8Array, prompt: string): string {
  const promptBytes = Buffer.from(prompt, "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(promptBytes.byteLength));
  return createHmac("sha256", secret).update("C2C-DESKTOP-PROMPT-COMMITMENT-V1\0", "utf8").update(length).update(promptBytes).digest("hex");
}

const ENDPOINT_PATHS: Record<GatewayEndpointKind, string> = {
  status: "/v1/status", desktop_heartbeat: "/v1/desktop-heartbeat", takeover_desktop: "/v1/takeover-desktop",
  release_bridge: "/v1/release-bridge", user_prompt_submit: "/v1/user-prompt-submit", stop_wake: "/v1/stop-wake",
};

export interface DesktopGatewayClientOptions {
  port: number; expectedHost: string; role: DesktopGatewayRole; keyId: string; secret: Uint8Array;
  timeoutMs?: number; fetch?: GatewayFetch; now?: () => Date; randomUUID?: () => string; randomNonce?: () => string;
}

export class DesktopGatewayClient {
  readonly #options: DesktopGatewayClientOptions & { fetch: GatewayFetch; now: () => Date; randomUUID: () => string; randomNonce: () => string; timeoutMs: number };
  constructor(options: DesktopGatewayClientOptions) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error("Invalid Desktop Gateway port");
    if (options.expectedHost !== "127.0.0.1:" + options.port) throw new Error("Desktop Gateway Host must be exact IPv4 loopback");
    if (options.secret.byteLength !== 32) throw new Error("Desktop Gateway key must be 256 bits");
    this.#options = { ...options, timeoutMs: options.timeoutMs ?? 1_500, fetch: options.fetch ?? globalThis.fetch,
      now: options.now ?? (() => new Date()), randomUUID: options.randomUUID ?? randomUUID,
      randomNonce: options.randomNonce ?? (() => randomBytes(16).toString("base64url")) };
  }

  async request(endpoint: GatewayEndpointKind, request: GatewayRequest): Promise<DesktopGatewayResponse> {
    const requestId = "requestId" in request ? request.requestId : request.eventId;
    const pathName = ENDPOINT_PATHS[endpoint];
    if (request.kind !== endpoint) throw new Error("Desktop Gateway endpoint/request mismatch");
    const body = JSON.stringify(request);
    const timestamp = this.#options.now().toISOString();
    const nonce = this.#options.randomNonce();
    const bodyDigest = sha256(body);
    const mac = this.#signRequest({ pathName, timestamp, nonce, requestId, bodyDigest });
    const origin = "http://127.0.0.1:" + this.#options.port;
    const response = await this.#options.fetch(origin + pathName, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(this.#options.timeoutMs), body,
      headers: { "content-type": "application/json", host: this.#options.expectedHost, "x-chat2codex-version": PROTOCOL_VERSION,
        "x-chat2codex-key-id": this.#options.keyId, "x-chat2codex-role": this.#options.role, "x-chat2codex-request-id": requestId,
        "x-chat2codex-timestamp": timestamp, "x-chat2codex-nonce": nonce, "x-chat2codex-body-sha256": bodyDigest, "x-chat2codex-signature": mac },
    });
    if (response.redirected || response.url && new URL(response.url).origin !== origin) throw new Error("Desktop Gateway redirect refused");
    if (response.status !== 200 || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("Desktop Gateway response refused");
    const responseBody = await response.text();
    this.#verifyResponse({ response, requestId, requestNonce: nonce, body: responseBody });
    return parseGatewayResponse(JSON.parse(responseBody));
  }

  #signRequest(input: { pathName: string; timestamp: string; nonce: string; requestId: string; bodyDigest: string }): string {
    return hmac(this.#options.secret, canonicalRequest({ method: "POST", path: input.pathName, version: PROTOCOL_VERSION,
      keyId: this.#options.keyId, role: this.#options.role, requestId: input.requestId, timestamp: input.timestamp,
      nonce: input.nonce, bodySha256: input.bodyDigest }));
  }

  signResponseForTest(input: { requestId: string; requestNonce: string; body: string; serverTime?: string }): string {
    const parsed = parseGatewayResponse(JSON.parse(input.body));
    return hmac(this.#options.secret, canonicalResponse({ version: PROTOCOL_VERSION, requestId: input.requestId,
      requestNonce: input.requestNonce, decision: parsed.decision, generation: parsed.generation?.toString() ?? "",
      fenceId: parsed.fenceId ?? "", bodySha256: sha256(input.body), timestamp: input.serverTime ?? this.#options.now().toISOString() }));
  }

  #verifyResponse(input: { response: Response; requestId: string; requestNonce: string; body: string }): void {
    const get = (name: string) => input.response.headers.get(name);
    const version = get("x-chat2codex-version"); const requestId = get("x-chat2codex-request-id");
    const nonce = get("x-chat2codex-request-nonce"); const serverTime = get("x-chat2codex-timestamp");
    const bodySha256 = get("x-chat2codex-body-sha256"); const received = get("x-chat2codex-signature");
    if (version !== PROTOCOL_VERSION || requestId !== input.requestId || nonce !== input.requestNonce || !serverTime || bodySha256 !== sha256(input.body) || !received || !/^[0-9a-f]{64}$/u.test(received)) throw new Error("Desktop Gateway response authentication failed");
    const observed = Date.parse(serverTime);
    if (!Number.isFinite(observed) || Math.abs(this.#options.now().getTime() - observed) > FRESHNESS_MS) throw new Error("Desktop Gateway response is stale");
    const expected = this.signResponseForTest({ requestId, requestNonce: nonce, body: input.body, serverTime });
    const a = Buffer.from(received, "hex"); const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Desktop Gateway response authentication failed");
  }
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function hmac(secret: Uint8Array, value: Buffer): string { return createHmac("sha256", secret).update(value).digest("hex"); }
function field(name: string, value: string): string { return name + ":" + Buffer.byteLength(value, "utf8") + ":" + value; }
function canonicalRequest(input: { method: string; path: string; version: string; keyId: string; role: string; requestId: string; timestamp: string; nonce: string; bodySha256: string }): Buffer {
  return Buffer.from(["C2C-GATEWAY-REQUEST-V1", field("method", input.method), field("path", input.path),
    field("version", input.version), field("key-id", input.keyId), field("role", input.role),
    field("request-id", input.requestId), field("timestamp", input.timestamp), field("nonce", input.nonce),
    field("body-sha256", input.bodySha256)].join("\n"), "utf8");
}
function canonicalResponse(input: { version: string; requestId: string; requestNonce: string; decision: string; generation: string; fenceId: string; bodySha256: string; timestamp: string }): Buffer {
  return Buffer.from(["C2C-GATEWAY-RESPONSE-V1", field("version", input.version), field("request-id", input.requestId),
    field("request-nonce", input.requestNonce), field("decision", input.decision), field("generation", input.generation),
    field("fence-id", input.fenceId), field("body-sha256", input.bodySha256), field("timestamp", input.timestamp)].join("\n"), "utf8");
}
