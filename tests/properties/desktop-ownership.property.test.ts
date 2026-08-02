import { expect, test } from "bun:test";
import fc from "fast-check";

import { DesktopOwnershipCoordinator } from "../../src/core/desktop-ownership.js";
import { emptyState, type BridgeState, type RegisteredTask } from "../../src/state/types.js";

const seed = 20260802;
const timestamp = "2026-08-02T00:00:00.000Z";

function boundedId() {
  return fc.stringMatching(/^[a-z][a-z0-9_-]{0,31}$/u);
}

const sha256Arbitrary = fc.array(fc.constantFrom(..."0123456789abcdef"), { minLength: 64, maxLength: 64 })
  .map((characters) => characters.join(""));

function fixture(anchorIndex: number, anchorDigest: string) {
  const state = emptyState();
  const task: RegisteredTask = {
    taskId: "task-1", conversationId: "conversation-1", chatType: "direct", senderKey: "sender-1",
    title: "task", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\repo",
    executionCwd: "C:\\repo", isolationMode: "canonical_fifo", sessionEpoch: "epoch-1",
    threadId: "root-thread", status: "completed", objectiveSummary: "", recentRequests: [],
    createdAt: timestamp, updatedAt: timestamp, lastActiveAt: timestamp,
  };
  state.tasks[task.taskId] = task;
  state.conversations[task.conversationId] = { taskIds: [task.taskId], lastTaskId: task.taskId };
  const coordinator = new DesktopOwnershipCoordinator({ leaseDurationMs: 30_000 });
  const binding = coordinator.bind(state, {
    mutationId: "bind-1", bindingId: "binding-1", rootThreadId: task.threadId!,
    taskId: task.taskId, conversationId: task.conversationId, adapterId: "weixin:bot",
    bindingAnchorTurnId: "anchor-turn", bindingAnchorTurnIndex: anchorIndex,
    bindingAnchorDigest: anchorDigest, observedAt: timestamp,
  });
  return { state, coordinator, binding };
}

test("property: ownership transfer increments once and stale CAS never mutates", () => {
  fc.assert(fc.property(
    boundedId(), fc.integer({ min: 0, max: 64 }), sha256Arbitrary,
    (ownerInstanceId, anchorIndex, anchorDigest) => {
      const { state, coordinator, binding } = fixture(anchorIndex, anchorDigest);
      const transferred = coordinator.takeover(state, {
        mutationId: "takeover-1", bindingId: binding.bindingId, expectedGeneration: 1,
        ownerInstanceId, observedAt: "2026-08-02T00:00:01.000Z",
      });
      expect(transferred.owner).toBe("desktop");
      expect(transferred.generation).toBe(2);
      const beforeStale = structuredClone(state);
      expect(() => coordinator.takeover(state, {
        mutationId: "takeover-stale", bindingId: binding.bindingId, expectedGeneration: 1,
        ownerInstanceId: ownerInstanceId + "-stale", observedAt: "2026-08-02T00:00:02.000Z",
      })).toThrow(/stale generation/i);
      expect(state).toEqual(beforeStale);
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: identical mutation replay is a no-op and changed bytes fail uncertain", () => {
  fc.assert(fc.property(boundedId(), boundedId().filter((value) => value !== "different"), (ownerInstanceId, changedOwner) => {
    fc.pre(ownerInstanceId !== changedOwner);
    const { state, coordinator, binding } = fixture(0, "a".repeat(64));
    const request = {
      mutationId: "takeover-replay", bindingId: binding.bindingId, expectedGeneration: 1,
      ownerInstanceId, observedAt: "2026-08-02T00:00:01.000Z",
    };
    const first = coordinator.takeover(state, request);
    const afterFirst = structuredClone(state);
    expect(coordinator.takeover(state, request)).toBe(first);
    expect(state).toEqual(afterFirst);
    expect(() => coordinator.takeover(state, { ...request, ownerInstanceId: changedOwner })).toThrow(/integrity conflict/i);
    expect(binding.owner).toBe("uncertain");
    expect(binding.generation).toBe(3);
  }), { seed, numRuns: 100, endOnFailure: true });
});

test("property: uncertain and disabled states never grant Desktop ownership", () => {
  fc.assert(fc.property(fc.constantFrom<"uncertain" | "disabled">("uncertain", "disabled"), (owner) => {
    const { state, coordinator, binding } = fixture(0, "a".repeat(64));
    binding.owner = owner;
    const before = structuredClone(state);
    expect(() => coordinator.takeover(state, {
      mutationId: "takeover-denied", bindingId: binding.bindingId, expectedGeneration: 1,
      ownerInstanceId: "desktop-1", observedAt: "2026-08-02T00:00:01.000Z",
    })).toThrow();
    expect(state).toEqual(before);
  }), { seed, numRuns: 40, endOnFailure: true });
});
