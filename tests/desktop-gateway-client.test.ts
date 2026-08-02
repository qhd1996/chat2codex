import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  DesktopGatewayClient,
  computePromptCommitment,
  loadScopedTokenFile,
} from "../src/desktop-gateway/client.js";

const roots: string[] = [];
const secret = Buffer.alloc(32, 7);
const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";
const safeAcl = { ownerSid: "S-1-5-21-1000", currentUserSid: "S-1-5-21-1000", protected: true, rules: [{ sid: "S-1-5-21-1000", type: "allow" as const, rights: 1, inherited: false }] };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop Gateway client", () => {
  test("loads one base64url key from an absolute owner-only regular file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-client-")); roots.push(root);
    const tokenPath = path.join(root, "prompt.key");
    await writeFile(tokenPath, secret.toString("base64url"), { mode: 0o600 });

    expect(await loadScopedTokenFile(tokenPath, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).toEqual(secret);
    await expect(loadScopedTokenFile("relative.key", { platform: "win32", inspectWindowsAcl: async () => safeAcl })).rejects.toThrow(/absolute/i);
    await expect(loadScopedTokenFile(tokenPath, { platform: "win32", inspectWindowsAcl: async () => ({ ...safeAcl, protected: false }) })).rejects.toThrow(/owner-only/i);
    await expect(loadScopedTokenFile(tokenPath, { platform: "win32", inspectWindowsAcl: async () => ({ ...safeAcl, rules: [...safeAcl.rules, { sid: "S-1-1-0", type: "allow", rights: 1, inherited: true }] }) })).rejects.toThrow(/owner-only/i);
  });

  test("refuses symlinks and malformed or unbounded token files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-client-")); roots.push(root);
    const target = path.join(root, "target.key");
    const link = path.join(root, "link.key");
    await writeFile(target, secret.toString("base64url"), { mode: 0o600 });
    try {
      await symlink(target, link);
      await expect(loadScopedTokenFile(link, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).rejects.toThrow(/symbolic/i);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EPERM")) throw error;
    }
    await writeFile(target, "not a key");
    await expect(loadScopedTokenFile(target, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).rejects.toThrow(/base64url/i);
    await writeFile(target, " " + secret.toString("base64url") + " ");
    await expect(loadScopedTokenFile(target, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).rejects.toThrow(/base64url/i);
  });

  test("reloads rotated key bytes and rejects an inherited Windows temp-file ACL", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-gateway-client-")); roots.push(root);
    const tokenPath = path.join(root, "rotate.key");
    const rotated = Buffer.alloc(32, 9);
    await writeFile(tokenPath, secret.toString("base64url"), { mode: 0o600 });
    expect(await loadScopedTokenFile(tokenPath, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).toEqual(secret);
    await writeFile(tokenPath, rotated.toString("base64url"), { mode: 0o600 });
    expect(await loadScopedTokenFile(tokenPath, { platform: "win32", inspectWindowsAcl: async () => safeAcl })).toEqual(rotated);
    if (process.platform === "win32") await expect(loadScopedTokenFile(tokenPath)).rejects.toThrow(/owner-only/i);
  });

  test("uses a domain-separated keyed prompt commitment", () => {
    const prompt = "low entropy prompt";
    const plain = createHash("sha256").update(prompt).digest("hex");
    const promptBytes = Buffer.from(prompt, "utf8");
    const length = Buffer.allocUnsafe(8); length.writeBigUInt64BE(BigInt(promptBytes.byteLength));
    const expected = createHmac("sha256", secret)
      .update("C2C-DESKTOP-PROMPT-COMMITMENT-V1\0", "utf8")
      .update(length).update(promptBytes).digest("hex");
    expect(computePromptCommitment(secret, prompt)).toBe(expected);
    expect(expected).not.toBe(plain);
  });

  test("sends exact loopback requests without redirects and accepts only bound signed responses", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const client = new DesktopGatewayClient({
      port: 43117, expectedHost: "127.0.0.1:43117", role: "prompt_hook", keyId: "prompt-v1", secret,
      now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId, randomNonce: () => "ABEiM0RVZneImaq7zN3u_w",
      fetch: async (url, init) => {
        captured = { url: String(url), init };
        const body = JSON.stringify({ requestId, decision: "allow", generation: 2, fenceId: "fence-1" });
        return new Response(body, { status: 200, headers: {
          "content-type": "application/json",
          "x-chat2codex-version": "1",
          "x-chat2codex-request-id": requestId,
          "x-chat2codex-request-nonce": "ABEiM0RVZneImaq7zN3u_w",
          "x-chat2codex-timestamp": "2026-08-02T10:00:00.000Z",
          "x-chat2codex-body-sha256": createHash("sha256").update(body).digest("hex"),
          "x-chat2codex-signature": client.signResponseForTest({ requestId, requestNonce: "ABEiM0RVZneImaq7zN3u_w", body }),
        }});
      },
    });
    const response = await client.request("user_prompt_submit", {
      kind: "user_prompt_submit", requestId, sessionId: "root-1", turnId: "turn-1",
      promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z",
    });

    expect(response.decision).toBe("allow");
    expect(captured?.url).toBe("http://127.0.0.1:43117/v1/user-prompt-submit");
    expect(captured?.init.redirect).toBe("error");
    expect(captured?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(captured)).not.toContain(secret.toString("base64url"));
  });

  test("uses the Auth-line request canonicalization and signed response envelope", async () => {
    let signedHeaders: Headers | undefined;
    // Generated independently by the Auth line's signGatewayRequest with these fixed bytes.
    const expectedSignature = "a09b95ce8ce73c19f0cad9526a43f955879640ef37cc0d0521bb03ccb13d97cb";
    const client = new DesktopGatewayClient({
      port: 43117, expectedHost: "127.0.0.1:43117", role: "prompt_hook", keyId: "prompt-v1", secret,
      now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId, randomNonce: () => "ABEiM0RVZneImaq7zN3u_w",
      fetch: async (_url, init) => {
        signedHeaders = new Headers(init?.headers);
        const body = JSON.stringify({ requestId, decision: "block" });
        return new Response(body, { status: 200, headers: {
          "content-type": "application/json", "x-chat2codex-version": "1", "x-chat2codex-request-id": requestId,
          "x-chat2codex-request-nonce": "ABEiM0RVZneImaq7zN3u_w", "x-chat2codex-timestamp": "2026-08-02T10:00:00.000Z",
          "x-chat2codex-body-sha256": createHash("sha256").update(body).digest("hex"),
          "x-chat2codex-signature": client.signResponseForTest({ requestId, requestNonce: "ABEiM0RVZneImaq7zN3u_w", body }),
        }});
      },
    });
    await client.request("user_prompt_submit", { kind: "user_prompt_submit", requestId, sessionId: "root-1", turnId: "turn-1", promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z" });
    expect(signedHeaders?.get("x-chat2codex-nonce")).toBe("ABEiM0RVZneImaq7zN3u_w");
    expect(signedHeaders?.get("x-chat2codex-signature")).toBe(expectedSignature);
    expect(signedHeaders?.get("x-chat2codex-mac")).toBeNull();
  });

  test("blocks unsigned, stale, mismatched, redirected, and malformed responses", async () => {
    const makeClient = (response: Response) => new DesktopGatewayClient({
      port: 43117, expectedHost: "127.0.0.1:43117", role: "prompt_hook", keyId: "prompt-v1", secret,
      now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId, randomNonce: () => "ABEiM0RVZneImaq7zN3u_w", fetch: async () => response,
    });
    const request = { kind: "user_prompt_submit", requestId, sessionId: "root-1", turnId: "turn-1", promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z" } as const;
    for (const response of [
      new Response(JSON.stringify({ requestId, decision: "allow" }), { status: 200 }),
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ requestId, decision: "allow" }), { status: 200, headers: { "content-type": "application/json", "x-chat2codex-version": "1", "x-chat2codex-request-id": requestId, "x-chat2codex-request-nonce": "wrong", "x-chat2codex-timestamp": "2026-08-02T09:00:00.000Z", "x-chat2codex-body-sha256": "0".repeat(64), "x-chat2codex-signature": "0".repeat(64) } }),
    ]) await expect(makeClient(response).request("user_prompt_submit", request)).rejects.toThrow();
  });

  test("rejects non-loopback construction and endpoint/request substitution", async () => {
    expect(() => new DesktopGatewayClient({ port: 43117, expectedHost: "localhost:43117", role: "prompt_hook", keyId: "prompt-v1", secret })).toThrow(/IPv4 loopback/i);
    const client = new DesktopGatewayClient({ port: 43117, expectedHost: "127.0.0.1:43117", role: "prompt_hook", keyId: "prompt-v1", secret, fetch: async () => { throw new Error("must not fetch"); } });
    await expect(client.request("status", { kind: "user_prompt_submit", requestId, sessionId: "root-1", turnId: "turn-1", promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z" })).rejects.toThrow(/mismatch/i);
  });
});
