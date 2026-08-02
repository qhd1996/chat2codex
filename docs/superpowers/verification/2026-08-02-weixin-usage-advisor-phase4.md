# Weixin UsageAdvisor Phase 4 Verification

## Verdict

**Pass for the bounded review-only UsageAdvisor capability.** This does not mark
the seven-group Weixin-Codex Goal complete and does not authorize deployment.

## Implemented boundary

- Closed signals: `task_target_clarification`, `abandoned_image_draft`,
  `routing_correction`, `delivery_retry`, `ownership_conflict`, and
  `recovery_action`.
- The runtime currently records real task-target clarification and durable
  delivery-retry friction. Only signal code and timestamp reach UsageAdvisor.
- Proposal threshold is 3. Aggregate cap and proposal cap are 6; each aggregate
  retains at most 8 recent timestamps. Proposal text is rebuilt from fixed code
  templates with observation, evidence, benefit, risks, scope, rollback, and
  verification.
- `/advisor` lists at most six proposals. `/advisor approve <id>` records only
  `approved_for_planning`; `/advisor reject <id>` is terminal. Invalid `apply`,
  unknown IDs, and terminal re-review do not change advisor state or start Codex.
- Signal persistence and proposal notification are best-effort after the
  original clarification/retry behavior. Failure does not block the original
  state machine or rerun Codex.
- The optional advisor partition remains inside schema v5. Legacy state loads
  with an empty advisor, and load/save reapply enum, template, and retention
  constraints. Rollback to an earlier schema-v5 package can ignore the optional
  field; this is not a claim that a schema-v4 package can read a schema-v5
  envelope.
- `src/core/usage-advisor.ts` imports only state types and has no process, file,
  network, Codex, configuration, deployment, or permission-changing interface.

## Focused evidence

- Core contract: 8 passed, 0 failed.
- Persistence plus core/state suite: 36 passed, 0 failed before Task 3.
- Final UsageAdvisor-focused run across six files: 21 passed, 0 failed.
- Documentation and architecture boundary run: 9 passed, 0 failed.
- Task 4 router integration proves three target clarifications produce a
  traceable proposal without changing tasks, drafts, or clarifications; the
  on-disk advisor partition excludes supplied credential-, path-, task-, and
  sender-shaped strings. Persistence and notification failure tests preserve
  durable retry and one Codex run.
- Final complete MessageRouter shards: 183 tests, 182 passed, 1 platform skip,
  0 failed, 0 timed out, and 0 residual root/child process identities.

## Full release gate

The accepted full run used bundled Node `v24.14.0` because the ambient system
Node `v16.17.0` is below the package requirement `>=20.12.0`. The safe wrapper
recorded PID plus creation time and verified no residual process identity.

```text
bun run check
562 pass, 8 skip, 0 fail
2492 assertions, 570 tests across 42 files
typecheck: pass
contract typecheck: pass
build: pass
timeout: no
residual root/children: 0/0
```

An earlier complete run had one existing archive-recovery assertion exceed its
one-second polling window: 561 passed, 8 skipped, 1 failed. It exited normally
with no residual identities and is retained as negative evidence. The exact
archive test then passed five consecutive isolated runs, and the later complete
gate passed without changing its product behavior or assertion. The failed run
is not counted as passing.

## Review and remaining scope

The complete committed diff and final uncommitted documentation diff were
reviewed against `USAGE-001` and `USAGE-002`. A separately dispatched enhanced
review agent twice lost its supplied task and returned no code findings; those
empty responses were not treated as evidence. Verification relies on direct
Git diff inspection, closed-boundary tests, deterministic router shards, and the
fresh full gate above.

Phase 3 Desktop primitives, Gateway implementation, production supervision,
Phase 2 deployment, Computer Use, and real Weixin E2E remain outside this pass
and retain their separate approval gates.
