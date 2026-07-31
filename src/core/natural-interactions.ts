import type { CodexApprovalDecision } from "../agent/codex-runner.js";

export type NaturalApprovalChoice = { kind: "resolve"; decisionIndex: number } | { kind: "clarify" };

export function chooseNaturalApprovalDecision(intent: "approve" | "deny", decisions: CodexApprovalDecision[]): NaturalApprovalChoice {
  if (intent === "approve") {
    const index = decisions.findIndex((decision) => decision === "accept");
    return index >= 0 ? { kind: "resolve", decisionIndex: index } : { kind: "clarify" };
  }
  const index = decisions.findIndex((decision) => decision === "decline" || decision === "cancel");
  return index >= 0 ? { kind: "resolve", decisionIndex: index } : { kind: "clarify" };
}
