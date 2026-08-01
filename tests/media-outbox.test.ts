import path from "node:path";

import { describe, expect, test } from "bun:test";

import { MediaOutbox } from "../src/core/media-outbox.js";
import type { StagedDeliverable } from "../src/core/deliverable-stager.js";
import type { BridgeState, DurableCodexJob, RegisteredTask } from "../src/state/types.js";
import { emptyState } from "../src/state/types.js";

const taskId = "tsk_aaaaaaaaaaaaaaaaaaaaaaaa";

describe("MediaOutbox", () => {
  test("appends visible text before staged media with stable task-qualified identities", () => {
    const { state, job } = fixture();
    const files = [
      staged("answer.png", "image", "image/png", "a", 1),
      staged("report.pdf", "file", "application/octet-stream", "b", 2),
    ];
    const appended = new MediaOutbox().appendResult(state, job, {
      text: "完成。", textKind: "markdown", stagedFiles: files, createdAt: "2026-08-02T00:00:00.000Z",
    });
    expect(appended.map(({ kind, sequence }) => ({ kind, sequence }))).toEqual([
      { kind: "markdown", sequence: 0 }, { kind: "image", sequence: 1 }, { kind: "file", sequence: 2 },
    ]);
    expect(appended.map((item) => item.taskId)).toEqual([taskId, taskId, taskId]);
    expect(appended[1]).toMatchObject({ stagedPath: files[0]!.stagedPath, fileName: "answer.png", mediaType: "image/png", size: 1, sha256: "a".repeat(64), text: "" });
    expect(new Set(appended.map((item) => item.id)).size).toBe(3);
    expect(appended.map((item) => item.idempotencyKey)).toEqual(appended.map((item) => item.id));
    expect(job.deliveryIds).toEqual(appended.map((item) => item.id));
    const repeatedFixture = fixture();
    const repeated = new MediaOutbox().appendResult(repeatedFixture.state, repeatedFixture.job, {
      text: "完成。", textKind: "markdown", stagedFiles: files, createdAt: "2026-08-02T00:00:00.000Z",
    });
    expect(repeated.map((item) => item.id)).toEqual(appended.map((item) => item.id));
  });

  test("validates the whole result before mutating durable state", () => {
    const { state, job } = fixture();
    expect(() => new MediaOutbox().appendResult(state, job, {
      text: "answer", stagedFiles: [staged("bad.png", "image", "image/png", "not-a-hash", 1)], createdAt: "2026-08-02T00:00:00.000Z",
    })).toThrow(/hash/i);
    expect(state.outbox).toEqual({});
    expect(job.deliveryIds).toEqual([]);
  });

  test("recovery preserves delivered prefixes and resumes the lowest undelivered sequence", () => {
    const { state, job } = fixture();
    const outbox = new MediaOutbox();
    const items = outbox.appendResult(state, job, {
      text: "answer", stagedFiles: [staged("a.png", "image", "image/png", "a", 1), staged("b.bin", "file", "application/octet-stream", "b", 2)], createdAt: "2026-08-02T00:00:00.000Z",
    });
    items[0]!.status = "delivered"; items[0]!.deliveredAt = "2026-08-02T00:01:00.000Z";
    items[1]!.status = "sending"; items[1]!.attempts = 2;
    expect(outbox.recover(state).map((item) => item.id)).toEqual([items[1]!.id]);
    expect(items.map((item) => item.status)).toEqual(["delivered", "pending", "pending"]);
    expect(items[1]!.attempts).toBe(2);
    expect(outbox.nextUndelivered(state, job.id)?.id).toBe(items[1]!.id);
    expect(outbox.recover(state).map((item) => item.id)).toEqual([items[1]!.id]);
  });
});

function fixture(): { state: BridgeState; job: DurableCodexJob } {
  const state = emptyState();
  const task: RegisteredTask = {
    taskId, conversationId: "conversation", chatType: "direct", senderKey: "sender", title: "task", aliases: [], workspaceKind: "work",
    workspaceRoot: "C:\workspace", executionCwd: "C:\workspace", isolationMode: "canonical_fifo", sessionEpoch: "epoch", status: "running",
    objectiveSummary: "", recentRequests: [], createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", lastActiveAt: "2026-08-02T00:00:00.000Z",
  };
  const job: DurableCodexJob = {
    id: "job-result", kind: "codex_run", messageId: "message", chatId: task.conversationId, chatType: "direct", cwd: task.workspaceRoot,
    prompt: "prompt", taskId, status: "completed", createdAt: task.createdAt, updatedAt: task.updatedAt, completedAt: task.updatedAt, deliveryIds: [],
  };
  state.tasks[taskId] = task; state.conversations[task.conversationId] = { taskIds: [taskId], lastTaskId: taskId }; state.jobs[job.id] = job;
  return { state, job };
}

function staged(fileName: string, kind: StagedDeliverable["kind"], mediaType: string, hash: string, index: number): StagedDeliverable {
  return { sourcePath: path.resolve("source", fileName), stagedPath: path.resolve("outbound", taskId, "job-result", String(index).padStart(2, "0") + "-" + fileName), fileName, kind, mediaType, size: 1, sha256: hash.length === 1 ? hash.repeat(64) : hash };
}
