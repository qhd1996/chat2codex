import { describe, expect, test } from "bun:test";

import {
  DurableGatewayRequestReplay,
  Phase3GatewayController,
  claimBoundBridgeStart,
} from "../src/core/phase3-gateway-controller.js";
import { DesktopOwnershipCoordinator } from "../src/core/desktop-ownership.js";
import type { BridgeState, RegisteredTask } from "../src/state/types.js";
import { emptyState } from "../src/state/types.js";
import { loadConfig } from "../src/config/env.js";
import { JsonStateStore } from "../src/state/store.js";
import { MessageRouter } from "../src/core/message-router.js";
import { disposeSupervisorBridgeRuntime, startRouterThenOptionalGateway } from "../src/runtime/bridge-runtime.js";

const at = (second: number): string =>
  `2026-08-02T00:00:${String(second).padStart(2, "0")}.000Z`;
const uuid = (suffix: string | number): string => `019fc160-7e0d-7990-9317-${String(suffix).padStart(12, "0")}`;

function task(): RegisteredTask {
  return {
    taskId: "task-1", conversationId: "conversation-1", chatType: "direct", senderKey: "sender-1",
    title: "sensitive task title", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\repo",
    executionCwd: "C:\\repo", isolationMode: "canonical_fifo", sessionEpoch: "epoch-1",
    threadId: "root-thread-1", status: "completed", objectiveSummary: "secret objective", recentRequests: [],
    createdAt: at(0), updatedAt: at(0), lastActiveAt: at(0),
  };
}

function boundState(): { state: BridgeState; ownership: DesktopOwnershipCoordinator } {
  const state = emptyState();
  state.tasks["task-1"] = task();
  state.conversations["conversation-1"] = { taskIds: ["task-1"], lastTaskId: "task-1" };
  const ownership = new DesktopOwnershipCoordinator({ leaseDurationMs: 30_000 });
  ownership.bind(state, {
    mutationId: "bind-1", bindingId: "binding-1", rootThreadId: "root-thread-1",
    taskId: "task-1", conversationId: "conversation-1", adapterId: "weixin:bot",
    bindingAnchorTurnId: "anchor-turn", bindingAnchorTurnIndex: 0,
    bindingAnchorDigest: "e".repeat(64), observedAt: at(0),
  });
  return { state, ownership };
}

function harness(initial = boundState()) {
  let failSave = false;
  let state = initial.state;
  const controller = new Phase3GatewayController({
    ownership: initial.ownership,
    readState: async (read) => read(state),
    mutateState: async (mutation) => {
      const previous = structuredClone(state);
      try {
        const result = await mutation(state);
        if (failSave) throw new Error("simulated save failure");
        return result;
      } catch (error) {
        state = previous;
        throw error;
      }
    },
  });
  return { controller, get state() { return state; }, set failSave(value: boolean) { failSave = value; } };
}

describe("Phase3GatewayController", () => {
  test("persists request-body replay identity on the addressed binding", async () => {
    const fixture = harness();
    const replay = new DurableGatewayRequestReplay({
      mutateState: async (mutation) => mutation(fixture.state),
    });
    const request = {
      kind: "takeover_desktop" as const, requestId: uuid(20), bindingId: "binding-1",
      expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1),
    };
    expect(await replay.checkAndRecord(request.requestId, "a".repeat(64), request)).toBe("new");
    expect(await replay.checkAndRecord(request.requestId, "a".repeat(64), request)).toBe("idempotent");
    expect(await replay.checkAndRecord(request.requestId, "b".repeat(64), request)).toBe("conflict");
    expect(fixture.state.desktopGateway!.bindings["binding-1"]!.processedMutationIds[`replay:${request.requestId}`]).toBe("a".repeat(64));
  });

  test("returns bounded redacted status and never invokes Codex or chat", async () => {
    const fixture = harness();
    const response = await fixture.controller.status({
      kind: "status", requestId: uuid(1), rootThreadId: "root-thread-1",
    });
    expect(response).toEqual({
      requestId: uuid(1), decision: "accepted", generation: 1,
      message: "owner=bridge;fence=clear;release=clear;wake=clear",
    });
    const serialized = JSON.stringify(response);
    for (const secret of ["root-thread-1", "task-1", "conversation-1", "sensitive task title", "secret objective"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("takes over, heartbeats, fences the actual turn, and requests release", async () => {
    const fixture = harness();
    expect(await fixture.controller.takeover({
      kind: "takeover_desktop", requestId: uuid(2), bindingId: "binding-1",
      expectedGeneration: 1, ownerInstanceId: "desktop-process", observedAt: at(1),
    })).toMatchObject({ requestId: uuid(2), decision: "accepted", generation: 2 });
    expect(await fixture.controller.heartbeat({
      kind: "desktop_heartbeat", requestId: uuid(3), bindingId: "binding-1",
      expectedGeneration: 2, ownerInstanceId: "desktop-process", observedAt: at(2),
    })).toMatchObject({ decision: "accepted", generation: 2 });
    expect(await fixture.controller.submitPrompt({
      kind: "user_prompt_submit", requestId: uuid(4), sessionId: "root-thread-1",
      turnId: "actual-turn-9", promptCommitment: "a".repeat(64), observedAt: at(3),
    })).toEqual({ requestId: uuid(4), decision: "allow", generation: 2, fenceId: "actual-turn-9" });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]!.activeStartFence?.turnId).toBe("actual-turn-9");

    delete fixture.state.desktopGateway!.bindings["binding-1"]!.activeStartFence;
    expect(await fixture.controller.release({
      kind: "release_bridge", requestId: uuid(5), bindingId: "binding-1",
      expectedGeneration: 2, observedAt: at(4),
    })).toMatchObject({ decision: "accepted", generation: 2 });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]!.releaseRequested).toBe(true);
  });

  test("handles exact control prompts without permitting a model turn", async () => {
    const fixture = harness();
    expect(await fixture.controller.submitPrompt({
      kind: "user_prompt_submit", requestId: uuid(6), sessionId: "root-thread-1",
      turnId: "takeover-control-turn", promptCommitment: "b".repeat(64), observedAt: at(1),
      controlKind: "takeover",
    })).toMatchObject({ decision: "accepted", generation: 2 });
    const binding = fixture.state.desktopGateway!.bindings["binding-1"]!;
    expect(binding.owner).toBe("desktop");
    expect(binding.excludedControlTurns["takeover-control-turn"]).toMatchObject({
      kind: "takeover", originGeneration: 2, promptCommitment: "b".repeat(64),
    });
    expect(binding.activeStartFence).toBeUndefined();

    expect(await fixture.controller.submitPrompt({
      kind: "user_prompt_submit", requestId: uuid(7), sessionId: "root-thread-1",
      turnId: "release-control-turn", promptCommitment: "c".repeat(64), observedAt: at(2),
      controlKind: "release_request",
    })).toMatchObject({ decision: "accepted", generation: 2 });
    expect(binding.releaseRequested).toBe(true);
    expect(binding.activeStartFence).toBeUndefined();
  });

  test("fails closed for unbound, stale, wrong-owner, uncertain, and save-failure requests", async () => {
    const fixture = harness();
    const ordinary = {
      kind: "user_prompt_submit" as const, requestId: uuid(8), sessionId: "missing-root",
      turnId: "turn", promptCommitment: "d".repeat(64), observedAt: at(1),
    };
    expect(await fixture.controller.submitPrompt(ordinary)).toMatchObject({ decision: "not_found" });
    expect(await fixture.controller.submitPrompt({ ...ordinary, requestId: uuid(9), sessionId: "root-thread-1" })).toMatchObject({ decision: "block" });
    expect(await fixture.controller.takeover({
      kind: "takeover_desktop", requestId: uuid(10), bindingId: "binding-1",
      expectedGeneration: 9, ownerInstanceId: "desktop", observedAt: at(1),
    })).toMatchObject({ decision: "stale_generation" });

    fixture.state.desktopGateway!.bindings["binding-1"]!.owner = "uncertain";
    expect(await fixture.controller.submitPrompt({ ...ordinary, requestId: uuid(11), sessionId: "root-thread-1" })).toMatchObject({ decision: "ownership_uncertain" });

    fixture.state.desktopGateway!.bindings["binding-1"]!.owner = "bridge";
    fixture.failSave = true;
    expect(await fixture.controller.takeover({
      kind: "takeover_desktop", requestId: uuid(12), bindingId: "binding-1",
      expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1),
    })).toMatchObject({ decision: "block" });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]).toMatchObject({ owner: "bridge", generation: 1 });
  });

  test("durably commits uncertain when a Desktop lease expires inside a controller transaction", async () => {
    const fixture = harness();
    await fixture.controller.takeover({
      kind: "takeover_desktop", requestId: uuid(40), bindingId: "binding-1",
      expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1),
    });
    const heartbeat = {
      kind: "desktop_heartbeat", requestId: uuid(41), bindingId: "binding-1",
      expectedGeneration: 2, ownerInstanceId: "desktop", observedAt: "2026-08-02T00:00:32.000Z",
    } as const;
    expect(await fixture.controller.heartbeat(heartbeat)).toMatchObject({ decision: "ownership_uncertain", generation: 3 });
    expect(await fixture.controller.heartbeat(heartbeat)).toMatchObject({ decision: "ownership_uncertain", generation: 3 });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]).toMatchObject({ owner: "uncertain", generation: 3 });
  });

  test("durably commits uncertain when prompt fencing observes an expired lease", async () => {
    const fixture = harness();
    await fixture.controller.takeover({
      kind: "takeover_desktop", requestId: uuid(42), bindingId: "binding-1",
      expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1),
    });
    const request = {
      kind: "user_prompt_submit" as const, requestId: uuid(43), sessionId: "root-thread-1",
      turnId: "expired-turn", promptCommitment: "f".repeat(64), observedAt: "2026-08-02T00:00:32.000Z",
    };
    expect(await fixture.controller.submitPrompt(request)).toMatchObject({ decision: "ownership_uncertain", generation: 3 });
    expect(await fixture.controller.submitPrompt(request)).toMatchObject({ decision: "ownership_uncertain", generation: 3 });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]).toMatchObject({ owner: "uncertain", generation: 3 });
  });

  test("Stop only records an idempotent wake and never starts work", async () => {
    const fixture = harness();
    const request = {
      kind: "stop_wake" as const, eventId: uuid(13), sessionId: "root-thread-1",
      turnId: "turn-stop", observedAt: at(1),
    };
    expect(await fixture.controller.wake(request)).toMatchObject({ decision: "accepted" });
    expect(await fixture.controller.wake(request)).toMatchObject({ decision: "accepted" });
    expect(fixture.state.desktopGateway!.bindings["binding-1"]!.pendingWakeIds).toEqual([uuid(13)]);
  });
});

describe("bound bridge pre-turn fence", () => {
  test("Desktop Gateway surface shares the Router generation owner and rolls back failed saves", async () => {
    const config = loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: process.cwd() });
    class MemoryStore extends JsonStateStore {
      current = boundState().state;
      fail = false;
      constructor() { super("unused.json", { adapterId: "weixin:bot" }); }
      override async load() { return this.current; }
      override async save(state: BridgeState) {
        if (this.fail) throw new Error("save failed");
        this.current = structuredClone(state);
      }
    }
    const store = new MemoryStore();
    const router = new MessageRouter(
      config, store,
      { sendText: async () => undefined, sendMarkdown: async () => undefined },
      { debug() {}, info() {}, warn() {}, error() {} },
      { run: async () => ({ finalText: "", stderr: "", exitCode: 0 }) },
      {},
    );
    try {
      await router.start();
      const { controller } = router.getDesktopGatewaySurface();
      store.fail = true;
      expect(await controller.takeover({
        kind: "takeover_desktop", requestId: uuid(30), bindingId: "binding-1",
        expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1),
      })).toMatchObject({ decision: "block" });
      store.fail = false;
      expect(await controller.status({ kind: "status", requestId: uuid(31), rootThreadId: "root-thread-1" })).toMatchObject({
        decision: "accepted", generation: 1, message: expect.stringContaining("owner=bridge"),
      });
    } finally {
      await router.dispose();
    }
  });

  test("atomically records owner generation before a bound job may run", () => {
    const { state } = boundState();
    state.jobs.job = {
      id: "job", kind: "codex_run", messageId: "job", chatId: "conversation-1", chatType: "direct",
      cwd: "C:\\repo", prompt: "redacted", status: "queued", createdAt: at(1), updatedAt: at(1),
      deliveryIds: [], taskId: "task-1", threadId: "root-thread-1",
    };
    expect(claimBoundBridgeStart(state, { taskId: "task-1", jobId: "job", observedAt: at(2) })).toEqual({
      bindingId: "binding-1", generation: 1,
    });
    expect(state.jobs.job).toMatchObject({ status: "running", desktopBindingId: "binding-1", desktopGeneration: 1 });
  });

  test("Desktop Gateway generation owner permits exactly one of bridge start and Desktop takeover", async () => {
    const first = boundState();
    first.state.jobs.job = {
      id: "job", kind: "codex_run", messageId: "job", chatId: "conversation-1", chatType: "direct",
      cwd: "C:\\repo", prompt: "redacted", status: "queued", createdAt: at(1), updatedAt: at(1),
      deliveryIds: [], taskId: "task-1", threadId: "root-thread-1",
    };
    claimBoundBridgeStart(first.state, { taskId: "task-1", jobId: "job", observedAt: at(2) });
    expect(() => first.ownership.takeover(first.state, {
      mutationId: "takeover", bindingId: "binding-1", expectedGeneration: 1,
      ownerInstanceId: "desktop", observedAt: at(2),
    })).toThrow(/active bridge job/i);

    const second = boundState();
    second.state.jobs.job = structuredClone(first.state.jobs.job!);
    second.state.jobs.job.status = "queued";
    delete second.state.jobs.job.desktopBindingId;
    delete second.state.jobs.job.desktopGeneration;
    // A queued durable job is already an obligation, so takeover cannot cross it.
    expect(() => second.ownership.takeover(second.state, {
      mutationId: "takeover", bindingId: "binding-1", expectedGeneration: 1,
      ownerInstanceId: "desktop", observedAt: at(2),
    })).toThrow(/active bridge job/i);
    second.state.jobs.job.status = "cancelled";
    second.ownership.takeover(second.state, {
      mutationId: "takeover-after-cancel", bindingId: "binding-1", expectedGeneration: 1,
      ownerInstanceId: "desktop", observedAt: at(2),
    });
    second.state.jobs.job.status = "queued";
    expect(() => claimBoundBridgeStart(second.state, { taskId: "task-1", jobId: "job", observedAt: at(3) })).toThrow(/bridge ownership/i);
  });
});

describe("Desktop Gateway runtime ordering", () => {
  test("starts the Router before constructing and listening on the Gateway", async () => {
    const events: string[] = [];
    const gateway = await startRouterThenOptionalGateway(
      { start: async () => { events.push("router:start"); } },
      true,
      async () => ({
        start: async () => { events.push("gateway:start"); },
        stop: async () => { events.push("gateway:stop"); },
      }),
    );
    expect(events).toEqual(["router:start", "gateway:start"]);
    expect(gateway).toBeDefined();
  });

  test("cleans up a Gateway that fails to listen and propagates the startup failure", async () => {
    const events: string[] = [];
    await expect(startRouterThenOptionalGateway(
      { start: async () => { events.push("router:start"); } },
      true,
      async () => ({
        start: async () => { events.push("gateway:start"); throw new Error("listen failed"); },
        stop: async () => { events.push("gateway:stop"); },
      }),
    )).rejects.toThrow("listen failed");
    expect(events).toEqual(["router:start", "gateway:start", "gateway:stop"]);
  });

  test("stops accepting Gateway work before draining supervisor and Router", async () => {
    const events: string[] = [];
    await disposeSupervisorBridgeRuntime(
      { stop: async () => { events.push("supervisor:stop"); } } as never,
      { dispose: async () => { events.push("router:dispose"); } },
      { stop: async () => { events.push("gateway:stop"); } },
    );
    expect(events[0]).toBe("gateway:stop");
    expect(new Set(events.slice(1))).toEqual(new Set(["supervisor:stop", "router:dispose"]));
  });
});
