# Reusable Windows Distribution Design

> Scope update (2026-08-04): accepted requirements-ledger CR-0010 and ADR-0006
> supersede the P0 same-machine multi-user interpretation in this document.
> The current P0 product is the personal portable installer defined by
> docs/superpowers/specs/2026-08-04-personal-portable-installer-design.md.
> Existing other-user ACL evidence remains P1 hardening and is not deleted.

**Status:** Approved for overnight repository execution by accepted CR-0007.

**Authority:** Requirements ledger commit
`21a5800c4d725375af256a1e1c827bab75c3f034`, especially accepted CR-0006
(`DIST-001..003`) and CR-0007. This document does not authorize Task 12 or any
real external action.

## 1. Outcome and boundaries

Chat2Codex shall ship one versioned npm archive that can be installed for an
arbitrary Windows user without repository access or this computer's paths. The
package supplies a current-user service lifecycle, fresh machine-local Gateway
keys, exact ACL verification, doctor coverage, configuration and compatibility
templates, schema/rollback instructions, and a clean-Windows evidence protocol.

Repository implementation and disposable validation are in scope. The following
remain separately approval-gated and are not executed by this design: production
writes/restarts, the real user `~/.codex`, Hook installation/trust, Desktop
restart, Computer Use, real Weixin outbound, and other irreversible external
actions. A Windows installer may emit reviewed files for later `~/.codex` use but
must never copy or trust them automatically.

## 2. Options

### A. Current-user Scheduled Task (recommended)

The npm CLI creates a package-owned launcher and manifest under
`CHAT2CODEX_HOME/.service/windows`, generates three owner-only Gateway token files
under `CHAT2CODEX_HOME/.secrets/desktop-gateway`, updates only a marked managed
block in the selected `.env`, and registers one current-user Scheduled Task. The
task starts at logon, restarts on failure with bounded retries, and invokes the
absolute Node executable plus installed entrypoint through the package-owned
PowerShell launcher.

Benefits: no bundled third-party executable, no administrator requirement, exact
current-user ownership, native query/unregister support, and alignment with the
existing Windows deployment shape. Risks: Task Scheduler XML/quoting is
Windows-specific and logon tasks do not run before login. These are acceptable for
a personal Weixin/Desktop integration and are covered by rendering and disposable
tests.

### B. Third-party service wrapper

Bundle or download a service wrapper such as WinSW and install an SCM service. It
can start before login, but adds binary provenance/signing, administrator rights,
service-account ACL, upgrade, and removal obligations. It is rejected for this
release because CR-0006 does not require pre-login execution and the added supply
chain is disproportionate.

### C. Registry Run key

Register a per-user logon command. This is small but lacks native restart policy,
structured state/query, and robust single-writer lifecycle. It is rejected.

## 3. Package and compatibility contract

The npm archive is the sole release input. It contains compiled runtime files, the
configuration example, lifecycle/compatibility/troubleshooting/E2E documents,
Phase 3 inert assets, licenses, and third-party notices. It never contains a
generated key, live credential, state file, username, drive-specific production
path, repository path, or machine-specific trust record.

A checked-in release manifest records package version, supported Windows
architectures, Node range, tested Codex CLI/Desktop ranges, state schema read/write
range, Hook hashes, and runtime asset list. The build verifies that every declared
runtime asset is packed and rejects forbidden developer paths or high-confidence
secret patterns. Archive SHA-256 remains release evidence generated after pack,
not a self-referential file inside the archive.

Supported initial matrix:

- Windows 10/11 x64; Windows 11 arm64 is declared unverified until direct CI or
  clean-machine evidence exists.
- Node follows `package.json#engines` and must be an absolute executable for a
  background task.
- Codex CLI must match or pass the existing bundled protocol compatibility/smoke
  gate.
- State schema v6 is read/write; v4/v5 migrate through existing store rules and
  hash-verified backup procedures; downgrade eligibility remains fail-closed.

## 4. Windows filesystem layout

Defaults derive from the current profile, never a literal username or drive:

```text
%USERPROFILE%\.chat2codex\
  .env                              user configuration
  .data\state.json                  durable user data (preserved on uninstall)
  .data\logs\                      runtime logs (preserved by default)
  .service\windows\
    launcher.ps1                   generated package-owned launcher
    installation.json              bounded lifecycle manifest and hashes
    rollback\<version-timestamp>\  hash manifest/config copy, never live keys
  .secrets\desktop-gateway\
    prompt-hook.key
    stop-hook.key
    desktop-mcp.key
```

The selected home/env path may be overridden with existing CLI options. All
written paths are canonical, absolute, non-symlink paths below the selected home,
except the explicitly selected env file. Reparse points and path escapes fail
closed.

## 5. Key and ACL lifecycle

On first install, Node generates three distinct 32-byte random values and encodes
each as exactly 43 base64url characters plus a newline. Existing valid key files
are preserved during upgrade. Missing, duplicate, malformed, symlinked, broadly
readable, or wrong-owner files make upgrade fail closed; the installer never
silently replaces uncertain key material. Explicit rotation is a later separately
reviewed operation.

The Windows ACL helper receives paths only through a process environment value,
sets the owner to the current user SID, disables inheritance, removes inherited
rules, and grants FullControl only to the current user SID, LocalSystem, and
Builtin Administrators. It then invokes the existing independent read-only ACL
inspector. If verification fails, newly created key bytes are deleted, no task is
registered, and the prior managed configuration is restored. Key bytes never
enter argv, logs, manifests, evidence, or `.env`; only paths and SHA-256-free
fingerprints suitable for distinctness checks may exist transiently in memory.

## 6. Install, upgrade, uninstall, and rollback

The command surface extends `chat2codex service`:

- `service print --target windows-task` renders redacted launcher/task/manifest
  intent without mutation.
- `service install --target windows-task` performs preflight, creates missing
  keys/ACLs, replaces one marked env block atomically, writes launcher/manifest
  atomically, registers or updates the current-user task, then queries exact task
  identity. The command is idempotent for identical inputs.
- `service uninstall --target windows-task` unregisters only the exact manifest
  task, removes launcher/manifest, removes the marked env block, and removes only
  installer-owned token files. State, user-authored env lines, credentials, logs,
  and deliverables remain by default. `--purge-data` is deliberately absent.

Upgrade is a documented two-package transaction:

1. Run old-package doctor and record package/state/config/task hashes.
2. Create a timestamped rollback record and exact config/state backup without key
   contents in the manifest.
3. Install the reviewed new npm archive.
4. Run `service install --target windows-task` to preserve config/keys and replace
   package-owned launcher/manifest/task definition.
5. Start through the exact task, allow the new store to migrate, then run doctor
   and smokes.
6. On failure, stop/unregister the exact task, restore the old archive and
   compatible state/config backup, reinstall its task definition, and re-run old
   doctor. A downgrade is refused while v6 obligations make v5 rollback unsafe.

Filesystem updates use write-new, flush/close, verify hash, and atomic replace.
Task registration occurs last. A failure before task registration restores prior
owned files. A failure after registration unregisters the new definition and
restores the prior manifest/definition.

## 7. Scheduled Task contract

The task name defaults to `Chat2Codex` inside a Chat2Codex Task Scheduler folder
and is scoped to the current user SID. It runs only when that user is logged on,
starts at logon, allows manual start, rejects overlapping instances, restarts after
failure with bounded attempts, uses an execution time limit disabled for the
long-running bridge, and runs with least privilege. The task action is:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File <absolute package-owned launcher.ps1>
```

The launcher sets only `CHAT2CODEX_ENV`, `CHAT2CODEX_LOG_FILE`,
`CHAT2CODEX_SERVICE_RESTART_ENABLED=true`, `NODE_ENV=production`, and the reviewed
PATH, then invokes the absolute Node binary and absolute package entrypoint. All
PowerShell literals use a dedicated single-quote encoder. The XML/command renderer
rejects control characters, relative paths, task names outside the bounded
character set, and untrusted XML fragments.

## 8. Doctor

Doctor remains read-only and redacts secrets. In addition to existing checks it
reports:

- Windows version/architecture and supported-matrix status;
- package version, manifest schema, and state schema compatibility;
- absolute Node/Codex executable paths and versions;
- selected home/env/state/log paths, canonicality, and reparse-point failures;
- current-user Scheduled Task presence, exact action/launcher identity, last result,
  and one-writer process/lock health;
- three distinct key files, format, owner-only ACL, and role/path mapping without
  key material;
- loopback-only Gateway configuration;
- Hook/MCP example and installed-hash status when an installed path is explicitly
  configured, without trusting or modifying it;
- Codex Desktop package/version availability as informational until Task 12;
- Weixin credential/private-chat checks already present; and
- actionable recovery codes and non-zero exit when any error check exists.

Doctor logic is split into pure checks with injected platform/task/ACL/process
readers so adversarial behavior is testable without changing the real machine.
The CLI wrapper alone performs read-only native queries.

## 9. Configuration and documentation

The packed `.env.example` uses placeholders such as
`C:/Users/<you>/Projects/Work`, clearly marked as examples, and contains no
developer/production drive. README examples derive from `%USERPROFILE%`,
`$env:USERPROFILE`, or explicit operator inputs. The package includes:

- `docs/windows/lifecycle.md`;
- `docs/windows/compatibility.md`;
- `docs/windows/troubleshooting.md`; and
- `docs/quality/clean-windows-e2e-runbook.md`.

The troubleshooting guide maps doctor recovery codes to bounded, reversible
actions and preserves every external-action approval boundary.

## 10. Clean-Windows repeatability protocol

A qualifying environment has a fresh Windows user profile and no Chat2Codex
package, service, state, config, secrets, trusted project Hooks/MCP, or copied user
profile. The exact reviewed archive is transferred and hash-checked. The protocol
records redacted OS/architecture, Node/npm, package, Codex CLI/Desktop versions,
commands, task/manifest/file hashes, schema transitions, and timestamps/results.

Sequence:

1. Environment qualification and absence proof.
2. npm archive hash verification and installation.
3. Template-based config, fresh key generation, ACL negative test, and doctor.
4. Current-user task install/start/restart/single-writer evidence.
5. Separately approved Weixin login and transport.
6. Separately approved real `~/.codex` materialization/Hook trust and Desktop
   restart.
7. Seven installed primitives plus named inbound/outbound E2E.
8. Reviewed upgrade, schema migration, failure injection, rollback, and restore.
9. Uninstall, preserved-data proof, reinstall, and final cleanup.

Approval packets are presented after 09:00. A mock, copied profile, container-only
run, or partial local test cannot close `DIST-003`.

## 11. Testing and evidence

TDD layers:

1. Pure Windows launcher/task XML, manifest, env managed-block, path, key-format,
   and rollback-plan tests.
2. Injected install/upgrade/uninstall transaction tests including failure at every
   write/registration boundary.
3. Native disposable Windows ACL creation/negative verification; no real user
   configuration or scheduled task mutation in repository automation.
4. Doctor positive/adversarial tests with injected readers.
5. Archive content/forbidden-path/secret/runtime-asset/manifest validation.
6. Existing full stable, Windows workflow, audit, pack, authority, and evidence
   gates.
7. Later direct clean-Windows E2E under separate approvals.

## 12. Risks and rollback

- Task XML drift: pin the rendered contract and query the installed action before
  accepting it.
- ACL localization: operate on SIDs and .NET ACL APIs, never localized account
  names.
- Partial upgrade: task registration last, atomic owned-file writes, exact prior
  manifest backup, and fail-closed state downgrade eligibility.
- Key loss: preserve valid existing keys on upgrade; never put their bytes in
  backup manifests; uninstall removes only keys whose ownership is recorded and
  verified.
- Path injection: canonical absolute paths, reparse rejection, bounded task names,
  and dedicated PowerShell/XML encoders.
- False completion: repository automation leaves `DIST-003` and real Desktop/Weixin
  rows missing until direct evidence exists.

Repository rollback reverts the isolated distribution commits. No installed
system is changed by design/implementation work. Later real rollback follows the
hash-verified prior archive/config/state/task manifest and retains separate action
approval.

## 13. Schedule impact

Repository implementation is estimated at 1.5-2.5 engineering days: Windows task
and ACL lifecycle 0.5-1 day, doctor/package portability 0.5-1 day, docs/evidence and
full validation 0.5 day. A qualifying clean-Windows E2E adds approximately 3-6
hours when the second environment and all action-time approvals are available;
external login/CAPTCHA or Desktop trust issues can extend it. Until that direct run
passes, the Goal remains active.
