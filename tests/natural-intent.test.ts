import { describe, expect, test } from "bun:test";
import { resolveNaturalIntent, type NaturalIntentClassifier } from "../src/core/natural-intent.js";

const context = {
  hasThread: true, activeRun: false, pendingApprovalCount: 0,
  pendingPermissionCount: 0, hasImageDraft: false,
};

describe("natural intent", () => {
  test("accepts a schema-valid high-confidence decision", async () => {
    const classifier: NaturalIntentClassifier = {
      classify: async () => ({ intent: "new_task", confidence: 0.94 }),
    };
    expect(await resolveNaturalIntent({ text: "换个话题查微软", context }, classifier, 0.78))
      .toEqual({ intent: "new_task", confidence: 0.94 });
  });

  test("fails closed for low confidence, invalid output, and action/context conflicts", async () => {
    for (const output of [
      { intent: "continue_task", confidence: 0.3 },
      { intent: "unknown", confidence: 0.99 },
      { intent: "approve", confidence: 0.99 },
    ]) {
      const classifier: NaturalIntentClassifier = { classify: async () => output };
      const result = await resolveNaturalIntent({ text: "可以", context }, classifier, 0.78);
      expect(result.intent).toBe("clarify");
      expect(result.question).toBeTruthy();
    }
  });

  test("returns clarification when the classifier throws", async () => {
    const classifier: NaturalIntentClassifier = { classify: async () => { throw new Error("offline"); } };
    expect((await resolveNaturalIntent({ text: "继续吧", context }, classifier, 0.78)).intent)
      .toBe("clarify");
  });

  test("requires a question for explicit clarify output", async () => {
    const classifier: NaturalIntentClassifier = {
      classify: async () => ({ intent: "clarify", confidence: 0.9 }),
    };
    const result = await resolveNaturalIntent({ text: "那个呢", context }, classifier, 0.78);
    expect(result.intent).toBe("clarify");
    expect(result.question).toContain("继续");
  });

  test("keeps stop intent so the router can report that nothing is active", async () => {
    const classifier: NaturalIntentClassifier = { classify: async () => ({ intent: "stop", confidence: 0.99 }) };
    expect((await resolveNaturalIntent({ text: "停一下", context: { ...context, activeRun: false } }, classifier, 0.78)).intent).toBe("stop");
  });
});
