# Phase 3 installation runbook

> STOP: Task 12 is not authorized. Do not modify ~/.codex, create scoped keys, install or grant Hook trust, restart Desktop, write production state, initialize Computer Use, or perform a real Weixin send. Reconfirm each action separately at execution time.

## Purpose and current state

Tasks 0–11 produce a reviewable package only. The repository Gateway remains disabled, the MCP patch is enabled=false, Hook definitions are inert examples, and the three Hook hashes are UNTRUSTED_UNTIL_TASK_12_APPROVAL. No file in this directory contains a token value.

The supported route is the authenticated IPv4 loopback Gateway at 127.0.0.1, bound to one explicit concrete root threadId. It does not depend on plugin/list; AppX repair or reinstall is outside this runbook. UserPromptSubmit is fail-closed and binds its actual turn_id to a durable generation fence. Stop is advisory wake-only. Stable thread/read(includeTurns: true) is authoritative. Unbound roots and concrete child Agent threads are non-exportable.

## Approval ledger

Record approver, timestamp, exact target, hashes, and scope before each row. Approval of one row does not authorize another.

| Action | Exact target shown before action | Separate approval |
| --- | --- | --- |
| ~/.codex changes | final config and Hook-definition paths under the current Codex Home | required |
| Hook trust | every exact path and SHA-256 in the Hook SHA-256 manifest | required |
| Desktop restart | current Desktop process/package identity | required |
| production write | package, launcher, config, state, and process targets under the selected `<CHAT2CODEX_HOME>` | required |
| Computer Use | exact Windows interaction sequence | required |
| real Weixin send | fresh target conversation/handle and final payload | required immediately before sending |

## Repository-only preparation already allowed

1. Build and package using bundled Node 24. Run bun run check, bun audit, and bun pm pack --dry-run.
2. Verify docs/phase3/hook-sha256.json against the three packaged files under scripts/codex-hooks/.
3. Stage the inert patch in a temporary Codex Home below the operating-system temporary directory. The helper refuses the declared real Codex Home:

   powershell: node scripts/stage-phase3-codex-home.mjs --package-root ABSOLUTE_PACKAGE_PATH --codex-home ABSOLUTE_TEMP_CODEX_HOME --real-codex-home ABSOLUTE_REAL_CODEX_HOME

4. Inspect phase3-staging/README.txt, config.phase3.toml, hooks.phase3.json, and the Hook SHA-256 manifest. This temporary Codex Home test does not install, trust, enable, or restart anything.
5. Generate and strict-parse an actual disposable config with bundled Node 24 and the signed Codex CLI. The verifier never calls plugin/list:

   powershell: node scripts/generate-phase3-temp-codex-home.mjs ABSOLUTE_PACKAGE_PATH ABSOLUTE_TEMP_CODEX_HOME ABSOLUTE_NODE_24_PATH

   powershell: node scripts/verify-phase3-temp-codex-home.mjs ABSOLUTE_CODEX_EXE ABSOLUTE_TEMP_CODEX_HOME ABSOLUTE_WORKSPACE

## Post-approval execution sequence

Pause again before step 1. Never substitute placeholders or infer approval from earlier repository work.

1. Read-only inventory: record active package/version/hash, launcher/config/state hashes, exact scheduled task/PID/CreationDate, Gateway bind state, Desktop package/version, Codex version, and current Hook/MCP status. Redact credentials.
2. After production-write approval, create a new timestamped backup without deleting older backups. Hash and byte-compare package, launcher, config, and state copies.
3. After ~/.codex approval, create three independent 256-bit base64url token files outside source control: prompt_hook, stop_hook, and desktop_mcp. Set owner-only protected ACLs. Record only path, key ID, ACL evidence, and redacted hash prefix; never record token bytes.
4. In fresh processes, require Gateway and every client to reject relative paths, symlinks, malformed keys, duplicate key material/path, wrong owner, inherited broad-read ACEs, and non-owner reads.
5. Materialize the reviewed inert MCP patch and exact Hook schema using absolute Node 24/package/token paths. Keep MCP disabled until its own approved enable point. Do not register SubagentStop.
6. After Hook trust approval, recompute hashes from installed bytes, compare with the manifest, inspect exact commands/timeouts/environment, then grant trust. Prove the active Hook inventory by the supported Hook status API; this is installed evidence, not a runtime dependency of the Gateway.
7. Behavior-prove missing executable, process crash, inner/outer timeout, changed/untrusted hash, disabled Hook, and conflicting Hook definition. Any ordinary prompt that silently continues is a hard failure: create no binding, disable Phase 3, and return to design.
8. After Desktop-restart approval, restart only the exact Desktop process. From a fresh process verify MCP status, signed/redacted Gateway status, exact IPv4 loopback bind, and identical concrete root threadId plus authoritative turn digest. Never copy Desktop history, SQLite, or JSONL.
9. Exercise installed ownership/fence/wake/reconcile behavior on one disposable root. Stop only reduces recovery latency; a missed/duplicate wake must converge through stable authoritative reads.
10. Pause separately before Computer Use and again immediately before the first real Weixin send. Re-enumerate the fresh intended handle and show the final text/image/file payload.

## Seven-primitive installed behavior matrix

Automated repository evidence is prerequisite only. Leave each installed row unverified until Task 12 direct evidence exists.

| Primitive | Required installed pass behavior | Direct evidence |
| --- | --- | --- |
| 1. Desktop status/MCP | authenticated redacted status reconnects on the same concrete root without plugin/list; bad key/Gateway-down leaks nothing | package/process versions, root/thread digest transcript, before/after state hash, timestamped Desktop capture |
| 2. UserPromptSubmit fence | only current Desktop generation creates one fence on actual turn_id; bridge/stale/unbound/uncertain/bad-auth/down/broken/untrusted/disabled/conflicting/child cases cannot submit | exact Hook inventory/trust/hash, exits/decisions, generation/fence snapshots, zero unexpected turns |
| 3. Same-thread takeover | bridge to Desktop to bridge increments generation and never clones/copies history or overlaps starts | identical thread IDs, authoritative thread/read, CAS log, process/turn timeline |
| 4. Stop wake | one, duplicate, missing, and crash-lost Stop converge; false payload and SubagentStop never export | redacted wake envelopes/IDs, restart scans, proof no hook/child text enters outbox |
| 5. Authoritative read | text and declared file bytes/hashes match stable thread/read; malformed/unavailable read advances nothing | protocol version/transcript, content/file SHA-256, ordered outbox and unchanged negative-state snapshots |
| 6. Single-writer race | bridge/Desktop/takeover/release/stale/expiry/crash races yield exactly one owner/generation/start | deterministic and installed timing trace, generation history, zero concurrent root turns |
| 7. Unbound/child exclusion | unbound root and concrete child thread create no wake/outbox/export across restart | root/child identity transcript, identical outbox hashes, zero delivery IDs, redacted exclusion diagnostic |

## Evidence bundle

Retain exact commands, UTC/local timestamps, commit and package SHA-256, manifest and installed Hook SHA-256, ACL reports, versions, PID plus CreationDate, signed-envelope metadata with HMAC/token/prompt/sender/path removed, state/outbox hashes, test counts, zero residual identities, screenshots, and every still-unverified requirement. A killed, timed-out, or partial run is negative evidence.

On any failure or unexpected write/send, stop; do not retry externally until scope and current state are re-reviewed. Follow rollback-runbook.md.
