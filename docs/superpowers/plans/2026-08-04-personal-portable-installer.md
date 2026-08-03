# Personal Portable Installer Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Every implementation task uses TDD and completion verification.

**Goal:** Deliver a path-neutral one-command personal Windows installer and move
the remaining Goal through clean Windows, production, Desktop, and authorized
real-Weixin E2E.

**Architecture:** A thin PowerShell bootstrap invokes a tested TypeScript portable
controller that composes the existing Windows service, keys, manifest, rollback,
doctor, package, and evidence modules. Hosted multi-user ACL behavior is retained
as non-blocking P1 evidence; clean personal Windows and real E2E are P0.

**Tech Stack:** PowerShell 5.1, Node 24, TypeScript 7, Bun 1.3.9, npm package
archives, Windows Task Scheduler, current-user .NET ACLs, existing Gateway/state
v6/outbox contracts.

**Authority:** requirements-ledger commit
564d6519c08cc3ecd477a7cefd4bfd8c1afca72c, CR-0010, ADR-0006. Never read
or replay damaged task 019fc002-590e-7023-b7e5-2a802168f00a.

---

### Task 0: Bind repository authority and delivery documentation

**Files:**
- Modify: quality/authority/requirements-ledger.json
- Modify: tests/openspec-authority.test.ts
- Create: openspec/changes/personal-portable-installer/proposal.md
- Create: openspec/changes/personal-portable-installer/design.md
- Create: openspec/changes/personal-portable-installer/tasks.md
- Create: openspec/changes/personal-portable-installer/specs/distribution/spec.md
- Modify: docs/superpowers/specs/2026-08-02-reusable-windows-distribution-design.md

- [ ] Write RED assertions for authority commit 564d651, CR-0010, ADR-0006,
  DIST-002, DIST-003, and DIST-HARDEN-001 without adding production authority.
- [ ] Run bun test tests/openspec-authority.test.ts and require RED from the old
  authority lock.
- [ ] Update the hashes from the committed ledger, add the OpenSpec overlay, and
  mark old multi-user P0 prose as superseded rather than deleting history.
- [ ] Run bun test tests/openspec-authority.test.ts, bun run openspec:validate,
  and bun run quality:authority; require exit 0.
- [ ] Commit: docs: bind personal portable installer authority.

### Task 1: Define portable lifecycle command contracts

**Files:**
- Create: src/setup/personal-portable.ts
- Create: tests/personal-portable.test.ts
- Modify: src/cli.ts
- Modify: tests/cli.test.ts

- [ ] Write RED tests for portable plan/install/upgrade/rollback/uninstall/
  reinstall/doctor actions, explicit archive/SHA, current-user defaults, dry-run,
  stable error codes, default data preservation, and purge rejection.
- [ ] Run bun test tests/personal-portable.test.ts tests/cli.test.ts; require RED
  because the portable command is absent.
- [ ] Implement pure argument parsing and PersonalPortablePlan values that call no
  filesystem/process/network APIs.
- [ ] Wire chat2codex portable ACTION with JSON and human output; unknown actions,
  missing archive/hash, relative/reparse paths, and purge without confirmation
  fail before mutation.
- [ ] Run focused tests and bun run typecheck; require pass.
- [ ] Commit: feat: define personal portable lifecycle commands.

### Task 2: Add the one-command PowerShell bootstrap

**Files:**
- Create: scripts/chat2codex-personal.ps1
- Create: tests/personal-bootstrap.test.ts
- Modify: package.json
- Modify: tests/distribution-package.test.ts

- [ ] Write RED tests that PowerShell AST exposes Install, Upgrade, Rollback,
  Uninstall, Reinstall, and Doctor; verifies SHA-256 before npm; derives paths from
  LOCALAPPDATA/APPDATA/USERPROFILE; never embeds username, drive, repository,
  production path, token, prompt, or SID.
- [ ] Write RED subprocess fixtures for missing Node, npm, Codex CLI, Desktop,
  archive, hash mismatch, and noncanonical install root. Expected output is one
  stable code plus safe remediation and exit nonzero.
- [ ] Run bun test tests/personal-bootstrap.test.ts tests/distribution-package.test.ts;
  require RED.
- [ ] Implement the thin bootstrap. It detects external prerequisites but does not
  silently download them. It invokes only the installed reviewed CLI with an
  argument array and never uses Invoke-Expression.
- [ ] Pack/extract and prove the script is present and byte-identical.
- [ ] Commit: feat: add one-command personal Windows bootstrap.

### Task 3: Compose transactional install and upgrade

**Files:**
- Modify: src/setup/personal-portable.ts
- Modify: src/setup/windows-service.ts
- Modify: src/setup/windows-lifecycle.ts
- Create: src/setup/portable-receipt.ts
- Create: tests/portable-install.test.ts

- [ ] Write RED injected-I/O tests for archive verification, prerequisite
  snapshot, quiescent obligations, backup receipt, private npm prefix install,
  managed env merge, key creation, task registration last, doctor, and commit.
- [ ] Add one RED case after every mutation boundary and prove reverse rollback
  restores exact prior package/config/state/task hashes.
- [ ] Run bun test tests/portable-install.test.ts; require RED.
- [ ] Implement a schema-1 durable receipt with canonical owned paths, hashes,
  completed operations, and rollback status; never store secrets.
- [ ] Compose existing installWindowsUserTask, state migration, and doctor rather
  than duplicating their logic.
- [ ] Run focused lifecycle/service/state tests and typecheck.
- [ ] Commit: feat: transact personal install and upgrade.

### Task 4: Compose rollback, uninstall, and reinstall

**Files:**
- Modify: src/setup/personal-portable.ts
- Modify: src/setup/portable-receipt.ts
- Create: tests/portable-rollback.test.ts

- [ ] Write RED tests for named receipt selection, hash drift, active obligations,
  incompatible schema, exact old task restore, old doctor, double uninstall,
  preserved state/credentials/deliverables/backups, and fresh key rotation after
  reinstall.
- [ ] Run bun test tests/portable-rollback.test.ts; require RED.
- [ ] Implement rollback and uninstall from manifest/receipt ownership only.
  Unknown files are never removed; purge remains a separate confirmed action.
- [ ] Run focused tests and a disposable private-prefix lifecycle twice.
- [ ] Commit: feat: rollback and remove personal installations safely.

### Task 5: Complete dependency and personal doctor diagnostics

**Files:**
- Modify: src/setup/distribution-doctor.ts
- Modify: src/setup/windows-distribution-inspector.ts
- Modify: src/cli.ts
- Modify: tests/distribution-doctor.test.ts
- Modify: tests/cli.test.ts

- [ ] Write RED checks for Windows/architecture, PowerShell, Node/npm engines,
  Codex CLI, Desktop, Weixin readiness, package/manifest/schema, one writer/lock,
  loopback, three key roles/current-user ACL/distinctness, Hook/MCP hashes, and
  pending rollback receipt.
- [ ] Verify every error has what_happened, safe_state, next_action and contains no
  credential, prompt, identity, SID, or absolute path.
- [ ] Run focused tests; require RED for the new checks.
- [ ] Implement read-only inspectors and stable recovery codes.
- [ ] Run focused tests, typecheck, and secret/path scans.
- [ ] Commit: feat: diagnose personal portable installations.

### Task 6: Align package and CI with personal P0 evidence

**Files:**
- Modify: package.json
- Modify: distribution/release-manifest.json
- Modify: scripts/verify-distribution-package.mjs
- Modify: .github/workflows/windows-quality.yml
- Modify: tests/distribution-package.test.ts
- Modify: tests/novice-docs.test.ts
- Create: docs/superpowers/verification/personal-native-hosted-evidence.md

- [ ] Write RED tests that the bootstrap/controller/docs are packaged, developer
  paths/secrets are rejected, hosted native lifecycle is always-published
  non-blocking diagnostic, final full repository and clean-package jobs remain
  blocking, and no timeout/skip is added.
- [ ] Run focused tests; require RED.
- [ ] Implement workflow separation. Preserve hosted failures including run
  30836801914, but do not let DIST-HARDEN-001 determine personal P0.
- [ ] Run the full workflow parser tests and quality distribution verifier.
- [ ] Commit: ci: align Windows gates with personal portable scope.

### Task 7: Freeze the .18 candidate and final full Windows CI

**Files:**
- Modify: the eight existing version/hash binding files identified by
  tests/novice-docs.test.ts and distribution tests
- Create: docs/superpowers/verification/personal-portable-candidate.md

- [ ] Bump to 0.8.0-novice.18 only after Tasks 0–6 are green.
- [ ] Build two independent detached clean archives with Node 24 and Bun 1.3.9;
  require byte-identical size/file count/SHA-256.
- [ ] Bind workflow expected version/hash and build a third archive; require exact
  equality and extracted package verifier pass.
- [ ] Run one final full Windows CI; require repository, package, old-version
  upgrade, clean-package, audit, and zero-residual proof green. Hosted hardening
  diagnostic may be red only in its explicitly nonblocking evidence job.
- [ ] Commit: build: freeze personal portable candidate.

### Task 8: Execute clean personal Windows DIST-003

**Files:**
- Modify: scripts/novice-clean-windows-attestation.mjs
- Modify: scripts/run-novice-acceptance.mjs
- Modify: scripts/verify-novice-evidence.mjs
- Modify: tests/novice-isolation.test.ts
- Create: docs/superpowers/verification/personal-clean-windows-evidence.json

- [ ] Run from a fresh personal Windows profile with no repository/package/state/
  secrets/trust. Record archive/version/hash and prerequisite versions.
- [ ] Execute bootstrap Install twice, setup weixin, doctor, start/stop/restart,
  Upgrade twice, Rollback, Uninstall twice, Reinstall, and final Uninstall.
- [ ] Execute 30 table-driven mock daily-use repetitions and fault injection with
  zero fail/skip/leak/residual.
- [ ] Under existing real-action authority, install Hook/MCP, restart Desktop,
  execute seven primitives, and run authorized real E2E to Haoda only.
- [ ] Record commands, hashes, results and zero residuals; run the evidence
  verifier. Commit only redacted evidence.

### Task 9: Deploy to production with rollback

**Files:**
- Modify: deployment packet under docs/superpowers/verification
- Modify: requirements CURRENT only after direct evidence

- [ ] Read-only revalidate .4 production writer/lock/state/env/task identities and
  zero active obligations.
- [ ] Diagnose the prior .17 launch failure using preserved logs and reproduce its
  cause in a disposable root before mutation.
- [ ] Back up and hash package/config/state/task, install exact .18, migrate to v6,
  start one writer/Gateway, run doctor and obligation/hash checks.
- [ ] On any failed gate restore exact .4 bytes/task/state and prove one old writer.
- [ ] Preserve the deployment report, rollback report, versions, hashes, and
  process creation identities.

### Task 10: Complete current-machine Hook/MCP and Desktop primitives

**Files:**
- Modify: docs/superpowers/verification installed evidence only

- [ ] Generate/install three fresh current-user owner-only keys and exact
  hash-trusted Hook/MCP files in the real Codex Home.
- [ ] Restart Desktop, verify exact root binding and authenticated reconnect.
- [ ] Execute status/reconnect, fail-closed prompt, takeover/release, Stop wake,
  authoritative thread/read, idempotent mirroring/high-water recovery, and
  unbound-child exclusion.
- [ ] Record screenshots/timestamps/redacted envelopes/generations/outbox hashes
  and zero unexpected turns/deliveries.

### Task 11: Complete authorized real-Weixin E2E

**Files:**
- Modify: docs/superpowers/verification real E2E evidence only

- [ ] Revalidate Haoda's currently bound Chat2Codex test conversation and fail
  closed on uncertain identity.
- [ ] Send only acceptance messages prefixed with the approved automatic-test
  marker until final completion.
- [ ] Prove inbound/outbound text, image, file, exact order/hash, retry, network
  loss, restart, duplicate suppression, and no Codex rerun.
- [ ] Prove multi-task/workspace/Plan/approval/structured input and child no-send.

### Task 12: Final matrix and completion

**Files:**
- Modify: requirements ledger acceptance-matrix.md
- Modify: requirements ledger CURRENT.md
- Modify: clean-Windows debugging retrospective and evidence indices

- [ ] Independently map every accepted P0 row to direct current evidence. Keep any
  uncertain row incomplete.
- [ ] Verify production one writer, no pending obligations, package/hash/version,
  Desktop seven primitives, real-Weixin media/retry/dedup, clean Windows, and zero
  residuals.
- [ ] Update ledger and commit evidence indices without rewriting history.
- [ ] Only when every row passes, send exactly: codex连接微信成功，请试用
- [ ] Verify send success, then mark the Goal complete.

## Self-review

- CR-0010 and ADR-0006 are represented without deleting CR-0006 history.
- Current-user owner-only ACL, keys, authentication, redaction, one writer,
  thread binding, idempotency, and child exclusion remain P0.
- DIST-HARDEN-001 is retained as P1 and its evidence is not discarded.
- No implementation step uses a mock to close real Desktop/Weixin/DIST-003 rows.
- No step extends timeout, skips a blocking P0 gate, or purges user data by
  default.
- The final message and Goal completion remain behind full direct-evidence audit.
