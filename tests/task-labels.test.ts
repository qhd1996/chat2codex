import { describe, expect, test } from "bun:test";
import { formatTaskLabel, prefixTaskMessage } from "../src/core/task-labels.js";
describe("task labels", () => {
  test("sanitizes and bounds labels", () => { const label = formatTaskLabel({ taskId: "tsk_1234567890", title: "  日本\n酒店" + "长".repeat(30) }); expect(label.startsWith("[日本 酒店")).toBe(true); expect([...label.slice(1, -1)]).toHaveLength(20); });
  test("falls back to task id and prefixes messages", () => { expect(formatTaskLabel({ taskId: "tsk_abcdef123456", title: "\n\t" })).toBe("[tsk_abcd]"); expect(prefixTaskMessage({ taskId: "tsk_a", title: "测试" }, "已完成")).toBe("[测试] 已完成"); });
});
