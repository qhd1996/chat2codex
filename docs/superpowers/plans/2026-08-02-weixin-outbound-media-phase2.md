# Weixin Outbound Media Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver explicitly declared Codex output images/files to Weixin after visible final text, with secure immutable staging, encrypted upload, durable ordered retry, and no implicit file leakage.

**Architecture:** CodexRunner parses one exact final `CHAT2CODEX_OUTPUT_FILES` control line from the untruncated final response and returns structured paths separately from visible text. A platform-neutral staging service validates declared files against the exact task roots and snapshots immutable bytes into private Chat2Codex storage. The task-qualified durable outbox stores ordered text/image/file entries; the Weixin adapter implements encrypted CDN upload and native IMAGE/FILE messages while BridgeRunner resumes the first undelivered entry after failure or restart without rerunning Codex.

**Tech Stack:** TypeScript, Bun 1.3.9, Node 24 for development, Node 22 production, Codex app-server JSON-RPC, JSON state schema migration, AES-128-ECB, MD5/SHA-256, Weixin iLink/CDN.

---

## File responsibility map

- `src/core/output-declarations.ts`: parse and remove the single final output-files control line; never inspect diffs or ordinary path mentions.
- `src/core/deliverable-stager.ts`: authorize, sniff, snapshot, hash, quota-check, and clean staged files.
- `src/core/media-outbox.ts`: platform-neutral ordered media delivery records and retry helpers.
- `src/agent/codex-runner.ts`: apply output declaration parsing before final-text truncation and expose `outputFiles`.
- `src/state/types.ts`, `src/state/store.ts`: schema v5 durable staged-media/outbox migration and reference validation.
- `src/core/bridge-runner.ts`: stage declared outputs and append ordered task-qualified outbox entries atomically with terminal job state.
- `src/core/actions.ts`, `src/core/bridge-runner.ts`, `src/runtime/bridge-runtime.ts`: adapter-neutral media sender contract.
- `src/adapters/weixin/types.ts`, `src/adapters/weixin/api.ts`, `src/adapters/weixin/adapter.ts`: Tencent upload URL, AES upload, native IMAGE/FILE send.

---

### Task 1: Parse explicit output declarations before truncation

**Files:**
- Create: `src/core/output-declarations.ts`
- Create: `tests/output-declarations.test.ts`
- Modify: `src/agent/codex-runner.ts`
- Modify: `tests/codex-runner.test.ts`, `tests/codex-session-manager.test.ts`

- [ ] **Step 1: Write parser RED tests**

Test one optional final line with this exact grammar:

```text
CHAT2CODEX_OUTPUT_FILES: ["C:\\absolute\\report.png","C:\\absolute\\notes.pdf"]
```

Assert: valid JSON string array is returned in declaration order; the line is removed from visible text; no declaration yields `[]`; a non-final line, malformed JSON, non-array, non-string entry, empty path, duplicate declaration line, or more than 16 entries yields a bounded declaration error and zero files. Ordinary mentioned paths, changed files, command output, and code fences are ignored.

- [ ] **Step 2: Run RED**

Run: `bun test tests/output-declarations.test.ts`
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the strict parser**

Expose:

```typescript
export interface ParsedOutputDeclaration {
  visibleText: string;
  outputFiles: string[];
  error?: string;
}
export function parseOutputDeclaration(fullText: string): ParsedOutputDeclaration;
```

Do not resolve filesystem paths in this module. Limit the input scan and returned error length.

- [ ] **Step 4: Integrate CodexRunner before truncation**

Add `outputFiles?: string[]` and `outputDeclarationError?: string` to `CodexRunResult`. Parse the complete accumulated final message, then truncate only `visibleText`. Apply this to single-use and reusable app-server paths.

- [ ] **Step 5: Run GREEN and commit**

Run: `bun test tests/output-declarations.test.ts tests/codex-runner.test.ts tests/codex-session-manager.test.ts`
Commit: `feat: parse explicit Codex output files`

---

### Task 2: Securely stage declared task deliverables

**Files:**
- Create: `src/core/deliverable-stager.ts`
- Create: `tests/deliverable-stager.test.ts`
- Modify: `src/config/env.ts`, `.env.example`, `tests/config.test.ts`

- [ ] **Step 1: Write staging RED tests**

Cover absolute canonical regular files; source roots limited to task `workspaceRoot` plus an output-only task's private `executionCwd`; rejection of relative/missing/directory/symlink/outside-root paths; duplicate canonical paths; maximum 16 files; default 25 MiB/file and 50 MiB/turn; PNG/JPEG/GIF/WEBP content sniffing; other regular files as generic files; source mutation during copy; dirty preexisting destination; and cleanup that never follows symlinks.

- [ ] **Step 2: Run RED**

Run: `bun test tests/deliverable-stager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement immutable private snapshots**

Expose:

```typescript
export interface StagedDeliverable {
  sourcePath: string;
  stagedPath: string;
  fileName: string;
  kind: "image" | "file";
  mediaType: string;
  size: number;
  sha256: string;
}
```

Stage under `CHAT2CODEX_HOME/outbound/<taskId>/<jobId>/<sequence>-<safe-name>` using exclusive creation. Validate source before and after copy; hash the staged bytes; remove the whole newly-created job staging directory on any partial failure. Never trust filename extension for image classification.

- [ ] **Step 4: Add configuration**

Add `OUTBOUND_MEDIA_MAX_COUNT`, `OUTBOUND_MEDIA_MAX_FILE_BYTES`, `OUTBOUND_MEDIA_MAX_TOTAL_BYTES`, and `OUTBOUND_MEDIA_RETENTION_HOURS` with strict bounded defaults. Strip them from Codex child environments.

- [ ] **Step 5: Run GREEN and commit**

Run: `bun test tests/deliverable-stager.test.ts tests/config.test.ts tests/codex-environment.test.ts`
Commit: `feat: stage declared task deliverables`

---

### Task 3: Migrate to a task-qualified media outbox

**Files:**
- Create: `src/core/media-outbox.ts`
- Create: `tests/media-outbox.test.ts`
- Modify: `src/state/types.ts`, `src/state/store.ts`
- Modify: `tests/state-store.test.ts`

- [ ] **Step 1: Write schema v5 RED tests**

Migrate v4 to v5 with `.v4.bak`. Extend outbox kinds to `text | markdown | image | file`. Media entries require task ID, job ID, sequence, staged path, filename, media type, size, SHA-256, status, attempts, and idempotency key. Reject orphaned task/job media, duplicate sequence, noncanonical staged path, media outside private outbound root, invalid hash/size, and future schemas. Preserve legacy text deliveries.

- [ ] **Step 2: Run RED**

Run: `bun test tests/state-store.test.ts tests/media-outbox.test.ts -t "media|schema v5"`
Expected: FAIL.

- [ ] **Step 3: Implement ordered record helpers**

`MediaOutbox.appendResult()` atomically creates visible text first (when nonempty) followed by staged files in declaration order. Stable IDs derive from job ID and sequence. A delivered prefix remains delivered; recovery changes `sending` to `pending` and resumes the lowest undelivered sequence.

- [ ] **Step 4: Implement retention**

Never prune pending/sending media, referenced staging directories, active task jobs, or a delivered prefix whose later sibling is pending. Prune only complete terminal delivery groups and securely clean their unreferenced staging directories.

- [ ] **Step 5: Run GREEN and commit**

Run: `bun test tests/state-store.test.ts tests/media-outbox.test.ts`
Commit: `feat: add durable ordered media outbox`

---

### Task 4: Add platform-neutral outbound media contracts

**Files:**
- Modify: `src/core/actions.ts`, `src/core/bridge-runner.ts`, `src/runtime/bridge-runtime.ts`
- Modify: `tests/adapter-supervisor.test.ts`, `tests/message-router.test.ts`

- [ ] **Step 1: Write contract RED tests**

Define a sender method that accepts one immutable staged media item and a stable idempotency key. Prove adapter ID isolation, task ownership, sequence preservation, unsupported-adapter fail-closed behavior, and no file bytes or secrets in logs/status.

- [ ] **Step 2: Implement contract**

Use:

```typescript
interface OutboundMediaInput {
  kind: "image" | "file";
  stagedPath: string;
  fileName: string;
  mediaType: string;
  size: number;
  sha256: string;
}
```

Add `sendMedia?(chatId, input, options)` to `ChatSender`. Bridge runtime routes it only to the owning adapter.

- [ ] **Step 3: Run GREEN and commit**

Run: `bun test tests/adapter-supervisor.test.ts tests/message-router.test.ts -t "media sender|adapter isolation"`
Commit: `feat: add outbound media sender contract`

---

### Task 5: Implement encrypted Weixin image/file upload

**Files:**
- Modify: `src/adapters/weixin/types.ts`, `src/adapters/weixin/api.ts`, `src/adapters/weixin/adapter.ts`
- Modify: `tests/weixin-adapter.test.ts`
- Update if required by pinned Tencent baseline: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Capture the pinned protocol fixture**

From the repository's pinned Tencent `openclaw-weixin` baseline, record exact `getuploadurl` request/response field names and IMAGE/FILE item shapes in typed fixtures. Do not infer wire fields from documentation prose.

- [ ] **Step 2: Write crypto/protocol RED tests**

For known plaintext/key fixtures assert MD5, PKCS#7 AES-128-ECB ciphertext, encrypted size, upload request, CDN PUT bytes, native IMAGE and FILE messages, context token, client ID, sanitized filename, response error handling, timeouts, and no token/key logging. Retry with the same delivery ID may request a new upload URL but must send one stable client ID.

- [ ] **Step 3: Implement upload flow**

Read only the immutable staged file. Generate a fresh 16-byte AES key for each upload attempt; calculate plaintext MD5 and sizes; call `ilink/bot/getuploadurl`; encrypt/upload; send IMAGE or FILE item. Zero sensitive temporary buffers when practical and never persist the AES key in bridge state.

- [ ] **Step 4: Run GREEN and commit**

Run: `bun test tests/weixin-adapter.test.ts -t "upload|outbound image|outbound file|AES"`
Commit: `feat: upload encrypted Weixin media`

---

### Task 6: Integrate declared outputs with terminal task delivery

**Files:**
- Modify: `src/core/bridge-runner.ts`, `src/runtime/bridge-runtime.ts`
- Modify: `tests/message-router.test.ts`, `tests/state-store.test.ts`

- [ ] **Step 1: Write result integration RED tests**

Controlled Codex results prove: declaration parsing occurs before chat truncation; invalid declarations produce one task-labelled correction and zero files; valid files are staged before the durable terminal commit; outbox order is text then declarations; merely mentioned/changed/input/log files never send; partial media failure leaves that and later entries pending; retry/restart sends no delivered prefix and never reruns Codex; source modification after staging does not change sent bytes; wrong task/root fails closed.

- [ ] **Step 2: Implement atomic terminal capture**

For a task result, stage all output files first. In one state mutation record terminal job result plus the complete ordered outbox. On staging failure remove new snapshots, persist a bounded corrective delivery, and do not partially append media.

- [ ] **Step 3: Extend delivery drain**

Drain by ascending sequence. Text uses existing methods; media calls `sendMedia`. Mark one entry delivered only after adapter success. Stop at first failure, schedule existing bounded retry, and leave later entries untouched. Startup resumes pending media.

- [ ] **Step 4: Implement cleanup and status**

Expose only filename/kind/remaining count in task status. Never show staged absolute paths, hashes, source paths, encryption keys, or upload URLs. Cleanup staged bytes only after the entire delivery group is terminal and outside retention.

- [ ] **Step 5: Run full integration and commit**

Run: `bun test tests/message-router.test.ts tests/state-store.test.ts -t "output file|media|ordered|restart|partial"`
Then: `bun test tests/message-router.test.ts tests/state-store.test.ts`
Commit: `feat: deliver ordered task media results`

---

### Task 7: Document, verify, version, and package Phase 2

**Files:**
- Modify: `README.md`, `README.zh-CN.md`, `docs/architecture.md`, `.env.example`, `package.json`, `bun.lock`
- Create: `docs/superpowers/verification/2026-08-02-weixin-outbound-media-phase2.md`

- [ ] **Step 1: Document behavior and corrective guidance**

Document exact control-line syntax, declaration order, root/quota rules, supported image sniffing, generic files, immutable staging, separate native messages, retry/restart, and examples of rejected unsafe/implicit declarations. State that Phase 3 desktop and Phase 4 UsageAdvisor are not delivered.

- [ ] **Step 2: Run focused and complete checks**

Run all new Phase 2 suites, then `bun run check`, official-registry `bun audit`, and `bun pm pack --dry-run`. Rerun the full Phase 1 acceptance automation to prove no regression.

- [ ] **Step 3: Version and pack**

Bump from `0.8.0-orchestrator.4` to `0.8.0-media.1`; update only the lockfile version metadata; rerun checks; commit `docs: prepare Weixin outbound media phase 2`; pack one `chat2codex-0.8.0-media.1.tgz` and record SHA-256.

---

### Task 8: Deploy and run real ordered Weixin media E2E

**Files:**
- Modify during deployment: `F:/Chat2Codex/Start-Chat2Codex.ps1` only for new non-secret quota settings
- Complete: `docs/superpowers/verification/2026-08-02-weixin-outbound-media-phase2.md`

- [ ] **Step 1: Backup and install**

Record installed version, package/state/launcher hashes, gateway PID, lock and log tail. Copy exact installed package/state/launcher to a new timestamped rollback directory and verify equality. Stop only the exact scheduled gateway, install the hashed package, restart, run migration/doctor/handshake/turn/approval/real sandbox probes.

- [ ] **Step 2: Use the existing unattended E2E authorization**

The user authorized unattended Weixin test/deploy/rollback for the existing `C2C-P1-E2E` scope. Use only non-sensitive generated image/file fixtures and the already-bound direct conversation. Pause only for CAPTCHA or an irreversible operation. Stop immediately if the user takes control or presses Esc.

- [ ] **Step 3: Real delivery acceptance**

Run one task that returns visible text plus one declared PNG and one declared generic file. Verify three separate native messages in exact order and task label. Verify bytes/hashes. Test an invalid outside-root declaration, a mentioned but undeclared path, an upload failure followed by retry, restart between media entries, and no duplicate Codex turn/delivered prefix.

- [ ] **Step 4: Rollback rehearsal and evidence**

Exercise old-package/current-package state compatibility on disposable copies, restore the candidate, verify health, and record every command/timestamp/redacted ID/hash/result. Commit `test: verify Weixin outbound media phase 2`. Phase 2 is accepted only with real ordered text/image/file evidence and restart/dedup proof.

---

## Plan self-review

- Every Phase 2 design requirement maps to parser, staging, state, transport, integration, or real E2E evidence.
- No file is inferred from diffs, mentions, logs, inputs, or filesystem changes.
- Staged bytes, not live workspace bytes, are retried.
- All durable media is qualified by adapter/conversation/task/job/sequence and stable delivery identity.
- Upload keys/URLs/credentials never enter durable state, logs, status, or prompts.
- Phase 1 natural control, concurrency, approvals, inbound images, migration, rollback, and text outbox remain green.
- Phase 3 desktop handoff and Phase 4 UsageAdvisor remain explicitly out of scope.
