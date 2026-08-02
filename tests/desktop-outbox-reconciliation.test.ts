import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AuthoritativeCodexThread, AuthoritativeCodexTurn } from "../src/agent/codex-runner.js";
import { DesktopResultCoordinator } from "../src/core/desktop-result-coordinator.js";
import { DeliverableStager } from "../src/core/deliverable-stager.js";
import { MediaOutbox } from "../src/core/media-outbox.js";
import { authoritativeTurnDigest } from "../src/core/desktop-reconciler.js";
import { emptyState, type BridgeState } from "../src/state/types.js";
import { loadConfig } from "../src/config/env.js";
import { JsonStateStore } from "../src/state/store.js";
import { MessageRouter } from "../src/core/message-router.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function turn(id: string, prompt: string, finalText: string): AuthoritativeCodexTurn {
  return { id, status: "completed", items: [
    { id: `${id}-user`, type: "userMessage", text: prompt },
    { id: `${id}-agent`, type: "agentMessage", text: finalText, phase: "final_answer" },
  ] };
}

async function fixture(finalText = "Desktop result") {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-desktop-result-")); roots.push(root);
  const home = path.join(root, "home"); const workspace = path.join(root, "workspace");
  await mkdir(home); await mkdir(workspace);
  const taskId = "tsk_aaaaaaaaaaaaaaaaaaaaaaaa";
  const anchor = turn("turn-z", "anchor", "anchor result");
  const target = turn("turn-a", "desktop prompt", finalText);
  const thread: AuthoritativeCodexThread = { id: "root-thread", sessionId: "root-thread", cwd: workspace, turns: [anchor, target] };
  let state: BridgeState = emptyState();
  let reads = 0;
  state.tasks[taskId] = {
    taskId, conversationId: "weixin-chat", chatType: "direct", senderKey: "sender", title: "task", aliases: [],
    workspaceKind: "work", workspaceRoot: workspace, executionCwd: workspace, isolationMode: "canonical_fifo",
    sessionEpoch: "epoch", threadId: thread.id, status: "completed", objectiveSummary: "", recentRequests: [],
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", lastActiveAt: "2026-08-02T00:00:00.000Z",
  };
  state.conversations["weixin-chat"] = { taskIds: [taskId], lastTaskId: taskId };
  state.desktopGateway!.bindings.binding = {
    bindingId: "binding", rootThreadId: thread.id, taskId, conversationId: "weixin-chat", adapterId: "weixin:bot",
    owner: "desktop", generation: 2, ownerInstanceId: "desktop", leaseExpiresAt: "2026-08-02T01:00:00.000Z",
    bindingAnchorTurnId: anchor.id, bindingAnchorTurnIndex: 0, lastReconciledTurnId: anchor.id, lastReconciledTurnIndex: 0,
    lastAuthoritativeDigest: authoritativeTurnDigest(anchor),
    activeStartFence: { turnId: target.id, originGeneration: 2, requestId: "request", promptCommitment: "a".repeat(64), issuedAt: "2026-08-02T00:00:01.000Z" },
    excludedControlTurns: {}, pendingWakeIds: ["wake"], processedMutationIds: {},
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:01.000Z",
  };
  state.desktopGateway!.wakes.wake = { eventId: "wake", bindingId: "binding", turnId: target.id, observedAt: "2026-08-02T00:00:02.000Z" };
  let failCommit = false;
  const coordinator = new DesktopResultCoordinator({
    readThread: async () => { reads += 1; return structuredClone(thread); },
    readState: async (read) => read(state),
    mutateState: async (mutation) => {
      const before = structuredClone(state);
      try { const result = await mutation(state); if (failCommit) throw new Error("commit failed"); return result; }
      catch (error) { state = before; throw error; }
    },
    stager: new DeliverableStager({ chat2codexHome: home }), mediaOutbox: new MediaOutbox(),
    now: () => "2026-08-02T00:00:03.000Z",
  });
  return { root, home, workspace, taskId, thread, target, coordinator, get reads() { return reads; }, get state() { return state; }, set failCommit(value: boolean) { failCommit = value; } };
}

describe("Desktop outbox reconciliation", () => {
  test("atomically mirrors text, advances array high water, and clears only the matched fence/wake", async () => {
    const item = await fixture();
    expect(await item.coordinator.reconcileBinding("binding")).toMatchObject({ kind: "committed", deliveryCount: 1 });
    const binding = item.state.desktopGateway!.bindings.binding!;
    expect(binding).toMatchObject({ lastReconciledTurnId: item.target.id, lastReconciledTurnIndex: 1, lastMirroredTurnId: item.target.id });
    expect(binding.activeStartFence).toBeUndefined(); expect(binding.pendingWakeIds).toEqual([]);
    expect(item.state.desktopGateway!.wakes).toEqual({});
    const delivery = Object.values(item.state.outbox)[0]!;
    expect(delivery).toMatchObject({ kind: "markdown", text: "Desktop result", sequence: 0, status: "pending" });
    expect(delivery.idempotencyKey).toMatch(/^desktop:binding:2:turn-a:0:[a-f0-9]{64}$/u);
    expect(await item.coordinator.reconcileBinding("binding")).toEqual({ kind: "noop" });
  });

  test("stages declared image/file in order and recovers a crash before the atomic commit without rerunning Codex", async () => {
    const item = await fixture("Done\nCHAT2CODEX_OUTPUT_FILES: [\"" + "PLACEHOLDER" + "\"]");
    const image = path.join(item.workspace, "answer.png"); const file = path.join(item.workspace, "report.txt");
    await writeFile(image, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1])); await writeFile(file, "report");
    item.thread.turns[1]!.items[1]!.text = `Done\nCHAT2CODEX_OUTPUT_FILES: ${JSON.stringify([image, file])}`;
    item.failCommit = true;
    await expect(item.coordinator.reconcileBinding("binding")).rejects.toThrow("commit failed");
    expect(Object.keys(item.state.outbox)).toHaveLength(0);
    item.failCommit = false;
    expect(await item.coordinator.reconcileBinding("binding")).toMatchObject({ kind: "committed", deliveryCount: 3 });
    expect(Object.values(item.state.outbox).sort((a,b) => a.sequence-b.sequence).map((entry) => entry.kind)).toEqual(["markdown", "image", "file"]);
    expect(item.reads).toBe(2);
    const media = Object.values(item.state.outbox).filter((entry) => entry.kind === "image" || entry.kind === "file");
    expect(await readFile(media[0]!.stagedPath)).toEqual(await readFile(image));
  });

  test("recovers an unreferenced deterministic staging tree left by a hard crash", async () => {
    const item = await fixture();
    const file = path.join(item.workspace, "crash.txt"); await writeFile(file, "fresh bytes");
    item.thread.turns[1]!.items[1]!.text = `Done\nCHAT2CODEX_OUTPUT_FILES: ${JSON.stringify([file])}`;
    const staleDirectory = path.join(item.home, "outbound", item.taskId, "desktop-binding-2-turn-a");
    await mkdir(staleDirectory, { recursive: true }); await writeFile(path.join(staleDirectory, "01-crash.txt"), "stale bytes");
    expect(await item.coordinator.reconcileBinding("binding")).toMatchObject({ kind: "committed", deliveryCount: 2 });
    const media = Object.values(item.state.outbox).find((entry) => entry.kind === "file")!;
    expect(await readFile(media.stagedPath, "utf8")).toBe("fresh bytes");
  });

  test("same logical outbox position with different bytes fails uncertain without cursor advancement", async () => {
    const item = await fixture();
    const position = "desktop:binding:2:turn-a:0:";
    item.state.outbox.existing = { id: "existing", jobId: "desktop-existing", taskId: item.taskId, chatId: "weixin-chat",
      kind: "markdown", text: "different", sequence: 0, status: "pending", idempotencyKey: position + "b".repeat(64),
      attempts: 0, createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" };
    item.state.jobs["desktop-existing"] = { id: "desktop-existing", kind: "control_recovery", messageId: "desktop-existing",
      chatId: "weixin-chat", chatType: "direct", cwd: item.workspace, prompt: "[desktop result]", threadId: "root-thread",
      status: "completed", createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: "2026-08-02T00:00:00.000Z", deliveryIds: ["existing"], taskId: item.taskId };
    expect(await item.coordinator.reconcileBinding("binding")).toMatchObject({ kind: "uncertain" });
    expect(item.state.desktopGateway!.bindings.binding).toMatchObject({ owner: "uncertain", lastReconciledTurnIndex: 0 });
  });

  test("concrete child or unbound history is excluded with zero outbox", async () => {
    const item = await fixture();
    item.thread.id = "child-thread"; item.thread.sessionId = "root-thread";
    expect(await item.coordinator.reconcileBinding("binding")).toMatchObject({ kind: "uncertain" });
    expect(Object.keys(item.state.outbox)).toHaveLength(0);
  });

  test("starts authoritative scanning only after control commitments and delivers without Codex rerun", async () => {
    const item = await fixture();
    const statePath = path.join(item.root, "state.json");
    item.state.desktopGateway!.bindings.binding!.adapterId = "feishu:default";
    const config = loadConfig({
      FEISHU_APP_ID: "test", FEISHU_APP_SECRET: "test-secret", CODEX_WORKDIR: item.workspace,
      CHAT2CODEX_HOME: item.home, BRIDGE_STATE_PATH: statePath, ALLOWED_USER_IDS: "user",
      CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: "true",
    });
    const store = new JsonStateStore(statePath, { chat2codexHome: item.home });
    await store.save(item.state);
    let runs = 0; const sent: string[] = [];
    const router = new MessageRouter(
      config, store, { sendText: async (_chat, text) => { sent.push(text); }, sendMarkdown: async (_chat, text) => { sent.push(text); } },
      { debug() {}, info() {}, warn() {}, error() {} },
      { run: async () => { runs += 1; throw new Error("Desktop reconciliation must not rerun Codex"); }, readThreadWithTurns: async () => structuredClone(item.thread) },
      {},
    );
    try {
      await router.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await store.load()).desktopGateway!.bindings.binding!.lastReconciledTurnIndex).toBe(0);
      router.configureDesktopControlCommitments({ takeover: "b".repeat(64), release_request: "c".repeat(64) });
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await store.load()).desktopGateway!.bindings.binding!.lastReconciledTurnIndex === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const finalState = await store.load();
      expect(finalState.desktopGateway!.bindings.binding).toMatchObject({ lastReconciledTurnIndex: 1, lastMirroredTurnId: "turn-a" });
      expect(runs).toBe(0);
      expect(sent).toContain("Desktop result");
    } finally { await router.dispose(); }
  });
});
