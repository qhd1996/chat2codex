import { expect, test } from "bun:test";
import fc from "fast-check";

import {
  GatewayAuthenticationError, NonceReplayCache, authenticateGatewayRequest, signGatewayRequest,
  type GatewayCapability,
} from "../../src/desktop-gateway/auth.js";

const seed = 20260802;
const now = new Date("2026-08-02T10:00:00.000Z");
const capability: GatewayCapability = {
  keyId: "prompt-v1", role: "prompt_hook", endpoints: ["user_prompt_submit"],
  secret: new Uint8Array(32).fill(0x2a),
};

test("property: changing any signed body byte is rejected", async () => {
  await fc.assert(fc.asyncProperty(
    fc.uint8Array({ minLength: 1, maxLength: 128 }),
    fc.uint8Array({ minLength: 16, maxLength: 16 }),
    fc.integer({ min: 0, max: 127 }),
    async (bodyBytes, nonceBytes, salt) => {
      const body = Buffer.from(bodyBytes);
      const nonce = Buffer.from(nonceBytes).toString("base64url");
      const signed = signGatewayRequest({
        method: "POST", path: "/v1/user-prompt-submit",
        requestId: "019fc160-7e0d-7990-9317-e830a4425a8f", timestamp: now.toISOString(),
        nonce, body, capability,
      });
      await expect(authenticateGatewayRequest({
        method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body,
        capabilities: [capability], nonceCache: new NonceReplayCache(), now: () => now.getTime(),
      })).resolves.toMatchObject({ endpoint: "user_prompt_submit", role: "prompt_hook" });

      const changed = Buffer.from(body);
      const index = salt % changed.length;
      changed[index] = changed[index]! ^ 1;
      await expect(authenticateGatewayRequest({
        method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body: changed,
        capabilities: [capability], nonceCache: new NonceReplayCache(), now: () => now.getTime(),
      })).rejects.toBeInstanceOf(GatewayAuthenticationError);
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: role, exact route, freshness, and nonce replay remain closed", async () => {
  await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 16, maxLength: 16 }), async (nonceBytes) => {
    const body = Buffer.from("{}");
    const signed = signGatewayRequest({
      method: "POST", path: "/v1/user-prompt-submit",
      requestId: "019fc160-7e0d-7990-9317-e830a4425a8f", timestamp: now.toISOString(),
      nonce: Buffer.from(nonceBytes).toString("base64url"), body, capability,
    });
    const cache = new NonceReplayCache({ now: () => now.getTime() });
    const base = { method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability] } as const;
    await authenticateGatewayRequest({ ...base, nonceCache: cache, now: () => now.getTime() });
    await expect(authenticateGatewayRequest({ ...base, nonceCache: cache, now: () => now.getTime() }))
      .rejects.toMatchObject({ code: "nonce_reused" });
    await expect(authenticateGatewayRequest({ ...base, path: "/v1/status", nonceCache: new NonceReplayCache(), now: () => now.getTime() }))
      .rejects.toBeInstanceOf(GatewayAuthenticationError);
    await expect(authenticateGatewayRequest({ ...base, headers: { ...signed.headers, "x-chat2codex-role": "desktop_mcp" }, nonceCache: new NonceReplayCache(), now: () => now.getTime() }))
      .rejects.toBeInstanceOf(GatewayAuthenticationError);
    await expect(authenticateGatewayRequest({ ...base, nonceCache: new NonceReplayCache(), now: () => now.getTime() + 30_001 }))
      .rejects.toMatchObject({ code: "stale_request" });
  }), { seed, numRuns: 100, endOnFailure: true });
});
