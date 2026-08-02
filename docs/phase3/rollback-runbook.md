# Phase 3 rollback runbook

> STOP-ROLLBACK: execution is a production/config/Hook action and remains separately approved. Never downgrade or uninstall while any Desktop/uncertain binding, active generation fence, wake, release request, staged result, or undelivered outbox obligation exists.

## Decision gate

Read state through the one production writer and stable authoritative thread/read; time or lease expiry never proves completion. Record hashes before and after every step. If reconciliation cannot prove a terminal ordered root, mark it uncertain and stop.

## Immediate bridge-only mode

This is the preferred feature rollback and preserves schema v6.

1. Enter maintenance mode and reject new bridge/Desktop starts.
2. Reconcile all bound roots, actual-turn fences, excluded control turns, wakes, release requests, staged results, and ordered outbox parts.
3. STOP-ROLLBACK if there is an active/uncertain binding, active fence, pending wake/release/staging item, or undelivered outbox entry.
4. CAS each proven-safe root to owner bridge at generation plus one. Disable Desktop takeover and MCP controls.
5. Revoke/rotate the Desktop MCP and Stop keys. Keep the trusted UserPromptSubmit Hook in fail-closed bridge-only mode until every formerly shared root is retired; otherwise Desktop could become a second writer.
6. Verify one production writer, no Desktop turn/fence, stable authoritative high water, stable state/outbox hashes, and normal bridge-only work before leaving maintenance.

This rollback requires production-write and, where applicable, ~/.codex/Hook/Desktop approvals. It does not authorize a real Weixin send.

## Full schema v6 to v5 downgrade

Perform only after immediate bridge-only mode succeeds and every Phase 3 obligation is absent.

1. Create and hash a new byte-exact schema-v6 backup; never delete older backups.
2. Retire every shared root from bridge execution or explicitly move it to a fresh bridge-only thread. Same-thread Desktop handoff becomes unavailable.
3. Re-run the copy-only v5/v6 rehearsal with the candidate and rollback package in fresh processes. Require preservation of all v5 partitions, Phase 2 staged hashes/order, and UsageAdvisor data.
4. STOP-ROLLBACK on any Desktop/uncertain binding, active fence, wake, release request, staged desktop result, undelivered outbox, reference/count/order/hash mismatch, future-schema read, or failed fresh-process load.
5. After separate production approval, stop only the exact scheduled Gateway and PID plus CreationDate. Restore the hash-verified v5-compatible package/config/state copies atomically; never kill unrelated Node/Codex processes.
6. Restart and verify bridge-only health, one writer, schema v5 fresh-process load, Phase 2 media/UsageAdvisor preservation, outbox resume without Codex rerun, and stable hashes.

## Hook and Codex Home removal

Full removal is later than safe feature rollback. After every formerly shared root is retired and separate ~/.codex/Hook/Desktop approvals are recorded, disable/remove the exact MCP and Hook definitions, revoke the three scoped keys, restart Desktop, and prove no stale active definition remains. Never edit broad config sections or delete the whole Codex Home.

## Recovery from failed rollback

Keep maintenance mode. Do not infer success from a process exit. Restore the most recent hash-verified schema-v6 package/config/state backup into a disposable copy first, validate it in a fresh process, then request fresh production authority for restoration. Preserve all failure evidence and leave installed/Goal acceptance rows unverified.
