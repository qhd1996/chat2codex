import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { JsonStateStore } from "../src/state/store.js";
import {
  USAGE_ADVISOR_LIMITS,
  USAGE_ADVISOR_SIGNAL_CODES,
  UsageAdvisor,
} from "../src/core/usage-advisor.js";
import type {
  BridgeState,
  DurableCodexJob,
  DurableCodexJobStatus,
  DurableOutboxMessage,
  DurableOutboxStatus,
  RegisteredTask,
} from "../src/state/types.js";
import { emptyState, emptyUsageAdvisorState } from "../src/state/types.js";

describe("JsonStateStore", () => {
  test("loads empty state when no file exists and persists state atomically", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    try {
      const stateDirectory = path.join(tempDir, "nested");
      const store = new JsonStateStore(path.join(stateDirectory, "state.json"));
      expect(await store.load()).toEqual({
        tasks: {}, conversations: {},
        chats: {},
        jobs: {},
        outbox: {},
        pendingMessages: {},
        processedMessageIds: [],
        diagnostics: {},
        imageDrafts: {},
        clarifications: {},
        usageAdvisor: emptyUsageAdvisorState(),
        desktopGateway: { bindings: {}, wakes: {} },
      });

      await store.save({
        chats: {
          oc_chat: {
            sessionEpoch: "epoch_1",
            cwd: tempDir,
            updatedAt: "2026-06-29T00:00:00.000Z",
            threadId: "thread_1",
          },
        },
        jobs: {},
        outbox: {},
        pendingMessages: {},
        processedMessageIds: Array.from({ length: 510 }, (_, index) => `m${index}`),
        diagnostics: {
          lastEvent: {
            at: "2026-06-29T00:00:00.000Z",
            outcome: "routed",
            messageId: "m1",
            chatId: "oc_chat",
            chatType: "direct",
            messageType: "text",
            mentionCount: 0,
            startsWithMention: false,
            attachmentCount: 0,
            textLength: 5,
            botIdentityResolved: true,
          },
          recentFailures: Array.from({ length: 7 }, (_, index) => ({
            at: `2026-06-29T00:0${index}:00.000Z`,
            category: "unknown",
            cwd: tempDir,
            promptPreview: `prompt ${index}`,
            detail: `failure ${index}`,
          })),
        },
      });

      const loaded = await store.load();
      expect(loaded.chats.oc_chat?.threadId).toBe("thread_1");
      expect(loaded.chats.oc_chat?.sessionEpoch).toBe("epoch_1");
      expect(loaded.processedMessageIds).toHaveLength(500);
      expect(loaded.processedMessageIds[0]).toBe("m10");
      expect(loaded.diagnostics.lastEvent?.messageId).toBe("m1");
      expect(loaded.diagnostics.recentFailures).toHaveLength(5);
      expect(loaded.diagnostics.recentFailures?.[0]?.detail).toBe("failure 2");
      expect(loaded.diagnostics.recentFailures?.at(-1)?.detail).toBe("failure 6");

      if (process.platform !== "win32") {
        expect((await stat(stateDirectory)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(stateDirectory, "state.json"))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("does not change permissions on an existing parent directory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const stateDirectory = path.join(tempDir, "existing");
    try {
      await mkdir(stateDirectory, { mode: 0o755 });
      await chmod(stateDirectory, 0o755);
      const store = new JsonStateStore(path.join(stateDirectory, "state.json"));
      await store.save({
        chats: {},
        jobs: {},
        outbox: {},
        pendingMessages: {},
        processedMessageIds: [],
        diagnostics: {},
      });

      if (process.platform !== "win32") {
        expect((await stat(stateDirectory)).mode & 0o777).toBe(0o755);
        expect((await stat(path.join(stateDirectory, "state.json"))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent saves targeting the same state file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "nested", "state.json");
    try {
      const stores = [new JsonStateStore(statePath), new JsonStateStore(statePath)];
      const saves = Array.from({ length: 50 }, (_, index) =>
        stores[index % stores.length]!.save({
          chats: {
            oc_chat: {
              sessionEpoch: `epoch_${index}`,
              cwd: tempDir,
              updatedAt: `2026-06-29T00:00:${String(index).padStart(2, "0")}.000Z`,
              threadId: `thread_${index}`,
            },
          },
          jobs: {},
          outbox: {},
          pendingMessages: {},
          processedMessageIds: [`m${index}`],
          diagnostics: {},
        }),
      );

      await Promise.all(saves);

      const loaded = await stores[0]!.load();
      expect(loaded.chats.oc_chat?.threadId).toBe("thread_49");
      expect(loaded.chats.oc_chat?.sessionEpoch).toBe("epoch_49");
      expect(loaded.processedMessageIds).toEqual(["m49"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("loads pre-outbox state with empty durable job collections", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      await Bun.write(
        statePath,
        JSON.stringify({
          chats: {},
          pendingMessages: {},
          processedMessageIds: ["legacy"],
          diagnostics: {},
        }),
      );

      const loaded = await new JsonStateStore(statePath).load();
      expect(loaded.jobs).toEqual({});
      expect(loaded.outbox).toEqual({});
      expect(loaded.processedMessageIds).toEqual(["legacy"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("migrates v0.6 state into one adapter partition and preserves a private backup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    const legacy = {
      chats: {
        oc_legacy: {
          sessionEpoch: "epoch_legacy",
          cwd: tempDir,
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      },
      jobs: {},
      outbox: {},
      pendingMessages: {},
      processedMessageIds: ["m_legacy"],
      diagnostics: {},
    };
    try {
      await Bun.write(statePath, `${JSON.stringify(legacy)}\n`);
      const store = new JsonStateStore(statePath, { adapterId: "lark:default" });
      const loaded = await store.load();
      expect(loaded.chats.oc_legacy?.sessionEpoch).toBe("epoch_legacy");

      await store.save(loaded);

      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(persisted.schemaVersion).toBe(6);
      expect(persisted.adapters["lark:default"].processedMessageIds).toEqual(["m_legacy"]);
      expect(JSON.parse(await readFile(`${statePath}.v0.6.bak`, "utf8"))).toEqual(legacy);
      if (process.platform !== "win32") {
        expect((await stat(`${statePath}.v0.6.bak`)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("isolates adapter partitions while sharing one atomic state file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const feishu = new JsonStateStore(statePath, { adapterId: "feishu:default" });
      const slack = new JsonStateStore(statePath, { adapterId: "slack:team-a" });
      const feishuState = await feishu.load();
      feishuState.processedMessageIds.push("same-message-id");
      feishuState.chats.same_chat = {
        sessionEpoch: "epoch_feishu",
        cwd: tempDir,
        updatedAt: "2026-07-22T00:00:00.000Z",
      };
      await feishu.save(feishuState);

      const slackState = await slack.load();
      expect(slackState).toEqual({
        tasks: {}, conversations: {},
        chats: {},
        jobs: {},
        outbox: {},
        pendingMessages: {},
        processedMessageIds: [],
        diagnostics: {},
        imageDrafts: {},
        clarifications: {},
        usageAdvisor: emptyUsageAdvisorState(),
        desktopGateway: { bindings: {}, wakes: {} },
      });
      slackState.processedMessageIds.push("same-message-id");
      slackState.chats.same_chat = {
        sessionEpoch: "epoch_slack",
        cwd: tempDir,
        updatedAt: "2026-07-22T00:00:00.000Z",
      };
      await slack.save(slackState);

      expect((await feishu.load()).chats.same_chat?.sessionEpoch).toBe("epoch_feishu");
      expect((await slack.load()).chats.same_chat?.sessionEpoch).toBe("epoch_slack");
      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(Object.keys(persisted.adapters).sort()).toEqual([
        "feishu:default",
        "slack:team-a",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("migrates schema v3 chats into deterministic tasks and preserves a v3 backup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-v3-"));
    const statePath = path.join(tempDir, "state.json");
    const legacy = { schemaVersion: 3, adapters: { "weixin:bot": { chats: { wx_chat: { sessionEpoch: "epoch-v3", cwd: tempDir, threadId: "thread-v3", chatType: "direct", updatedAt: "2026-08-01T00:00:00.000Z" } }, jobs: {}, outbox: {}, pendingMessages: {}, processedMessageIds: [], diagnostics: {}, imageDrafts: {}, clarifications: {} } } };
    try {
      await writeFile(statePath, JSON.stringify(legacy));
      const store = new JsonStateStore(statePath, { adapterId: "weixin:bot" });
      const loaded = await store.load();
      const imported = Object.values(loaded.tasks);
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({ conversationId: "wx_chat", workspaceRoot: tempDir, executionCwd: tempDir, isolationMode: "canonical_fifo", threadId: "thread-v3", sessionEpoch: "epoch-v3", status: "completed" });
      expect(loaded.conversations.wx_chat?.taskIds).toEqual([imported[0]!.taskId]);
      await store.save(loaded);
      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(persisted.schemaVersion).toBe(6);
      expect(JSON.parse(await readFile(`${statePath}.v3.bak`, "utf8"))).toEqual(legacy);
      expect((await store.load()).conversations.wx_chat?.taskIds).toEqual([imported[0]!.taskId]);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("refuses to overwrite an unknown future state schema", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    const futureState = `${JSON.stringify({ schemaVersion: 7, adapters: {} }, null, 2)}\n`;
    try {
      await writeFile(statePath, futureState, { mode: 0o600 });
      const store = new JsonStateStore(statePath, { adapterId: "feishu:default" });

      await expect(store.load()).rejects.toThrow("Unsupported bridge state schema version: 7");
      await expect(store.save(emptyState())).rejects.toThrow(
        "Unsupported bridge state schema version: 7",
      );
      expect(await readFile(statePath, "utf8")).toBe(futureState);
      expect(await stat(`${statePath}.v0.6.bak`).catch(() => null)).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("migrates v2 adapter state with empty drafts and persists valid draft metadata", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-v2-"));
    const statePath = path.join(tempDir, "state.json");
    const imagePath = path.join(tempDir, "image.jpg");
    try {
      await writeFile(statePath, JSON.stringify({
        schemaVersion: 2,
        adapters: { "weixin:bot": { ...emptyState(), processedMessageIds: ["kept-v2"] } },
      }));
      const store = new JsonStateStore(statePath, { adapterId: "weixin:bot" });
      const state = await store.load();
      expect(state.imageDrafts).toEqual({});
      expect(state.clarifications).toEqual({});
      expect(state.processedMessageIds).toEqual(["kept-v2"]);
      state.imageDrafts!["chat:user"] = {
        chatId: "chat", senderKey: "user", createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-01T00:30:00.000Z",
        images: [{ sourceMessageId: "m1", path: imagePath, sha256: "a".repeat(64), mediaType: "image/jpeg", bytes: 10 }],
        totalBytes: 10,
      };
      await store.save(state);
      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(persisted.schemaVersion).toBe(6);
      expect((await store.load()).imageDrafts["chat:user"]?.images).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("schema v5 migrates v4 media state with a private v4 backup and preserves legacy text", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-v4-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const legacy = { schemaVersion: 4, adapters: { "weixin:bot": durableState(
        [durableJob("legacy-job", "completed", timestamp(1), ["legacy-text"])],
        [durableOutbox("legacy-text", "legacy-job", "delivered", timestamp(1))],
      ) } };
      await writeFile(statePath, JSON.stringify(legacy));
      const store = new JsonStateStore(statePath, { adapterId: "weixin:bot", chat2codexHome: tempDir });
      const state = await store.load();
      expect(state.outbox["legacy-text"]?.text).toBe("delivery legacy-text");
      await store.save(state);
      expect(JSON.parse(await readFile(statePath, "utf8")).schemaVersion).toBe(6);
      expect(JSON.parse(await readFile(statePath + ".v4.bak", "utf8"))).toEqual(legacy);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("schema v5 rejects invalid or orphaned durable media records", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-media-state-"));
    try {
      const taskId = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";
      const jobId = "media-job";
      const stagedDirectory = path.join(tempDir, "outbound", taskId, jobId);
      const stagedPath = path.join(stagedDirectory, "01-image.png");
      await mkdir(stagedDirectory, { recursive: true }); await writeFile(stagedPath, "image-bytes");
      const hash = new Bun.CryptoHasher("sha256").update("image-bytes").digest("hex");
      const makeState = () => {
        const state = emptyState();
        const task = registeredTask(taskId, "conversation", tempDir); task.status = "completed";
        state.tasks[taskId] = task; state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
        const job = durableJob(jobId, "completed", timestamp(1), ["media-entry"]); job.chatId = "conversation"; job.taskId = taskId; state.jobs[jobId] = job;
        state.outbox["media-entry"] = {
          id: "media-entry", jobId, taskId, chatId: "conversation", kind: "image", text: "", sequence: 0,
          stagedPath, fileName: "image.png", mediaType: "image/png", size: 11, sha256: hash,
          status: "pending", idempotencyKey: "media-entry", attempts: 0, createdAt: timestamp(1), updatedAt: timestamp(1),
        };
        return state;
      };
      const expectRejected = async (label: string, mutate: (state: BridgeState) => void, pattern: RegExp) => {
        const state = makeState(); mutate(state);
        await expect(new JsonStateStore(path.join(tempDir, label + ".json"), { chat2codexHome: tempDir }).save(state)).rejects.toThrow(pattern);
      };
      await expect(new JsonStateStore(path.join(tempDir, "valid.json"), { chat2codexHome: tempDir }).save(makeState())).resolves.toBeUndefined();
      await expectRejected("missing-job", (state) => { delete state.jobs[jobId]; }, /orphan.*job/i);
      await expectRejected("missing-task", (state) => { delete state.tasks[taskId]; }, /orphan.*task/i);
      await expectRejected("wrong-task", (state) => { state.tasks["tsk_cccccccccccccccccccccccc"] = registeredTask("tsk_cccccccccccccccccccccccc", "conversation", tempDir); state.outbox["media-entry"]!.taskId = "tsk_cccccccccccccccccccccccc"; }, /task.*owner/i);
      await expectRejected("duplicate-sequence", (state) => { state.outbox.copy = { ...state.outbox["media-entry"]!, id: "copy", idempotencyKey: "copy" }; state.jobs[jobId]!.deliveryIds.push("copy"); }, /duplicate.*sequence/i);
      await expectRejected("relative-path", (state) => { state.outbox["media-entry"]!.stagedPath = "relative.png"; }, /canonical|absolute/i);
      await expectRejected("outside-root", (state) => { state.outbox["media-entry"]!.stagedPath = path.join(tempDir, "outside.png"); }, /outbound root/i);
      const wrongJobDirectory = path.join(tempDir, "outbound", taskId, "other-job"); await mkdir(wrongJobDirectory, { recursive: true }); await writeFile(path.join(wrongJobDirectory, "01-image.png"), "image-bytes");
      await expectRejected("wrong-job-directory", (state) => { state.outbox["media-entry"]!.stagedPath = path.join(wrongJobDirectory, "01-image.png"); }, /job.*staging|staging.*job/i);
      await expectRejected("bad-hash", (state) => { state.outbox["media-entry"]!.sha256 = "bad"; }, /sha-?256|hash/i);
      await expectRejected("bad-size", (state) => { state.outbox["media-entry"]!.size = 10; }, /size/i);
      await expectRejected("bad-attempts", (state) => { state.outbox["media-entry"]!.attempts = -1; }, /attempt/i);
      await expectRejected("bad-idempotency", (state) => { state.outbox["media-entry"]!.idempotencyKey = ""; }, /idempotency/i);
      await expectRejected("unknown-kind", (state) => { (state.outbox["media-entry"] as { kind: string }).kind = "video"; }, /kind/i);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("schema v6 migrates a complete v5 partition without losing media or UsageAdvisor and preserves a private v5 backup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-v5-"));
    const statePath = path.join(tempDir, "state.json");
    const taskId = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";
    const jobId = "media-job";
    const stagedDirectory = path.join(tempDir, "outbound", taskId, jobId);
    const stagedPath = path.join(stagedDirectory, "00-image.png");
    try {
      await mkdir(stagedDirectory, { recursive: true });
      await writeFile(stagedPath, "image-bytes");
      const state = emptyState();
      delete state.desktopGateway;
      state.tasks[taskId] = registeredTask(taskId, "conversation", tempDir);
      state.tasks[taskId]!.threadId = "root-thread-v5";
      state.tasks[taskId]!.status = "completed";
      state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
      state.jobs[jobId] = durableJob(jobId, "completed", timestamp(1), ["media-entry"]);
      state.jobs[jobId]!.chatId = "conversation";
      state.jobs[jobId]!.taskId = taskId;
      state.outbox["media-entry"] = {
        id: "media-entry", jobId, taskId, chatId: "conversation", kind: "image", text: "", sequence: 0,
        stagedPath, fileName: "image.png", mediaType: "image/png", size: 11,
        sha256: new Bun.CryptoHasher("sha256").update("image-bytes").digest("hex"),
        status: "pending", idempotencyKey: "media-entry", attempts: 0, createdAt: timestamp(1), updatedAt: timestamp(1),
      };
      const advisor = new UsageAdvisor(emptyUsageAdvisorState());
      for (const at of [timestamp(1), timestamp(2), timestamp(3)]) advisor.record({ code: "delivery_retry", at });
      state.usageAdvisor = advisor.state;
      const legacy = { schemaVersion: 5, adapters: { "weixin:bot": state } };
      await writeFile(statePath, JSON.stringify(legacy));

      const store = new JsonStateStore(statePath, { adapterId: "weixin:bot", chat2codexHome: tempDir });
      const loaded = await store.load();
      expect(loaded.desktopGateway).toEqual({ bindings: {}, wakes: {} });
      expect(loaded.outbox["media-entry"]).toEqual(state.outbox["media-entry"]);
      expect(loaded.usageAdvisor).toEqual(advisor.state);
      await store.save(loaded);

      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(persisted.schemaVersion).toBe(6);
      expect(persisted.adapters["weixin:bot"].desktopGateway).toEqual({ bindings: {}, wakes: {} });
      expect(persisted.adapters["weixin:bot"].outbox["media-entry"]).toEqual(state.outbox["media-entry"]);
      expect(persisted.adapters["weixin:bot"].usageAdvisor).toEqual(advisor.state);
      expect(JSON.parse(await readFile(statePath + ".v5.bak", "utf8"))).toEqual(legacy);
      if (process.platform !== "win32") expect((await stat(statePath + ".v5.bak")).mode & 0o777).toBe(0o600);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("schema v6 rejects orphan and duplicate Desktop root bindings", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-desktop-bindings-"));
    try {
      const taskId = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";
      const makeState = () => {
        const state = emptyState();
        state.tasks[taskId] = registeredTask(taskId, "conversation", tempDir);
        state.tasks[taskId]!.threadId = "root-thread";
        state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
        state.desktopGateway!.bindings.first = desktopBinding({ bindingId: "first", taskId });
        return state;
      };
      const expectLoadRejected = async (name: string, mutate: (state: BridgeState) => void, pattern: RegExp) => {
        const state = makeState();
        mutate(state);
        const statePath = path.join(tempDir, name + ".json");
        await writeFile(statePath, JSON.stringify({ schemaVersion: 6, adapters: { "weixin:bot": state } }));
        await expect(new JsonStateStore(statePath, { adapterId: "weixin:bot" }).load()).rejects.toThrow(pattern);
      };

      await expectLoadRejected("orphan-task", (state) => { delete state.tasks[taskId]; }, /orphan.*task|task.*binding/i);
      await expectLoadRejected("wrong-thread", (state) => { state.tasks[taskId]!.threadId = "other-thread"; }, /root.*thread|thread.*task/i);
      await expectLoadRejected("duplicate-root", (state) => {
        state.tasks.other = { ...registeredTask("other", "other-conversation", tempDir), threadId: "root-thread" };
        state.conversations["other-conversation"] = { taskIds: ["other"] };
        state.desktopGateway!.bindings.second = desktopBinding({ bindingId: "second", taskId: "other", conversationId: "other-conversation" });
      }, /duplicate.*root|root.*multiple/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("schema v6 upgrades every adapter in one v4 envelope before saving", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-all-adapter-v4-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const legacy = { schemaVersion: 4, adapters: {
        "weixin:one": { ...emptyState(), desktopGateway: undefined, processedMessageIds: ["one"] },
        "weixin:two": { ...emptyState(), desktopGateway: undefined, processedMessageIds: ["two"] },
      } };
      await writeFile(statePath, JSON.stringify(legacy));
      const store = new JsonStateStore(statePath, { adapterId: "weixin:one", chat2codexHome: tempDir });
      await store.save(await store.load());
      const persisted = JSON.parse(await readFile(statePath, "utf8"));
      expect(persisted.schemaVersion).toBe(6);
      expect(persisted.adapters["weixin:one"].desktopGateway).toEqual({ bindings: {}, wakes: {} });
      expect(persisted.adapters["weixin:two"].desktopGateway).toEqual({ bindings: {}, wakes: {} });
      expect(persisted.adapters["weixin:two"].processedMessageIds).toEqual(["two"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("schema v6 rejects duplicate Desktop roots across adapter partitions", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-cross-adapter-binding-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const makePartition = (adapterId: string, taskId: string, conversationId: string, bindingId: string) => {
        const state = emptyState();
        state.tasks[taskId] = { ...registeredTask(taskId, conversationId, tempDir), threadId: "shared-root" };
        state.conversations[conversationId] = { taskIds: [taskId] };
        state.desktopGateway!.bindings[bindingId] = desktopBinding({ bindingId, taskId, conversationId });
        state.desktopGateway!.bindings[bindingId]!.rootThreadId = "shared-root";
        state.desktopGateway!.bindings[bindingId]!.adapterId = adapterId;
        return state;
      };
      await writeFile(statePath, JSON.stringify({ schemaVersion: 6, adapters: {
        "weixin:one": makePartition("weixin:one", "task-one", "conversation-one", "binding-one"),
        "weixin:two": makePartition("weixin:two", "task-two", "conversation-two", "binding-two"),
      } }));
      await expect(new JsonStateStore(statePath, { adapterId: "weixin:one" }).load()).rejects.toThrow(/duplicate.*root.*adapter/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("schema v6 rejects malformed active bindings and wake references", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-desktop-active-"));
    try {
      const taskId = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";
      const makeState = () => {
        const state = emptyState();
        state.tasks[taskId] = registeredTask(taskId, "conversation", tempDir);
        state.tasks[taskId]!.threadId = "root-thread";
        state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
        state.desktopGateway!.bindings.first = desktopBinding({ bindingId: "first", taskId });
        return state;
      };
      const expectSaveRejected = async (name: string, mutate: (state: BridgeState) => void, pattern: RegExp) => {
        const state = makeState();
        mutate(state);
        await expect(new JsonStateStore(path.join(tempDir, name + ".json"), { adapterId: "weixin:bot" }).save(state)).rejects.toThrow(pattern);
      };

      await expectSaveRejected("desktop-without-lease", (state) => { state.desktopGateway!.bindings.first!.owner = "desktop"; }, /desktop.*lease|owner.*instance/i);
      await expectSaveRejected("bridge-with-fence", (state) => {
        state.desktopGateway!.bindings.first!.activeStartFence = { turnId: "turn", originGeneration: 1, requestId: "request", promptCommitment: "a".repeat(64), issuedAt: timestamp(2) };
      }, /bridge.*fence|fence.*owner/i);
      await expectSaveRejected("orphan-wake", (state) => {
        state.desktopGateway!.wakes.wake = { eventId: "wake", bindingId: "first", turnId: "turn", observedAt: timestamp(2) };
      }, /wake.*pending|orphan.*wake/i);
      await expectSaveRejected("missing-wake", (state) => { state.desktopGateway!.bindings.first!.pendingWakeIds = ["missing"]; }, /wake.*missing|pending.*wake/i);
      await expectSaveRejected("unknown-binding-field", (state) => {
        (state.desktopGateway!.bindings.first as unknown as Record<string, unknown>).rawPrompt = "must-not-persist";
      }, /unknown.*binding|binding.*field/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("loads only bounded image clarification references and drops descriptor-like fields", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-clarification-")); const statePath = path.join(tempDir, "state.json");
    try {
      const state = emptyState();
      state.clarifications!["chat:user"] = { chatId: "chat", senderKey: "user", question: "图片属于哪个任务？", originalText: "处理一下", draftKey: "chat:user", candidateTaskIds: ["tsk_1"], choices: ["tsk_1"], createdAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-01T00:05:00.000Z" };
      await new JsonStateStore(statePath).save(state);
      const raw = JSON.parse(await readFile(statePath, "utf8"));
      raw.adapters["feishu:default"].clarifications["chat:user"].images = [{ path: "secret.jpg", bytes: "base64" }];
      await writeFile(statePath, JSON.stringify(raw));

      const loaded = await new JsonStateStore(statePath).load(); const pending = loaded.clarifications?.["chat:user"] as Record<string, unknown>;
      expect(pending.draftKey).toBe("chat:user");
      expect(pending.candidateTaskIds).toEqual(["tsk_1"]);
      expect(pending.images).toBeUndefined();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("adds and persists a session epoch when loading legacy chat state", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      await Bun.write(
        statePath,
        JSON.stringify({
          chats: {
            oc_legacy: {
              cwd: tempDir,
              updatedAt: "2026-06-29T00:00:00.000Z",
              threadId: "thread_legacy",
            },
          },
          jobs: {},
          outbox: {},
          pendingMessages: {},
          processedMessageIds: [],
          diagnostics: {},
        }),
      );

      const store = new JsonStateStore(statePath);
      const loaded = await store.load();
      const generatedEpoch = loaded.chats.oc_legacy?.sessionEpoch;
      expect(generatedEpoch).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      await store.save(loaded);
      const reloaded = await store.load();
      expect(reloaded.chats.oc_legacy?.sessionEpoch).toBe(generatedEpoch);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("prunes the oldest terminal jobs and delivered outbox records to configured limits", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const store = new JsonStateStore(statePath, {
        jobRetentionCount: 3,
        outboxRetentionCount: 3,
      });
      const state = durableState(
        [
          durableJob("job_1", "completed", timestamp(1), ["outbox_1"]),
          durableJob("job_2", "failed", timestamp(2), ["outbox_2"]),
          durableJob("job_3", "completed", timestamp(3), ["outbox_3"]),
          durableJob("job_4", "queued", timestamp(4), ["outbox_4"]),
          durableJob("job_5", "running", timestamp(5), ["outbox_5"]),
        ],
        [
          durableOutbox("outbox_1", "job_1", "delivered", timestamp(1)),
          durableOutbox("outbox_2", "job_2", "delivered", timestamp(2)),
          durableOutbox("outbox_3", "job_3", "delivered", timestamp(3)),
          durableOutbox("outbox_4", "job_4", "pending", timestamp(4)),
          durableOutbox("outbox_5", "job_5", "sending", timestamp(5)),
        ],
      );

      await store.save(state);

      expect(Object.keys(state.jobs)).toEqual(["job_3", "job_4", "job_5"]);
      expect(Object.keys(state.outbox)).toEqual(["outbox_3", "outbox_4", "outbox_5"]);
      expect(state.jobs.job_3?.deliveryIds).toEqual(["outbox_3"]);
      expect(state.jobs.job_4?.status).toBe("queued");
      expect(state.jobs.job_5?.status).toBe("running");
      expect(state.outbox.outbox_4?.status).toBe("pending");
      expect(state.outbox.outbox_5?.status).toBe("sending");

      const loaded = await store.load();
      expect(Object.keys(loaded.jobs)).toEqual(["job_3", "job_4", "job_5"]);
      expect(Object.keys(loaded.outbox)).toEqual(["outbox_3", "outbox_4", "outbox_5"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("keeps active records above the configured limits and protects their job references", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const store = new JsonStateStore(statePath, {
        jobRetentionCount: 0,
        outboxRetentionCount: 0,
      });
      const state = durableState(
        [
          durableJob("job_queued", "queued", timestamp(1), ["outbox_delivered"]),
          durableJob("job_running", "running", timestamp(2), ["outbox_sending"]),
          durableJob("job_blocked", "completed", timestamp(3), ["outbox_pending"]),
        ],
        [
          durableOutbox("outbox_delivered", "job_queued", "delivered", timestamp(1)),
          durableOutbox("outbox_sending", "job_running", "sending", timestamp(2)),
          durableOutbox("outbox_pending", "job_blocked", "pending", timestamp(3)),
        ],
      );

      await store.save(state);

      expect(Object.keys(state.jobs)).toEqual(["job_queued", "job_running", "job_blocked"]);
      expect(Object.keys(state.outbox)).toEqual(["outbox_delivered", "outbox_sending", "outbox_pending"]);
      expect(state.jobs.job_queued?.deliveryIds).toEqual(["outbox_delivered"]);
      expect(state.jobs.job_running?.deliveryIds).toEqual(["outbox_sending"]);
      expect(state.jobs.job_blocked?.deliveryIds).toEqual(["outbox_pending"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("keeps an active capacity notice until its queue has recovered", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const store = new JsonStateStore(statePath, {
        jobRetentionCount: 1,
        outboxRetentionCount: 0,
      });
      const activeJob = durableJob("job_active", "queued", timestamp(1), []);
      const capacityNotice = durableJob(
        "job_capacity_notice",
        "cancelled",
        timestamp(2),
        ["outbox_capacity_notice"],
      );
      capacityNotice.capacityNoticeActive = true;
      capacityNotice.capacityNoticeKind = "durable";
      capacityNotice.capacityNoticeScope = "global";
      const state = durableState(
        [activeJob, capacityNotice],
        [
          durableOutbox(
            "outbox_capacity_notice",
            capacityNotice.id,
            "delivered",
            timestamp(2),
          ),
        ],
      );

      await store.save(state);

      expect(Object.keys(state.jobs).sort()).toEqual(
        [activeJob.id, capacityNotice.id].sort(),
      );
      expect(state.outbox).toEqual({});

      capacityNotice.capacityNoticeActive = false;
      await store.save(state);
      expect(Object.keys(state.jobs)).toEqual([activeJob.id]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("normalizes durable references and applies retention again when loading after restart", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-state-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const writer = new JsonStateStore(statePath);
      const state = durableState(
        [
          durableJob("job_old", "completed", timestamp(1), ["missing", "outbox_new"]),
          durableJob("job_new", "completed", timestamp(2), []),
        ],
        [
          durableOutbox("outbox_old", "job_old", "delivered", timestamp(1)),
          durableOutbox("outbox_new", "job_new", "delivered", timestamp(2)),
        ],
      );
      await writer.save(state);
      expect(Object.keys((await writer.load()).jobs)).toEqual(["job_old", "job_new"]);

      const restartedStore = new JsonStateStore(statePath, {
        jobRetentionCount: 1,
        outboxRetentionCount: 10,
      });
      const loaded = await restartedStore.load();

      expect(Object.keys(loaded.jobs)).toEqual(["job_new"]);
      expect(Object.keys(loaded.outbox)).toEqual(["outbox_new"]);
      expect(loaded.jobs.job_new?.deliveryIds).toEqual(["outbox_new"]);
      expect(Object.values(loaded.outbox).every((message) => loaded.jobs[message.jobId])).toBe(true);

      await restartedStore.save(loaded);
      const reloaded = await restartedStore.load();
      expect(reloaded.jobs).toEqual(loaded.jobs);
      expect(reloaded.outbox).toEqual(loaded.outbox);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  test("task recovery normalizes durable task references", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-task-references-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const state = emptyState();
      const first = registeredTask("tsk_first", "conversation", tempDir, "thread_first");
      const second = registeredTask("tsk_second", "conversation", tempDir);
      state.tasks[first.taskId] = first; state.tasks[second.taskId] = second;
      state.conversations.conversation = { taskIds: ["missing", first.taskId, first.taskId], lastTaskId: "missing" };
      const draftKey = "conversation:sender";
      state.imageDrafts![draftKey] = { chatId: "conversation", senderKey: "sender", createdAt: timestamp(1), updatedAt: timestamp(1), expiresAt: timestamp(59), images: [], totalBytes: 0 };
      state.clarifications![draftKey] = { chatId: "conversation", senderKey: "sender", question: "选择任务", draftKey, candidateTaskIds: [first.taskId, "missing", second.taskId], choices: [first.taskId, "missing", second.taskId], createdAt: timestamp(1), expiresAt: timestamp(59) };
      const job = durableJob("job_task", "completed", timestamp(2), ["outbox_task"]);
      job.chatId = "conversation"; job.taskId = first.taskId; state.jobs[job.id] = job;
      const delivery = durableOutbox("outbox_task", job.id, "delivered", timestamp(2));
      delivery.chatId = "conversation"; delivery.taskId = second.taskId; state.outbox[delivery.id] = delivery;

      const store = new JsonStateStore(statePath); await store.save(state); const loaded = await store.load();
      expect(loaded.conversations.conversation?.taskIds).toEqual([first.taskId, second.taskId]);
      expect(loaded.conversations.conversation?.lastTaskId).toBe(second.taskId);
      expect(loaded.clarifications?.[draftKey]).toMatchObject({ draftKey, candidateTaskIds: [first.taskId, second.taskId], choices: [first.taskId, second.taskId] });
      expect(loaded.outbox.outbox_task?.taskId).toBe(first.taskId);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("task recovery rejects duplicate task thread ownership", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-task-thread-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const state = emptyState();
      state.tasks.tsk_first = registeredTask("tsk_first", "conversation", tempDir, "thread_shared");
      state.tasks.tsk_second = registeredTask("tsk_second", "conversation", tempDir, "thread_shared");
      state.conversations.conversation = { taskIds: ["tsk_first", "tsk_second"] };
      await expect(new JsonStateStore(statePath).save(state)).rejects.toThrow("Codex thread is bound to multiple tasks");
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("task recovery retention keeps jobs backing active task obligations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-task-retention-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const state = emptyState(); const task = registeredTask("tsk_waiting", "conversation", tempDir); task.status = "waiting_approval";
      state.tasks[task.taskId] = task; state.conversations.conversation = { taskIds: [task.taskId], lastTaskId: task.taskId };
      const job = durableJob("job_waiting", "completed", timestamp(1), []); job.chatId = "conversation"; job.taskId = task.taskId; state.jobs[job.id] = job;
      const store = new JsonStateStore(statePath, { jobRetentionCount: 0, outboxRetentionCount: 0 }); await store.save(state);
      expect((await store.load()).jobs.job_waiting?.taskId).toBe(task.taskId);
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("media retention prunes only complete terminal groups and cleans unreferenced staging directories", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-media-retention-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const state = emptyState();
      const taskId = "tsk_dddddddddddddddddddddddd";
      const task = registeredTask(taskId, "conversation", tempDir); task.status = "completed";
      state.tasks[taskId] = task; state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
      for (const [index, jobId] of ["old-job", "new-job"].entries()) {
        const dir = path.join(tempDir, "outbound", taskId, jobId); await mkdir(dir, { recursive: true });
        const file = path.join(dir, "01-output.bin"); await writeFile(file, jobId);
        const job = durableJob(jobId, "completed", timestamp(index + 1), [jobId + "-text", jobId + "-file"]); job.chatId = "conversation"; job.taskId = taskId; state.jobs[jobId] = job;
        const text = durableOutbox(jobId + "-text", jobId, "delivered", timestamp(index + 1)); text.chatId = "conversation"; text.taskId = taskId; text.sequence = 0; state.outbox[text.id] = text;
        state.outbox[jobId + "-file"] = { id: jobId + "-file", jobId, taskId, chatId: "conversation", kind: "file", text: "", sequence: 1, stagedPath: file, fileName: "output.bin", mediaType: "application/octet-stream", size: jobId.length, sha256: new Bun.CryptoHasher("sha256").update(jobId).digest("hex"), status: "delivered", idempotencyKey: jobId + "-file", attempts: 1, createdAt: timestamp(index + 1), updatedAt: timestamp(index + 1), deliveredAt: timestamp(index + 1) };
      }
      await new JsonStateStore(statePath, { chat2codexHome: tempDir, jobRetentionCount: 1, outboxRetentionCount: 2 }).save(state);
      expect(Object.keys(state.jobs)).toEqual(["new-job"]);
      expect(Object.values(state.outbox).map((item) => item.jobId)).toEqual(["new-job", "new-job"]);
      expect(await stat(path.join(tempDir, "outbound", taskId, "old-job")).catch(() => null)).toBeNull();
      expect(await stat(path.join(tempDir, "outbound", taskId, "new-job"))).toBeTruthy();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("media retention preserves recent complete groups until the configured age expires", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-media-age-retention-"));
    try {
      const state = emptyState();
      const taskId = "tsk_ffffffffffffffffffffffff";
      const task = registeredTask(taskId, "conversation", tempDir);
      state.tasks[taskId] = task;
      state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
      const now = Date.now();
      for (const [jobId, ageHours] of [["recent-media", 2], ["expired-media", 48]] as const) {
        const at = new Date(now - ageHours * 60 * 60 * 1_000).toISOString();
        const dir = path.join(tempDir, "outbound", taskId, jobId);
        const file = path.join(dir, "01-output.bin");
        const bytes = Buffer.from(jobId);
        await mkdir(dir, { recursive: true });
        await writeFile(file, bytes);
        const job = durableJob(jobId, "completed", at, [jobId + "-file"]);
        job.chatId = "conversation"; job.taskId = taskId; state.jobs[jobId] = job;
        state.outbox[jobId + "-file"] = {
          id: jobId + "-file", jobId, taskId, chatId: "conversation", kind: "file", text: "", sequence: 0,
          stagedPath: file, fileName: "output.bin", mediaType: "application/octet-stream", size: bytes.length,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), status: "delivered",
          idempotencyKey: jobId + "-file", attempts: 1, createdAt: at, updatedAt: at, deliveredAt: at,
        };
      }
      const store = new JsonStateStore(path.join(tempDir, "state.json"), {
        chat2codexHome: tempDir, jobRetentionCount: 0, outboxRetentionCount: 0, outboundMediaRetentionHours: 24,
      });
      await store.save(state);
      expect(state.jobs["recent-media"]).toBeDefined();
      expect(state.outbox["recent-media-file"]).toBeDefined();
      expect(state.jobs["expired-media"]).toBeUndefined();
      expect(state.outbox["expired-media-file"]).toBeUndefined();
      expect(await stat(path.join(tempDir, "outbound", taskId, "recent-media"))).toBeTruthy();
      expect(await stat(path.join(tempDir, "outbound", taskId, "expired-media")).catch(() => null)).toBeNull();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("media retention keeps a delivered prefix while a later sibling is pending", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-media-prefix-"));
    try {
      const state = durableState(
        [durableJob("partial-job", "completed", timestamp(1), ["prefix", "remaining"])],
        [durableOutbox("prefix", "partial-job", "delivered", timestamp(1)), durableOutbox("remaining", "partial-job", "pending", timestamp(1))],
      );
      state.outbox.prefix!.sequence = 0; state.outbox.remaining!.sequence = 1;
      await new JsonStateStore(path.join(tempDir, "state.json"), { chat2codexHome: tempDir, jobRetentionCount: 0, outboxRetentionCount: 0 }).save(state);
      expect(Object.keys(state.outbox)).toEqual(["prefix", "remaining"]);
      expect(state.jobs["partial-job"]).toBeDefined();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("media retention protects complete delivery groups backing active task obligations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-media-active-task-"));
    try {
      const state = emptyState();
      const taskId = "tsk_eeeeeeeeeeeeeeeeeeeeeeee";
      const task = registeredTask(taskId, "conversation", tempDir); task.status = "waiting_approval";
      state.tasks[taskId] = task; state.conversations.conversation = { taskIds: [taskId], lastTaskId: taskId };
      const job = durableJob("active-task-job", "completed", timestamp(1), ["active-task-text"]); job.taskId = taskId; job.chatId = "conversation"; state.jobs[job.id] = job;
      const message = durableOutbox("active-task-text", job.id, "delivered", timestamp(1)); message.taskId = taskId; message.chatId = "conversation"; state.outbox[message.id] = message;
      await new JsonStateStore(path.join(tempDir, "state.json"), { chat2codexHome: tempDir, jobRetentionCount: 0, outboxRetentionCount: 0 }).save(state);
      expect(state.jobs[job.id]).toBeDefined();
      expect(state.outbox[message.id]).toBeDefined();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  });

  test("UsageAdvisor state survives save and reload in schema v6", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-usage-advisor-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      const advisor = new UsageAdvisor(emptyUsageAdvisorState());
      for (const at of [timestamp(1), timestamp(2), timestamp(3)]) {
        advisor.record({ code: "delivery_retry", at });
      }
      advisor.review("usage-delivery-retry", "approve_for_planning", timestamp(4));
      const state = emptyState();
      state.usageAdvisor = advisor.state;

      const store = new JsonStateStore(statePath);
      await store.save(state);
      const loaded = await store.load();
      const persisted = JSON.parse(await readFile(statePath, "utf8"));

      expect(persisted.schemaVersion).toBe(6);
      expect(loaded.usageAdvisor).toEqual(advisor.state);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("UsageAdvisor loads legacy state with an empty advisor partition", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-usage-advisor-legacy-"));
    const statePath = path.join(tempDir, "state.json");
    try {
      await writeFile(statePath, JSON.stringify({
        schemaVersion: 5,
        adapters: { "feishu:default": emptyState() },
      }));
      const raw = JSON.parse(await readFile(statePath, "utf8"));
      delete raw.adapters["feishu:default"].usageAdvisor;
      await writeFile(statePath, JSON.stringify(raw));

      expect((await new JsonStateStore(statePath).load()).usageAdvisor).toEqual(emptyUsageAdvisorState());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("UsageAdvisor drops malformed disk entries and rebuilds proposal text from code templates", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-usage-advisor-coerce-"));
    const statePath = path.join(tempDir, "state.json");
    const secret = "sk-secret C:\\private\\prompt sender@example.test task-identity";
    try {
      const state = emptyState() as BridgeState & { usageAdvisor: unknown };
      state.usageAdvisor = {
        aggregates: {
          delivery_retry: {
            code: "delivery_retry",
            count: 9,
            firstSeenAt: timestamp(9),
            lastSeenAt: timestamp(1),
            recentAt: [secret, timestamp(9), timestamp(1), timestamp(8), timestamp(2), timestamp(7), timestamp(3), timestamp(6), timestamp(4), timestamp(5)],
            prompt: secret,
          },
          unknown_signal: { code: "unknown_signal", count: 999, firstSeenAt: timestamp(1), lastSeenAt: timestamp(2), recentAt: [timestamp(1)] },
          routing_correction: { code: "delivery_retry", count: -4, firstSeenAt: "bad", lastSeenAt: "bad", recentAt: [] },
          ownership_conflict: { code: "ownership_conflict", count: 1, firstSeenAt: timestamp(1), lastSeenAt: timestamp(1), recentAt: [timestamp(1)] },
        },
        proposals: {
          "usage-delivery-retry": {
            id: "usage-delivery-retry",
            signalCode: "delivery_retry",
            status: "approved_for_planning",
            createdAt: timestamp(3),
            reviewedAt: timestamp(4),
            evidence: { count: 999, prompt: secret },
            sections: { observation: secret, benefit: secret, risks: secret, scope: secret, rollback: secret, verification: secret },
            apply: true,
          },
          malicious: { id: "malicious", signalCode: "delivery_retry", status: "applied", createdAt: timestamp(3), sections: { observation: secret } },
          "usage-ownership-conflict": {
            id: "usage-ownership-conflict",
            signalCode: "ownership_conflict",
            status: "pending_review",
            createdAt: timestamp(1),
            sections: { observation: secret },
          },
        },
      };
      await writeFile(statePath, JSON.stringify({ schemaVersion: 5, adapters: { "feishu:default": state } }));

      const loaded = await new JsonStateStore(statePath).load();
      const aggregate = loaded.usageAdvisor?.aggregates.delivery_retry;
      const proposal = loaded.usageAdvisor?.proposals["usage-delivery-retry"];

      expect(Object.keys(loaded.usageAdvisor?.aggregates ?? {})).toEqual(["delivery_retry", "ownership_conflict"]);
      expect(aggregate).toMatchObject({ count: 9, firstSeenAt: timestamp(1), lastSeenAt: timestamp(9) });
      expect(aggregate?.recentAt).toHaveLength(USAGE_ADVISOR_LIMITS.recentTimestamps);
      expect(aggregate?.recentAt).toEqual([...aggregate!.recentAt].sort());
      expect(Object.keys(loaded.usageAdvisor?.proposals ?? {})).toEqual(["usage-delivery-retry"]);
      expect(proposal).toMatchObject({ status: "approved_for_planning", reviewedAt: timestamp(4) });
      expect(proposal?.sections.observation).toBe("Durable outbound delivery repeatedly required retry.");
      expect(JSON.stringify(loaded.usageAdvisor)).not.toContain(secret);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("UsageAdvisor reapplies closed caps and redaction before save", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-usage-advisor-save-"));
    const statePath = path.join(tempDir, "state.json");
    const secret = "Bearer secret prompt C:\\private sender@example.test";
    try {
      const state = emptyState() as BridgeState & { usageAdvisor: unknown };
      state.usageAdvisor = {
        aggregates: Object.fromEntries([
          ...USAGE_ADVISOR_SIGNAL_CODES.map((code, index) => [code, {
            code,
            count: 3,
            firstSeenAt: timestamp(index + 1),
            lastSeenAt: timestamp(index + 3),
            recentAt: Array.from({ length: 20 }, (_, offset) => timestamp(index + offset + 1)),
            sender: secret,
          }]),
          ["unknown_signal", { code: "unknown_signal", count: 3, firstSeenAt: timestamp(1), lastSeenAt: timestamp(3), recentAt: [timestamp(1)] }],
        ]),
        proposals: Object.fromEntries(USAGE_ADVISOR_SIGNAL_CODES.map((code) => ["arbitrary-" + code, {
          id: "arbitrary-" + code,
          signalCode: code,
          status: "pending_review",
          createdAt: timestamp(3),
          sections: { observation: secret },
        }])),
      };

      const store = new JsonStateStore(statePath);
      await store.save(state);
      const persistedText = await readFile(statePath, "utf8");
      const loaded = await store.load();

      expect(Object.keys(loaded.usageAdvisor?.aggregates ?? {})).toHaveLength(USAGE_ADVISOR_LIMITS.aggregates);
      expect(Object.keys(loaded.usageAdvisor?.proposals ?? {})).toHaveLength(0);
      expect(Object.values(loaded.usageAdvisor?.aggregates ?? {}).every((item) =>
        item!.recentAt.length <= USAGE_ADVISOR_LIMITS.recentTimestamps
      )).toBe(true);
      expect(persistedText).not.toContain(secret);
      expect(persistedText).not.toContain("unknown_signal");
      expect(persistedText).not.toContain("arbitrary-");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function durableState(
  jobs: DurableCodexJob[],
  outbox: DurableOutboxMessage[],
): BridgeState {
  return {
    chats: {},
    jobs: Object.fromEntries(jobs.map((job) => [job.id, job])),
    outbox: Object.fromEntries(outbox.map((message) => [message.id, message])),
    pendingMessages: {},
    processedMessageIds: [],
    diagnostics: {},
  };
}

function desktopBinding(overrides: { bindingId: string; taskId: string; conversationId?: string }) {
  return {
    bindingId: overrides.bindingId, rootThreadId: "root-thread", taskId: overrides.taskId,
    conversationId: overrides.conversationId ?? "conversation", adapterId: "weixin:bot",
    owner: "bridge" as const, generation: 1, bindingAnchorTurnId: "anchor-turn",
    lastReconciledTurnId: "anchor-turn", excludedControlTurns: {}, pendingWakeIds: [],
    processedMutationIds: { bind: "a".repeat(64) }, createdAt: timestamp(1), updatedAt: timestamp(1),
  };
}

function durableJob(
  id: string,
  status: DurableCodexJobStatus,
  at: string,
  deliveryIds: string[],
): DurableCodexJob {
  return {
    id,
    kind: "codex_run",
    messageId: `message_${id}`,
    chatId: "chat_1",
    chatType: "direct",
    cwd: "/repo",
    prompt: `prompt ${id}`,
    status,
    createdAt: at,
    updatedAt: at,
    completedAt: status === "queued" || status === "running" ? undefined : at,
    deliveryIds,
  };
}

function durableOutbox(
  id: string,
  jobId: string,
  status: DurableOutboxStatus,
  at: string,
): DurableOutboxMessage {
  return {
    id,
    jobId,
    chatId: "chat_1",
    kind: "text",
    text: `delivery ${id}`,
    sequence: 0,
    status,
    idempotencyKey: id,
    attempts: 0,
    createdAt: at,
    updatedAt: at,
    deliveredAt: status === "delivered" ? at : undefined,
  };
}

function timestamp(minute: number): string {
  return `2026-06-29T00:${String(minute).padStart(2, "0")}:00.000Z`;
}

function registeredTask(taskId: string, conversationId: string, workspaceRoot: string, threadId?: string): RegisteredTask {
  return { taskId, conversationId, chatType: "direct", senderKey: "sender", title: taskId, aliases: [], workspaceKind: "work", workspaceRoot, executionCwd: workspaceRoot, isolationMode: "canonical_fifo", sessionEpoch: `epoch_${taskId}`, threadId, status: "completed", objectiveSummary: "", recentRequests: [], createdAt: timestamp(0), updatedAt: timestamp(0), lastActiveAt: timestamp(0) };
}
