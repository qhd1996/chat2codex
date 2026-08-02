import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { DesktopGatewayResponse, GatewayEndpointKind, GatewayRequest } from "./contracts.js";
import { DesktopGatewayClient, loadScopedTokenFile } from "./client.js";

type Request = (endpoint: GatewayEndpointKind, body: GatewayRequest) => Promise<DesktopGatewayResponse>;
export interface DesktopGatewayMcpOptions {
  rootThreadId: string; bindingId: string; ownerInstanceId: string; request: Request; now?: () => Date; randomUUID?: () => string;
}

const generationArgs = z.object({ expectedGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const emptyArgs = z.object({}).strict();
const tools = [
  { name: "desktop_status", description: "Read bounded redacted ownership status for the configured concrete root." },
  { name: "take_over_for_desktop", description: "Explicitly request Desktop ownership using an expected generation." },
  { name: "release_to_bridge", description: "Explicitly request release to the bridge after reconciliation." },
  { name: "desktop_recovery_guidance", description: "Read fixed recovery guidance without changing ownership." },
] as const;

export class DesktopGatewayMcpSurface {
  readonly #options: DesktopGatewayMcpOptions & { now: () => Date; randomUUID: () => string };
  constructor(options: DesktopGatewayMcpOptions) {
    this.#options = { ...options, now: options.now ?? (() => new Date()), randomUUID: options.randomUUID ?? randomUUID };
  }
  listTools(): Array<{ name: string; description: string }> { return tools.map((tool) => ({ ...tool })); }
  async callTool(name: string, args: unknown): Promise<Record<string, unknown>> {
    if (name === "desktop_recovery_guidance") { emptyArgs.parse(args); return { recoveryCode: "check_authenticated_status_then_reconcile" }; }
    const requestId = this.#options.randomUUID();
    const observedAt = this.#options.now().toISOString();
    let response: DesktopGatewayResponse;
    if (name === "desktop_status") {
      emptyArgs.parse(args);
      response = await this.#options.request("status", { kind: "status", requestId, rootThreadId: this.#options.rootThreadId });
    } else if (name === "take_over_for_desktop") {
      const { expectedGeneration } = generationArgs.parse(args);
      response = await this.#options.request("takeover_desktop", { kind: "takeover_desktop", requestId, bindingId: this.#options.bindingId, expectedGeneration, ownerInstanceId: this.#options.ownerInstanceId, observedAt });
    } else if (name === "release_to_bridge") {
      const { expectedGeneration } = generationArgs.parse(args);
      response = await this.#options.request("release_bridge", { kind: "release_bridge", requestId, bindingId: this.#options.bindingId, expectedGeneration, observedAt });
    } else throw new Error("Unknown Desktop Gateway MCP tool");
    return { decision: response.decision, ...(response.generation === undefined ? {} : { generation: response.generation }), recoveryCode: recoveryCode(response.decision) };
  }
}

function recoveryCode(decision: DesktopGatewayResponse["decision"]): string {
  if (decision === "ownership_uncertain") return "reconcile_required";
  if (decision === "stale_generation") return "refresh_status";
  if (decision === "authentication_failed") return "verify_scoped_key";
  if (decision === "not_found") return "root_not_bound";
  return "none";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMcpStdio();

async function runMcpStdio(): Promise<void> {
  const { createInterface } = await import("node:readline");
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY, terminal: false });
  let surfacePromise: Promise<DesktopGatewayMcpSurface> | undefined;
  for await (const line of input) {
    if (!line.trim()) continue;
    let request: any;
    try { request = JSON.parse(line); }
    catch { writeError(null, -32700, "Parse error"); continue; }
    if (!request || request.jsonrpc !== "2.0" || !(typeof request.id === "string" || typeof request.id === "number" || request.id === null) || typeof request.method !== "string") {
      writeError(request?.id ?? null, -32600, "Invalid request"); continue;
    }
    try {
      if (request.method === "initialize") {
        writeResult(request.id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "chat2codex-desktop-gateway", version: "1" } });
      } else if (request.method === "notifications/initialized") {
        // Notifications have no response.
      } else if (request.method === "tools/list") {
        const surface = surfacePromise ? await surfacePromise : unconfiguredSurface();
        writeResult(request.id, { tools: surface.listTools().map((tool) => ({ ...tool, inputSchema: inputSchema(tool.name) })) });
      } else if (request.method === "tools/call") {
        const names = new Set(tools.map((tool) => tool.name));
        if (!request.params || typeof request.params.name !== "string" || !names.has(request.params.name)) throw new Error("invalid arguments");
        surfacePromise ??= createConfiguredSurface();
        const value = await (await surfacePromise).callTool(request.params.name, request.params.arguments ?? {});
        writeResult(request.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
      } else writeError(request.id, -32601, "Method not found");
    } catch { writeError(request.id, -32602, "Invalid parameters or unavailable authenticated Gateway"); }
  }
}

function unconfiguredSurface(): DesktopGatewayMcpSurface {
  return new DesktopGatewayMcpSurface({ rootThreadId: "unconfigured", bindingId: "unconfigured", ownerInstanceId: "unconfigured", request: async () => { throw new Error("unconfigured"); } });
}
async function createConfiguredSurface(): Promise<DesktopGatewayMcpSurface> {
  const port = Number(requiredEnvironment("CHAT2CODEX_DESKTOP_GATEWAY_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid port");
  const secret = await loadScopedTokenFile(requiredEnvironment("CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE"));
  const client = new DesktopGatewayClient({ port, expectedHost: "127.0.0.1:" + port, role: "desktop_mcp", keyId: requiredEnvironment("CHAT2CODEX_DESKTOP_MCP_KEY_ID"), secret });
  return new DesktopGatewayMcpSurface({ rootThreadId: requiredEnvironment("CHAT2CODEX_DESKTOP_ROOT_THREAD_ID"), bindingId: requiredEnvironment("CHAT2CODEX_DESKTOP_BINDING_ID"), ownerInstanceId: requiredEnvironment("CHAT2CODEX_DESKTOP_OWNER_INSTANCE_ID"), request: (endpoint, body) => client.request(endpoint, body) });
}
function inputSchema(name: string): Record<string, unknown> {
  return name === "take_over_for_desktop" || name === "release_to_bridge"
    ? { type: "object", additionalProperties: false, properties: { expectedGeneration: { type: "integer", minimum: 1 } }, required: ["expectedGeneration"] }
    : { type: "object", additionalProperties: false, properties: {} };
}
function requiredEnvironment(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error("missing configuration"); return value; }
function writeResult(id: string | number | null, result: unknown): void { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function writeError(id: string | number | null, code: number, message: string): void { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }
