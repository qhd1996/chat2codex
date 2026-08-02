import { describe, expect, test } from "bun:test";
import { resolveNaturalTaskDecision, type NaturalTaskClassifier, type NaturalTaskRoutingInput } from "../src/core/natural-task-router.js";
const input: NaturalTaskRoutingInput = { text: "停止酒店任务", conversationId: "wx", candidates: [{ taskId: "tsk_hotel", title: "酒店", aliases: [], workspaceKind: "travel", status: "running", objectiveSummary: "", recentRequests: [] }], workspaces: [], pendingImageCount: 0, pendingInteractions: [] };
const classifier = (decision: unknown): NaturalTaskClassifier => ({ classifyTask: async () => decision });
describe("natural task routing", () => {
  test("accepts a strict high-confidence candidate action", async () => { expect(await resolveNaturalTaskDecision(input, classifier({ action: { kind: "stop_task", taskId: "tsk_hotel" }, imageDisposition: "none", confidence: 0.95 }), 0.78)).toMatchObject({ action: { kind: "stop_task", taskId: "tsk_hotel" } }); });
  test("fails closed for low confidence, unknown fields, missing targets, and quoted-only approval", async () => { for (const decision of [{ action: { kind: "stop_task", taskId: "tsk_hotel" }, imageDisposition: "none", confidence: 0.2 },{ action: { kind: "stop_task", taskId: "missing" }, imageDisposition: "none", confidence: 1 },{ action: { kind: "approve", taskId: "tsk_hotel" }, imageDisposition: "none", confidence: 1 },{ action: { kind: "stop_task", taskId: "tsk_hotel", extra: true }, imageDisposition: "none", confidence: 1 },{ action: { kind: "unknown" }, imageDisposition: "none", confidence: 1 },{ action: { kind: "stop_task", taskId: "tsk_hotel" }, imageDisposition: "none", confidence: 1, extra: true }]) expect((await resolveNaturalTaskDecision(input, classifier(decision), 0.78)).action.kind).toBe("clarify"); });
  test("requires explicit image disposition and explicit session grant context", async () => { const withImage = { ...input, pendingImageCount: 2 }; expect((await resolveNaturalTaskDecision(withImage, classifier({ action: { kind: "continue_task", taskId: "tsk_hotel", instruction: "分析" }, imageDisposition: "none", confidence: 1 }), 0.78)).action.kind).toBe("clarify"); const permission = { ...input, pendingInteractions: [{ taskId: "tsk_hotel", requestId: "p", kind: "permission" as const, decisions: ["grantTurn", "deny"] }] }; expect((await resolveNaturalTaskDecision(permission, classifier({ action: { kind: "grant_session", taskId: "tsk_hotel", requestId: "p" }, imageDisposition: "none", confidence: 1 }), 0.78)).action.kind).toBe("clarify"); });
  test("accepts only meaningful dispositions for a pending image draft", async () => {
    const withImage = { ...input, pendingImageCount: 2 };
    expect(await resolveNaturalTaskDecision(withImage, classifier({ action: { kind: "continue_task", taskId: "tsk_hotel", instruction: "分析图片" }, imageDisposition: "attach", confidence: 1 }), 0.78)).toMatchObject({ action: { kind: "continue_task" }, imageDisposition: "attach" });
    expect(await resolveNaturalTaskDecision(withImage, classifier({ action: { kind: "create_task", instruction: "做另一个任务", workspaceKind: "finance" }, imageDisposition: "discard", confidence: 1 }), 0.78)).toMatchObject({ action: { kind: "create_task" }, imageDisposition: "discard" });
    expect(await resolveNaturalTaskDecision(withImage, classifier({ action: { kind: "clarify", question: "这些图片属于哪个任务？", candidateTaskIds: ["tsk_hotel"] }, imageDisposition: "clarify", confidence: 1 }), 0.78)).toMatchObject({ action: { kind: "clarify" }, imageDisposition: "clarify" });
  });
  test("rejects phantom or non-submitting image dispositions", async () => {
    const withImage = { ...input, pendingImageCount: 1 };
    for (const [routingInput, decision] of [
      [input, { action: { kind: "continue_task", taskId: "tsk_hotel", instruction: "分析" }, imageDisposition: "attach", confidence: 1 }],
      [withImage, { action: { kind: "show_status" }, imageDisposition: "attach", confidence: 1 }],
      [withImage, { action: { kind: "continue_task", taskId: "tsk_hotel", instruction: "分析" }, imageDisposition: "clarify", confidence: 1 }],
    ] as const) expect((await resolveNaturalTaskDecision(routingInput, classifier(decision), 0.78)).action.kind).toBe("clarify");
  });
  test("rejects wrong field types and bounds classifier metadata", async () => {
    expect((await resolveNaturalTaskDecision(input, classifier({ action: { kind: "show_status", taskId: 3 }, imageDisposition: "none", confidence: 1 }), 0.78)).action.kind).toBe("clarify");
    let received: NaturalTaskRoutingInput | undefined; const capture: NaturalTaskClassifier = { classifyTask: async (value) => { received = value; return { action: { kind: "show_status" }, imageDisposition: "none", confidence: 1 }; } };
    await resolveNaturalTaskDecision({ ...input, text: "x".repeat(10000), candidates: Array.from({ length: 20 }, (_, index) => ({ ...input.candidates[0]!, taskId: "tsk_" + index, title: "t".repeat(500), aliases: ["a".repeat(500)], objectiveSummary: "o".repeat(2000), recentRequests: ["r".repeat(1000)] })) }, capture, 0.78);
    expect(received).toBeDefined(); expect(JSON.stringify(received).length).toBeLessThanOrEqual(16 * 1024); expect(received!.candidates.length).toBeLessThanOrEqual(12);
  });
  test("preserves valid execution intent on task creation", async () => {
    for (const executionIntent of ["general", "output_only"] as const) {
      const decision = await resolveNaturalTaskDecision(
        input,
        classifier({
          action: {
            kind: "create_task",
            instruction: "生成一份新报告",
            workspaceKind: "work",
            executionIntent,
          },
          imageDisposition: "none",
          confidence: 1,
        }),
        0.78,
      );

      expect(decision.action).toMatchObject({ kind: "create_task", executionIntent });
    }
  });
  test("fails closed for invalid or misplaced execution intent", async () => {
    const decisions = [
      { action: { kind: "create_task", instruction: "生成报告", executionIntent: "read_only" }, imageDisposition: "none", confidence: 1 },
      { action: { kind: "continue_task", taskId: "tsk_hotel", instruction: "继续", executionIntent: "output_only" }, imageDisposition: "none", confidence: 1 },
    ];

    for (const decision of decisions) {
      expect((await resolveNaturalTaskDecision(input, classifier(decision), 0.78)).action.kind).toBe("clarify");
    }
  });
  test("accepts only bounded review-only UsageAdvisor actions", async () => {
    expect(await resolveNaturalTaskDecision(input, classifier({
      action: { kind: "list_advisor_proposals" }, imageDisposition: "none", confidence: 1,
    }), 0.78)).toMatchObject({ action: { kind: "list_advisor_proposals" } });
    expect(await resolveNaturalTaskDecision(input, classifier({
      action: { kind: "review_advisor_proposal", proposalId: "usage-delivery-retry", decision: "approve_for_planning" },
      imageDisposition: "none", confidence: 1,
    }), 0.78)).toMatchObject({ action: { kind: "review_advisor_proposal", decision: "approve_for_planning" } });
    for (const action of [
      { kind: "review_advisor_proposal", proposalId: "usage-delivery-retry", decision: "apply" },
      { kind: "review_advisor_proposal", proposalId: "", decision: "reject" },
      { kind: "review_advisor_proposal", decision: "reject" },
      { kind: "list_advisor_proposals", proposalId: "unexpected" },
    ]) {
      expect((await resolveNaturalTaskDecision(input, classifier({ action, imageDisposition: "none", confidence: 1 }), 0.78)).action.kind).toBe("clarify");
    }
  });
});
