# Message Router Test Stability Verification

## Verdict

**Pass after test-harness fixes.** The previously unbounded high-CPU run was decomposed into eight deterministic shards under a process-tree-safe wrapper. Final evidence covers all 176 `message-router.test.ts` tests: 175 passed, 1 platform-dependent symlink test skipped, 0 failed, 0 timed out, and 0 residual root/child identities.

## Initial failure evidence

- Terminating parent tool cells left Bun child tests running. Two identified test children and their `bun run check` parents saturated CPU until explicitly terminated. A killed run was never counted as passing.
- The first 22-test shard containing the shutdown recovery test timed out after 90 seconds with 85.9 seconds of root-process CPU and no test summary. `taskkill /T` removed the tree and left zero tracked residuals.
- Binary search isolated `task recovery shutdown aborts and awaits every active task run`. Alone it timed out after 15 seconds with 14.6 seconds CPU.
- Instrumentation reached `dispose -> Promise.allSettled` and showed one active Codex promise plus one orchestrated wrapper promise never settling.

## Root causes and fixes

1. `ConcurrentTaskCodex`, a test fake, added its abort listener after earlier `await` boundaries. If shutdown aborted before listener registration, DOM `AbortSignal` did not replay the event and the fake waited forever. The test helper now resolves immediately when a signal is already aborted and otherwise registers a one-shot listener.
2. The same-root cancellation test waited for durable state but asserted the latest outgoing message before the cancellation reply was delivered. It now waits for the target message itself.
3. The two-task concurrency test waited for two fake Codex runs but read durable task records before both `onThreadBound` mutations completed. It now waits for both task thread IDs.

These are test-harness timing fixes. No production router logic changed.

## Safe wrapper

- `scripts/run-test-shard.mjs` records shard name/command, expected Bun summary counts, wall time, root CPU, exit, timeout, root identity, tracked descendants, and residual identities.
- On timeout it calls `taskkill /T /F` only after confirming `PID + CreationDate` still matches the launched root. Unknown/reused identity fails closed.
- Descendants are tracked only if created after the root and reached from the observed identity graph.
- A prior PPID-only check incorrectly associated an older responsive `AndrowsStore.exe` with a reused parent PID. Windows denied all attempted terminations; the process remained running with unchanged creation time. The wrapper no longer uses post-exit PPID alone.
- Wrapper tests: 4 passed, 0 failed. They cover PID reuse rejection, descendant time boundaries, timeout tree cleanup, and Bun stderr summary parsing.

## Final shard evidence

| Shard | Tests | Pass | Skip | Fail | Wall ms | CPU ms | Timeout | Residual identities |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 0 | 22 | 22 | 0 | 0 | 3561 | 484 | no | 0 |
| 1 | 22 | 22 | 0 | 0 | 2766 | 453 | no | 0 |
| 2 | 22 | 22 | 0 | 0 | 3565 | 1891 | no | 0 |
| 3 | 22 | 22 | 0 | 0 | 2418 | 422 | no | 0 |
| 4 | 22 | 21 | 1 | 0 | 2538 | 375 | no | 0 |
| 5 | 22 | 22 | 0 | 0 | 3511 | 359 | no | 0 |
| 6 | 22 | 22 | 0 | 0 | 3330 | 422 | no | 0 |
| 7 | 22 | 22 | 0 | 0 | 2366 | 469 | no | 0 |
| **Total** | **176** | **175** | **1** | **0** | **24055** | **4875** | **0** | **0** |

Additional focused evidence: the formerly hanging shutdown test passed three consecutive runs in about 1.9 seconds each with zero residual identities; the two-task thread-binding test passed three consecutive runs after its event-based wait.

## Remaining release gate

Integrate the test-only fixes into the Phase 2 branch, regenerate the shard manifest there (because the branch has newer approval-reviewer tests outside this file), rerun all eight router shards and non-router shards with the safe wrapper, then run typecheck/contracts/build/audit/pack serially. No terminated historical run is part of the pass count.
