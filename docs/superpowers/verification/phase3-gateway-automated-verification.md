# Phase 3 Gateway automated pre-install verification

Date: 2026-08-02 Asia/Shanghai

Candidate source SHA: `7f524d8ba86ea907d6c0b15e4efeeb245f61e196`

Verdict: **Tasks 0-11 repository automation is ready for pre-install review.
Task 12 and every installed/real-environment acceptance row remain unexecuted.**
This report is not production, installed Desktop, real Weixin, or clean-Windows
evidence. The overall Goal remains active.

## Authority and boundaries

- Product authority: requirements ledger commit `21a5800c4d725375af256a1e1c827bab75c3f034`.
- Approved Gateway design: `79fc097`; hardened design head: `fd96093`.
- Approved implementation plan: `599b3a9`; Tasks 0-11 were authorized.
- Accepted CR-0006 adds reusable distribution requirements `DIST-001..003`.
- Accepted CR-0007 permits reversible repository work from 22:00 to 09:00
  Beijing time.
- Task 12, production writes/restarts, real `~/.codex` changes, Hook
  installation/trust, Desktop restart, Computer Use, real Weixin outbound, and
  other irreversible external actions were not performed.
- Damaged task `019fc002-590e-7023-b7e5-2a802168f00a` was not read, restored, or
  replayed.

The repository-local OpenSpec overlay remains scoped to the earlier approved
minimal-quality-acceleration change and is non-authoritative. The fresh authority
validator passed for that overlay; it does not claim to close CR-0006 or CR-0007.

## Model routing and escalation

CR-0005 requires Sol + Extra High for Phase 3, concurrency/recovery, and final
review when the platform supports explicit routing. The main-agent inherited model
and effort were not exposed, so they are recorded as unavailable rather than
inferred. Explicit `gpt-5.6-sol/xhigh` review/debug agents were requested after
consecutive failures, but their task payloads arrived empty and they performed no
review or file writes. The primary agent changed paths and performed the security,
diff, test, process, package, and evidence review directly.

During Router stabilization, repeated failures were escalated from observation
timeouts to event-boundary and process-identity diagnosis. This found one stale
repository-test Bun process (PID 33484, parent absent, exact 2026-08-02 16:49:45
creation identity, repository test command, no children) and one orphan created by
an interrupted controlled test (PID 4740). Each was identity-checked and stopped;
no production process or file was touched. The final fix changes test observation
semantics only: invocation, callback-ready, scheduler-idle, sender-visible, and
durable-delivered events are distinct. Product outbox behavior was not weakened.

## Fresh final-SHA verification

| Gate | Direct result | Evidence |
| --- | --- | --- |
| Stable full gate | 763 pass, 8 skip, 0 fail; typecheck, contract typecheck, and build pass | `.tmp/task11-final-check-7f524d8.json` |
| Stable gate process safety | 52.176 seconds; 0 timeout, 0 residual root, 0 residual child, exit 0 | same report |
| Exact Router shards | 8 reports; 185 accounted; 184 pass, 1 skip, 0 fail | `.tmp/router-task11-7f524d8-0.json` through `-7.json` |
| Router process safety | 0 timeout, 0 residual root/child, 0 bad exit | same eight reports |
| High-risk media/output-only reruns | 60 pass, 0 fail after event-boundary correction | terminal evidence before `7f524d8` |
| Two-task recovery reruns | 30 pass, 0 fail, 0 timeout/residual | `.tmp/task-recovery-rerun-30-event.json` |
| Two named tasks reruns | 30 pass, 0 fail, 0 timeout/residual | `.tmp/two-named-tasks-rerun-30-v2.json` |
| Official dependency audit | `No vulnerabilities found` | fresh `bun audit` with `https://registry.npmjs.org` |
| OpenSpec authority | valid; 4 artifacts, 3 requirement IDs | fresh `bun run quality:authority` |
| Evidence manifest | valid; 5 targets, 1 passed automated evidence row | fresh `bun run quality:evidence` |
| Pack dry run | 96 files, 1.89 MB unpacked | fresh `bun pm pack --dry-run` |

No terminated, timed-out, or orphaned run is counted as passing.

## Seven Gateway primitives

`tests/phase3-seven-primitives.test.ts` contains eight current tests across the
seven primitive groups. On the candidate SHA it passed 8/8 once and 160/160 across
20 reruns, with 0 failures, timeouts, or residual processes.

| Primitive | Automated behavior proved | Installed behavior |
| --- | --- | --- |
| 1. Authenticated status/MCP | signed bounded status protocol, role/scope/root binding, replay and secret-redaction negatives | Unproven |
| 2. UserPromptSubmit | fail-closed request/fence decisions on actual turn identity; invalid, unavailable, stale, wrong-owner, and uncertain negatives | Unproven |
| 3. Same-thread takeover | exact concrete root, owner/generation transitions, one-writer lease and durable fence semantics | Unproven |
| 4. Stop wake | identifier-only advisory wake; duplicate/missing wake converges through reconciliation and never supplies result text | Unproven |
| 5. Authoritative read | stable `thread/read` parsing, exact array position/digest, malformed/incomplete/wrong-root rejection | Unproven |
| 6. Competition/recovery | stale generation, race, crash/restart, high-water, and uncertain-state fail-closed behavior | Unproven |
| 7. Unbound/child exclusion | unbound roots and concrete child threads create no export/outbox obligation | Unproven |

These automated rows do not change `DESKTOP-001`, `DESKTOP-002`, or
`DESKTOP-003` from MISSING/PARTIAL to PASS. Task 12 must directly exercise the
installed Desktop/Hook/MCP/Gateway boundary.

## Candidate archive and Hook bytes

Fresh archive:

`F:/workspace/chat2codex-custom/.worktrees/weixin-phase3-gateway-integration/.tmp/task11-package-7f524d8-run2/chat2codex-0.8.0-desktop.1.tgz`

| Item | Result |
| --- | --- |
| Package version | `0.8.0-desktop.1` |
| Archive size | 328,630 bytes |
| Archive SHA-256 | `6a5821d515a823919e0c3e33212eeb1a7bb13dd10a050b439a0abcda387d4008` |
| File count | 96 |
| Unpacked size | 1.89 MB |
| `hook-client.mjs` | `97d50e2e311e352cde674f58eb62eb53e4b956a5255adc6a00c137aaf63d9f00` |
| `stop-wake.mjs` | `96e6d66f3a9eafca658459c124d33fd4b045de8aba2b998ad21f0930de789169` |
| `user-prompt-submit.mjs` | `9388ddd4d4900534729dcfc44d14928cb3f8cab306bf6a5cbdd9708ed08745e6` |

The archive SHA and size are byte-identical to the previously staged candidate,
as expected because the final Router changes are test-only. Raw extraction from
the actual gzip/tar archive reproduced all three Hook hashes exactly.

The high-confidence archive secret scan found no private key, common API-token,
or long bearer-token pattern. The generic `dependencies.secret` match in
`hook-client.mjs` is a variable reference, not embedded key material.

## Reusable-distribution RED evidence

CR-0006 was accepted after the Phase 3 implementation plan. The current archive
is a valid pre-install candidate, but it is not yet a reusable Windows product:

- `src/setup/service.ts` supports launchd/systemd only; `win32` defaults to
  systemd and then fails the Linux platform guard. Windows service tests are
  skipped.
- The packed `.env.example`, English README, Chinese README, and Phase 3
  installation runbook contain `F:/workspace/...` or `F:/Chat2Codex` examples.
- No integrated Windows install/upgrade/uninstall, fresh-key generation and ACL
  lifecycle, complete doctor matrix, or clean-Windows install-to-E2E evidence
  exists.

Therefore `DIST-001` and `DIST-002` remain partial and `DIST-003` remains missing.
The reusable-distribution design, plan, implementation, and non-production
verification continue under CR-0007; they are not mislabeled as Task 12.

## Rollback readiness

Repository rollback remains bounded: revert the isolated implementation/test
commits or select the prior reviewed archive; no installed state was changed. The
schema-v5/v6 fixture rehearsal proves fail-closed downgrade eligibility and exact
backup/restore mechanics on disposable bytes only. The installation and rollback
runbooks require exact package/config/state/process hashes, one writer, and
obligation reconciliation. Real rollback remains Task 12/production approval-gated.

## Remaining direct evidence

Before the overall Goal can complete, at minimum the following remain:

1. Task 12 real backup, key creation/ACL, installation/trust, Desktop restart, and
   the seven installed primitive behavior tests.
2. Production single-writer deployment/recovery and every named real Weixin
   inbound/outbound, media, retry/restart/dedup, multi-task, approval, workspace,
   and no-Codex-rerun row.
3. The reusable versioned Windows lifecycle and qualifying second or equivalent
   clean-Windows install/login/Codex/Desktop/E2E/upgrade/rollback/uninstall run
   required by `DIST-001..003`.

Each external action retains its separate action-time confirmation.
