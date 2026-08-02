import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { DesktopGatewayResponse, GatewayEndpointKind } from "./contracts.js";
import { desktopGatewayProtocolVersion, endpointForGatewayPath } from "./protocol.js";

export type GatewayRole = "prompt_hook" | "stop_hook" | "desktop_mcp";

export interface GatewayCapability {
  keyId: string;
  role: GatewayRole;
  endpoints: readonly GatewayEndpointKind[];
  secret: Uint8Array;
}

export type GatewayAuthErrorCode =
  | "malformed_request" | "protocol_mismatch" | "unknown_capability"
  | "endpoint_scope_denied" | "stale_request" | "nonce_reused"
  | "nonce_cache_full"
  | "body_digest_mismatch" | "invalid_signature" | "response_binding_failed";

export class GatewayAuthenticationError extends Error {
  readonly publicCode = "authentication_failed";
  constructor(readonly code: GatewayAuthErrorCode, message = "Gateway authentication failed") {
    super(message);
    this.name = "GatewayAuthenticationError";
  }
}

const signedRequestHeaders = [
  "x-chat2codex-version", "x-chat2codex-key-id", "x-chat2codex-role",
  "x-chat2codex-request-id", "x-chat2codex-timestamp", "x-chat2codex-nonce",
  "x-chat2codex-body-sha256", "x-chat2codex-signature",
] as const;

const signedResponseHeaders = [
  "x-chat2codex-version", "x-chat2codex-request-id", "x-chat2codex-request-nonce",
  "x-chat2codex-timestamp", "x-chat2codex-body-sha256", "x-chat2codex-signature",
] as const;

type HeaderBag = Record<string, string | string[] | undefined> | readonly string[];

export function parseUniqueGatewayHeaders(headers: HeaderBag): Record<string, string> {
  const parsed: Record<string, string> = {};
  const add = (rawName: string, rawValue: string) => {
    const name = rawName.toLowerCase();
    if (parsed[name] !== undefined) throw new GatewayAuthenticationError("malformed_request");
    parsed[name] = rawValue;
  };
  if (Array.isArray(headers)) {
    if (headers.length % 2 !== 0) throw new GatewayAuthenticationError("malformed_request");
    for (let index = 0; index < headers.length; index += 2) add(headers[index]!, headers[index + 1]!);
  } else {
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) throw new GatewayAuthenticationError("malformed_request");
      if (value !== undefined) add(name, value);
    }
  }
  return parsed;
}

export interface CanonicalGatewayRequest {
  method: string; path: string; version: string; keyId: string; role: string;
  requestId: string; timestamp: string; nonce: string; bodySha256: string;
}

function field(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, "utf8")}:${value}`;
}

export function canonicalizeGatewayRequest(input: CanonicalGatewayRequest): Buffer {
  return Buffer.from([
    "C2C-GATEWAY-REQUEST-V1",
    field("method", input.method), field("path", input.path),
    field("version", input.version), field("key-id", input.keyId),
    field("role", input.role), field("request-id", input.requestId),
    field("timestamp", input.timestamp), field("nonce", input.nonce),
    field("body-sha256", input.bodySha256),
  ].join("\n"), "utf8");
}

export interface SignGatewayRequestInput {
  method: string; path: string; requestId: string; timestamp: string; nonce: string;
  body: Uint8Array; capability: GatewayCapability;
}

export interface SignedGatewayRequest { body: Buffer; headers: Record<string, string> }

export function signGatewayRequest(input: SignGatewayRequestInput): SignedGatewayRequest {
  requireUppercasePost(input.method);
  const endpoint = endpointForGatewayPath(input.path);
  validateCapability(input.capability);
  if (!input.capability.endpoints.includes(endpoint)) throw new GatewayAuthenticationError("endpoint_scope_denied");
  requireUuid(input.requestId);
  requireTimestamp(input.timestamp);
  requireNonce(input.nonce);
  const body = Buffer.from(input.body);
  const bodySha256 = sha256(body);
  const metadata = {
    method: input.method, path: input.path, version: desktopGatewayProtocolVersion,
    keyId: input.capability.keyId, role: input.capability.role, requestId: input.requestId,
    timestamp: input.timestamp, nonce: input.nonce, bodySha256,
  };
  return {
    body,
    headers: {
      "x-chat2codex-version": metadata.version,
      "x-chat2codex-key-id": metadata.keyId,
      "x-chat2codex-role": metadata.role,
      "x-chat2codex-request-id": metadata.requestId,
      "x-chat2codex-timestamp": metadata.timestamp,
      "x-chat2codex-nonce": metadata.nonce,
      "x-chat2codex-body-sha256": metadata.bodySha256,
      "x-chat2codex-signature": hmacHex(input.capability.secret, canonicalizeGatewayRequest(metadata)),
    },
  };
}

export interface NonceReplayCacheOptions { now?: () => number; maxEntries?: number; freshnessMs?: number }

export class NonceReplayCache {
  private readonly entries = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly freshnessMs: number;
  constructor(options: NonceReplayCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.freshnessMs = options.freshnessMs ?? 30_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries <= 0) throw new Error("maxEntries must be positive");
  }
  consume(keyId: string, nonce: string, timestampMs: number): void {
    const cutoff = this.now() - this.freshnessMs;
    for (const [key, seenAt] of this.entries) if (seenAt < cutoff) this.entries.delete(key);
    const identity = `${keyId}:${nonce}`;
    if (this.entries.has(identity)) throw new GatewayAuthenticationError("nonce_reused");
    if (this.entries.size >= this.maxEntries)
      throw new GatewayAuthenticationError("nonce_cache_full");
    this.entries.set(identity, timestampMs);
  }
}

export interface AuthenticateGatewayRequestInput {
  method: string; path: string; headers: HeaderBag; body: Uint8Array;
  capabilities: readonly GatewayCapability[]; nonceCache: NonceReplayCache; now?: () => number;
}

export interface AuthenticatedGatewayRequest {
  endpoint: GatewayEndpointKind; role: GatewayRole; requestId: string; keyId: string;
  nonce: string; bodySha256: string; capability: GatewayCapability;
}

export async function authenticateGatewayRequest(
  input: AuthenticateGatewayRequestInput,
): Promise<AuthenticatedGatewayRequest> {
  try {
    requireUppercasePost(input.method);
    const endpoint = endpointForGatewayPath(input.path);
    const headers = parseUniqueGatewayHeaders(input.headers);
    for (const header of signedRequestHeaders) requireHeader(headers, header);
    if (headers["x-chat2codex-version"] !== desktopGatewayProtocolVersion)
      throw new GatewayAuthenticationError("protocol_mismatch");
    const capability = input.capabilities.find((entry) => entry.keyId === headers["x-chat2codex-key-id"]);
    if (!capability || capability.role !== headers["x-chat2codex-role"])
      throw new GatewayAuthenticationError("unknown_capability");
    validateCapability(capability);
    if (!capability.endpoints.includes(endpoint)) throw new GatewayAuthenticationError("endpoint_scope_denied");
    const requestId = headers["x-chat2codex-request-id"]!;
    const timestamp = headers["x-chat2codex-timestamp"]!;
    const nonce = headers["x-chat2codex-nonce"]!;
    requireUuid(requestId); requireNonce(nonce);
    const timestampMs = requireTimestamp(timestamp);
    if (Math.abs((input.now ?? Date.now)() - timestampMs) > 30_000)
      throw new GatewayAuthenticationError("stale_request");
    const bodySha256 = sha256(input.body);
    if (bodySha256 !== headers["x-chat2codex-body-sha256"])
      throw new GatewayAuthenticationError("body_digest_mismatch");
    const canonical = canonicalizeGatewayRequest({
      method: input.method, path: input.path, version: headers["x-chat2codex-version"]!,
      keyId: capability.keyId, role: capability.role, requestId, timestamp, nonce, bodySha256,
    });
    if (!constantTimeHexEqual(
      hmacHex(capability.secret, canonical), headers["x-chat2codex-signature"]!,
    )) throw new GatewayAuthenticationError("invalid_signature");
    input.nonceCache.consume(capability.keyId, nonce, timestampMs);
    return { endpoint, role: capability.role, requestId, keyId: capability.keyId, nonce, bodySha256, capability };
  } catch (error) {
    if (error instanceof GatewayAuthenticationError) throw error;
    throw new GatewayAuthenticationError("malformed_request");
  }
}

interface CanonicalGatewayResponse {
  version: string; requestId: string; requestNonce: string; decision: string;
  generation: string; fenceId: string; bodySha256: string; timestamp: string;
}

function canonicalizeGatewayResponse(input: CanonicalGatewayResponse): Buffer {
  return Buffer.from([
    "C2C-GATEWAY-RESPONSE-V1", field("version", input.version),
    field("request-id", input.requestId), field("request-nonce", input.requestNonce),
    field("decision", input.decision), field("generation", input.generation),
    field("fence-id", input.fenceId), field("body-sha256", input.bodySha256),
    field("timestamp", input.timestamp),
  ].join("\n"), "utf8");
}

export function signGatewayResponse(input: {
  response: DesktopGatewayResponse; body: Uint8Array; requestNonce: string;
  timestamp: string; capability: GatewayCapability;
}): { headers: Record<string, string> } {
  requireNonce(input.requestNonce); requireTimestamp(input.timestamp);
  const bodySha256 = sha256(input.body);
  const metadata: CanonicalGatewayResponse = {
    version: desktopGatewayProtocolVersion, requestId: input.response.requestId,
    requestNonce: input.requestNonce, decision: input.response.decision,
    generation: input.response.generation?.toString() ?? "",
    fenceId: input.response.fenceId ?? "", bodySha256, timestamp: input.timestamp,
  };
  return { headers: {
    "x-chat2codex-version": metadata.version, "x-chat2codex-request-id": metadata.requestId,
    "x-chat2codex-request-nonce": metadata.requestNonce, "x-chat2codex-timestamp": metadata.timestamp,
    "x-chat2codex-body-sha256": bodySha256,
    "x-chat2codex-signature": hmacHex(input.capability.secret, canonicalizeGatewayResponse(metadata)),
  } };
}

export function verifyGatewayResponse(input: {
  response: DesktopGatewayResponse; body: Uint8Array; headers: HeaderBag;
  expectedRequestId: string; expectedRequestNonce: string; capability: GatewayCapability; now?: () => number;
}): DesktopGatewayResponse {
  try {
    const headers = parseUniqueGatewayHeaders(input.headers);
    for (const header of signedResponseHeaders) requireHeader(headers, header);
    const timestamp = headers["x-chat2codex-timestamp"]!;
    const timestampMs = requireTimestamp(timestamp);
    if (Math.abs((input.now ?? Date.now)() - timestampMs) > 30_000 ||
      headers["x-chat2codex-version"] !== desktopGatewayProtocolVersion ||
      headers["x-chat2codex-request-id"] !== input.expectedRequestId ||
      headers["x-chat2codex-request-nonce"] !== input.expectedRequestNonce ||
      input.response.requestId !== input.expectedRequestId)
      throw new GatewayAuthenticationError("response_binding_failed");
    const bodySha256 = sha256(input.body);
    if (headers["x-chat2codex-body-sha256"] !== bodySha256)
      throw new GatewayAuthenticationError("response_binding_failed");
    const metadata: CanonicalGatewayResponse = {
      version: desktopGatewayProtocolVersion, requestId: input.response.requestId,
      requestNonce: input.expectedRequestNonce, decision: input.response.decision,
      generation: input.response.generation?.toString() ?? "", fenceId: input.response.fenceId ?? "",
      bodySha256, timestamp,
    };
    if (!constantTimeHexEqual(
      hmacHex(input.capability.secret, canonicalizeGatewayResponse(metadata)),
      headers["x-chat2codex-signature"]!,
    )) throw new GatewayAuthenticationError("response_binding_failed");
    return input.response;
  } catch (error) {
    if (error instanceof GatewayAuthenticationError) throw error;
    throw new GatewayAuthenticationError("response_binding_failed");
  }
}

export function createPromptCommitment(secret: Uint8Array, prompt: string): string {
  const promptBytes = Buffer.from(prompt, "utf8");
  const domain = Buffer.from("C2C-DESKTOP-PROMPT-COMMITMENT-V1\0", "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(promptBytes.byteLength));
  return hmacHex(secret, Buffer.concat([domain, length, promptBytes]));
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function hmacHex(secret: Uint8Array, value: Uint8Array): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
function constantTimeHexEqual(expected: string, supplied: string): boolean {
  const valid = /^[0-9a-f]{64}$/u.test(supplied);
  const actual = valid ? Buffer.from(supplied, "hex") : Buffer.alloc(32);
  const equal = timingSafeEqual(Buffer.from(expected, "hex"), actual);
  return valid && equal;
}
function requireHeader(headers: Record<string, string>, name: string): void {
  if (!headers[name]) throw new GatewayAuthenticationError("malformed_request");
}
function requireUppercasePost(method: string): void {
  if (method !== "POST") throw new GatewayAuthenticationError("malformed_request");
}
function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    throw new GatewayAuthenticationError("malformed_request");
}
function requireTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new GatewayAuthenticationError("malformed_request");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new GatewayAuthenticationError("malformed_request");
  return timestamp;
}
function requireNonce(value: string): void {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(value) || Buffer.from(value, "base64url").byteLength !== 16)
    throw new GatewayAuthenticationError("malformed_request");
}
function validateCapability(capability: GatewayCapability): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(capability.keyId) || capability.secret.byteLength !== 32 ||
      capability.endpoints.length === 0) throw new GatewayAuthenticationError("unknown_capability");
  const expected: Readonly<Record<GatewayRole, readonly GatewayEndpointKind[]>> = {
    prompt_hook: ["user_prompt_submit"],
    stop_hook: ["stop_wake"],
    desktop_mcp: ["status", "desktop_heartbeat", "takeover_desktop", "release_bridge"],
  };
  const actual = [...new Set(capability.endpoints)].sort();
  const allowed = [...expected[capability.role]].sort();
  if (actual.length !== capability.endpoints.length || actual.join("\0") !== allowed.join("\0"))
    throw new GatewayAuthenticationError("endpoint_scope_denied");
}
