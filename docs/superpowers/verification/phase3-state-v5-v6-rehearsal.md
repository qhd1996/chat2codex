# Phase 3 schema-v5/v6 copy-only rehearsal

Date: 2026-08-02 Asia/Shanghai

Verdict: **fixture rehearsal passed; production-state-copy rehearsal remains separately gated.** No production file, `~/.codex`, Desktop process, Hook trust state, or Weixin conversation was read or changed by this rehearsal.

## Scope and artifacts

- Script: `scripts/state-v5-v6-rehearsal.ts`
- Complete v5 fixture: `tests/fixtures/state-v5-complete.json`
- Automated coverage: `tests/state-v5-v6-rehearsal.test.ts`
- Untracked raw evidence: `.tmp/fixture-rehearsal-20260802205244/rehearsal-result.json`
- Source fixture SHA-256: `8fa76c9144dd7f4ffd9465d7785be3d00b38095c92217a5684920ff92c055ffe`
- Rehearsal script SHA-256: `ebdb190b24c4568c64a23857e24dfa395a72b0ed77f95b34dc4303c482be6282`
- Real schema-v5 compiled store SHA-256: `d93f2645b5cba333168d9f189026188b67639e21ba9c38914312c1696389a0f9`
- Current schema-v6 source store SHA-256: `c91518a71cdab948a345a04e8a37faaf0b2250d41616f716cbe1c8265ee84a61`

The fixture includes tasks, conversations, chats, jobs, pending messages, processed-message order, diagnostics, image drafts, clarifications, UsageAdvisor, delivered text/image/file outbox records, job delivery order, and staged-file hashes.

## Direct results

| Check | Evidence | Result |
| --- | --- | --- |
| Old v5 reads fixture v5 | Fresh child process, schema 5, 2 tasks, 2 jobs, 3 outbox | Pass |
| v5 to v6 preservation | Projection removing only `desktopGateway` is canonically equal | Pass |
| Exact v5 migration backup | Materialized input and `.v5.bak` both `89a3f74d2d8c06b52970e792d9d03a753bb65d61095027c0446bb3ab22ca98ae` | Pass |
| Old v5 on untransformed v6 | Fresh process: `Unsupported bridge state schema version: 6` | Pass, failed closed |
| New v6 reads migrated v6 | Fresh child process; counts/order/hashes unchanged | Pass |
| Rollback obligation gate | Complete fixture is blocked by `pending-message:pending-fixture` | Pass |
| Active obligation negatives | Desktop, uncertain, bridge binding, fence, wake, release, pending outbox, running job/task | Pass |
| Canonical v6 to v5 | After explicitly clearing the fixture pending-message obligation, removes only `desktopGateway` | Pass |
| Old v5 reads rolled-back v5 | Fresh child process; all retained partitions/order/hashes match | Pass |
| New v6 reads restored v6 | Exact v6 copy hash restored: `85fecb32eb26b6fd2dafcd29f0f688f9b80e21e498b188ad6da8ef44f2bb3309` | Pass |
| Staged bytes | Draft hash `14dc34...a4e61`; both media hashes `61cc78...38670`, before equals after | Pass |
| Production-path guard | `F:/Chat2Codex` source requires explicit flag; destination is always forbidden | Pass |

Focused verification on the same commit candidate:

```text
bun test tests/state-store.test.ts tests/state-v5-v6-rehearsal.test.ts
38 pass, 0 fail, 175 expect() calls

Node v24.14.0
bun run typecheck
exit 0
```

## Safety properties

The script requires explicit source, new destination, adapter ID, old-v5 module, and new-v6 module paths. Sources/modules must be canonical regular non-symlink files. The source is never rewritten or deleted. The destination must not exist, cannot be under `F:/Chat2Codex`, and receives only copies, generated fixtures, hashes, and the report. Each old/new runtime load runs in a fresh process.

Full downgrade is refused while any adapter has a bridge, Desktop, uncertain, or otherwise active binding; fence; wake; release request; pending message; non-delivered outbox entry; non-terminal job; or active task. No time-based expiry is treated as proof of completion. The transform changes schema 6 to 5 and removes only `desktopGateway` after the obligation scan returns empty.

## Remaining gate

This document does **not** satisfy Task 12. A production-state copy requires separate production-read/write authority at action time, exact production process/state revalidation, a fresh destination outside production, and the same hash/invariant checks. Installing, restoring, stopping or restarting production; changing `~/.codex`; trusting Hooks; restarting Desktop; Computer Use; and real Weixin sends remain separately unapproved.
