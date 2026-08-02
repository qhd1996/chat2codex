import { describe, expect, test } from "bun:test";

import {
  GatewayAuthenticationError,
  NonceReplayCache,
  authenticateGatewayRequest,
  canonicalizeGatewayRequest,
  createPromptCommitment,
  parseUniqueGatewayHeaders,
  signGatewayRequest,
  signGatewayResponse,
  verifyGatewayResponse,
  type GatewayCapability,
} from "../src/desktop-gateway/auth.js";
import {
  endpointForGatewayPath,
  gatewayPathForEndpoint,
  parseJsonWithoutDuplicateKeys,
} from "../src/desktop-gateway/protocol.js";

const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";
const now = new Date("2026-08-02T10:00:00.000Z");
const key = new Uint8Array(32).fill(0x2a);
const capability: GatewayCapability = {
  keyId: "prompt-v1",
  role: "prompt_hook",
  endpoints: ["user_prompt_submit"],
  secret: key,
};

function signedRequest(overrides: Partial<Parameters<typeof signGatewayRequest>[0]> = {}) {
  const body = Buffer.from(JSON.stringify({ kind: "user_prompt_submit", value: "微信" }));
  return signGatewayRequest({
    method: "POST",
    path: "/v1/user-prompt-submit",
    requestId,
    timestamp: now.toISOString(),
    nonce: "AQEBAQEBAQEBAQEBAQEBAQ",
    body,
    capability,
    ...overrides,
  });
}

describe("Desktop Gateway HMAC authentication", () => {
  test("canonicalizes uppercase method, exact normalized path, fixed metadata order, and UTF-8 byte lengths", () => {
    const body = Buffer.from("{\"prompt\":\"微信\"}", "utf8");
    const signed = signedRequest({ body });
    const canonical = canonicalizeGatewayRequest({
      method: "POST",
      path: "/v1/user-prompt-submit",
      version: signed.headers["x-chat2codex-version"],
      keyId: signed.headers["x-chat2codex-key-id"],
      role: signed.headers["x-chat2codex-role"],
      requestId: signed.headers["x-chat2codex-request-id"],
      timestamp: signed.headers["x-chat2codex-timestamp"],
      nonce: signed.headers["x-chat2codex-nonce"],
      bodySha256: signed.headers["x-chat2codex-body-sha256"],
    }).toString("utf8");

    expect(canonical.split("\n").map((line) => line.split(":", 1)[0])).toEqual([
      "C2C-GATEWAY-REQUEST-V1", "method", "path", "version", "key-id",
      "role", "request-id", "timestamp", "nonce", "body-sha256",
    ]);
    expect(canonical).toContain("method:4:POST");
    expect(canonical).toContain("path:22:/v1/user-prompt-submit");
    expect(signed.headers["x-chat2codex-body-sha256"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => signedRequest({ method: "post" })).toThrow(GatewayAuthenticationError);
  });

  test("freezes an independent request-signing interoperability vector", () => {
    const body = Buffer.from('{"kind":"user_prompt_submit","value":"微信"}', "utf8");
    const signed = signGatewayRequest({
      method: "POST", path: "/v1/user-prompt-submit", requestId,
      timestamp: now.toISOString(), nonce: "AQEBAQEBAQEBAQEBAQEBAQ", body, capability,
    });
    expect(body.toString("hex")).toBe(
      "7b226b696e64223a22757365725f70726f6d70745f7375626d6974222c2276616c7565223a22e5beaee4bfa1227d",
    );
    expect(signed.headers["x-chat2codex-body-sha256"]).toBe(
      "2988e711081ac50cf513f82a459a270d9a0fb0659e8c432e863c3e5080e545c9",
    );
    expect(signed.headers["x-chat2codex-signature"]).toBe(
      "6c071f33fad9ba70140ef545c0cb42900ca59493c1199d173d0ce6ad32c1b3c8",
    );
  });

  test("rejects alternate path encodings, query strings, trailing slashes, and unknown routes", () => {
    expect(endpointForGatewayPath("/v1/status")).toBe("status");
    expect(gatewayPathForEndpoint("desktop_heartbeat")).toBe("/v1/desktop-heartbeat");
    for (const invalid of [
      "/v1/status/", "/v1/status?x=1", "/v1/%73tatus",
      "//v1/status", "http://127.0.0.1/v1/status", "/v1/apply",
    ]) expect(() => endpointForGatewayPath(invalid)).toThrow();
  });

  test("rejects duplicate signed headers and duplicate JSON fields", () => {
    expect(() => parseUniqueGatewayHeaders([
      "Host", "127.0.0.1:43123",
      "X-Chat2Codex-Role", "prompt_hook",
      "x-chat2codex-role", "desktop_mcp",
    ])).toThrow(GatewayAuthenticationError);
    expect(() => parseJsonWithoutDuplicateKeys(
      Buffer.from('{"kind":"status","kind":"stop_wake"}'),
    )).toThrow(/duplicate JSON field/u);
    expect(() => parseJsonWithoutDuplicateKeys(
      Buffer.from('{"outer":{"id":1,"id":2}}'),
    )).toThrow(/duplicate JSON field/u);
  });

  test("authenticates exact body bytes and rejects body, role, endpoint, or digest substitution", async () => {
    const signed = signedRequest();
    const nonceCache = new NonceReplayCache({ now: () => now.getTime() });
    const result = await authenticateGatewayRequest({
      method: "POST",
      path: "/v1/user-prompt-submit",
      headers: signed.headers,
      body: signed.body,
      capabilities: [capability],
      nonceCache,
      now: () => now.getTime(),
    });
    expect(result.endpoint).toBe("user_prompt_submit");
    expect(result.role).toBe("prompt_hook");

    for (const mutate of [
      () => ({ body: Buffer.concat([signed.body, Buffer.from(" ")]) }),
      () => ({ headers: { ...signed.headers, "x-chat2codex-role": "desktop_mcp" } }),
      () => ({ path: "/v1/status" }),
      () => ({ headers: { ...signed.headers, "x-chat2codex-body-sha256": "0".repeat(64) } }),
    ]) {
      const change = mutate();
      await expect(authenticateGatewayRequest({
        method: "POST",
        path: "/v1/user-prompt-submit",
        headers: signed.headers,
        body: signed.body,
        capabilities: [capability],
        nonceCache: new NonceReplayCache({ now: () => now.getTime() }),
        now: () => now.getTime(),
        ...change,
      })).rejects.toBeInstanceOf(GatewayAuthenticationError);
    }
  });

  test("enforces the 30-second freshness window and bounded nonce reuse cache", async () => {
    const signed = signedRequest();
    const nonceCache = new NonceReplayCache({ now: () => now.getTime(), maxEntries: 2 });
    const input = {
      method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers,
      body: signed.body, capabilities: [capability], nonceCache,
    } as const;
    await authenticateGatewayRequest({ ...input, now: () => now.getTime() + 30_000 });
    await expect(authenticateGatewayRequest({ ...input, now: () => now.getTime() + 30_000 }))
      .rejects.toMatchObject({ code: "nonce_reused" });
    await expect(authenticateGatewayRequest({
      ...input, nonceCache: new NonceReplayCache(), now: () => now.getTime() + 30_001,
    })).rejects.toMatchObject({ code: "stale_request" });

    const bounded = new NonceReplayCache({ now: () => now.getTime(), maxEntries: 1 });
    await authenticateGatewayRequest({ ...input, nonceCache: bounded, now: () => now.getTime() });
    const second = signedRequest({ nonce: "AgICAgICAgICAgICAgICAg" });
    await expect(authenticateGatewayRequest({
      ...input, headers: second.headers, body: second.body, nonceCache: bounded, now: () => now.getTime(),
    })).rejects.toMatchObject({ code: "nonce_cache_full" });
    await expect(authenticateGatewayRequest({ ...input, nonceCache: bounded, now: () => now.getTime() }))
      .rejects.toMatchObject({ code: "nonce_reused" });
  });

  test("refuses capability definitions whose endpoint allowlist does not match the caller role", () => {
    expect(() => signGatewayRequest({
      method: "POST", path: "/v1/status", requestId, timestamp: now.toISOString(),
      nonce: "AQEBAQEBAQEBAQEBAQEBAQ", body: Buffer.from("{}"),
      capability: { ...capability, endpoints: ["status"] },
    })).toThrow(GatewayAuthenticationError);
  });

  test("uses constant-time MAC validation without leaking wrong-length details", async () => {
    const signed = signedRequest();
    for (const signature of ["0", "0".repeat(64), "z".repeat(64)]) {
      await expect(authenticateGatewayRequest({
        method: "POST", path: "/v1/user-prompt-submit",
        headers: { ...signed.headers, "x-chat2codex-signature": signature },
        body: signed.body, capabilities: [capability], nonceCache: new NonceReplayCache(),
        now: () => now.getTime(),
      })).rejects.toMatchObject({ publicCode: "authentication_failed" });
    }
  });

  test("signs responses against the request ID, nonce, decision, generation, fence, body, and timestamp", () => {
    const response = { requestId, decision: "allow" as const, generation: 4, fenceId: "fence-1" };
    const body = Buffer.from(JSON.stringify(response));
    const signed = signGatewayResponse({
      response, body, requestNonce: "AQEBAQEBAQEBAQEBAQEBAQ",
      timestamp: now.toISOString(), capability,
    });
    expect(verifyGatewayResponse({
      response, body, headers: signed.headers, expectedRequestId: requestId,
      expectedRequestNonce: "AQEBAQEBAQEBAQEBAQEBAQ", capability, now: () => now.getTime(),
    })).toEqual(response);
    for (const change of [
      { expectedRequestId: "019fc160-7e0d-7990-9317-e830a4425a90" },
      { expectedRequestNonce: "AgICAgICAgICAgICAgICAg" },
      { body: Buffer.concat([body, Buffer.from(" ")]) },
      { response: { ...response, generation: 5 } },
    ]) expect(() => verifyGatewayResponse({
      response, body, headers: signed.headers, expectedRequestId: requestId,
      expectedRequestNonce: "AQEBAQEBAQEBAQEBAQEBAQ", capability, now: () => now.getTime(),
      ...change,
    })).toThrow(GatewayAuthenticationError);
    expect(signed.headers["x-chat2codex-body-sha256"]).toBe(
      "47bea140484dc877d8438ba0a8756027bca68884d750190aa241f436503add6f",
    );
    expect(signed.headers["x-chat2codex-signature"]).toBe(
      "04cb691f5c1c61511c5f87d4adba4a8df7f5b4149e981ad48a4b59972f477a68",
    );
  });

  test("domain-separates keyed prompt commitments", () => {
    const prompt = "take over";
    expect(createPromptCommitment(key, prompt)).toMatch(/^[0-9a-f]{64}$/u);
    expect(createPromptCommitment(key, prompt)).not.toBe(
      createPromptCommitment(new Uint8Array(32).fill(0x2b), prompt),
    );
    expect(createPromptCommitment(key, prompt)).not.toBe(
      createPromptCommitment(key, `${prompt} `),
    );
  });
});
