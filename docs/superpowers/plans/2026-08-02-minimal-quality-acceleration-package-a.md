# Minimal Quality Acceleration Package A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-local OpenSpec authority overlay, fail-closed evidence manifests, Windows ACL/process checks, and a Windows CI reporting gate without changing Chat2Codex product behavior or any external system.

**Architecture:** Package A is an interface-free quality layer on integration commit `969c5ae`. OpenSpec is an exact local development dependency invoked through a Node-version and no-telemetry wrapper. Custom validators keep the requirements ledger authoritative and keep automated evidence below installed/real-E2E evidence. Windows CI reuses the existing PID-plus-creation-time shard wrapper and adds read-only ACL inspection over disposable files.

**Tech Stack:** TypeScript/Bun tests, Node.js ESM scripts, OpenSpec `1.7.0`, JSON Schema, PowerShell read-only ACL queries, GitHub Actions `windows-latest`.

**Authority:** Requirements ledger commit `07603ee`; approved design commit `cc50609`. Never read or replay damaged task `019fc002-590e-7023-b7e5-2a802168f00a`.

---

## File map

### Repository governance and local OpenSpec

- Create `AGENTS.md`: repository-local authority, safety, and workflow rules.
- Modify `package.json`: exact local OpenSpec dependency and quality scripts.
- Modify `bun.lock`: lock exact dependency graph.
- Create `scripts/run-local-openspec.mjs`: Node `>=20.19.0`, exact project-local CLI, telemetry/update disabled, no init/update/archive.
- Create `quality/authority/requirements-ledger.json`: non-authoritative lock of ledger commit, file hashes, accepted CRs, and requirement IDs.
- Create `openspec/config.yaml`: brownfield project context and ledger precedence.
- Create `openspec/changes/minimal-quality-acceleration/.openspec.yaml`: `spec-driven` schema selection.
- Create the four OpenSpec artifacts under `openspec/changes/minimal-quality-acceleration/`.
- Create `scripts/verify-openspec-authority.mjs`: closed metadata and lock validator.
- Create `tests/openspec-authority.test.ts`: adversarial authority and local-wrapper tests.

### Evidence closure

- Create `quality/evidence/schema.json`: closed manifest schema.
- Create `quality/evidence/phase3-preinstall.json`: explicit unproven installed/real rows plus hashed automated evidence.
- Create `scripts/verify-quality-evidence.mjs`: schema, artifact, hash, redaction, and promotion validator.
- Create `tests/quality-evidence.test.ts`: adversarial manifest tests.

### Windows and runbook

- Create `scripts/assert-private-windows-file.mjs`: read-only ACL inspector and pure ACL policy.
- Create `tests/windows-security.test.ts`: synthetic policy tests everywhere and native disposable-file tests on Windows.
- Create `.github/workflows/windows-ci.yml`: pinned Windows reporting gate and JSON artifacts.
- Create `tests/windows-workflow.test.ts`: static workflow safety/version/shard assertions.
- Create `docs/quality/weixin-e2e-runbook.md`: evidence procedure with separate approval stops.
- Modify `tests/architecture-boundaries.test.ts`: prevent quality scripts from gaining product/external-action capabilities.

---

### Task 1: Freeze ledger authority and RED tests

**Files:**
- Create: `quality/authority/requirements-ledger.json`
- Create: `tests/openspec-authority.test.ts`

- [ ] **Step 1: Re-read the live ledger and calculate provenance**

Run read-only commands in `.worktrees/requirements-ledger`:

```powershell
git rev-parse HEAD
Get-FileHash docs/requirements/baselines/v1.0.0.md -Algorithm SHA256
Get-FileHash docs/requirements/acceptance-matrix.md -Algorithm SHA256
Get-FileHash docs/requirements/CURRENT.md -Algorithm SHA256
Get-ChildItem docs/requirements/changes/*.md | Get-FileHash -Algorithm SHA256
Get-ChildItem docs/requirements/adr/*.md | Get-FileHash -Algorithm SHA256
```

Expected: HEAD `07603ee8ddd38546aca003ff7be8370aa9a51203`; no file mutation. If HEAD differs, stop and reconcile the approved design before implementation.

- [ ] **Step 2: Create the non-authoritative lock**

Write schema version 1, the full authority commit, relative file/hash entries, accepted CR IDs (`CR-0001`, `CR-0002`, `CR-0004`, `CR-0005`), and the closed requirement-ID list from the acceptance matrix. Include `authoritative: false` and a note that the source ledger always wins.

- [ ] **Step 3: Write authority RED tests**

Tests must execute the not-yet-created validator against temporary change trees and require rejection for:

- missing metadata;
- unknown requirement ID;
- wrong authority commit/repository;
- `productionAuthorized: true`;
- `realExternalActionsAuthorized: true`;
- an authority claim for OpenSpec;
- a reference to the prohibited damaged task;
- mismatched change names across proposal/spec/design/tasks;
- unknown fields in metadata or lock; and
- a lock claiming `authoritative: true`.

The valid fixture must cite `07603ee`, known `OPS-001`, `OPS-003`, and `OPS-004`, and contain all four artifacts.

- [ ] **Step 4: Run RED**

```powershell
bun test tests/openspec-authority.test.ts
```

Expected: FAIL because `scripts/verify-openspec-authority.mjs` and/or its exports do not exist. Record the exact failure.

---

### Task 2: Implement the thin OpenSpec overlay

**Files:**
- Create: `AGENTS.md`
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `scripts/run-local-openspec.mjs`
- Create: `scripts/verify-openspec-authority.mjs`
- Create: `openspec/config.yaml`
- Create: `openspec/changes/minimal-quality-acceleration/.openspec.yaml`
- Create: `openspec/changes/minimal-quality-acceleration/proposal.md`
- Create: `openspec/changes/minimal-quality-acceleration/specs/quality-gates/spec.md`
- Create: `openspec/changes/minimal-quality-acceleration/design.md`
- Create: `openspec/changes/minimal-quality-acceleration/tasks.md`

- [ ] **Step 1: Add the exact local dependency**

With bundled Node 24 prepended only for the command process:

```powershell
bun add --dev --exact @fission-ai/openspec@1.7.0
```

Expected: only `package.json` and `bun.lock` change; no global package and no user-home files.

- [ ] **Step 2: Add local scripts**

Add scripts equivalent to:

```json
{
  "openspec:validate": "node scripts/run-local-openspec.mjs validate --all --strict --no-color",
  "quality:authority": "node scripts/verify-openspec-authority.mjs",
  "quality:evidence": "node scripts/verify-quality-evidence.mjs quality/evidence/phase3-preinstall.json",
  "quality:windows": "bun test tests/windows-security.test.ts tests/process-identity.test.ts tests/shard-wrapper.test.ts tests/windows-workflow.test.ts",
  "quality:check": "bun run openspec:validate && bun run quality:authority && bun run quality:evidence"
}
```

Do not add `init`, `update`, `archive`, deploy, restart, or external-send scripts.

- [ ] **Step 3: Implement the local wrapper**

The wrapper must:

- reject Node `<20.19.0`;
- resolve `node_modules/@fission-ai/openspec/bin/openspec.js` beneath the repository root;
- reject mutating top-level commands `init`, `update`, `archive`, `store`, `config`, `schema`, `completion`, and `feedback`;
- allow only read/validate commands needed by Package A;
- inject `OPENSPEC_TELEMETRY=0`, `OPENSPEC_NO_UPDATE_CHECK=1`, `DO_NOT_TRACK=1`, and `NO_COLOR=1`; and
- forward exit status without invoking a shell.

- [ ] **Step 4: Implement the authority validator**

Export a pure `validateOpenSpecAuthority` plus CLI entry. Parse one fixed HTML-comment metadata block from every artifact, reject unknown/missing fields, compare with the lock, scan forbidden authority/production/external-action claims, and require consistent change identity. Do not access the network or any path outside the repository.

- [ ] **Step 5: Add repository guidance and OpenSpec artifacts**

`AGENTS.md` must state ledger precedence, Superpowers execution ownership, damaged-task prohibition, no global install/init, and separate approval gates. The change artifacts must describe only Package A and use OpenSpec ADDED Requirement/Scenario syntax. `tasks.md` mirrors this approved plan and is not independently authoritative.

- [ ] **Step 6: Run GREEN and official OpenSpec validation**

```powershell
bun test tests/openspec-authority.test.ts
bun run quality:authority
bun run openspec:validate
```

Expected: all tests pass; OpenSpec reports the change valid; no user-home or global writes.

- [ ] **Step 7: Commit**

```powershell
git add AGENTS.md package.json bun.lock scripts/run-local-openspec.mjs scripts/verify-openspec-authority.mjs quality/authority openspec tests/openspec-authority.test.ts
git diff --cached --check
git commit -m "feat: add ledger-bound OpenSpec overlay"
```

---

### Task 3: RED-test the evidence manifest

**Files:**
- Create: `quality/evidence/schema.json`
- Create: `quality/evidence/phase3-preinstall.json`
- Create: `tests/quality-evidence.test.ts`

- [ ] **Step 1: Define a closed manifest fixture**

Use schema version 1 with top-level `manifestId`, `authorityCommit`, `repositoryCommit`, `generatedAt`, `targets`, and `evidence`. Targets contain `id`, `requiredLevel`, `verdict`, and `evidenceIds`. Evidence contains every field required by design section 6.1.

- [ ] **Step 2: Write adversarial RED tests**

Require rejection for:

- unknown top-level, target, evidence, count, version, or artifact fields;
- future schema version;
- duplicate target/evidence IDs or dangling evidence references;
- unknown evidence level/outcome/verdict;
- a passing evidence item with non-zero failures, timeouts, or residuals;
- `automated` evidence promoting an `installed_behavior` or `real_e2e` target;
- missing/non-regular/symlink/outside-root artifact;
- wrong SHA-256;
- invalid commit/timestamp/version/count;
- dirty evidence claimed as a clean release pass; and
- secret, raw-prompt, credential, sender, token, or private-path shaped notes.

Require acceptance for unproven Desktop/real-Weixin targets with no evidence and for one exact automated artifact whose hash matches.

- [ ] **Step 3: Run RED**

```powershell
bun test tests/quality-evidence.test.ts
```

Expected: FAIL because `scripts/verify-quality-evidence.mjs` does not exist.

---

### Task 4: Implement fail-closed evidence verification

**Files:**
- Create: `scripts/verify-quality-evidence.mjs`
- Complete: `quality/evidence/schema.json`
- Complete: `quality/evidence/phase3-preinstall.json`
- Complete: `tests/quality-evidence.test.ts`

- [ ] **Step 1: Implement pure validation**

Export `validateEvidenceManifest(value, options)` with closed-key helpers, level ranking, ID uniqueness, count invariants, secret-pattern checks, and safe relative artifact resolution. Reject symlinks before reading and compare lowercase SHA-256 over exact bytes.

- [ ] **Step 2: Implement the CLI**

Resolve the manifest relative to the repository, reject absolute/outside-root/symlink input, read JSON, call the pure validator, print only bounded IDs/counts, and exit non-zero on any validation error. Never print artifact contents or notes.

- [ ] **Step 3: Write the preinstall index**

Include `DESKTOP-001..003` and real Weixin rows as `unproven` with their required levels. Include only current automated evidence whose artifact exists and whose hash is calculated from the checked-in file. Do not mark any installed or real row passing.

- [ ] **Step 4: Run GREEN**

```powershell
bun test tests/quality-evidence.test.ts
bun run quality:evidence
```

Expected: all tests pass and CLI reports a valid manifest without content leakage.

- [ ] **Step 5: Commit**

```powershell
git add quality/evidence scripts/verify-quality-evidence.mjs tests/quality-evidence.test.ts package.json
git diff --cached --check
git commit -m "test: enforce evidence level integrity"
```

---

### Task 5: RED-test Windows ACL and workflow safety

**Files:**
- Create: `tests/windows-security.test.ts`
- Create: `tests/windows-workflow.test.ts`
- Modify: `tests/architecture-boundaries.test.ts`

- [ ] **Step 1: Write pure ACL-policy RED tests**

Synthetic fixtures must accept only allow ACEs for the current owner SID, SYSTEM, and Administrators with no broad inherited read. Reject Everyone, Authenticated Users, Builtin Users, unknown SIDs, deny/allow ambiguity, missing owner, malformed rights, and unparsable output.

- [ ] **Step 2: Write native Windows RED tests**

On Windows, create a disposable regular file, protect its ACL in the test fixture, grant only the current user/SYSTEM/Administrators, and require the inspector to accept it. Create another disposable file with an Everyone read ACE and require rejection. The inspector itself must perform no ACL mutation. On non-Windows, explicitly skip only the native cases.

- [ ] **Step 3: Write workflow RED tests**

Static tests require `windows-latest`, Node 24, Bun 1.3.9, frozen install, least privilege, `quality:check`, full check wrapper, eight router shards, Windows security tests, always-uploaded JSON artifacts, bounded timeouts/retention, and no production/Desktop/Hook/Weixin commands or paths.

- [ ] **Step 4: Extend architecture boundary RED**

Assert quality scripts do not import product adapters/router/runtime, cannot call deployment/setup functions, and do not contain network, global install, `openspec init/update/archive`, production path, Desktop operation, or real-send capability.

- [ ] **Step 5: Run RED**

```powershell
bun test tests/windows-security.test.ts tests/windows-workflow.test.ts tests/architecture-boundaries.test.ts
```

Expected: FAIL because ACL script and Windows workflow do not exist.

---

### Task 6: Implement Windows checks and reporting workflow

**Files:**
- Create: `scripts/assert-private-windows-file.mjs`
- Create: `.github/workflows/windows-ci.yml`
- Complete: `tests/windows-security.test.ts`
- Complete: `tests/windows-workflow.test.ts`
- Complete: `tests/architecture-boundaries.test.ts`

- [ ] **Step 1: Implement the pure ACL policy and read-only inspector**

The pure policy accepts structured `{ ownerSid, currentUserSid, aces }`. The CLI accepts exactly one absolute path, rejects missing/non-regular/symlink files, invokes `powershell.exe -NoProfile -NonInteractive` with a fixed code-owned script, parses bounded JSON, applies the policy, and prints only a redacted decision. It never invokes `Set-Acl`, `icacls`, or any mutating command.

- [ ] **Step 2: Implement Windows CI**

Use `actions/checkout@v7`, `actions/setup-node@v7` with Node 24, `oven-sh/setup-bun@v2` with Bun 1.3.9, and `actions/upload-artifact@v4`. Run `bun install --frozen-lockfile`, `bun run quality:check`, the full `bun run check` through `run-test-shard.mjs`, generate eight shards, execute each shard through the wrapper, and run `quality:windows`. Upload only `.tmp/quality-evidence/*.json` with `if: always()` and bounded retention.

- [ ] **Step 3: Run GREEN and wrapper regressions**

```powershell
bun test tests/windows-security.test.ts tests/windows-workflow.test.ts tests/architecture-boundaries.test.ts tests/process-identity.test.ts tests/shard-wrapper.test.ts
bun run quality:windows
```

Expected: all applicable tests pass, native ACL negatives fail closed, wrapper still leaves zero residual identities.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/windows-ci.yml scripts/assert-private-windows-file.mjs tests/windows-security.test.ts tests/windows-workflow.test.ts tests/architecture-boundaries.test.ts package.json
git diff --cached --check
git commit -m "ci: add auditable Windows quality gate"
```

---

### Task 7: Document the gated real-E2E procedure

**Files:**
- Create: `docs/quality/weixin-e2e-runbook.md`
- Modify: `tests/windows-workflow.test.ts` or create focused documentation assertions in `tests/quality-evidence.test.ts`

- [ ] **Step 1: Write documentation RED assertions**

Require the runbook to distinguish repository automation, production read-only health, production write/restart, `~/.codex`/Hook/MCP, Desktop/Computer Use, and each real-Weixin send. Require fresh handles, UTC/local timestamps, redacted screenshots/transcripts, state/process/hash/order/dedup/rollback evidence, and explicit statements that CI/static/schema evidence cannot pass real E2E.

- [ ] **Step 2: Run RED**

```powershell
bun test tests/quality-evidence.test.ts --test-name-pattern "runbook"
```

Expected: FAIL because the runbook does not exist.

- [ ] **Step 3: Write the runbook**

Every mutable or external section begins with a separate approval stop. Include no credentials, production commands that mutate state, current handles, or pre-authorized message content. Provide evidence templates and abort conditions only.

- [ ] **Step 4: Run GREEN**

```powershell
bun test tests/quality-evidence.test.ts --test-name-pattern "runbook"
```

- [ ] **Step 5: Commit**

```powershell
git add docs/quality/weixin-e2e-runbook.md tests/quality-evidence.test.ts
git diff --cached --check
git commit -m "docs: define evidence-gated Weixin acceptance"
```

---

### Task 8: Package A release gate and review

**Files:**
- Create: `docs/superpowers/verification/2026-08-02-minimal-quality-acceleration-package-a.md`
- Update: `openspec/changes/minimal-quality-acceleration/tasks.md` only to reflect completed Package A checkboxes

- [ ] **Step 1: Run focused repeat tests**

Run authority, evidence, workflow, ACL/policy, process identity, and shard wrapper tests three times. Expected: zero failures/timeouts/residual identities; exact counts recorded.

- [ ] **Step 2: Run local OpenSpec and quality gates**

```powershell
bun run openspec:validate
bun run quality:authority
bun run quality:evidence
bun run quality:check
```

Expected: every command exits 0 under bundled Node 24.

- [ ] **Step 3: Run full repository verification**

```powershell
$env:PATH='C:/Users/dada/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin;'+$env:PATH
bun run check
$env:npm_config_registry='https://registry.npmjs.org'
bun audit
bun pm pack --dry-run
git diff --check
git status --short
```

Expected: typecheck/contracts/all tests/build exit 0, no audit vulnerability, expected package files only, and no unintended changes.

- [ ] **Step 4: Verify boundaries and absence of side effects**

Inspect Git diff and process/user-home state. Prove no global OpenSpec install, no `~/.codex` changes, no production path changes, no Desktop/Computer Use, and no Weixin send. Scan tracked changes for credentials and forbidden task references, allowing the prohibited ID only in explicit rejection rules/documentation.

- [ ] **Step 5: Write verification evidence**

Record exact commits, versions, commands, counts, skips, hashes, and limitations. Mark Windows GitHub-hosted execution as pending until the workflow runs remotely; do not claim it from static YAML tests. Keep installed and real-E2E rows unproven.

- [ ] **Step 6: Specification review then code-quality review**

Review every design acceptance row against the diff and fresh evidence. Resolve all findings before continuing. Reviewers must not edit files.

- [ ] **Step 7: Commit release evidence**

```powershell
git add docs/superpowers/verification/2026-08-02-minimal-quality-acceleration-package-a.md openspec/changes/minimal-quality-acceleration/tasks.md
git diff --cached --check
git commit -m "test: verify minimal quality acceleration foundation"
```

Package A is complete only when all repository-local evidence passes. The remote Windows workflow remains a separately observed proof after branch publication; Package B remains pending until Phase 3 Tasks 1–4 merge.
