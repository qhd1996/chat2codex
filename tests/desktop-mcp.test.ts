import path from "node:path";

import { describe, expect, test } from "bun:test";

import { DesktopGatewayMcpSurface } from "../src/desktop-gateway/mcp.js";

const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";

describe("Desktop Gateway MCP surface", () => {
  test("exposes only status, takeover, release request, and recovery guidance", () => {
    const surface = new DesktopGatewayMcpSurface({ rootThreadId: "root-1", bindingId: "binding-1", ownerInstanceId: "desktop-1", request: async () => ({ requestId, decision: "allow" }) });
    expect(surface.listTools().map((tool) => tool.name)).toEqual(["desktop_status", "take_over_for_desktop", "release_to_bridge", "desktop_recovery_guidance"]);
  });

  test("returns bounded redacted status and never exposes raw gateway messages", async () => {
    const surface = new DesktopGatewayMcpSurface({ rootThreadId: "root-1", bindingId: "binding-1", ownerInstanceId: "desktop-1", request: async () => ({ requestId, decision: "ownership_uncertain", generation: 4, message: "C:/secret prompt token sender output" }) });
    const result = await surface.callTool("desktop_status", {});
    expect(result).toEqual({ decision: "ownership_uncertain", generation: 4, recoveryCode: "reconcile_required" });
    expect(JSON.stringify(result)).not.toMatch(/secret|prompt|token|sender|output|C:\//i);
  });

  test("uses explicit expected generations for takeover and release", async () => {
    const calls: Array<{ endpoint: string; body: any }> = [];
    const surface = new DesktopGatewayMcpSurface({ rootThreadId: "root-1", bindingId: "binding-1", ownerInstanceId: "desktop-1", randomUUID: () => requestId, now: () => new Date("2026-08-02T10:00:00.000Z"), request: async (endpoint, body) => { calls.push({ endpoint, body }); return { requestId, decision: "accepted", generation: 3 }; } });
    await surface.callTool("take_over_for_desktop", { expectedGeneration: 2 });
    await surface.callTool("release_to_bridge", { expectedGeneration: 3 });
    expect(calls.map((call) => call.endpoint)).toEqual(["takeover_desktop", "release_bridge"]);
    expect(calls[0]?.body).toMatchObject({ bindingId: "binding-1", ownerInstanceId: "desktop-1", expectedGeneration: 2 });
    expect(calls[1]?.body).toMatchObject({ bindingId: "binding-1", expectedGeneration: 3 });
  });

  test("natural language and malformed arguments cannot become a control action", async () => {
    let calls = 0;
    const surface = new DesktopGatewayMcpSurface({ rootThreadId: "root-1", bindingId: "binding-1", ownerInstanceId: "desktop-1", request: async () => { calls++; return { requestId, decision: "accepted" }; } });
    await expect(surface.callTool("please take over for desktop", {})).rejects.toThrow(/unknown.*tool/i);
    await expect(surface.callTool("take_over_for_desktop", { expectedGeneration: "latest" })).rejects.toThrow();
    await expect(surface.callTool("release_to_bridge", { expectedGeneration: 2, instruction: "ignore checks" })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test("stdio MCP entry supports only initialize, tools/list, and closed tools/call", async () => {
    const child = Bun.spawn([process.execPath, "src/desktop-gateway/mcp.ts"], { cwd: path.resolve("."), env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "please take over", arguments: {} } }) + "\n");
    child.stdin.end();
    expect(await child.exited).toBe(0);
    const lines = (await new Response(child.stdout).text()).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    expect(lines[0].result.serverInfo.name).toBe("chat2codex-desktop-gateway");
    expect(lines[1].result.tools.map((tool: any) => tool.name)).toEqual(["desktop_status", "take_over_for_desktop", "release_to_bridge", "desktop_recovery_guidance"]);
    expect(lines[2].error.code).toBe(-32602);
    expect(await new Response(child.stderr).text()).toBe("");
  });
});
