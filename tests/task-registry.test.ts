import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../src/core/task-registry.js";
import { emptyState } from "../src/state/types.js";

describe("TaskRegistry", () => {
  test("creates, lists, updates, and archives one conversation task", () => {
    const state = emptyState();
    const registry = new TaskRegistry({ now: () => Date.parse("2026-08-01T00:00:00Z") });
    const task = registry.create(state, {
      conversationId: "wx_chat", chatType: "direct", senderKey: "ilink:user-1",
      title: "日本酒店\n", aliases: [" 酒店任务 "], workspaceKind: "travel",
      workspaceRoot: "F:\\workspace\\workbuddy\\Travel", objective: "比较东京酒店",
    });
    expect(task.taskId).toMatch(/^tsk_[a-f0-9]{24}$/u);
    expect(task.title).toBe("日本酒店");
    expect(task.aliases).toEqual(["酒店任务"]);
    expect(registry.listConversation(state, "wx_chat")).toEqual([task]);
    expect(registry.transition(state, task.taskId, "queued").status).toBe("queued");
    expect(registry.transition(state, task.taskId, "running").status).toBe("running");
    expect(() => registry.transition(state, task.taskId, "draft")).toThrow(/transition/i);
    registry.appendRequest(state, task.taskId, "x".repeat(400));
    expect(task.recentRequests[0]).toHaveLength(300);
    registry.transition(state, task.taskId, "completed");
    registry.archive(state, task.taskId);
    expect(task.status).toBe("archived");
  });

  test("bounds aliases and recent request history", () => {
    const state = emptyState();
    const registry = new TaskRegistry();
    const task = registry.create(state, { conversationId: "c", chatType: "direct", senderKey: "u", title: "task", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\work", objective: "o" });
    for (let index = 0; index < 20; index += 1) { registry.addAlias(state, task.taskId, `alias-${index}`); registry.appendRequest(state, task.taskId, `request-${index}`); }
    expect(task.aliases).toHaveLength(12);
    expect(task.recentRequests).toEqual(Array.from({ length: 8 }, (_, index) => `request-${index + 12}`));
  });

  test("enforces unique thread ownership and conversation/sender isolation", () => {
    const state = emptyState();
    const registry = new TaskRegistry();
    const first = registry.create(state, { conversationId: "c1", chatType: "direct", senderKey: "u1", title: "one", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\work", objective: "one" });
    const second = registry.create(state, { conversationId: "c1", chatType: "direct", senderKey: "u2", title: "two", aliases: [], workspaceKind: "work", workspaceRoot: "C:\\work", objective: "two" });
    registry.bindThread(state, first.taskId, "thread_shared");
    expect(() => registry.bindThread(state, second.taskId, "thread_shared")).toThrow(/thread/i);
    expect(registry.listConversation(state, "c1", "u1")).toEqual([first]);
    expect(registry.listConversation(state, "c1", "u2")).toEqual([second]);
    expect(registry.listConversation(state, "other")).toEqual([]);
  });
});
