# Reusable Windows Distribution Implementation Plan

> Scope update (2026-08-04): accepted CR-0010 and ADR-0006 supersede the
> same-machine multi-user P0 interpretation. Continue P0 through
> `docs/superpowers/plans/2026-08-04-personal-portable-installer.md`; retain this
> plan and its evidence as historical implementation provenance.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 3 npm candidate into a path-neutral, versioned Windows
distribution with a tested current-user Scheduled Task lifecycle, generated
owner-only Gateway keys, expanded doctor, portable package contract, and an
evidence-ready clean-Windows runbook.

**Architecture:** Pure renderers and planners own task XML, launcher, managed env,
manifest, key specifications, and doctor decisions. A narrow injected Windows
executor performs native writes/ACL/task commands only when the CLI is explicitly
invoked; repository tests use fakes and disposable files. Installation is a
fail-closed transaction that registers the task last and preserves user data on
uninstall.

**Tech Stack:** TypeScript 7, Node.js 20+, Bun tests/package manager, PowerShell
5.1/.NET ACL APIs, Windows Task Scheduler (`schtasks.exe`), Zod/JSON manifests,
existing state-v6 and Phase 3 Gateway contracts.

**Authority:** Requirements ledger `21a5800`; design `2a1c740`. Never read or
replay damaged task `019fc002-590e-7023-b7e5-2a802168f00a`. Task 12, production,
real `~/.codex`, Hook trust/install, Desktop restart, Computer Use, real Weixin,
and irreversible external actions remain excluded.

---

### Task 0: Refresh the project-local authority overlay

**Files:**
- Modify: `quality/authority/requirements-ledger.json`
- Modify: `scripts/verify-openspec-authority.mjs`
- Modify: `tests/openspec-authority.test.ts`
- Modify: `openspec/changes/minimal-quality-acceleration/{proposal,design,tasks}.md`
- Modify: `openspec/changes/minimal-quality-acceleration/specs/quality-gates/spec.md`
- Create: `openspec/changes/reusable-windows-distribution/proposal.md`
- Create: `openspec/changes/reusable-windows-distribution/design.md`
- Create: `openspec/changes/reusable-windows-distribution/tasks.md`
- Create: `openspec/changes/reusable-windows-distribution/specs/distribution/spec.md`

- [ ] **Step 1: Write RED authority tests.**

Add tests requiring ledger commit `21a5800`, accepted CR-0006/CR-0007,
`DIST-001..003`, exact new ledger hashes, and validation of every directory below
`openspec/changes` rather than one hard-coded change. Keep rejection coverage for
authority inflation, production/external authorization, unknown IDs, and the
damaged task identifier.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/openspec-authority.test.ts`

Expected: FAIL because the lock and validator still name `07603ee` and omit
`DIST-*`.

- [ ] **Step 3: Refresh the non-authoritative lock and artifacts.**

Compute SHA-256 from the committed ledger worktree at `21a5800`. Add the four
reusable-distribution artifacts with metadata:

```json
{
  "changeName": "reusable-windows-distribution",
  "authorityCommit": "21a5800c4d725375af256a1e1c827bab75c3f034",
  "requirementIds": ["DIST-001", "DIST-002", "DIST-003"],
  "acceptedBy": "Haoda",
  "productionAuthorized": false,
  "realExternalActionsAuthorized": false
}
```

Generalize the validator main function to enumerate bounded direct child change
directories and return one result per complete change.

- [ ] **Step 4: Prove GREEN and validate OpenSpec.**

Run: `bun test tests/openspec-authority.test.ts && bun run openspec:validate && bun run quality:authority`

Expected: all tests pass; both changes validate; authority remains explicitly
non-authoritative.

- [ ] **Step 5: Commit.**

Commit: `docs: bind distribution overlay to accepted requirements`

### Task 1: Add the Windows Scheduled Task rendering contract

**Files:**
- Modify: `src/setup/service.ts`
- Modify: `tests/service-setup.test.ts`
- Create: `src/setup/windows-task.ts`
- Create: `tests/windows-task.test.ts`

- [ ] **Step 1: Write RED renderer/platform tests.**

Require `defaultServiceTarget("win32") === "windows-task"`, exact current-user
task XML, least privilege, logon trigger, no overlap, bounded restart policy,
unlimited execution time, and a PowerShell action that references only an absolute
launcher. Reject relative/control-character paths and unsafe task names.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/service-setup.test.ts tests/windows-task.test.ts`

Expected: FAIL because `windows-task` is not a service target.

- [ ] **Step 3: Implement pure renderers.**

Export:

```typescript
export interface WindowsTaskDefinition {
  taskName: string; userSid: string; launcherPath: string;
}
export function renderWindowsTaskXml(input: WindowsTaskDefinition): string;
export function renderWindowsLauncher(input: {
  nodeBin: string; entrypoint: string; envFile: string; logFile: string; pathEnv: string;
}): string;
```

Use XML escaping and one PowerShell single-quote encoder. Add
`windowsTaskName`/`windowsLauncherPath` to `ServiceOptions`; preserve existing
launchd/systemd output.

- [ ] **Step 4: Prove GREEN.**

Run the focused tests and `bun run typecheck`. Expected: pass.

- [ ] **Step 5: Commit.**

Commit: `feat: render a portable Windows user task`

### Task 2: Generate distinct owner-only Gateway keys

**Files:**
- Create: `src/setup/windows-private-files.ts`
- Create: `tests/windows-private-files.test.ts`
- Modify: `src/desktop-gateway/server.ts` only to reuse shared ACL types/checks if
  needed without weakening validation
- Modify: `tests/windows-security.test.ts`

- [ ] **Step 1: Write RED key/ACL tests.**

Require three distinct 32-byte keys, exact base64url files, no key bytes in argv or
result objects, existing valid keys preserved, symlink/malformed/duplicate/wrong
ACL rejected, and new files removed after verification failure. Native Windows
tests operate only under a fresh temp directory and confirm broad SID denial.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/windows-private-files.test.ts tests/windows-security.test.ts`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement the injected writer.**

Export a pure plan plus executor:

```typescript
export const gatewayKeyRoles = ["prompt-hook", "stop-hook", "desktop-mcp"] as const;
export async function ensureWindowsGatewayKeys(options: {
  root: string; randomBytes?: (size: number) => Buffer;
  applyAcl: (path: string) => Promise<void>;
  inspectAcl: (path: string) => Promise<unknown>;
}): Promise<{ created: string[]; preserved: string[]; paths: Record<string,string> }>;
```

Use create-exclusive writes, canonical non-reparse parents, buffer zeroing, .NET
ACL PowerShell with path in an environment variable, and the existing independent
read-only ACL validator.

- [ ] **Step 4: Prove GREEN and native disposable behavior.**

Run the focused tests and typecheck. Expected: pass without touching user config.

- [ ] **Step 5: Commit.**

Commit: `feat: create scoped Windows Gateway keys`

### Task 3: Add managed env, install manifest, and transaction planning

**Files:**
- Create: `src/setup/windows-lifecycle.ts`
- Create: `tests/windows-lifecycle.test.ts`
- Create: `tests/fixtures/windows-installation-v1.json`

- [ ] **Step 1: Write RED pure lifecycle tests.**

Cover exact managed block replacement, preservation of user-authored lines,
canonical owned paths, manifest schema/unknown fields, install idempotency, upgrade
preservation, task registration last, failure rollback order, uninstall owned-file
scope, and user data/log/config preservation.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/windows-lifecycle.test.ts`

Expected: FAIL because lifecycle planning does not exist.

- [ ] **Step 3: Implement pure manifest and transaction APIs.**

```typescript
export interface WindowsInstallationManifestV1 {
  schemaVersion: 1; packageVersion: string; taskName: string; userSid: string;
  launcherPath: string; envFile: string; keyFiles: string[]; ownedFiles: string[];
  hashes: Record<string,string>; installedAt: string;
}
export function replaceManagedEnvBlock(source: string, values: Record<string,string>): string;
export function planWindowsInstall(input: WindowsInstallInput): WindowsLifecycleOperation[];
export function planWindowsUninstall(manifest: WindowsInstallationManifestV1): WindowsLifecycleOperation[];
```

Unknown manifest fields and paths outside the selected home fail closed.

- [ ] **Step 4: Prove GREEN.**

Run focused tests and typecheck. Expected: pass.

- [ ] **Step 5: Commit.**

Commit: `feat: plan transactional Windows lifecycle`

### Task 4: Wire the Windows lifecycle into `chat2codex service`

**Files:**
- Modify: `src/setup/service.ts`
- Modify: `tests/service-setup.test.ts`
- Modify: `src/cli.ts` only if exit propagation requires it
- Create: `tests/windows-service-lifecycle.test.ts`

- [ ] **Step 1: Write RED CLI/executor tests.**

Inject filesystem, ACL, current-user SID, and task command execution. Prove print is
read-only; install executes the plan, validates task query, and rolls back on every
failure boundary; uninstall unregisters exact task and preserves data. Prove native
commands are `schtasks.exe /Create ... /XML`, `/Query`, `/Run`, and `/Delete` with
no shell interpolation.

- [ ] **Step 2: Prove RED.**

Run focused tests. Expected: FAIL because service setup has no Windows executor.

- [ ] **Step 3: Implement narrow execution wiring.**

Extend `ServiceTarget`, CLI parsing/help, and `installService`/`uninstallService`.
Task mutation occurs only inside explicit service install/uninstall. Never write
`~/.codex`, install/trust Hooks, restart Desktop, or send Weixin. Return non-zero
after rollback on any failure.

- [ ] **Step 4: Prove GREEN.**

Run `bun test tests/service-setup.test.ts tests/windows-task.test.ts tests/windows-private-files.test.ts tests/windows-lifecycle.test.ts tests/windows-service-lifecycle.test.ts` and typecheck.

- [ ] **Step 5: Commit.**

Commit: `feat: install and remove the Windows user task`

### Task 5: Expand doctor with injected distribution checks

**Files:**
- Create: `src/setup/distribution-doctor.ts`
- Create: `tests/distribution-doctor.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write RED doctor tests.**

Cover supported/unsupported OS/architecture, package/manifest/state schema, absolute
executables, canonical paths/reparse negatives, task action identity, one-writer
health, three key roles/format/ACL/distinctness, loopback, Hook hashes, Desktop
availability, redaction, recovery codes, and non-zero CLI exit for errors.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/distribution-doctor.test.ts tests/cli.test.ts`

Expected: FAIL because the distribution doctor does not exist.

- [ ] **Step 3: Implement pure checks and read-only adapters.**

Return `DoctorCheck` values plus stable recovery codes; native readers may query but
never mutate Task Scheduler, ACLs, processes, Desktop, or config. Integrate results
after existing config/Codex/Weixin checks and set `process.exitCode = 1` only when
an error check exists.

- [ ] **Step 4: Prove GREEN.**

Run focused tests and typecheck. Expected: pass with no secret values in output.

- [ ] **Step 5: Commit.**

Commit: `feat: diagnose the Windows distribution`

### Task 6: Enforce the npm portability and compatibility contract

**Files:**
- Create: `distribution/release-manifest.json`
- Create: `scripts/verify-distribution-package.mjs`
- Create: `tests/distribution-package.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/phase3/installation-runbook.md`

- [ ] **Step 1: Write RED package tests.**

Pack to a temp directory and reject missing declared assets, undeclared runtime
files, machine usernames, repository/production drive paths, embedded key/private
key/token patterns, inconsistent Hook hashes, unsupported schema/version metadata,
or absent lifecycle/troubleshooting/E2E docs.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/distribution-package.test.ts`

Expected: FAIL on the four currently packed `F:/...` examples and missing release
manifest/docs.

- [ ] **Step 3: Add manifest/verifier and path-neutral examples.**

Declare the exact packaged runtime/document assets and supported matrix. Replace
developer paths with `%USERPROFILE%`, `C:/Users/<you>/...`, or explicit placeholders.
Add `quality:distribution` and include it in `release:check`/`quality:check`.

- [ ] **Step 4: Prove GREEN.**

Run package tests, `bun run quality:distribution`, pack dry-run, and secret/path
scan. Expected: 0 forbidden packaged hits.

- [ ] **Step 5: Commit.**

Commit: `build: enforce portable Windows package contents`

### Task 7: Add lifecycle, compatibility, troubleshooting, and clean E2E docs

**Files:**
- Create: `docs/windows/lifecycle.md`
- Create: `docs/windows/compatibility.md`
- Create: `docs/windows/troubleshooting.md`
- Create: `docs/quality/clean-windows-e2e-runbook.md`
- Create: `quality/evidence/clean-windows-template.json`
- Create: `tests/clean-windows-evidence.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED evidence-schema tests.**

Require redacted OS/architecture and version inventory, archive/installed hashes,
exact commands with secret redaction, approval records for each external action,
install/doctor/service/login/Desktop/seven-primitives/Weixin/upgrade/rollback/
uninstall rows, timestamps, and explicit `unproven` defaults. Reject a mock/local
run claiming `DIST-003` pass.

- [ ] **Step 2: Prove RED.**

Run: `bun test tests/clean-windows-evidence.test.ts`

Expected: FAIL because schema/template/docs are absent.

- [ ] **Step 3: Write the operational documents and validator.**

Keep every real action as an approval stop. Include exact backup/hash/rollback
fields and failure handling. The checked-in template must mark installed, Desktop,
Weixin, and clean-environment direct evidence `unproven`.

- [ ] **Step 4: Prove GREEN.**

Run evidence/package/doc tests. Expected: pass; no external action occurs.

- [ ] **Step 5: Commit.**

Commit: `docs: define clean Windows acceptance evidence`

### Task 8: Full repository and disposable Windows verification

**Files:**
- Create: `docs/superpowers/verification/reusable-windows-distribution-preinstall.md`
- Modify: `quality/evidence/phase3-preinstall.json` only if adding a new
  automated row without promoting installed/real rows

- [ ] **Step 1: Run focused native/disposable gates.**

Run all distribution tests, Windows ACL temp-file tests, typecheck/contracts/build,
OpenSpec authority, evidence validators, and `git diff --check`. No scheduled task
or real user config is created.

- [ ] **Step 2: Run full stable and exact Router shards.**

Use `scripts/run-test-shard.mjs`; require 0 failures, timeouts, or residual process
identities.

- [ ] **Step 3: Audit and pack the actual archive.**

Use official registry `bun audit`, `bun pm pack`, verify file count/size/SHA-256,
extract it, check Hook and release-manifest hashes, and run the package verifier on
the archive bytes.

- [ ] **Step 4: Write the pre-install report.**

Record exact SHA, commands/results, archive/hash, routing/escalation, rollback, and
remaining proof. State `DIST-003`, Task 12, real Desktop, production, and real
Weixin are unproven.

- [ ] **Step 5: Commit.**

Commit: `test: verify reusable Windows distribution preinstall`

### Task 9: Prepare post-09:00 approval packets without execution

**Files:**
- Create: `.tmp/approval-packets/` evidence only; never commit secrets or machine
  identifiers

- [ ] **Step 1: Prepare separate packets.**

Prepare independent, redacted packets for: clean-environment package install/task
registration; Weixin login; real `~/.codex` materialization; Hook trust; Desktop
restart; Computer Use; real Weixin sends; and production deployment. Each packet
contains target, archive/hash, commands, expected mutation, backup, rollback,
evidence, and outage.

- [ ] **Step 2: Stop before external actions.**

Do not execute or request approval before 09:00 Beijing time. Keep the Goal active.
