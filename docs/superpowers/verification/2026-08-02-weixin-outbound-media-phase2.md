# Weixin Outbound Media Phase 2 Verification

## Verdict

**Incomplete as of 2026-08-02 Asia/Shanghai.** The Phase 2 implementation is packaged as candidate `0.8.0-media.1`. It has not yet been deployed or accepted through a real Weixin client. Automated evidence below proves parser, staging, durability, transport contracts, retry/restart semantics, and redaction; it does not replace real ordered text/image/file delivery evidence. Phase 2 and the overall Goal remain active.

## Candidate scope

- Source branch: `feat/weixin-orchestrator-phase1`.
- Implementation and release-evidence commits through `59d2d3a test: rehearse production state v4 v5 rollback`.
- Pinned Tencent protocol baseline: `@tencent-weixin/openclaw-weixin@2.4.6`; inspected archive SHA-256 `EF1C3600CA2FC0EE9076C1327AF1E0D5D2E8E19FBB61E9F56C961FCDE0BD07F6`.
- Candidate archive: `chat2codex-0.8.0-media.1.tgz`, 280,807 bytes, 73 files, SHA-256 `7DC160E060C0A44B395081663866890795477C233DAA85480793EF308C8FAB4F`.
- Installed production remains `0.8.0-orchestrator.4`; no Phase 2 production mutation has occurred.

## Implemented behavior

1. One exact final `CHAT2CODEX_OUTPUT_FILES` JSON-array line is parsed before visible-text truncation. Ordinary paths, diffs, inputs, command output, logs, and changed files are ignored.
2. Declared files are canonicalized, root/ownership/quota checked, content-sniffed, and copied into immutable private staging. Canonical workspace, exact task Git worktree, and verified output-only roots are distinct authorization cases.
3. State schema v5 stores task/job-qualified ordered text/image/file deliveries with stable IDs. Text chunks precede media; a delivered prefix is never reset.
4. Weixin upload uses the pinned AES-128-ECB PKCS#7, MD5, `getuploadurl`, CDN POST, IMAGE/FILE item shapes, context token, and stable `client_id` behavior. Keys, tokens, URLs, paths, hashes, and bytes are excluded from durable status/log output.
5. Terminal capture stages first, then commits terminal job metadata plus the complete ordered outbox in one state mutation. Injected save failure rolls state back and removes the new staging directory.
6. Delivery stops at the first failure. In-process retry and restart resume the first undelivered item without rerunning Codex or resending a confirmed prefix. `/status` exposes only bounded kind, filename, and remaining count.
7. Pending/sending groups and active task obligations are never pruned. Complete media groups retain backing jobs and staging until `OUTBOUND_MEDIA_RETENTION_HOURS` expires, after which count-based retention may remove the whole group.

## Fresh automated evidence

| Gate | Result |
| --- | --- |
| Task 5 Weixin focused upload/AES tests | 7 passed, 0 failed |
| Complete Weixin adapter tests | 19 passed, 0 failed |
| Task 6 atomic terminal/restart E2E | 1 passed, 0 failed; includes injected state-save failure and immutable staged-byte replay |
| Task 6 focused router/state selection | 20 passed, 0 failed |
| Deliverable stager suite | 9 passed, 0 failed |
| Media outbox suite | 3 passed, 0 failed |
| State store suite | 24 passed, 0 failed |
| Main typecheck, adapter contracts, production build | Passed with Node `v24.14.0` |
| Configurable approval reviewer integration | Commit `299f0c0`; 104 focused tests passed, 0 failed, plus typecheck/contracts/build. Default `auto_review` and explicit `user` rollback preserve `workspace-write + on-request`. |
| Full repository test gate | 549 tests: 541 passed, 8 skipped, 0 failed; 43.3 s wall, 13.4 s root CPU, no timeout and no residual process identities under the PID+CreationDate wrapper. |
| Typecheck / adapter contracts / production build | All exit 0 after the full test gate. |
| Official npm registry audit | `No vulnerabilities found`. |
| Pack dry run and archive inspection | 73 files, 1.70 MB unpacked; packed version `0.8.0-media.1` includes media outbox, Weixin upload, and approval-reviewer config. |
| Production-state-copy v4/v5 rehearsal | Commit `59d2d3a` / report `2026-08-02-production-state-v4-v5-rehearsal.md`: exact v4 backup hash, invariant-preserving v5 migration, old-on-v5 fail-closed, old-on-restored-v4 pass, new-on-restored-v5 pass; production hash/PID/lock unchanged. |

Earlier killed/timed-out full runs are not counted. The final release evidence comes only from the process-identity-safe wrapper and fresh serial gates above. Test-stability root cause and eight-shard evidence are recorded in `2026-08-02-router-test-stability.md`.

## Safety and negative evidence

- Malformed/non-final/duplicate/unsafe declarations yield zero media.
- Outside-root and wrong-task/worktree declarations fail closed.
- Source mutation after staging does not change retried bytes.
- Unsupported adapters retain pending media with a redacted error.
- Ordinary network errors do not log tokens or synthetic key material.
- Recovery reuses stable delivery identity but may request a fresh upload URL/key for a new attempt.

## Production acceptance still required

- Backup exact installed package, launcher, and state; verify copied hashes.
- Deploy the candidate, migrate a disposable/current state copy, and prove one gateway/lock plus healthy runtime logs.
- Run installed doctor, handshake, turn, approval, and real sandbox probes.
- Real Weixin: visible text, one PNG, and one generic file arrive as three separate native messages in exact order with the correct task label and byte hashes.
- Real negative cases: outside-root declaration and mentioned-but-undeclared path send no file.
- Real failure/recovery: upload failure, retry, restart between entries, stable/deduplicated delivery, and no duplicate Codex turn or delivered prefix.
- Rollback rehearsal on disposable copied state, then restore the selected candidate and recheck health.

Phase 3 desktop visibility/same-thread handoff and Phase 4 UsageAdvisor are not delivered by this candidate. The Phase 3 primitive blocker is recorded in branch commit `50514ff`; AppX repair/fallback is governed by accepted CR-0004. Phase 1 still has outstanding real Weixin multi-task, concurrency, approval, four-image, controlled restart, and rollback acceptance rows; later-phase progress does not close those gaps.
