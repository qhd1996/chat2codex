# Production State Copy v4/v5 Rehearsal

## Verdict

**Pass on a disposable copy; production was not modified.** The current production schema-v4 bytes were copied, migrated to v5, rolled back to the exact v4 backup for old-version loading, then restored to v5 for new-version loading.

## Source and isolation

- Production source: `F:/Chat2Codex/data/state.json`, read-only during the rehearsal.
- Source SHA-256: `CB1BF1F39ACDE7DADCAE52679C650236197C8570EDC7A253E5A1326E04552BD4`.
- Disposable root: `.tmp/production-state-20260802-132200` in this worktree.
- Production task remained `Running / 0x41301`, Node PID unchanged during copy/migration, and the live lock continued advancing.

## Migration evidence

- New store load/save migrated schema `4 -> 5`.
- `state.json.v4.bak` SHA-256 equals the source state hash byte-for-byte.
- Migrated v5 SHA-256: `92451711C74F4D367BD30B60B4FB1161EFE7594BB263D50AA3E8561E3DBD6233`.
- Invariants before/after: 1 adapter, 4 tasks, 1 conversation, 1 chat, 9 jobs, 4 delivered outbox entries, 0 pending messages, 0 image drafts, 0 clarifications, 12 processed IDs, 3 threads and 3 unique thread owners.
- Job status distribution remained 5 cancelled / 3 completed / 1 interrupted. Outbox remained 3 markdown / 1 text, all delivered.

## Old/new compatibility and rollback

1. Installed `0.8.0-orchestrator.4` store loading disposable v5 failed closed with `Unsupported bridge state schema version: 5` (exit 2).
2. Copying the exact `.v4.bak` over the disposable state allowed old `.4` to load 4 tasks / 3 unique threads / 9 jobs / 4 outbox (exit 0).
3. Copying the preserved v5 snapshot back allowed the new store to load the same invariants (exit 0).
4. The immutable v4 and v5 snapshot hashes did not change during the exercise.

## Operational consequence

Rollback from Phase 2 to `.4` must restore the exact schema-v4 backup before starting old code. Old code must never be pointed at the only v5 state copy. Forward restoration may then reinstall new code and restore/reload the v5 snapshot. Production deployment remains single-writer and must recheck process, task, lock, state hash, tasks, unique thread ownership, jobs, and outbox.

## Commands and artifacts

- Migration: `bun scripts/state-v4-v5-rehearsal.ts <source> <disposable-root> <adapter-id>`.
- Compatibility load: `node scripts/state-load-probe.mjs <store-module> <state> <adapter-id> <home>`.
- Machine result: `.tmp/production-state-20260802-132200.result.json`.
