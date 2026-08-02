import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { AuthoritativeCodexThread } from "../src/agent/codex-runner.js";
import { NonceReplayCache, authenticateGatewayRequest, signGatewayRequest, type GatewayCapability } from "../src/desktop-gateway/auth.js";
import { DesktopOwnershipCoordinator } from "../src/core/desktop-ownership.js";
import { DesktopReconciler, authoritativeTurnDigest, type DesktopReconciliationBinding } from "../src/core/desktop-reconciler.js";
import { Phase3GatewayController } from "../src/core/phase3-gateway-controller.js";
import { emptyState, type BridgeState } from "../src/state/types.js";

const rootFixture = JSON.parse(await readFile(new URL("./fixtures/phase3-root-thread.json", import.meta.url), "utf8")) as AuthoritativeCodexThread;
const childFixture = JSON.parse(await readFile(new URL("./fixtures/phase3-child-thread.json", import.meta.url), "utf8")) as AuthoritativeCodexThread;
const at = (seconds: number) => `2026-08-02T00:00:${String(seconds).padStart(2, "0")}.000Z`;
const uuid = (n: number) => `019fc160-7e0d-7990-9317-${String(n).padStart(12, "0")}`;

function stateFixture(): { state: BridgeState; ownership: DesktopOwnershipCoordinator } {
  const state = emptyState(); const taskId = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";
  state.tasks[taskId] = {
    taskId, conversationId: "weixin-chat", chatType: "direct", senderKey: "sender", title: "task", aliases: [],
    workspaceKind: "work", workspaceRoot: "C:/phase3-workspace", executionCwd: "C:/phase3-workspace",
    isolationMode: "canonical_fifo", sessionEpoch: "epoch", threadId: rootFixture.id, status: "completed",
    objectiveSummary: "", recentRequests: [], createdAt: at(0), updatedAt: at(0), lastActiveAt: at(0),
  };
  state.conversations["weixin-chat"] = { taskIds: [taskId], lastTaskId: taskId };
  const ownership = new DesktopOwnershipCoordinator({ leaseDurationMs: 30_000 });
  ownership.bind(state, {
    mutationId: "bind", bindingId: "binding", rootThreadId: rootFixture.id, taskId, conversationId: "weixin-chat",
    adapterId: "weixin:bot", bindingAnchorTurnId: rootFixture.turns[0]!.id, bindingAnchorTurnIndex: 0,
    bindingAnchorDigest: authoritativeTurnDigest(rootFixture.turns[0]!), observedAt: at(0),
  });
  return { state, ownership };
}

function controllerFixture() {
  const current = stateFixture(); let state = current.state;
  const controller = new Phase3GatewayController({
    ownership: current.ownership, readState: async (read) => read(state),
    mutateState: async (mutation) => { const before = structuredClone(state); try { return await mutation(state); } catch (error) { state = before; throw error; } },
  });
  return { controller, get state() { return state; } };
}

function reconciliationBinding(owner: DesktopReconciliationBinding["owner"] = "desktop"): DesktopReconciliationBinding {
  return {
    bindingId: "binding", rootThreadId: rootFixture.id, owner, generation: 2,
    bindingAnchorTurnId: rootFixture.turns[0]!.id, bindingAnchorTurnIndex: 0, lastReconciledTurnId: rootFixture.turns[0]!.id,
    lastReconciledTurnIndex: 0, lastAuthoritativeDigest: authoritativeTurnDigest(rootFixture.turns[0]!),
    activeStartFence: { turnId: rootFixture.turns[1]!.id, originGeneration: 2, requestId: "request", promptCommitment: "a".repeat(64), issuedAt: at(1) },
    excludedControlTurns: {},
  };
}

describe("Primitive 1 - authenticated status and reconnect", () => {
  test("binds every signed byte, rejects replay, and exposes only redacted root status", async () => {
    const capability: GatewayCapability = { keyId: "prompt", role: "prompt_hook", endpoints: ["user_prompt_submit"], secret: new Uint8Array(32).fill(7) };
    const body = Buffer.from("{}"); const now = new Date(at(1));
    const signed = signGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", requestId: uuid(1), timestamp: now.toISOString(), nonce: "AQEBAQEBAQEBAQEBAQEBAQ", body, capability });
    const cache = new NonceReplayCache({ now: () => now.getTime() });
    await expect(authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability], nonceCache: cache, now: () => now.getTime() })).resolves.toMatchObject({ role: "prompt_hook" });
    await expect(authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability], nonceCache: cache, now: () => now.getTime() })).rejects.toMatchObject({ code: "nonce_reused" });
    const fixture = controllerFixture();
    const status = await fixture.controller.status({ kind: "status", requestId: uuid(2), rootThreadId: rootFixture.id });
    expect(status).toMatchObject({ decision: "accepted", generation: 1, message: "owner=bridge;fence=clear;release=clear;wake=clear" });
    expect(JSON.stringify(status)).not.toContain(rootFixture.id);
  });
});

describe("Primitive 2 - UserPromptSubmit fail-closed fence and control turns", () => {
  test("blocks bridge owner, permits only current Desktop generation, and records exact control without a model fence", async () => {
    const fixture = controllerFixture();
    const prompt = { kind: "user_prompt_submit" as const, requestId: uuid(3), sessionId: rootFixture.id, turnId: "actual-turn", promptCommitment: "a".repeat(64), observedAt: at(1) };
    expect(await fixture.controller.submitPrompt(prompt)).toMatchObject({ decision: "block" });
    expect(await fixture.controller.takeover({ kind: "takeover_desktop", requestId: uuid(4), bindingId: "binding", expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1) })).toMatchObject({ decision: "accepted", generation: 2 });
    expect(await fixture.controller.submitPrompt({ ...prompt, requestId: uuid(5) })).toMatchObject({ decision: "allow", fenceId: "actual-turn" });
    delete fixture.state.desktopGateway!.bindings.binding!.activeStartFence;
    expect(await fixture.controller.submitPrompt({ ...prompt, requestId: uuid(6), turnId: "control-turn", controlKind: "release_request" })).toMatchObject({ decision: "accepted" });
    expect(fixture.state.desktopGateway!.bindings.binding).toMatchObject({ releaseRequested: true });
    expect(fixture.state.desktopGateway!.bindings.binding!.activeStartFence).toBeUndefined();
  });

  test("accepts an exact excluded control turn, noops when absent, and rejects conflicting output", () => {
    const control = structuredClone(rootFixture); control.turns[1] = { id: "control", status: "interrupted", items: [{ id: "control-user", type: "userMessage", text: "reserved" }] };
    const binding = reconciliationBinding(); binding.excludedControlTurns.control = { kind: "takeover", originGeneration: 2, promptCommitment: "b".repeat(64), recordedAt: at(1) };
    expect(new DesktopReconciler().reconcile({ binding, thread: control, controlPromptCommitments: { takeover: "b".repeat(64), release_request: "c".repeat(64) }, controlPrompts: { takeover: "reserved", release_request: "release" } })).toMatchObject({ kind: "ready", plan: { excludedControlTurn: true, clearsStartFence: false } });
    expect(new DesktopReconciler().reconcile({ binding, thread: { ...control, turns: [control.turns[0]!] }, controlPromptCommitments: { takeover: "b".repeat(64), release_request: "c".repeat(64) }, controlPrompts: { takeover: "reserved", release_request: "release" } })).toEqual({ kind: "noop" });
    control.turns[1]!.items.push({ id: "agent", type: "agentMessage", text: "forbidden" });
    expect(new DesktopReconciler().reconcile({ binding, thread: control, controlPromptCommitments: { takeover: "b".repeat(64), release_request: "c".repeat(64) }, controlPrompts: { takeover: "reserved", release_request: "release" } })).toMatchObject({ kind: "uncertain" });
  });
});

describe("Primitive 3 - same-thread single-writer transfer", () => {
  test("increments generation on takeover and release without cloning the concrete root", () => {
    const fixture = stateFixture(); const binding = fixture.state.desktopGateway!.bindings.binding!;
    fixture.ownership.takeover(fixture.state, { mutationId: "takeover", bindingId: "binding", expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1) });
    binding.releaseRequested = true; binding.lastMirroredTurnId = binding.lastReconciledTurnId;
    fixture.ownership.completeRelease(fixture.state, { mutationId: "release", bindingId: "binding", expectedGeneration: 2, observedAt: at(2) });
    expect(binding).toMatchObject({ rootThreadId: rootFixture.id, owner: "bridge", generation: 3 });
    expect(Object.values(fixture.state.tasks).filter((task) => task.threadId === rootFixture.id)).toHaveLength(1);
  });
});

describe("Primitive 4 - Stop is wake-only and recovery-safe", () => {
  test("deduplicates the same wake and excludes Hook content and SubagentStop", async () => {
    const fixture = controllerFixture();
    const request = { kind: "stop_wake" as const, eventId: uuid(7), sessionId: rootFixture.id, turnId: "turn-a-desktop", observedAt: at(1) };
    await fixture.controller.wake(request); await fixture.controller.wake(request);
    expect(fixture.state.desktopGateway!.bindings.binding!.pendingWakeIds).toEqual([uuid(7)]);
    expect(JSON.stringify(fixture.state.desktopGateway)).not.toMatch(/assistant|transcript|SubagentStop/i);
  });
});

describe("Primitive 5 - stable authoritative thread read", () => {
  test("uses complete array order and digest instead of lexical opaque IDs", () => {
    const result = new DesktopReconciler().reconcile({ binding: reconciliationBinding(), thread: rootFixture });
    expect(result).toMatchObject({ kind: "ready", plan: { turnId: "turn-a-desktop", authoritativeTurnIndex: 1, visibleText: "desktop result" } });
    const reordered = { ...rootFixture, turns: [rootFixture.turns[1]!, rootFixture.turns[0]!] };
    expect(new DesktopReconciler().reconcile({ binding: reconciliationBinding(), thread: reordered })).toMatchObject({ kind: "uncertain" });
  });
});

describe("Primitive 6 - owner generation races and expiry", () => {
  test("stale CAS is immutable, active work blocks takeover, and expiry grants nobody", () => {
    const fixture = stateFixture();
    const before = structuredClone(fixture.state);
    expect(() => fixture.ownership.takeover(fixture.state, { mutationId: "stale", bindingId: "binding", expectedGeneration: 9, ownerInstanceId: "desktop", observedAt: at(1) })).toThrow(/stale/i);
    expect(fixture.state).toEqual(before);
    fixture.ownership.takeover(fixture.state, { mutationId: "takeover", bindingId: "binding", expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1) });
    expect(() => fixture.ownership.heartbeat(fixture.state, { mutationId: "late", bindingId: "binding", expectedGeneration: 2, ownerInstanceId: "desktop", observedAt: at(32) })).toThrow(/expired/i);
    expect(fixture.state.desktopGateway!.bindings.binding).toMatchObject({ owner: "uncertain", generation: 3 });
  });
});

describe("Primitive 7 - unbound and concrete child exclusion", () => {
  test("never exports a child that merely shares the parent session ID", async () => {
    expect(rootFixture.id).toBe(rootFixture.sessionId);
    expect(childFixture.id).not.toBe(rootFixture.id); expect(childFixture.sessionId).toBe(rootFixture.id);
    const binding = reconciliationBinding(); const before = structuredClone(binding);
    expect(new DesktopReconciler().reconcile({ binding, thread: childFixture })).toMatchObject({ kind: "uncertain" });
    expect(binding).toEqual(before);
    const hooks = JSON.parse(await readFile(new URL("../docs/phase3/codex-hooks.example.json", import.meta.url), "utf8"));
    expect(hooks.hooks).not.toHaveProperty("SubagentStop");
  });
});
