# Novice Daily-Use Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a package-level, table-driven novice acceptance system for fresh
Windows users, durable upgrades, and fault recovery, including property/fuzz,
kill/restart, thirty-run stability, evidence validation, and a clean isolated
Windows runner.

**Architecture:** A closed scenario inventory feeds a pure simulation kernel. A
product driver invokes existing lifecycle, state, Gateway, ownership, reconciler,
and outbox boundaries while mock peers replace only prohibited external systems.
An archive runner installs the reviewed package into a private Windows profile and
emits a strict evidence record validated independently.

**Tech Stack:** TypeScript 7, Bun 1.3.9, Node.js 20+, fast-check 4.9, Windows
PowerShell/Task Scheduler adapters behind injected I/O, JSON evidence contracts,
GitHub Actions Windows runners.

**Authority:** Requirements ledger `01e827b`; design `5f6b460`. Production, the
real user Codex Home, Hook installation/trust, Desktop restart, Computer Use, real
Weixin login/outbound, and Task 12 remain excluded.

---

### Task 0: Bind the implementation overlay to CR-0009

**Files:**
- Modify: `quality/authority/requirements-ledger.json`
- Modify: `scripts/verify-openspec-authority.mjs`
- Modify: `tests/openspec-authority.test.ts`
- Create: `openspec/changes/novice-daily-use-simulation/proposal.md`
- Create: `openspec/changes/novice-daily-use-simulation/design.md`
- Create: `openspec/changes/novice-daily-use-simulation/tasks.md`
- Create: `openspec/changes/novice-daily-use-simulation/specs/novice-acceptance/spec.md`

- [ ] **Step 1: Write RED authority tests.** Require ledger commit `01e827b`,
  accepted CR-0009, `NOVICE-001..003`, and exact current ledger hashes. Keep
  negative tests for production/external authority and the forbidden damaged task.
- [ ] **Step 2: Prove RED.** Run `bun test tests/openspec-authority.test.ts`; expect
  a commit/requirement mismatch.
- [ ] **Step 3: Refresh the lock and add the non-authoritative OpenSpec delta.**
  Every artifact begins with metadata equivalent to:

```json
{
  "changeName": "novice-daily-use-simulation",
  "authorityCommit": "01e827b...",
  "requirementIds": ["NOVICE-001", "NOVICE-002", "NOVICE-003"],
  "acceptedBy": "Haoda",
  "productionAuthorized": false,
  "realExternalActionsAuthorized": false
}
```

- [ ] **Step 4: Prove GREEN.** Run `bun test tests/openspec-authority.test.ts &&
  bun run openspec:validate && bun run quality:authority`.
- [ ] **Step 5: Commit.** `docs: bind novice simulation to accepted requirements`

### Task 1: Define and validate the closed scenario inventory

**Files:**
- Create: `src/quality/novice-scenarios.ts`
- Create: `quality/scenarios/novice-daily-use.json`
- Create: `tests/novice-scenarios.test.ts`

- [ ] **Step 1: Write RED contract tests.** Require unique bounded IDs, closed
  environment/action/prompt/invariant/fault/recovery/probe enums, exact keys, no
  real external actions, and coverage for every CR-0009 obligation.
- [ ] **Step 2: Prove RED.** Run `bun test tests/novice-scenarios.test.ts`; expect
  missing module/inventory failures.
- [ ] **Step 3: Implement the validator and inventory.** Export:

```typescript
export type NoviceRequirement = "NOVICE-001" | "NOVICE-002" | "NOVICE-003";
export interface NoviceScenario {
  id: string; requirement: NoviceRequirement; environment: NoviceEnvironment;
  preconditions: NovicePrecondition[]; actions: NoviceAction[];
  expectedPromptCodes: NovicePromptCode[]; invariants: NoviceInvariant[];
  faults: NoviceFault[]; recovery: NoviceRecovery[]; requiredProbes: NoviceProbe[];
}
export function parseNoviceScenarioInventory(value: unknown): NoviceScenario[];
export function validateNoviceCoverage(items: NoviceScenario[]): NoviceCoverage;
```

  Inventory coverage includes download/hash/prerequisites, setup/doctor/service
  lifecycle, tasks/media/workspaces/Plan/approval/structured input, upgrade/state/
  outbox/migration/rollback, network/duplicate/process/disk/permission/schema,
  Gateway/token/generation, unbound/child exclusion, uninstall retention, and
  confirmed-only purge.
- [ ] **Step 4: Prove GREEN and type safety.** Run focused tests and `bun run
  typecheck`.
- [ ] **Step 5: Commit.** `test: define novice acceptance scenarios`

### Task 2: Build the fail-closed simulation kernel and prompt scanner

**Files:**
- Create: `src/quality/novice-simulator.ts`
- Create: `src/quality/novice-redaction.ts`
- Create: `tests/novice-simulator.test.ts`
- Create: `tests/novice-redaction.test.ts`

- [ ] **Step 1: Write RED tests.** An unimplemented action, missing prompt, failed
  invariant, timeout, skip, or cleanup uncertainty must fail. Verify prompt fields
  `what_happened`, `safe_state`, and `next_action`, and detect canary tokens,
  prompts, identities, and forbidden absolute paths in any emitted field.
- [ ] **Step 2: Prove RED.** Run both focused files; expect missing modules.
- [ ] **Step 3: Implement the minimum kernel.**

```typescript
export interface NoviceDriver {
  act(action: NoviceAction, context: NoviceContext): Promise<NoviceObservation>;
  inject(fault: NoviceFault, context: NoviceContext): Promise<void>;
  recover(step: NoviceRecovery, context: NoviceContext): Promise<NoviceObservation>;
  snapshot(): Promise<NoviceSnapshot>;
  cleanup(): Promise<NoviceCleanup>;
}
export async function runNoviceScenario(
  scenario: NoviceScenario, driver: NoviceDriver, options: NoviceRunOptions,
): Promise<NoviceScenarioResult>;
```

  Use an injected event-boundary deadline; never sleep for readiness. Preserve all
  failure results.
- [ ] **Step 4: Prove GREEN.** Focused tests and typecheck pass.
- [ ] **Step 5: Commit.** `feat: execute novice scenarios fail closed`

### Task 3: Compose real product boundaries for fresh and upgrade users

**Files:**
- Create: `src/quality/novice-product-driver.ts`
- Create: `tests/novice-fresh-journey.test.ts`
- Create: `tests/novice-upgrade-journey.test.ts`
- Create: `tests/fixtures/novice-old-state-v5.json`

- [ ] **Step 1: Write RED journey tests.** Fresh install/doctor/start/stop/restart/
  uninstall/reinstall and old-state upgrade/migration/rollback each run twice.
  Assert stable task/job/outbox IDs, ordering, pending obligations, data/config
  preservation, and explicit refusal of unconfirmed purge.
- [ ] **Step 2: Prove RED.** Run both files; expect missing driver/probes.
- [ ] **Step 3: Implement the product driver.** It calls existing Windows lifecycle
  planners/executor through injected file/task I/O, the real store migration path,
  Gateway auth, desktop ownership/reconciler, and media outbox. Mock peers can only
  answer external transport calls. The fixture contains synthetic data only and
  has a committed SHA-256 assertion.
- [ ] **Step 4: Prove GREEN.** Run both journeys twice and the existing Windows,
  Gateway, ownership, reconciler, media-outbox, and state focused suites.
- [ ] **Step 5: Commit.** `feat: simulate fresh and upgrade novice journeys`

### Task 4: Cover daily use and recovery faults

**Files:**
- Create: `src/quality/novice-mock-transport.ts`
- Create: `tests/novice-daily-use.test.ts`
- Create: `tests/novice-recovery.test.ts`

- [ ] **Step 1: Write RED table tests.** Cover create/continue/stop/retry, text/
  image/file ingress and egress, multi-task selection, six workspace routes, Plan
  mode, scoped approvals, structured input, unstable/offline network, duplicate/
  reordered messages, Gateway offline, wrong token, expired generation, disk/
  permission errors, malformed/future schema, and unbound/child non-export.
- [ ] **Step 2: Prove RED.** Run both files; expect missing transport/actions.
- [ ] **Step 3: Implement the authenticated mock transport and fault adapters.**
  Delivery acknowledgement must flow through normal idempotency APIs. Faults are
  injected before named durable writes or at mock network boundaries; they cannot
  mutate product state directly.
- [ ] **Step 4: Prove GREEN.** Run daily/recovery plus relevant existing router,
  media, Gateway, ownership, and reconciler shards.
- [ ] **Step 5: Commit.** `test: exercise novice daily use and recovery`

### Task 5: Add novice-mistake properties and event-boundary restart injection

**Files:**
- Create: `tests/properties/novice-actions.property.test.ts`
- Create: `tests/properties/novice-lifecycle.property.test.ts`
- Create: `scripts/novice-restart-probe.mjs`
- Create: `tests/novice-restart.test.ts`

- [ ] **Step 1: Write RED property and restart tests.** Generate invalid/repeated/
  reordered actions, Unicode/control paths, config mutations, lifecycle sequences,
  message IDs, signed-byte/token/nonce mutations, and generations. Spawn the probe,
  wait for `DURABLE_BOUNDARY <id>`, kill by PID+creation identity, restart, and
  verify state/outbox convergence and no rerun.
- [ ] **Step 2: Prove RED.** Focused tests fail for missing property adapters/probe.
- [ ] **Step 3: Implement minimum adapters and probe.** Fix seeds at `2026080201`
  and `2026080202`, at least 100 fast-check runs each. Use protocol events, not
  readiness sleeps.
- [ ] **Step 4: Prove GREEN and replay.** Run property files and 30 restart
  repetitions with zero timeout/residual identity.
- [ ] **Step 5: Commit.** `test: fuzz novice mistakes and restart boundaries`

### Task 6: Validate evidence and enforce thirty complete repetitions

**Files:**
- Create: `quality/evidence/novice-acceptance-template.json`
- Create: `scripts/verify-novice-evidence.mjs`
- Create: `scripts/run-novice-matrix.mjs`
- Create: `tests/novice-evidence.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED evidence tests.** Reject fewer than thirty repetitions,
  missing/duplicate scenarios, skip/timeout/failure, archive/hash mismatch, absent
  seeds/commands/versions/state hashes/failure history, leaks, nonzero residuals,
  and a checked-in template that claims a pass.
- [ ] **Step 2: Prove RED.** Run `bun test tests/novice-evidence.test.ts`.
- [ ] **Step 3: Implement validator and matrix runner.** Add scripts:

```json
{
  "quality:novice": "node scripts/verify-novice-evidence.mjs quality/evidence/novice-acceptance-template.json",
  "test:novice": "bun test tests/novice-*.test.ts tests/properties/novice-*.test.ts --max-concurrency=1",
  "test:novice:30": "node scripts/run-novice-matrix.mjs --repetitions 30"
}
```

  The checked-in template remains entirely `unproven`; generated reports go to a
  caller-selected evidence directory.
- [ ] **Step 4: Prove GREEN.** Run evidence tests, template validation, and a
  complete thirty-run repository matrix.
- [ ] **Step 5: Commit.** `test: require thirty novice acceptance repetitions`

### Task 7: Run the exact archive in an isolated Windows profile

**Files:**
- Create: `scripts/run-novice-acceptance.mjs`
- Create: `scripts/novice-windows-worker.mjs`
- Create: `tests/novice-isolation.test.ts`
- Create: `docs/quality/novice-acceptance-runbook.md`

- [ ] **Step 1: Write RED isolation tests.** Refuse a repository entrypoint,
  missing/incorrect SHA, real profile/Codex Home/production path, non-Windows
  qualification claim, mock security boundary, or cleanup outside the owned root.
- [ ] **Step 2: Prove RED.** Run `bun test tests/novice-isolation.test.ts`.
- [ ] **Step 3: Implement the runner.** Verify archive bytes, create a unique root
  and private npm prefix/profile/Home, install with `npm install --ignore-scripts
  --prefix <owned> <archive>`, invoke only the installed absolute CLI/worker, run
  matrix and cleanup probes, and emit versions/commands/hashes/PIDs. It never
  registers a real task or changes a real profile in repository automation.
- [ ] **Step 4: Prove GREEN.** Pack the candidate, run isolation tests, then run
  the archive worker in an owned temporary root. Verify zero residual PID and that
  a clean checkout reproduces archive SHA-256.
- [ ] **Step 5: Commit.** `feat: run novice acceptance from the packaged archive`

### Task 8: Package the gate and add Windows CI

**Files:**
- Modify: `package.json`
- Modify: `distribution/release-manifest.json`
- Modify: `scripts/verify-distribution-package.mjs`
- Modify: `tests/distribution-package.test.ts`
- Create: `.github/workflows/windows-quality.yml`
- Create: `docs/windows/novice-troubleshooting.md`
- Create: `tests/novice-docs.test.ts`

- [ ] **Step 1: Write RED package/docs/workflow tests.** Require all new runtime
  assets in the archive closed set, no machine paths/secrets/generated evidence,
  a Windows job with frozen install, package verification, novice tests, thirty-run
  matrix, residual-process check, and artifact upload only for redacted evidence.
- [ ] **Step 2: Prove RED.** Run distribution and novice-doc tests.
- [ ] **Step 3: Update package/version/docs/CI.** Bump the prerelease version, list
  every new asset, document prompt codes and recovery, and keep real-action stages
  explicitly unproven.
- [ ] **Step 4: Prove GREEN.** Run package verification on worktree and extracted
  archive, official `bun audit`, OpenSpec/authority/evidence gates, and CI syntax
  inspection.
- [ ] **Step 5: Commit.** `build: package the novice acceptance gate`

### Task 9: Full review, stability, and evidence handoff

**Files:**
- Create: `docs/superpowers/verification/novice-acceptance-preinstall.md`
- Update only after direct evidence: requirements-ledger acceptance matrix and
  `CURRENT.md` in the independent authority worktree

- [ ] **Step 1: Review spec compliance.** Map every CR-0009 sentence to scenario,
  test, probe, or still-unproven clean-environment row. No implicit promotion.
- [ ] **Step 2: Review code quality/security.** Inspect diffs, exact package roots,
  cleanup containment, error redaction, mock boundaries, and failure preservation.
- [ ] **Step 3: Run fresh gates.** `bun run check:stable`, eight exact Router
  shards, `bun run test:properties`, `bun run test:novice:30`, `bun audit`, pack,
  extracted-package validation, clean-checkout repack comparison, OpenSpec,
  authority, and all evidence validators.
- [ ] **Step 4: Run clean isolated Windows automation.** Record OS/Node/npm/Codex/
  package versions, exact archive SHA-256, commands, scenario/test counts, seeds,
  failure/fix history, state/hash transitions, and zero residual processes. This
  closes `NOVICE-*` only if the environment and whole report qualify.
- [ ] **Step 5: Commit the preinstall report.** It must name every real or installed
  row still missing and retain Task 12/external-action gates.
- [ ] **Step 6: Update the authoritative matrix with direct evidence.** Do this in
  the ledger worktree only after independent verification. A failed novice row
  remains a delivery blocker.
