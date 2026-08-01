import { describe, expect, test } from "bun:test";
import { TaskTargetResolver } from "../src/core/task-target-resolver.js";
import type { RegisteredTask } from "../src/state/types.js";
const task = (taskId: string, title: string, senderKey = "u", at = "2026-08-01T00:00:00Z"): RegisteredTask => ({ taskId, conversationId: "c", chatType: "direct", senderKey, title, aliases: [], workspaceKind: "work", workspaceRoot: "C:\\work", executionCwd: "C:\\work", isolationMode: "canonical_fifo", sessionEpoch: taskId, status: "completed", objectiveSummary: "", recentRequests: [], createdAt: at, updatedAt: at, lastActiveAt: at });
describe("TaskTargetResolver", () => {
  test("resolves exact id, title, alias, and unique interaction", () => {
    const first = task("tsk_one", "日本酒店"); first.aliases = ["酒店任务"]; const second = task("tsk_two", "微软财报"); const resolver = new TaskTargetResolver();
    expect(resolver.resolve({ tasks: [first, second], explicitTaskId: "tsk_one", actionKind: "continue_task" })).toMatchObject({ status: "resolved", taskId: "tsk_one", reason: "id" });
    expect(resolver.resolve({ tasks: [first, second], reference: " 日本 酒店 " , actionKind: "continue_task" })).toMatchObject({ reason: "title" });
    expect(resolver.resolve({ tasks: [first, second], reference: "酒店任务", actionKind: "continue_task" })).toMatchObject({ reason: "alias" });
    expect(resolver.resolve({ tasks: [first, second], pendingInteractionTaskIds: ["tsk_two"], actionKind: "approve" })).toMatchObject({ taskId: "tsk_two", reason: "interaction" });
  });
  test("isolates conversation, sender, and archived tasks", () => {
    const allowed = task("tsk_allowed", "任务"); const wrongSender = task("tsk_wrong", "另一个", "other"); const archived = task("tsk_old", "旧任务"); archived.status = "archived";
    const resolver = new TaskTargetResolver(); const result = resolver.resolve({ tasks: [allowed, wrongSender, archived], conversationId: "c", senderKey: "u", reference: "旧任务", actionKind: "continue_task" });
    expect(result.status).toBe("missing");
  });
  test("accepts validated semantic choice and never uses recency for high-risk actions", () => {
    const old = task("tsk_old", "旧", "u", "2026-08-01T00:00:00Z"); const recent = task("tsk_recent", "新", "u", "2026-08-01T01:00:00Z"); const resolver = new TaskTargetResolver();
    expect(resolver.resolve({ tasks: [old, recent], semanticTaskId: "tsk_old", semanticConfidence: 0.9, minimumConfidence: 0.78, actionKind: "continue_task" })).toMatchObject({ taskId: "tsk_old", reason: "semantic" });
    expect(resolver.resolve({ tasks: [old, recent], allowRecency: true, actionKind: "inspect_task" })).toMatchObject({ taskId: "tsk_recent", reason: "recency" });
    expect(resolver.resolve({ tasks: [old, recent], allowRecency: true, actionKind: "stop_task" }).status).toBe("ambiguous");
  });
  test("returns bounded ambiguity and missing questions", () => {
    const a = task("tsk_a", "A"); const b = task("tsk_b", "A"); const resolver = new TaskTargetResolver();
    expect(resolver.resolve({ tasks: [a, b], reference: "A", actionKind: "continue_task" })).toMatchObject({ status: "ambiguous", taskIds: ["tsk_a", "tsk_b"] });
    expect(resolver.resolve({ tasks: [], actionKind: "continue_task" })).toMatchObject({ status: "missing" });
  });
});
