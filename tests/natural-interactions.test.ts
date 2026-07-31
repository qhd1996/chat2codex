import { describe, expect, test } from "bun:test";
import { chooseNaturalApprovalDecision } from "../src/core/natural-interactions.js";

describe("natural interactions", () => {
  test("selects one-time accept and rejection decisions only when offered", () => {
    expect(chooseNaturalApprovalDecision("approve", ["accept", "acceptForSession", "decline"]))
      .toEqual({ kind: "resolve", decisionIndex: 0 });
    expect(chooseNaturalApprovalDecision("deny", ["accept", "decline"]))
      .toEqual({ kind: "resolve", decisionIndex: 1 });
    expect(chooseNaturalApprovalDecision("approve", ["decline", "cancel"]))
      .toEqual({ kind: "clarify" });
  });

  test("never grants session or rule scope from generic consent", () => {
    expect(chooseNaturalApprovalDecision("approve", ["acceptForSession", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["bun", "test"] } }, "cancel"]))
      .toEqual({ kind: "clarify" });
  });
});
