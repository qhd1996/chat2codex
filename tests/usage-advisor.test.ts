import { describe, expect, test } from "bun:test";

import {
  USAGE_ADVISOR_LIMITS,
  USAGE_ADVISOR_SIGNAL_CODES,
  UsageAdvisor,
} from "../src/core/usage-advisor.js";
import { emptyUsageAdvisorState } from "../src/state/types.js";

const times = [
  "2026-08-02T01:00:00.000Z",
  "2026-08-02T01:01:00.000Z",
  "2026-08-02T01:02:00.000Z",
] as const;

describe("UsageAdvisor bounded core contract", () => {
  test("accepts only closed signal codes and exact redacted input fields", () => {
    expect(USAGE_ADVISOR_SIGNAL_CODES).toEqual([
      "task_target_clarification",
      "abandoned_image_draft",
      "routing_correction",
      "delivery_retry",
      "ownership_conflict",
      "recovery_action",
    ]);

    const state = emptyUsageAdvisorState();
    const advisor = new UsageAdvisor(state);
    const before = JSON.stringify(state);
    const secret = "sk-secret prompt C:\\private\\task sender@example.test";

    expect(() => advisor.record({ code: "unknown", at: times[0] } as never)).toThrow(/signal code/i);
    expect(() => advisor.record({ code: "delivery_retry", at: times[0], prompt: secret } as never)).toThrow(/only code and at/i);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(state)).not.toContain(secret);
  });

  test("creates one deterministic fixed-section proposal only at the count threshold", () => {
    const state = emptyUsageAdvisorState();
    const advisor = new UsageAdvisor(state);

    expect(advisor.record({ code: "task_target_clarification", at: times[0] })).toBeUndefined();
    expect(advisor.record({ code: "task_target_clarification", at: times[1] })).toBeUndefined();
    const created = advisor.record({ code: "task_target_clarification", at: times[2] });

    expect(created).toMatchObject({
      id: "usage-task-target-clarification",
      signalCode: "task_target_clarification",
      status: "pending_review",
      evidence: { count: 3, firstSeenAt: times[0], lastSeenAt: times[2], recentAt: times },
      sections: {
        observation: expect.any(String),
        benefit: expect.any(String),
        risks: expect.any(String),
        scope: expect.any(String),
        rollback: expect.any(String),
        verification: expect.any(String),
      },
    });
    expect(Object.keys(created?.sections ?? {})).toEqual([
      "observation",
      "benefit",
      "risks",
      "scope",
      "rollback",
      "verification",
    ]);
    expect(advisor.list()).toHaveLength(1);
  });

  test("tracks bounded aggregate evidence and never exceeds aggregate or proposal caps", () => {
    const state = emptyUsageAdvisorState();
    const advisor = new UsageAdvisor(state);

    for (const [codeIndex, code] of USAGE_ADVISOR_SIGNAL_CODES.entries()) {
      for (let count = 0; count < USAGE_ADVISOR_LIMITS.recentTimestamps + 5; count += 1) {
        advisor.record({
          code,
          at: new Date(Date.UTC(2026, 7, 2, codeIndex, count)).toISOString(),
        });
      }
    }

    expect(Object.keys(state.aggregates).length).toBeLessThanOrEqual(USAGE_ADVISOR_LIMITS.aggregates);
    expect(Object.keys(state.proposals).length).toBeLessThanOrEqual(USAGE_ADVISOR_LIMITS.proposals);
    for (const aggregate of Object.values(state.aggregates)) {
      expect(aggregate?.recentAt.length).toBeLessThanOrEqual(USAGE_ADVISOR_LIMITS.recentTimestamps);
    }
    expect(advisor.list()).toHaveLength(USAGE_ADVISOR_SIGNAL_CODES.length);
  });

  test("records approve-for-planning and reject decisions without any execution state", () => {
    const approvedAdvisor = proposalFixture();
    const approved = approvedAdvisor.review(
      "usage-delivery-retry",
      "approve_for_planning",
      "2026-08-02T01:03:00.000Z",
    );
    expect(approved).toMatchObject({
      status: "approved_for_planning",
      reviewedAt: "2026-08-02T01:03:00.000Z",
    });
    expect(JSON.stringify(approved)).not.toMatch(/executed|applied|deployed/i);

    const rejectedAdvisor = proposalFixture();
    expect(rejectedAdvisor.review("usage-delivery-retry", "reject", "2026-08-02T01:04:00.000Z")).toMatchObject({
      status: "rejected",
      reviewedAt: "2026-08-02T01:04:00.000Z",
    });
  });

  test("rejects apply, unknown proposals, and terminal re-review with byte-equivalent state", () => {
    const advisor = proposalFixture();

    for (const operation of [
      () => advisor.review("usage-delivery-retry", "apply" as never, times[2]),
      () => advisor.review("missing", "reject", times[2]),
    ]) {
      const before = JSON.stringify(advisor.state);
      expect(operation).toThrow();
      expect(JSON.stringify(advisor.state)).toBe(before);
    }

    advisor.review("usage-delivery-retry", "reject", times[2]);
    const terminal = JSON.stringify(advisor.state);
    expect(() => advisor.review("usage-delivery-retry", "approve_for_planning", times[2])).toThrow(/terminal/i);
    expect(JSON.stringify(advisor.state)).toBe(terminal);
  });

  test("returns defensive proposal copies so callers cannot alter advisor state", () => {
    const advisor = proposalFixture();
    const proposal = advisor.list()[0]!;
    proposal.sections.scope = "broaden every permission";
    proposal.evidence.recentAt.push("2099-01-01T00:00:00.000Z");

    expect(advisor.list()[0]?.sections.scope).not.toBe("broaden every permission");
    expect(advisor.list()[0]?.evidence.recentAt).toEqual(times);
  });
});

function proposalFixture(): UsageAdvisor {
  const advisor = new UsageAdvisor(emptyUsageAdvisorState());
  for (const at of times) advisor.record({ code: "delivery_retry", at });
  return advisor;
}
