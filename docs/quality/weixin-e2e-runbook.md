# Weixin and Desktop evidence runbook

This runbook defines evidence capture and approval boundaries. It is not an execution authorization, deployment script, Desktop automation instruction, or pre-authorized message. The requirements ledger and the user's action-time approval remain controlling.

## Evidence layers

1. **repository automation** — unit, integration, property, documentation, packaging, and process-wrapper checks in an isolated worktree;
2. **production read-only health** — version, task/process/lock identity, hashes, and pending-obligation counts without changing state;
3. **production write or restart** — backup, install, migration, service ownership recovery, or restart;
4. **~/.codex, Hook, or MCP** — configuration, key creation, installation, or trust;
5. **Desktop restart or Computer Use** — any Desktop UI or Computer Use initialization/action; and
6. **each real Weixin outbound action** — every message, image, file, reply, or control sent to a real person/account.

These layers never collapse into one another: CI does not prove real E2E; static inspection does not prove real E2E; schema presence does not prove real E2E. A timed-out, killed, incomplete, stale, or residual-process run remains negative evidence.

## Common preflight

Before any mutable or external layer:

- re-read the requirements ledger and current acceptance row;
- record the exact repository commit and dirty state;
- record exact package, Node, Bun, Codex, Desktop, and adapter versions that apply;
- confirm the prior layer's artifacts and SHA-256 values;
- resolve the current unique process/thread/window/account identity immediately before action;
- record a fresh handle rather than reusing a remembered window or task handle;
- record both a canonical UTC timestamp and the corresponding Asia/Shanghai timestamp; and
- stop if any identity, state hash, pending obligation, or expected owner differs.

## Layer 1: repository automation

No external approval is required for repository-local read/write work already authorized in an isolated worktree. Capture:

- exact command and exit code;
- pass/fail/skip/timeout counts;
- PID + CreationDate for wrapped processes and residual root/child counts;
- artifact paths and hashes; and
- explicit limitations, including all installed or real rows that remain unproven.

## Layer 2: production read-only health

Read-only inspection may capture:

- installed package and state schema;
- process tree, owner PID + CreationDate, lock identity, and scheduled supervisor state;
- state SHA-256 and bounded counts of non-terminal jobs, pending messages, non-delivered outbox, drafts, and clarifications; and
- adapter health without starting, stopping, replying, or mutating state.

Abort condition: more than one writer, ambiguous process identity, an active obligation, a changed hash during inspection, or an unreadable/unsupported state version.

## Layer 3: production write or restart

> **APPROVAL STOP — production:** Present the exact target, package/hash, preflight state, backup location/hash, intended mutation, rollback condition, and expected outage. Wait for explicit action-time approval before any production write or restart.

Evidence after approval must include before/after state SHA-256, backup and rollback hash, exact process identities, one-writer proof, lock continuity, health result, and every failed or aborted step. Never combine service-ownership recovery and a package/schema deployment unless the user separately approves that combined scope.

## Layer 4: ~/.codex, Hook, or MCP

> **APPROVAL STOP — user Codex configuration:** Present every exact file/path to be created or changed, key material handling method without revealing the value, Hook/MCP trust action, rollback file list, and why supported behavior requires it. Wait for explicit action-time approval.

Evidence must prove absolute regular non-symlink token files, owner-only Windows ACL behavior, distinct paths/material, fresh-process loading, installed Hook/MCP identity and hash, and fail-closed behavior. Do not record credentials or token values.

## Layer 5: Desktop restart or Computer Use

> **APPROVAL STOP — Desktop/Computer Use:** Present the exact Desktop state to be exercised, the fresh handle-selection method, the visible action sequence, screenshots to capture, abort key/procedure, and all external side effects. Wait for explicit action-time approval before restart or Computer Use.

Capture a redacted screenshot for the bound root, status/reconnect behavior, blocked prompt state, thread ID evidence, generation/fence snapshots, and process timeline. Re-resolve the fresh handle after every restart or focus change. Stop immediately on user takeover, Esc, unexpected account/window, untrusted Hook, wrong thread, or ownership uncertainty.

## Layer 6: each real Weixin outbound action

> **APPROVAL STOP — real Weixin send:** Immediately before each outbound text, image, file, reply, or control, present the recipient/account, final visible content or artifact name/hash, reason, ordering position, and expected idempotency identity. Wait for explicit confirmation for that action.

Capture a redacted transcript and, where useful, a redacted screenshot. Record client/delivery IDs in redacted form, timestamps, ordering, byte hashes, attempts, deduplication outcome, and whether Codex reran. A local adapter test, simulated transport, or prior real send cannot authorize or prove a later send.

## Scenario evidence expectations

### Real Weixin transport and recovery

Record inbound/outbound success, controlled restart, duplicate event, retry, cursor continuity, one writer, and zero unintended messages. Stop on account mismatch, ambiguous delivery, unexpected duplicate, pending obligation, or process ownership drift.

### Natural multi-task and approvals

Use two named tasks and record exact target resolution, create/continue/steer/stop/inspect behavior, simultaneous decisions, generic-consent negative behavior, thread isolation, timing, workspace path, and approval scope. Stop on legacy-thread reuse or cross-task interaction.

### Inbound and outbound media

Record one-to-four inbound images, text requirement, fifth rejection, discard, ambiguity, TTL/restart, ordered text → image → file, upload encryption metadata without secret values, retry, prefix recovery, byte SHA-256, deduplication, and no Codex rerun. Stop if staged bytes/hash change or any file escapes the bound task root.

### Desktop seven primitives

Record authenticated redacted status/reconnect, fail-closed UserPromptSubmit with the actual turn ID, same-root takeover and monotonically increasing generation, advisory Stop wake, stable authoritative thread read, single-writer races/crash/expiry, and unbound child non-export. Stop on any unexpected turn, uncertain ownership, signature failure, missing binding, high-water mismatch, or outbox identity conflict.

## Evidence record template

- Requirement ID:
- Evidence level: `static | automated | installed_behavior | real_e2e`
- Outcome: `pass | fail | incomplete | contradicted`
- Observed at: UTC timestamp / Asia/Shanghai timestamp
- Repository commit and dirty state:
- Runtime/package versions:
- Fresh handle / PID + CreationDate / thread identity (redacted):
- Preconditions and approval reference:
- Exact command or named manual procedure:
- Counts and residual identities:
- State SHA-256 before/after:
- Artifact path and Artifact SHA-256:
- Ordering and deduplication evidence:
- Redacted screenshot / redacted transcript:
- Backup and rollback hash:
- Abort condition:
- Outcome and limitation:

## Completion rule

Update the authoritative acceptance matrix only through an explicitly authorized requirements-ledger change after direct evidence satisfies the entire row. A passing repository, CI, installed, Desktop, or Weixin subset must remain partial or unproven wherever the named scope is missing.
