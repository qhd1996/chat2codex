import { expect, test, describe } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  NonceReplayCache,
  signGatewayRequest,
  verifyGatewayResponse,
  type GatewayCapability,
} from "../src/desktop-gateway/auth.js";
import {
  DesktopGatewayServer,
  inspectWindowsTokenAcl,
  loadGatewayCapabilities,
  type DurableMutationReplay,
  type GatewayDecisionLog,
  type WindowsTokenAclReport,
} from "../src/desktop-gateway/server.js";
import { desktopGatewayControlPrompts } from "../src/desktop-gateway/protocol.js";
import type { DesktopGatewayController, DesktopGatewayResponse } from "../src/desktop-gateway/contracts.js";

const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";
const observedAt = "2026-08-02T10:00:00.000Z";
const secret = new Uint8Array(32).fill(0x31);
const promptCapability: GatewayCapability = {
  keyId: "prompt-v1", role: "prompt_hook", endpoints: ["user_prompt_submit"], secret,
};
const mcpCapability: GatewayCapability = {
  keyId: "mcp-v1", role: "desktop_mcp",
  endpoints: ["status", "desktop_heartbeat", "takeover_desktop", "release_bridge"],
  secret: new Uint8Array(32).fill(0x32),
};

class MemoryReplay implements DurableMutationReplay {
  private readonly seen = new Map<string, string>();
  async checkAndRecord(id: string, bodySha256: string, request?: unknown) {
    void request;
    const prior = this.seen.get(id);
    if (prior === undefined) { this.seen.set(id, bodySha256); return "new" as const; }
    return prior === bodySha256 ? "idempotent" as const : "conflict" as const;
  }
}

function controller(overrides: Partial<DesktopGatewayController> = {}): DesktopGatewayController {
  const reply = async (request: { requestId?: string; eventId?: string }): Promise<DesktopGatewayResponse> => ({
    requestId: request.requestId ?? request.eventId ?? requestId, decision: "allow", generation: 4,
  });
  return {
    status: reply, heartbeat: reply, takeover: reply, release: reply, submitPrompt: reply, wake: reply,
    ...overrides,
  } as DesktopGatewayController;
}

async function requestServer(options: {
  port: number; path?: string; method?: string; host?: string; contentType?: string;
  origin?: string; forwarded?: boolean; body?: Buffer; capability?: GatewayCapability; nonce?: string;
}) {
  const body = options.body ?? Buffer.from(JSON.stringify({
    kind: "user_prompt_submit", requestId,
    sessionId: "019fc160-7e0d-7990-9317-e830a4425a90", turnId: "turn-1",
    promptCommitment: "a".repeat(64), observedAt,
  }));
  const capability = options.capability ?? promptCapability;
  const route = options.path ?? "/v1/user-prompt-submit";
  const signed = signGatewayRequest({
    method: options.method ?? "POST", path: route, requestId, timestamp: observedAt,
    nonce: options.nonce ?? "AQEBAQEBAQEBAQEBAQEBAQ", body, capability,
  });
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = {
      ...signed.headers,
      host: options.host ?? `127.0.0.1:${options.port}`,
      "content-type": options.contentType ?? "application/json",
      "content-length": body.byteLength,
    };
    if (options.origin) headers.origin = options.origin;
    if (options.forwarded) headers["x-forwarded-for"] = "127.0.0.1";
    const request = http.request({
      hostname: "127.0.0.1", port: options.port, path: route,
      method: options.method ?? "POST", headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function promptBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    kind: "user_prompt_submit", requestId,
    sessionId: "019fc160-7e0d-7990-9317-e830a4425a90", turnId: "turn-1",
    promptCommitment: "a".repeat(64), observedAt, ...overrides,
  }));
}

describe("Desktop Gateway token files", () => {
  const safeAcl: WindowsTokenAclReport = {
    ownerSid: "S-1-5-21-1000", currentUserSid: "S-1-5-21-1000", protected: true,
    rules: [{ sid: "S-1-5-21-1000", type: "allow", rights: 0x1f01ff, inherited: false }],
  };

  test("loads three distinct absolute owner-only regular base64url token files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-keys-"));
    try {
      const specs = await Promise.all((["prompt_hook", "stop_hook", "desktop_mcp"] as const).map(
        async (role, index) => {
          const filePath = path.join(directory, `${role}.key`);
          await writeFile(filePath, Buffer.from(new Uint8Array(32).fill(index + 1)).toString("base64url") + "\n");
          return { keyId: `${role}-v1`, role, filePath };
        },
      ));
      const loaded = await loadGatewayCapabilities(specs, {
        platform: "win32", inspectWindowsAcl: async () => safeAcl,
      });
      expect(loaded.map((entry) => [entry.role, entry.secret.byteLength])).toEqual([
        ["prompt_hook", 32], ["stop_hook", 32], ["desktop_mcp", 32],
      ]);
      expect(loaded[0]?.endpoints).toEqual(["user_prompt_submit"]);
      expect(loaded[1]?.endpoints).toEqual(["stop_wake"]);
      expect(loaded[2]?.endpoints).toEqual([
        "status", "desktop_heartbeat", "takeover_desktop", "release_bridge",
      ]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects relative paths, symlinks, directories, malformed keys, duplicate paths/material, and unsafe ACLs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-keys-"));
    try {
      const good = path.join(directory, "good.key");
      const same = path.join(directory, "same.key");
      const malformed = path.join(directory, "bad.key");
      const linkDirectory = path.join(directory, "link-dir");
      const link = path.join(linkDirectory, "good.key");
      await writeFile(good, Buffer.from(new Uint8Array(32).fill(1)).toString("base64url"));
      await writeFile(same, Buffer.from(new Uint8Array(32).fill(1)).toString("base64url"));
      await writeFile(malformed, "not a key\nsecond line");
      await symlink(directory, linkDirectory, "junction");
      const base = { platform: "win32" as const, inspectWindowsAcl: async () => safeAcl };
      const complete = (prompt: string, stop = same, mcp = malformed) => [
        { keyId: "p", role: "prompt_hook" as const, filePath: prompt },
        { keyId: "s", role: "stop_hook" as const, filePath: stop },
        { keyId: "m", role: "desktop_mcp" as const, filePath: mcp },
      ];
      await expect(loadGatewayCapabilities(complete("relative.key"), base)).rejects.toThrow(/absolute/u);
      await expect(loadGatewayCapabilities(complete(link), base)).rejects.toThrow(/symbolic link/u);
      await expect(loadGatewayCapabilities(complete(directory), base)).rejects.toThrow(/regular file/u);
      await expect(loadGatewayCapabilities(complete(good, malformed, same), base)).rejects.toThrow(/base64url/u);
      await expect(loadGatewayCapabilities(complete(good, good, malformed), base)).rejects.toThrow(/distinct/u);
      await expect(loadGatewayCapabilities(complete(good, same, malformed), base)).rejects.toThrow(/duplicate key material/u);
      await expect(loadGatewayCapabilities(complete(good, malformed, same), {
        platform: "win32", inspectWindowsAcl: async () => ({
          ...safeAcl, protected: false,
          rules: [...safeAcl.rules, { sid: "S-1-1-0", type: "allow", rights: 1, inherited: true }],
        }),
      })).rejects.toThrow(/ACL/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("reads rotated bytes anew instead of retaining prior-process material", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-keys-"));
    try {
      const paths = ["p.key", "s.key", "m.key"].map((name) => path.join(directory, name));
      const specs = paths.map((filePath, index) => ({
        keyId: `k${index}`, role: (["prompt_hook", "stop_hook", "desktop_mcp"] as const)[index]!, filePath,
      }));
      for (let index = 0; index < paths.length; index++)
        await writeFile(paths[index]!, Buffer.from(new Uint8Array(32).fill(index + 1)).toString("base64url"));
      const first = await loadGatewayCapabilities(specs, { platform: "win32", inspectWindowsAcl: async () => safeAcl });
      await writeFile(paths[0]!, Buffer.from(new Uint8Array(32).fill(9)).toString("base64url"));
      const second = await loadGatewayCapabilities(specs, { platform: "win32", inspectWindowsAcl: async () => safeAcl });
      expect(first[0]?.secret[0]).toBe(1);
      expect(second[0]?.secret[0]).toBe(9);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test.skipIf(process.platform !== "win32")("ships a read-only Windows ACL inspector instead of trusting the caller", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-acl-"));
    try {
      const filePath = path.join(directory, "token.key");
      await writeFile(filePath, "placeholder");
      const report = await inspectWindowsTokenAcl(filePath);
      expect(report.ownerSid).toMatch(/^S-1-/u);
      expect(report.currentUserSid).toMatch(/^S-1-/u);
      expect(typeof report.protected).toBe("boolean");
      expect(report.rules.length).toBeGreaterThan(0);
      await expect(loadGatewayCapabilities([
        { keyId: "p", role: "prompt_hook", filePath },
        { keyId: "s", role: "stop_hook", filePath },
        { keyId: "m", role: "desktop_mcp", filePath },
      ], { platform: "win32" })).rejects.not.toThrow(/inspection is required/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("Desktop Gateway loopback server", () => {
  test("binds only IPv4 loopback and returns a request-bound signed response", async () => {
    const logs: GatewayDecisionLog[] = [];
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability], controller: controller(),
      nonceCache: new NonceReplayCache({ now: () => new Date(observedAt).getTime() }),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
      onDecision: (entry) => logs.push(entry),
    });
    try {
      const address = await server.start();
      expect(address.host).toBe("127.0.0.1");
      const response = await requestServer({ port: address.port });
      expect(response.status).toBe(200);
      const parsed = JSON.parse(response.body.toString("utf8"));
      expect(verifyGatewayResponse({
        response: parsed, body: response.body, headers: response.headers,
        expectedRequestId: requestId, expectedRequestNonce: "AQEBAQEBAQEBAQEBAQEBAQ",
        capability: promptCapability, now: () => new Date(observedAt).getTime(),
      })).toMatchObject({ decision: "allow", generation: 4 });
      expect(logs).toEqual([{
        requestId, role: "prompt_hook", endpoint: "user_prompt_submit",
        decision: "allow", latencyMs: expect.any(Number), errorCode: undefined,
      }]);
    } finally { await server.stop(); }
  });

  test("rejects wrong Host/content type, Origin, forwarded headers, methods, routes, encodings, and oversized bodies without CORS or redirects", async () => {
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability], controller: controller(),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
      maxBodyBytes: 512,
    });
    try {
      const { port } = await server.start();
      const cases = [
        { host: `localhost:${port}` },
        { contentType: "application/json; charset=utf-8" },
        { origin: "https://example.test" },
        { forwarded: true },
        { method: "PUT" },
        { path: "/v1/status?x=1" },
        { path: "/v1/%75ser-prompt-submit" },
        { body: Buffer.alloc(513, 0x20) },
      ];
      for (const invalid of cases) {
        let response: Awaited<ReturnType<typeof requestServer>>;
        try { response = await requestServer({ port, ...invalid }); } catch { continue; }
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.headers.location).toBeUndefined();
        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      }
    } finally { await server.stop(); }
  });

  test("fails closed on duplicate JSON fields and request-ID replay with different bytes", async () => {
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability], controller: controller(),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
    });
    try {
      const { port } = await server.start();
      const duplicate = Buffer.from(`{"kind":"user_prompt_submit","kind":"user_prompt_submit","requestId":"${requestId}","sessionId":"s","turnId":"t","promptCommitment":"${"a".repeat(64)}","observedAt":"${observedAt}"}`);
      expect((await requestServer({ port, body: duplicate })).status).toBe(400);

      const first = await requestServer({ port, nonce: "AgICAgICAgICAgICAgICAg" });
      expect(first.status).toBe(200);
      const changed = Buffer.from(JSON.stringify({
        kind: "user_prompt_submit", requestId, sessionId: "different", turnId: "turn-1",
        promptCommitment: "b".repeat(64), observedAt,
      }));
      const conflict = await requestServer({ port, body: changed, nonce: "AwMDAwMDAwMDAwMDAwMDAw" });
      expect(conflict.status).toBe(409);
    } finally { await server.stop(); }
  });

  test("keeps read-only status replay out of the durable mutation replay store", async () => {
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [mcpCapability], controller: controller(),
      mutationReplay: { checkAndRecord: async () => { throw new Error("status mutated replay state"); } },
      now: () => new Date(observedAt).getTime(),
    });
    const body = Buffer.from(JSON.stringify({
      kind: "status", requestId, rootThreadId: "019fc160-7e0d-7990-9317-e830a4425a90",
    }));
    try {
      const { port } = await server.start();
      expect((await requestServer({
        port, path: "/v1/status", body, capability: mcpCapability, nonce: "BwcHBwcHBwcHBwcHBwcHBw",
      })).status).toBe(200);
      expect((await requestServer({
        port, path: "/v1/status", body, capability: mcpCapability, nonce: "CAgICAgICAgICAgICAgICA",
      })).status).toBe(200);
    } finally { await server.stop(); }
  });

  test("binds the authenticated request ID to the body and recomputes exact control prompt commitments", async () => {
    const accepted: unknown[] = [];
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability],
      controller: controller({ submitPrompt: async (request) => {
        accepted.push(request); return { requestId: request.requestId, decision: "block" };
      } }),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
    });
    try {
      const { port } = await server.start();
      const mismatched = await requestServer({ port, body: promptBody({
        requestId: "019fc160-7e0d-7990-9317-e830a4425a91",
      }) });
      expect(mismatched.status).toBe(400);
      expect(accepted).toHaveLength(0);

      const invalidControl = await requestServer({ port, nonce: "AgICAgICAgICAgICAgICAg", body: promptBody({
        controlKind: "takeover", promptCommitment: "b".repeat(64),
      }) });
      expect(invalidControl.status).toBe(401);
      expect(accepted).toHaveLength(0);

      const { createPromptCommitment } = await import("../src/desktop-gateway/auth.js");
      const validControl = await requestServer({ port, nonce: "AwMDAwMDAwMDAwMDAwMDAw", body: promptBody({
        controlKind: "takeover",
        promptCommitment: createPromptCommitment(secret, desktopGatewayControlPrompts.takeover),
      }) });
      expect(validControl.status).toBe(200);
      expect(accepted).toHaveLength(1);
    } finally { await server.stop(); }
  });

  test("refuses to sign a controller response for a different request", async () => {
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability],
      controller: controller({ submitPrompt: async () => ({
        requestId: "019fc160-7e0d-7990-9317-e830a4425a91", decision: "allow",
      }) }),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
    });
    try {
      const { port } = await server.start();
      expect((await requestServer({ port })).status).toBe(500);
    } finally { await server.stop(); }
  });

  test("bounds concurrency and request duration", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const controllerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability],
      controller: controller({ submitPrompt: async (request) => { entered(); await wait; return { requestId: request.requestId, decision: "allow" }; } }),
      mutationReplay: { checkAndRecord: async () => "new" },
      now: () => new Date(observedAt).getTime(), maxConcurrentRequests: 1, requestDeadlineMs: 100,
    });
    try {
      const { port } = await server.start();
      const first = requestServer({ port, nonce: "BAQEBAQEBAQEBAQEBAQEBA" });
      await controllerEntered;
      const second = await requestServer({ port, nonce: "BQUFBQUFBQUFBQUFBQUFBQ" });
      expect(second.status).toBe(503);
      const timedOut = await first;
      expect(timedOut.status).toBe(408);
      release();
    } finally { release(); await server.stop(); }
  });

  test("decision logs never contain prompt, token, path, sender, or result-shaped values", async () => {
    const logs: GatewayDecisionLog[] = [];
    const server = new DesktopGatewayServer({
      port: 0, capabilities: [promptCapability], controller: controller(),
      mutationReplay: new MemoryReplay(), now: () => new Date(observedAt).getTime(),
      onDecision: (entry) => logs.push(entry),
    });
    try {
      const { port } = await server.start();
      await requestServer({ port });
      const text = JSON.stringify(logs);
      for (const forbidden of ["aaaaaa", Buffer.from(secret).toString("base64url"), "C:\\\secret", "sender", "result text"])
        expect(text).not.toContain(forbidden);
      expect(Object.keys(logs[0] ?? {}).sort()).toEqual([
        "decision", "endpoint", "errorCode", "latencyMs", "requestId", "role",
      ]);
    } finally { await server.stop(); }
  });
});
