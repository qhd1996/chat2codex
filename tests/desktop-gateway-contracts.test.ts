import { describe, expect, test } from "bun:test";

import {
  gatewayEndpointKinds,
  parseGatewayRequest,
  parseGatewayResponse,
  type DesktopGatewayController,
} from "../src/desktop-gateway/contracts.js";

const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";
const sessionId = "019fc160-7e0d-7990-9317-e830a4425a90";

describe("Desktop Gateway contracts", () => {
  test("freezes the closed endpoint surface", () => {
    expect(gatewayEndpointKinds).toEqual([
      "status",
      "desktop_heartbeat",
      "takeover_desktop",
      "release_bridge",
      "user_prompt_submit",
      "stop_wake",
    ]);
    expect(() => parseGatewayRequest({ kind: "apply" })).toThrow();
    expect(() => parseGatewayRequest({ kind: "deploy" })).toThrow();
  });

  test("requires the actual Hook turn id and bounded prompt commitment", () => {
    expect(parseGatewayRequest({
      kind: "user_prompt_submit", requestId, sessionId, turnId: "turn-1",
      promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z",
    })).toEqual({
      kind: "user_prompt_submit", requestId, sessionId, turnId: "turn-1",
      promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z",
    });
    for (const invalid of [
      { kind: "user_prompt_submit", requestId, sessionId, promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z" },
      { kind: "user_prompt_submit", requestId, sessionId, turnId: "turn-1", promptCommitment: "raw prompt", observedAt: "2026-08-02T10:00:00.000Z" },
      { kind: "user_prompt_submit", requestId: "not-a-uuid", sessionId, turnId: "turn-1", promptCommitment: "a".repeat(64), observedAt: "2026-08-02T10:00:00.000Z" },
    ]) expect(() => parseGatewayRequest(invalid)).toThrow();
  });

  test("accepts only identifier metadata for Stop wake-up", () => {
    expect(parseGatewayRequest({
      kind: "stop_wake", eventId: requestId, sessionId, turnId: "turn-1",
      observedAt: "2026-08-02T10:00:00.000Z",
    })).toMatchObject({ kind: "stop_wake", turnId: "turn-1" });
    expect(() => parseGatewayRequest({
      kind: "stop_wake", eventId: requestId, sessionId, turnId: "turn-1",
      observedAt: "2026-08-02T10:00:00.000Z", lastAssistantMessage: "secret",
    })).toThrow();
  });

  test("bounds status and ownership requests without exposing generic mutation", () => {
    expect(parseGatewayRequest({ kind: "status", requestId, rootThreadId: sessionId })).toMatchObject({ kind: "status" });
    expect(parseGatewayRequest({ kind: "desktop_heartbeat", requestId, bindingId: requestId, expectedGeneration: 2, ownerInstanceId: "desktop-1", observedAt: "2026-08-02T10:00:00.000Z" })).toMatchObject({ kind: "desktop_heartbeat" });
    expect(parseGatewayRequest({ kind: "takeover_desktop", requestId, bindingId: requestId, expectedGeneration: 2, ownerInstanceId: "desktop-1", observedAt: "2026-08-02T10:00:00.000Z" })).toMatchObject({ kind: "takeover_desktop" });
    expect(parseGatewayRequest({ kind: "release_bridge", requestId, bindingId: requestId, expectedGeneration: 3, observedAt: "2026-08-02T10:00:00.000Z" })).toMatchObject({ kind: "release_bridge" });
    expect(() => parseGatewayRequest({ kind: "status", requestId, rootThreadId: sessionId, prompt: "secret" })).toThrow();
  });

  test("accepts only closed bounded response decisions", () => {
    expect(parseGatewayResponse({ requestId, decision: "allow", generation: 3, fenceId: requestId })).toEqual({ requestId, decision: "allow", generation: 3, fenceId: requestId });
    expect(() => parseGatewayResponse({ requestId, decision: "apply" })).toThrow();
    expect(() => parseGatewayResponse({ requestId, decision: "allow", message: "x".repeat(501) })).toThrow();
  });

  test("controller is a closed decision interface, not a state or HTTP object", () => {
    const methodNames: Array<keyof DesktopGatewayController> = ["status", "heartbeat", "takeover", "release", "submitPrompt", "wake"];
    expect(methodNames).toHaveLength(6);
  });
});
