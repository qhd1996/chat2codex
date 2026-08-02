import type {
  UsageAdvisorAggregate,
  UsageAdvisorProposal,
  UsageAdvisorProposalSections,
  UsageAdvisorSignalCode,
  UsageAdvisorState,
} from "../state/types.js";

export const USAGE_ADVISOR_SIGNAL_CODES = [
  "task_target_clarification",
  "abandoned_image_draft",
  "routing_correction",
  "delivery_retry",
  "ownership_conflict",
  "recovery_action",
] as const satisfies readonly UsageAdvisorSignalCode[];

export const USAGE_ADVISOR_LIMITS = Object.freeze({
  aggregates: USAGE_ADVISOR_SIGNAL_CODES.length,
  proposals: USAGE_ADVISOR_SIGNAL_CODES.length,
  recentTimestamps: 8,
  proposalThreshold: 3,
});

export type UsageAdvisorReviewDecision = "approve_for_planning" | "reject";

interface SignalTemplate extends UsageAdvisorProposalSections {
  id: string;
}

const SIGNAL_CODE_SET = new Set<string>(USAGE_ADVISOR_SIGNAL_CODES);

const TEMPLATES: Readonly<Record<UsageAdvisorSignalCode, Readonly<SignalTemplate>>> = {
  task_target_clarification: template(
    "usage-task-target-clarification",
    "Task targeting repeatedly required clarification.",
    "Reduce avoidable clarification while continuing to fail closed on ambiguity.",
    "A broader matching rule could select the wrong task.",
    "Review task labels, aliases, and deterministic targeting rules only.",
    "Remove the accepted targeting adjustment and retain the existing fail-closed clarification.",
    "Replay ambiguity, exact-target, and preserved-state cases before any release.",
  ),
  abandoned_image_draft: template(
    "usage-abandoned-image-draft",
    "Image drafts repeatedly expired or were abandoned before an instruction.",
    "Make the required next action clearer without consuming draft images.",
    "More reminders could create noise or reveal draft existence to the wrong context.",
    "Review draft guidance and expiry notices only.",
    "Restore the current draft wording and expiry behavior.",
    "Verify draft retention, expiry, sender binding, and no-action image handling.",
  ),
  routing_correction: template(
    "usage-routing-correction",
    "Workspace or task routing was repeatedly corrected.",
    "Improve first-choice routing while preserving explicit paths and ambiguity checks.",
    "An over-broad alias could route work into an unauthorized workspace.",
    "Review bounded aliases and deterministic routing metadata only.",
    "Remove the accepted alias or rule and retain the current routing table.",
    "Run all six workspace routes plus explicit-path and ambiguity negatives.",
  ),
  delivery_retry: template(
    "usage-delivery-retry",
    "Durable outbound delivery repeatedly required retry.",
    "Reduce delivery delay without rerunning Codex or duplicating acknowledged messages.",
    "Retry changes can increase load or weaken exactly-once delivery.",
    "Review retry timing and transport diagnostics only.",
    "Restore the current retry policy while preserving the durable outbox.",
    "Exercise partial failure, restart, acknowledged-prefix, and no-Codex-rerun cases.",
  ),
  ownership_conflict: template(
    "usage-ownership-conflict",
    "Single-writer ownership conflicts occurred repeatedly.",
    "Make safe handoff expectations clearer while retaining lease enforcement.",
    "Weakening conflict checks could allow concurrent turns on one thread.",
    "Review lease diagnostics and handoff guidance only.",
    "Restore the existing guidance; never bypass the generation lease.",
    "Verify stale generation, concurrent writer, crash, and uncertain-owner rejection.",
  ),
  recovery_action: template(
    "usage-recovery-action",
    "Operators repeatedly used the same bounded recovery action.",
    "Shorten recovery while preserving explicit authority and state.",
    "Automation could replay unsafe work or hide a production fault.",
    "Review diagnostics and a separately authorized recovery workflow only.",
    "Disable the accepted workflow and return to the explicit recovery action.",
    "Test damaged-turn refusal, interrupted work, restart, and production single-writer gates.",
  ),
};

export class UsageAdvisor {
  constructor(public readonly state: UsageAdvisorState) {}

  record(input: { code: UsageAdvisorSignalCode; at?: string }): UsageAdvisorProposal | undefined {
    validateRecordInput(input);
    const at = normalizedTimestamp(input.at);
    const existing = this.state.aggregates[input.code];
    const aggregate: UsageAdvisorAggregate = existing
      ? {
          ...existing,
          count: Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1),
          lastSeenAt: at,
          recentAt: [...existing.recentAt, at].slice(-USAGE_ADVISOR_LIMITS.recentTimestamps),
        }
      : { code: input.code, count: 1, firstSeenAt: at, lastSeenAt: at, recentAt: [at] };

    this.state.aggregates[input.code] = aggregate;
    const definition = TEMPLATES[input.code];
    if (aggregate.count !== USAGE_ADVISOR_LIMITS.proposalThreshold || this.state.proposals[definition.id]) {
      return undefined;
    }
    if (Object.keys(this.state.proposals).length >= USAGE_ADVISOR_LIMITS.proposals) return undefined;

    const proposal: UsageAdvisorProposal = {
      id: definition.id,
      signalCode: input.code,
      status: "pending_review",
      createdAt: at,
      evidence: cloneAggregate(aggregate),
      sections: cloneSections(definition),
    };
    this.state.proposals[proposal.id] = proposal;
    return cloneProposal(proposal);
  }

  list(): UsageAdvisorProposal[] {
    return Object.values(this.state.proposals)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(cloneProposal);
  }

  review(id: string, decision: UsageAdvisorReviewDecision, at?: string): UsageAdvisorProposal {
    if (decision !== "approve_for_planning" && decision !== "reject") {
      throw new RangeError("UsageAdvisor review decision must be approve_for_planning or reject.");
    }
    const proposal = this.state.proposals[id];
    if (!proposal) throw new RangeError("Unknown UsageAdvisor proposal.");
    if (proposal.status !== "pending_review") throw new Error("UsageAdvisor proposal review is terminal.");
    const reviewedAt = normalizedTimestamp(at);

    proposal.status = decision === "approve_for_planning" ? "approved_for_planning" : "rejected";
    proposal.reviewedAt = reviewedAt;
    return cloneProposal(proposal);
  }
}

function validateRecordInput(input: { code: UsageAdvisorSignalCode; at?: string }): void {
  if (!input || typeof input !== "object" || !SIGNAL_CODE_SET.has(input.code)) {
    throw new RangeError("Unknown UsageAdvisor signal code.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "code" && key !== "at")) {
    throw new RangeError("UsageAdvisor signals accept only code and at.");
  }
  if (input.at !== undefined) normalizedTimestamp(input.at);
}

function normalizedTimestamp(value = new Date().toISOString()): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RangeError("UsageAdvisor timestamp must be a valid date string.");
  }
  return new Date(value).toISOString();
}

function template(
  id: string,
  observation: string,
  benefit: string,
  risks: string,
  scope: string,
  rollback: string,
  verification: string,
): Readonly<SignalTemplate> {
  return Object.freeze({ id, observation, benefit, risks, scope, rollback, verification });
}

function cloneAggregate(value: UsageAdvisorAggregate): UsageAdvisorAggregate {
  return { ...value, recentAt: [...value.recentAt] };
}

function cloneSections(value: UsageAdvisorProposalSections): UsageAdvisorProposalSections {
  return {
    observation: value.observation,
    benefit: value.benefit,
    risks: value.risks,
    scope: value.scope,
    rollback: value.rollback,
    verification: value.verification,
  };
}

function cloneProposal(value: UsageAdvisorProposal): UsageAdvisorProposal {
  return { ...value, evidence: cloneAggregate(value.evidence), sections: cloneSections(value.sections) };
}
