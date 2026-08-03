# Personal Portable Installer Design

Status: approved by Haoda on 2026-08-04

Authority: requirements-ledger commit
564d6519c08cc3ecd477a7cefd4bfd8c1afca72c, accepted CR-0010 and ADR-0006

## 1. Outcome and product boundary

Chat2Codex ships as a personal portable installer for one current Windows user.
The exact npm archive and one-command lifecycle must move to another clean
personal Windows computer without developer paths, usernames, drive letters,
copied keys, copied state, or pretrusted Hooks/MCP.

P0 keeps current-user owner-only key ACLs, fresh keys per machine, authenticated
127.0.0.1 Gateway endpoints, fail-closed UserPromptSubmit, root-thread and
owner/generation binding, Stop wake-only behavior, authoritative thread/read,
idempotent outbox/high-water recovery, child exclusion, redaction, user-data
preservation, and clean-Windows real E2E.

Same-machine second-user read/delete/replace testing is retained as
DIST-HARDEN-001 P1. Its current-host positive evidence and hosted negative
evidence remain indexed. It is not a P0 installer or full-CI blocker.

## 2. Chosen approach

Three approaches were evaluated:

1. A monolithic PowerShell installer containing lifecycle and state logic. This
   is rejected because it duplicates tested TypeScript transaction behavior and
   makes schema/rollback drift likely.
2. A new native Windows MSI/MSIX. This is rejected for the first release because
   signing, elevation, update channels, and AppX behavior add unrelated critical
   path risk.
3. A thin hash-reviewed PowerShell bootstrap over the existing npm CLI and
   Windows lifecycle core. This is selected. PowerShell handles prerequisite
   detection, archive verification, stable path discovery, and user-facing
   orchestration; TypeScript remains authoritative for install, doctor, service,
   manifest, keys, schema, and rollback decisions.

## 3. User experience

The package includes scripts/chat2codex-personal.ps1. It supports these actions:

- Install: verify archive hash, detect prerequisites, install the reviewed npm
  archive into a current-user prefix, create configuration from the shipped
  template, generate keys, install the current-user task, and run doctor.
- Upgrade: hash and snapshot current package/config/state/task/manifest, install
  reviewed new bytes, migrate, reinstall the exact task, run doctor, and retain a
  rollback receipt.
- Rollback: consume a named receipt, refuse active obligations or incompatible
  schema, restore exact package/config/state/task material, and run prior doctor.
- Uninstall: stop/remove only the manifest-owned service/task/config/keys/package
  files and preserve state, Weixin credentials, deliverables, and backups.
- Reinstall: Install after Uninstall, generating new keys while reusing preserved
  user data.
- Doctor: read-only dependency, installation, service, state, Gateway, key ACL,
  Hook/MCP, Desktop, and Weixin readiness diagnostics.

The script accepts an explicit archive and SHA-256. Defaults derive only from
LOCALAPPDATA, APPDATA, USERPROFILE, Program Files discovery, PATH, and explicit
arguments. No repository, F: drive, developer username, or production path may
appear in shipped bytes.

## 4. Dependency detection

The bootstrap and doctor identify:

- supported Windows version and x64 architecture;
- PowerShell 5.1 or newer;
- Node satisfying package engines and a usable npm CLI;
- Codex CLI presence/version and its executable path;
- Codex Desktop presence/version when Desktop integration is requested;
- Weixin setup state without displaying credentials;
- current package/install manifest/schema/task/writer/lock state;
- Gateway loopback host and three generated key roles/format/current-user ACL;
- real Hook/MCP expected hashes and trust/config state.

Missing external prerequisites are not silently downloaded. The script stops
before mutation with stable error codes and exact safe remediation. This keeps
Node/Codex/Desktop supply-chain ownership explicit while preserving a one-command
Chat2Codex lifecycle once prerequisites are present.

## 5. Transaction and data ownership

The bootstrap creates an intent receipt before mutation. The TypeScript portable
controller then calls the existing Windows service lifecycle with injected
readers/writers. Mutation order is:

1. validate archive/version/hash and prerequisite snapshot;
2. verify current obligations and canonical owned paths;
3. write a hash-verified backup/rollback receipt;
4. install reviewed package bytes in a current-user prefix;
5. merge only the managed configuration block;
6. create/preserve three valid machine-local keys and current-user ACLs;
7. register the exact current-user task last;
8. start, verify one writer/lock/Gateway, and run doctor;
9. atomically mark the receipt committed.

Failure reverses completed operations from the receipt. No fallback deletes
unknown paths, changes a different task, weakens ACLs, purges data, or starts a
second writer.

## 6. Security and redaction

Keys are generated with 256 bits of entropy, never shipped, never placed in argv,
URLs, receipts, logs, annotations, screenshots, or evidence. Installer and doctor
validate canonical regular files, no reparse points, current-user ownership,
protected DACLs, distinct key material, loopback-only host, and exact Hook hashes.

Errors contain stable stage/code and actionable recovery, never key bytes,
prompts, Weixin identity, Windows SID/username, message contents, or absolute
paths. Diagnostic paths are classified rather than printed.

## 7. CI and evidence model

Repository native lifecycle becomes a non-blocking hosted-environment diagnostic.
It always uploads and publishes bounded stage/code/cleanup evidence. It cannot
promote DIST-002 or DIST-003 and does not block personal P0 on hosted owner
semantics.

The blocking Windows gates are:

- repository/unit/property/package/full-CI integrity;
- package-only no-checkout personal lifecycle using the reviewed archive;
- clean personal Windows or second-computer DIST-003;
- production, installed Hook/MCP/Desktop, and real-Weixin direct E2E.

The final full CI still runs repository stability and clean-package jobs. No test
is skipped and no timeout is extended to manufacture a pass. DIST-HARDEN-001 may
run manually or on a suitable disposable host and remains separately reported.

## 8. Clean personal Windows acceptance

A qualifying environment has a fresh personal Windows profile, no repository,
no Chat2Codex package/service/config/state/secrets, and no trusted Hooks/MCP. It
executes the exact reviewed archive:

1. verify download size and SHA-256;
2. record Windows/Node/npm/Codex/Desktop versions;
3. run Install twice and prove idempotency;
4. run setup weixin and doctor;
5. start/stop/restart and prove one writer/lock;
6. install exact Hook/MCP material and restart Desktop;
7. execute seven Gateway primitives;
8. send authorized text/image/file only to Haoda's bound test conversation;
9. prove retry/restart/dedup/no Codex rerun;
10. upgrade, migrate, rollback, and resume obligations;
11. uninstall twice, prove user data retained, reinstall, rotate keys, and prove
    zero owned process/task/root residuals.

Mock transport may cover automation before the real external step but cannot
close the real Weixin/Desktop rows.

## 9. Failure handling and rollback

Every action is idempotent or fail-closed. Interrupted install/upgrade/uninstall
uses the durable receipt on the next invocation. Doctor identifies whether the
safe next action is resume, rollback, repair, or manual prerequisite install.
Purge is a separate explicit-confirmation action and is outside default uninstall.

Production adoption remains single-writer. A failed candidate health gate restores
the exact old package/config/state/task and verifies old doctor, one writer, lock,
and obligations before returning control.

## 10. Delivery sequencing and schedule

The ordered P0 path is:

1. governance/design/plan consistency;
2. one-command bootstrap and portable controller;
3. dependency/doctor and package contract;
4. final archive/full Windows CI;
5. clean personal Windows DIST-003;
6. production deployment/rollback;
7. real Hook/MCP/Desktop primitives;
8. authorized real-Weixin E2E;
9. matrix/CURRENT/final message.

Estimated remaining critical path is 1–2 engineering days when Desktop and clean
Windows capability are available. The scope update saves approximately 0.5–1 day
of hosted multi-user ACL debugging. External Desktop/Weixin availability can add
time; the Goal remains active until every accepted P0 row has direct evidence.
