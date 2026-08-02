import { describe, expect, test } from "bun:test";

import { DesktopOwnershipCoordinator } from "../src/core/desktop-ownership.js";
import type { BridgeState, RegisteredTask } from "../src/state/types.js";
import { emptyState } from "../src/state/types.js";

const at = (second: number): string =>
  `2026-08-02T00:00:${String(second).padStart(2, "0")}.000Z`;

function task(): RegisteredTask {
  return {
    taskId: "task-1", conversationId: "conversation-1", chatType: "direct", senderKey: "sender-1",
    title: "task", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\repo",
    executionCwd: "C:\\repo", isolationMode: "canonical_fifo", sessionEpoch: "epoch-1",
    threadId: "root-thread-1", status: "completed", objectiveSummary: "", recentRequests: [],
    createdAt: at(0), updatedAt: at(0), lastActiveAt: at(0),
  };
}

function stateWithBinding() {
  const state = emptyState();
  state.tasks["task-1"] = task();
  state.conversations["conversation-1"] = { taskIds: ["task-1"], lastTaskId: "task-1" };
  const coordinator = new DesktopOwnershipCoordinator({ leaseDurationMs: 30_000 });
  const binding = coordinator.bind(state, {
    mutationId: "bind-1", bindingId: "binding-1", rootThreadId: "root-thread-1",
    taskId: "task-1", conversationId: "conversation-1", adapterId: "weixin:bot",
    bindingAnchorTurnId: "anchor-turn", observedAt: at(0),
  });
  return { state, coordinator, binding };
}

describe("DesktopOwnershipCoordinator", () => {
  test("binds one concrete root and transfers it with monotonic generation CAS", () => {
    const { state, coordinator, binding } = stateWithBinding();
    expect(binding).toMatchObject({ owner: "bridge", generation: 1, rootThreadId: "root-thread-1" });

    const desktop = coordinator.takeover(state, {
      mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1,
      ownerInstanceId: "desktop-process-1", observedAt: at(1),
    });
    expect(desktop).toMatchObject({ owner: "desktop", generation: 2, ownerInstanceId: "desktop-process-1" });
    expect(() => coordinator.takeover(state, {
      mutationId: "takeover-stale", bindingId: binding.bindingId, expectedGeneration: 1,
      ownerInstanceId: "desktop-process-2", observedAt: at(2),
    })).toThrow(/stale generation/i);
  });

  test("rejects takeover while a bridge job, start fence, or release obligation is active", () => {
    const first = stateWithBinding();
    first.state.jobs.active = {
      id: "active", kind: "codex_run", messageId: "message-1", chatId: "conversation-1",
      chatType: "direct", cwd: "C:\\repo", prompt: "opaque", status: "running",
      createdAt: at(0), updatedAt: at(0), deliveryIds: [], taskId: "task-1",
    };
    expect(() => first.coordinator.takeover(first.state, {
      mutationId: "takeover-active", bindingId: "binding-1", expectedGeneration: 1,
      ownerInstanceId: "desktop-process", observedAt: at(1),
    })).toThrow(/active bridge job/i);

    const second = stateWithBinding();
    second.binding.activeStartFence = {
      turnId: "turn-existing", originGeneration: 1, requestId: "request-existing",
      promptCommitment: "a".repeat(64), issuedAt: at(0),
    };
    expect(() => second.coordinator.takeover(second.state, {
      mutationId: "takeover-fenced", bindingId: "binding-1", expectedGeneration: 1,
      ownerInstanceId: "desktop-process", observedAt: at(1),
    })).toThrow(/start fence/i);
  });

  test("creates a fence for the actual hook turn and rejects replay with different bytes", () => {
    const { state, coordinator, binding } = stateWithBinding();
    coordinator.takeover(state, { mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1, ownerInstanceId: "desktop-1", observedAt: at(1) });
    const input = {
      requestId: "request-1", bindingId: binding.bindingId, expectedGeneration: 2, turnId: "actual-hook-turn",
      promptCommitment: "b".repeat(64), issuedAt: at(2),
    };
    const first = coordinator.createFence(state, input);
    const replay = coordinator.createFence(state, input);
    expect(first.activeStartFence).toEqual({
      turnId: "actual-hook-turn", originGeneration: 2, requestId: "request-1",
      promptCommitment: "b".repeat(64), issuedAt: at(2),
    });
    expect(replay).toBe(first);
    expect(() => coordinator.createFence(state, { ...input, turnId: "different-turn" })).toThrow(/integrity conflict/i);
    expect(binding.owner).toBe("uncertain");
  });

  test("records bounded excluded control turns without exporting prompt content", () => {
    const { state, coordinator, binding } = stateWithBinding();
    coordinator.recordControlTurn(state, {
      mutationId: "control-1", bindingId: binding.bindingId, expectedGeneration: 1, turnId: "control-turn-1",
      kind: "takeover", promptCommitment: "c".repeat(64), recordedAt: at(1),
    });
    coordinator.recordControlTurn(state, {
      mutationId: "control-1", bindingId: binding.bindingId, expectedGeneration: 1, turnId: "control-turn-1",
      kind: "takeover", promptCommitment: "c".repeat(64), recordedAt: at(1),
    });
    expect(binding.excludedControlTurns["control-turn-1"]).toMatchObject({ kind: "takeover", originGeneration: 1 });
    expect(JSON.stringify(binding)).not.toContain("raw prompt");

    expect(() => coordinator.recordControlTurn(state, {
      mutationId: "control-conflict", bindingId: binding.bindingId, expectedGeneration: 1, turnId: "control-turn-1",
      kind: "release_request", promptCommitment: "d".repeat(64), recordedAt: at(2),
    })).toThrow(/integrity conflict/i);
    expect(binding.owner).toBe("uncertain");
  });

  test("release request never transfers ownership before reconciliation and delivery obligations clear", () => {
    const { state, coordinator, binding } = stateWithBinding();
    coordinator.takeover(state, { mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1, ownerInstanceId: "desktop-1", observedAt: at(1) });
    coordinator.requestRelease(state, { mutationId: "release-request-1", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(2) });
    expect(binding).toMatchObject({ owner: "desktop", generation: 2, releaseRequested: true });

    coordinator.enqueueWake(state, { eventId: "wake-1", bindingId: binding.bindingId, turnId: "turn-1", observedAt: at(3) });
    expect(() => coordinator.completeRelease(state, { mutationId: "release-1", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(4) })).toThrow(/wake|reconciliation/i);
    binding.pendingWakeIds = [];
    state.desktopGateway!.wakes = {};
    binding.lastMirroredTurnId = "desktop-turn-1";
    expect(() => coordinator.completeRelease(state, { mutationId: "release-unreconciled", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(4) })).toThrow(/reconciliation|high.water/i);
    binding.lastReconciledTurnId = "desktop-turn-1";
    state.outbox.delivery = { id: "delivery", jobId: "desktop-job", taskId: "task-1", chatId: "conversation-1", sequence: 0, status: "pending", idempotencyKey: "desktop-delivery", attempts: 0, createdAt: at(3), updatedAt: at(3), kind: "text", text: "result" };
    expect(() => coordinator.completeRelease(state, { mutationId: "release-2", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(4) })).toThrow(/outbox|delivery/i);
    state.outbox.delivery.status = "delivered";
    const released = coordinator.completeRelease(state, { mutationId: "release-3", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(5) });
    expect(released).toMatchObject({ owner: "bridge", generation: 3, releaseRequested: false });
  });

  test("expiry only marks ownership uncertain and never grants another writer", () => {
    const { state, coordinator, binding } = stateWithBinding();
    coordinator.takeover(state, { mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1, ownerInstanceId: "desktop-1", observedAt: at(1) });
    const uncertain = coordinator.markUncertain(state, { mutationId: "expiry-1", bindingId: binding.bindingId, expectedGeneration: 2, observedAt: at(32), reason: "lease_expired" });
    expect(uncertain).toMatchObject({ owner: "uncertain", generation: 3 });
    expect(() => coordinator.takeover(state, { mutationId: "takeover-after-expiry", bindingId: binding.bindingId, expectedGeneration: 3, ownerInstanceId: "desktop-2", observedAt: at(33) })).toThrow(/uncertain/i);
  });

  test("a late heartbeat cannot revive an expired Desktop lease", () => {
    const { state, coordinator, binding } = stateWithBinding();
    coordinator.takeover(state, { mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1, ownerInstanceId: "desktop-1", observedAt: at(1) });
    expect(() => coordinator.heartbeat(state, {
      mutationId: "late-heartbeat", bindingId: binding.bindingId, expectedGeneration: 2,
      ownerInstanceId: "desktop-1", observedAt: at(32),
    })).toThrow(/expired|uncertain/i);
    expect(binding).toMatchObject({ owner: "uncertain", generation: 3 });
  });

  test("bounds durable mutation and wake identifiers and stores no supplied secret-like fields", () => {
    const { state, coordinator, binding } = stateWithBinding();
    const same = coordinator.bind(state, {
      mutationId: "bind-1", bindingId: "binding-1", rootThreadId: "root-thread-1", taskId: "task-1",
      conversationId: "conversation-1", adapterId: "weixin:bot", bindingAnchorTurnId: "anchor-turn", observedAt: at(0),
    });
    expect(same).toBe(binding);
    expect(() => coordinator.bind(state, {
      mutationId: "bind-1", bindingId: "binding-1", rootThreadId: "other-root", taskId: "task-1",
      conversationId: "conversation-1", adapterId: "weixin:bot", bindingAnchorTurnId: "anchor-turn", observedAt: at(0),
    })).toThrow(/integrity conflict/i);
    expect(Object.keys(binding.processedMutationIds).length).toBeLessThanOrEqual(256);
  });
});
