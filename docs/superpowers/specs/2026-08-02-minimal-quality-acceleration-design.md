# Minimal Quality Acceleration Design

**Date:** 2026-08-02

**Status:** Proposed for written review after Haoda approved option B. No implementation is authorized by this document alone.

## 1. Objective

Add a small, repository-local quality layer to Chat2Codex that:

- preserves the existing Superpowers design, worktree, TDD, review, and verification workflow;
- uses OpenSpec only for implementation-level change deltas, never as a second product-requirements authority;
- exercises the repository on Windows in CI with auditable process-tree evidence;
- applies bounded property testing to the highest-risk pure Phase 3 state machines after those modules exist on integration; and
- makes automated, installed-behavior, and real Weixin/Desktop evidence mechanically distinguishable.

The quality layer accelerates evidence production. It does not change product behavior, deploy a candidate, or satisfy a real-E2E acceptance row by itself.

## 2. Authority and workflow

### 2.1 One requirements authority

Product requirements remain authoritative only at:

`F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/`

This design was checked against ledger commit `07603ee`. Implementation must
re-read the live ledger branch and stop if the governing baseline, accepted CRs,
ADRs, or acceptance rows have materially changed. The recorded commit is audit
provenance, not permission to ignore later accepted requirements.

The authority order is unchanged:

1. baseline `v1.0.0`;
2. accepted change records;
3. ADRs;
4. acceptance matrix;
5. `CURRENT.md` as a drift-prone operational snapshot.

An OpenSpec artifact must cite the governing ledger commit and requirement IDs. It may refine an authorized change into testable implementation scenarios, but it may not create, accept, supersede, or close a product requirement. If an OpenSpec delta disagrees with the ledger, the delta is invalid and implementation stops.

The damaged task `019fc002-590e-7023-b7e5-2a802168f00a` remains prohibited input. Its turns, tool calls, and tool outputs are never read, imported, summarized, or converted into OpenSpec artifacts.

### 2.2 Superpowers remains the execution method

Superpowers continues to own:

- brainstorming and written design approval;
- implementation planning;
- isolated worktrees;
- test-first RED/GREEN evidence;
- specification and code-quality review; and
- verification before completion.

OpenSpec supplies a repository-local change graph and machine validation of proposal/spec/design/task consistency. It does not replace those gates. `apply` or equivalent OpenSpec actions never imply production authority.

### 2.3 No global or user-home mutation

The repository pins OpenSpec as an exact development dependency. Commands run through package scripts using Node 24. No global package is installed, no system or user `PATH` is changed, and `openspec init` is not run because its documented cleanup behavior can reach user-home prompt files.

No file under `~/.codex`, no Hook/MCP trust record, and no Desktop configuration is created or changed by this quality initiative. Agent guidance is repository-local in `AGENTS.md`.

## 3. Delivery decomposition

### 3.1 Package A: quality foundation

Package A branches from integration commit `969c5ae` in
`feat/minimal-quality-acceleration`. It is independent of the unfinished Phase 3 implementation lines. It adds:

- the thin OpenSpec overlay and its authority validator;
- a Windows CI workflow pinned to Node 24 and Bun 1.3.9;
- reusable Windows process/ACL quality checks without changing production service installation;
- a versioned evidence-manifest schema and fail-closed verifier; and
- tests for all new validators and workflow invariants.

Package A does not add placeholder ownership/auth/reconciliation APIs and does not edit product state schema.

### 3.2 Package B: Phase 3 property verification

Package B begins only after Phase 3 Tasks 1–4 are reviewed and merged into integration in the approved order. The quality branch rebases on that merge result, then adds `fast-check` properties against the real modules:

- ownership/generation/start-fence state machine;
- scoped HMAC, canonical request bytes, and replay protection; and
- authoritative reconciliation/high-water/child-exclusion behavior.

If a Phase 3 interface differs from the approved design, the interface is resolved on integration first. Property tests never define a competing API merely to run early.

## 4. Repository changes

### 4.1 Package A files

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | Repository-local authority, safety, Superpowers/OpenSpec, and evidence rules |
| `package.json` | Exact local OpenSpec command and quality/evidence scripts |
| `bun.lock` | Reproducible local OpenSpec dependency |
| `openspec/config.yaml` | Brownfield context and explicit ledger precedence |
| `openspec/changes/minimal-quality-acceleration/proposal.md` | Approved problem, scope, and non-goals |
| `openspec/changes/minimal-quality-acceleration/specs/quality-gates/spec.md` | ADDED implementation-level quality scenarios |
| `openspec/changes/minimal-quality-acceleration/design.md` | Link to this approved design and local component decisions |
| `openspec/changes/minimal-quality-acceleration/tasks.md` | Mirror of the approved implementation plan, not an independent task authority |
| `scripts/verify-openspec-authority.mjs` | Fail if change artifacts omit or contradict authority metadata and safety boundaries |
| `tests/openspec-authority.test.ts` | RED/GREEN coverage for the authority validator |
| `quality/evidence/schema.json` | Closed evidence-manifest schema |
| `quality/evidence/phase3-preinstall.json` | Checked-in pre-install evidence index; installed/real rows remain unproven |
| `scripts/verify-quality-evidence.mjs` | Validate evidence levels, hashes, commands, counts, and forbidden promotions |
| `tests/quality-evidence.test.ts` | Adversarial manifest tests |
| `scripts/assert-private-windows-file.mjs` | Structured Windows ACL inspection for disposable test files |
| `tests/windows-security.test.ts` | Windows ACL and existing process-identity behavior; non-Windows uses an explicit skip |
| `.github/workflows/windows-ci.yml` | Windows quality gate and JSON artifacts |
| `docs/quality/weixin-e2e-runbook.md` | Evidence capture procedure only; all external-action approvals remain explicit |

Existing `scripts/make-router-shards.mjs`, `scripts/run-test-shard.mjs`, and `scripts/process-identity.mjs` are reused rather than replaced. Product runner files are not refactored in this initiative.

### 4.2 Package B files

| File | Responsibility |
| --- | --- |
| `package.json` | Exact `fast-check` development dependency and bounded property scripts |
| `bun.lock` | Reproducible property-test dependency |
| `tests/properties/desktop-ownership.property.test.ts` | Generation, CAS, fence, idempotency, and no-double-writer properties |
| `tests/properties/desktop-gateway-auth.property.test.ts` | Byte binding, scope, freshness, and replay properties |
| `tests/properties/desktop-reconciler.property.test.ts` | High-water, idempotent export, ordering, and child exclusion properties |

No production file is changed solely to make a property test convenient. A testability problem is reported as an interface/design issue.

## 5. Thin OpenSpec overlay

### 5.1 Artifact semantics

The first change is delta-first and covers only this quality initiative. There is no bulk conversion of the existing ledger, Superpowers specs, plans, verification reports, or historical branches.

Every OpenSpec change contains machine-readable front matter or a fixed metadata block with:

- `authorityRepo`;
- `authorityCommit`;
- `requirementIds`;
- `acceptedBy`;
- `productionAuthorized: false`; and
- `realExternalActionsAuthorized: false`.

`verify-openspec-authority.mjs` rejects missing metadata, an unknown requirement ID, claims that OpenSpec is authoritative, production authorization, real-Weixin authorization, or references to the damaged task. It also checks that proposal, delta spec, design, and tasks name the same change.

### 5.2 Local commands

OpenSpec is fixed at the reviewed version and invoked only through package scripts. The scripts fail with a clear Node-version error below `20.19.0`; local verification prepends the already available bundled Node 24 directory for that process only. CI uses `actions/setup-node` with Node 24.

The design does not depend on generated Codex skills. Repository `AGENTS.md` tells an agent when and how to invoke the local validation scripts, preserving current user-level Codex configuration untouched.

### 5.3 Archive behavior

Archiving an OpenSpec change may update implementation-level `openspec/specs/quality-gates/`. It never writes the requirements-ledger worktree and never updates acceptance status. A separate, explicitly authorized ledger change remains required for any product-requirement change.

## 6. Evidence manifest

### 6.1 Closed evidence levels

The manifest accepts only:

1. `static`;
2. `automated`;
3. `installed_behavior`;
4. `real_e2e`.

`contradicted` is an outcome, not an evidence level. A timed-out, killed, incomplete, stale, or residual-process run is negative evidence and cannot be promoted.

Each evidence record includes:

- requirement or design-invariant ID;
- evidence level and outcome;
- UTC timestamp;
- repository commit and dirty-state flag;
- platform and exact Node/Bun/package versions;
- exact command or named manual procedure;
- pass/fail/skip/timeout counts;
- process residual counts where applicable;
- artifact path and SHA-256; and
- a redacted note with a bounded length.

Secrets, raw prompts, sender identifiers, credentials, local token values, result text, and private file contents are forbidden.

### 6.2 Fail-closed promotion rules

The verifier encodes the required evidence level for each indexed row. An `automated` record cannot set a row requiring `installed_behavior` or `real_e2e` to `PASS`. Missing artifacts, hash mismatch, non-zero failure/timeout/residual counts, unknown fields, future schema versions, stale commit IDs, or an unclean run marked clean fail validation.

The checked-in `phase3-preinstall.json` intentionally leaves installed and real rows unproven. CI proves only its own automated rows. The requirements-ledger acceptance matrix remains the only authoritative roll-up.

## 7. Windows CI

The workflow runs on `windows-latest` with least-privilege read-only repository permissions. It:

1. checks out the exact commit;
2. installs Node 24 and Bun 1.3.9;
3. runs `bun install --frozen-lockfile`;
4. validates the OpenSpec overlay and evidence manifests;
5. runs the complete `bun run check` through the existing PID-plus-creation-time wrapper with a bounded timeout;
6. generates eight deterministic `message-router` shards and runs each through the same wrapper;
7. runs Windows ACL/process-focused tests; and
8. uploads JSON reports and manifests even on failure, with a bounded retention period and no secrets.

No workflow step starts the production scheduled task, accesses `F:/Chat2Codex`, logs into Weixin, installs Desktop Hooks, or sends a message.

The Windows check begins as a reporting workflow on the feature branch. It must
pass for this quality branch to be accepted, but it is not added to repository
branch protection by this initiative. Any later branch-protection change requires
separate repository-administration authority after three consecutive green runs.

## 8. Property-testing model

### 8.1 Determinism and bounds

`fast-check` is fixed to an exact reviewed version. PR runs use a fixed default seed plus the failing seed/path printed by fast-check. Run count, generated collection sizes, string byte lengths, and state-machine command counts are capped. A separate explicit stress script may increase the run count but is not part of ordinary `bun run check`.

### 8.2 Ownership properties

Generated command sequences must prove:

- successful ownership transfer increases generation exactly once;
- stale generations never mutate state;
- `uncertain` and `disabled` never grant a writer;
- at most one bridge/Desktop start succeeds for one root/generation;
- active bridge work, a start fence, release obligations, or pending delivery blocks takeover/release as designed;
- expiry only creates `uncertain`;
- same mutation ID and canonical bytes is a no-op; different bytes is an integrity conflict; and
- excluded control turns never clear an ordinary fence or become exportable.

### 8.3 Authentication properties

Generated byte strings and metadata must prove changing any signed method, exact path, ordered metadata field, body byte, byte length, role, endpoint, nonce, request ID, or timestamp invalidates authentication as applicable. Reuse is rejected, response signatures bind to the request, and no secret or prompt commitment appears in decision logs.

### 8.4 Reconciliation properties

Generated authoritative turn histories must prove:

- opaque turn IDs are never ordered lexically;
- missing/reordered high water produces uncertainty without mutation;
- a deterministic outbox identity with equal bytes is idempotent; unequal bytes conflicts;
- a crash point commits all or none of cursor and outbox changes;
- duplicate/missed Stop does not change correctness; and
- unbound or concrete child thread output never enters the root conversation outbox.

## 9. Real Weixin/Desktop runbook

The runbook is a procedure and evidence template, not an executable E2E test. It separates:

- repository automation;
- production read-only health;
- production write/restart;
- `~/.codex`/Hook/MCP installation or trust;
- Desktop restart and Computer Use; and
- each real Weixin outbound action.

The last four categories retain their existing individual confirmation gates. The runbook requires fresh handles, timestamps, redacted screenshots/transcripts, state hashes, process identities, ordering/dedup evidence, and rollback hashes. It explicitly forbids treating simulated transport, a schema, a static bundle inspection, or CI as real E2E.

## 10. Error handling and safety

- OpenSpec validation fails closed on ambiguous authority.
- Evidence validation fails closed on unknown fields, missing hashes, stale/incomplete runs, or level inflation.
- Windows ACL inspection fails closed when PowerShell output is missing or unparsable; it never edits an ACL.
- The process wrapper keeps its PID-plus-creation-time identity guard before tree termination.
- CI artifacts are redacted and bounded.
- No quality tool accepts a production path by default.
- No quality command may deploy, restart, install trust, operate Desktop, or send Weixin.

## 11. Acceptance matrix

| Capability | Required proof | Pass condition |
| --- | --- | --- |
| Authority preservation | Adversarial OpenSpec validator tests | Ledger precedence enforced; damaged task and authority inflation rejected |
| Local-only tooling | Git diff and process environment evidence | Exact local dependency; no global install, home write, or PATH persistence |
| Windows CI | Three workflow runs before any branch-protection proposal | Exact versions, full check and shards, zero failure/timeout/residual process |
| Windows ACL/process checks | Native Windows tests | Private disposable file accepted; broad-readable/symlink/unparseable cases rejected; PID reuse remains rejected |
| Evidence schema | Adversarial manifest tests | Unknown/stale/inflated/secret-shaped evidence rejected |
| Evidence-level separation | Manifest verifier tests and checked-in preinstall index | Automated evidence cannot pass installed/real rows |
| Ownership properties | Bounded deterministic fast-check runs after Task 1 merge | No counterexample; seed/path retained on failure |
| Auth properties | Bounded deterministic fast-check runs after Task 2 merge | Any signed-byte/scope/replay mutation is rejected |
| Reconciliation properties | Bounded deterministic fast-check runs after Task 4 merge | No duplicate/leak/high-water corruption counterexample |
| Existing behavior | Fresh repository gate | Typecheck, contracts, all tests, build pass with exact counts |
| Real E2E | Separately confirmed runbook execution | Remains unproven until direct Desktop/Weixin artifacts exist |

## 12. Rollback

Package A and Package B are separate commits or merge intervals.

Package B rollback removes the three property suites, `fast-check` dependency, and property scripts. Package A remains useful.

Package A rollback removes the Windows workflow, OpenSpec/evidence/ACL quality files, local OpenSpec dependency, and repository guidance. It does not touch product code, state files, deployments, user Codex configuration, or production processes. Existing Superpowers specs/plans/tests remain unchanged.

No rollback command performs a recursive delete against a broad path. Git reversion is preferred after verifying the exact commit interval.

## 13. Sequencing and merge gate

1. Review and approve this written specification.
2. Write and review a detailed implementation plan.
3. Implement Package A with TDD in `feat/minimal-quality-acceleration`.
4. Run specification review, code-quality review, and full verification.
5. Keep the branch independent until Phase 3 Task 5 establishes the reviewed integration merge point.
6. Rebase Package A on that point and resolve only interface-free quality files.
7. Implement Package B with TDD against the real Phase 3 modules.
8. Merge only after full Linux-compatible local checks, Windows workflow evidence, secret scan, dependency audit, diff review, and authority/evidence validation.

Production, `~/.codex`, Desktop, Computer Use, and real Weixin remain outside this merge gate.

## 14. Estimate and risk

Package A is estimated at 1.0–1.5 engineering days. Package B is estimated at 1.0–1.5 engineering days after Tasks 1–4 stabilize. Total remains 2–3 engineering days, normally 1–2 calendar days only where CI and review latency overlap.

Primary risks and controls:

- **Dual authority:** prevented by repository guidance and fail-closed metadata validation.
- **OpenSpec side effects:** no global install and no `init`; project-local exact dependency only.
- **CI runtime:** bounded wrappers and deterministic shards; artifacts retained for diagnosis.
- **Property-test flakiness or explosion:** fixed seeds, replay paths, strict generator/run caps, separate stress profile.
- **Premature interface coupling:** Package B waits for real Phase 3 merges.
- **False acceptance:** evidence-level rules prohibit automated promotion of installed or real-E2E rows.
- **Merge conflict with active Phase 3 work:** independent worktree, Package A avoids product modules, final rebase occurs at the Task 5 integration gate.
