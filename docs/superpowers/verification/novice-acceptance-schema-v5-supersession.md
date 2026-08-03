# Novice acceptance schema-v5 supersession

Date: 2026-08-03 Asia/Shanghai

Verdict: **repository and exact-archive pre-install gates pass for the schema-v5
candidate, but qualifying clean-Windows, installed Desktop, production, and real
Weixin evidence remain missing.**

## Supersession reason

Adversarial review proved that schema-v4 scenario executions could echo inventory
tokens while a synthetic driver self-certified every invariant. The coverage
validator also accepted obligations moved to the wrong scenario. Clean-Windows
evidence accepted hollow stage strings, late approvals, and failure paths without
an always-run owned cleanup proof. A separate lifecycle audit found non-transactional
task creation/rollback/uninstall, task-name drift, active-writer, rollback ACL, and
reparse-point gaps.

Commits `78f4b9c`, `122d624`, and `b216232` replace those boundaries. Scenario
coverage is code-owned per row, each execution binds named product-probe SHA-256
records, evidence comparison is semantic rather than JSON key-order dependent,
and clean-Windows stage evidence is closed, hash-only, approval-ordered, and
failure-preserving. Windows lifecycle operations now fail closed and are retryable.

The `.3` schema-v4 report and every intermediate `.4`, `.5`, `122d624`,
`b216232`, `8ff7ee3`, `e917aa5`, `7b0d1e0`, or `84c7430` artifact remain
historical evidence only. They must not be used for approval or installation.

## Immutable candidate

| Item | Direct result |
| --- | --- |
| Version | `0.8.0-novice.6` |
| Source | `11919dddfb20d3510fa0587c42926630ed0ce7c7` |
| Size | 392,178 bytes |
| SHA-256 | `81cdcb130550bff426e2386f8a921609ea7b3ad1255eec75b0c1cfa6bf784079` |
| Files | 131 |
| Reproduction | two new detached clean checkouts; byte-identical |
| Extracted package | 131-file closed-set verifier passed; three Hook hashes match |
| Package smoke | `.6` package/CLI equality; non-qualifying; owned root removed |
| Real old-package chain | `0.8.0-orchestrator.4` → `.6`; v5→v6→v5→v6; config/state/task/delivered/pending obligations preserved; zero process; evidence SHA-256 `fd1faae...c8762` |

## Fresh gates

- Full stable after the final lifecycle, evidence, and version changes: 896 pass, 8
  platform-conditional skip, 0 fail; typecheck, contract typecheck, and build pass.
- Official-registry `bun audit`: no vulnerabilities.
- OpenSpec/authority/quality/package: pass; checked-in templates remain `unproven`.
- Schema-v5 repository matrix at final source `11919dd`: 30×19 scenarios, 570 execution records, 1,950
  tests, zero fail/skip/timeout/residual.
- Report: `.tmp/novice-repository-30-11919dd.json`.
- Report SHA-256:
  `4759a35ec765ab6a7b4982c78abc607e0c82e1b86f8d00febe7e8f59d58afeab`.
- The report intentionally has `attestation=null` and `realUpgrade=null`, so it
  is repository evidence only and cannot promote clean-Windows acceptance.
- The final `.6` extracted package preserves the same three reviewed Hook hashes.
  Its 131-file closed set, path/secret scan, exact-package profile projection,
  double lifecycle, migration, Gateway fail-closed, cleanup, and zero-residual
  process proof passed. The earlier exact `.5` temporary-Codex-Home run generated
  and strict-parsed a new temporary Codex Home using signed Codex CLI `0.146.0`
  (`bc343b...1fddb`): exactly two
  untrusted Hooks, zero Hook errors/warnings, one disabled/unstarted MCP
  definition, and no `plugin/list`. The temporary config SHA-256 is
  `31bc30b14f8f267bcfe19509e65bcbd7e21be06fcda70b06a4d0ed7a209093b9`.
- Seven primitives passed 8/8 once and 160/160 over 20 fresh reruns with zero
  failure and no residual test process. Report SHA-256 is
  `2cb845e5a0ccf6c26aa27d5d3f438f3ab7db50c41fc23844da42607f41947b26`.
  Two earlier PowerShell wrapper attempts failed to parse Bun output and remain
  negative tool evidence; the route changed to direct Bun `spawnSync`.
- Windows workflows resolve only immutable action commits: checkout
  `3d3c42e...`, setup-node `8207627...`, setup-bun `0c5077e...`, artifact upload
  `ea165f8...`, and artifact download `d3f86a1...`. GitHub MCP resolved each tag
  read-only; no push, PR, or workflow dispatch occurred.

## Preserved failure and fix history

- The first final-source matrix attempt at `e917aa5` failed on repetition 6:
  `novice-restart.test.ts` exceeded its unchanged 5-second test deadline. The
  failed report is `.tmp/novice-repository-30-e917aa5.json`, SHA-256
  `441fff4289428ae341697ca54c7698567524f6b9fa14d5519bd9ab7d3c89253f`.
  Root cause was two redundant PowerShell process-existence probes inside the
  test. Commit `7b0d1e0` replaces them with a direct non-shell PID probe while
  retaining the pre-kill PID/creation-time check and outer residual audit. No
  deadline was extended.
- A later `84c7430` matrix was explicitly terminated and rejected when the tracked
  worktree changed during execution. It emitted no final report and is not counted.
- Two clean-checkout pack attempts failed under the machine PATH's unsupported
  Node `16.17.0`. The route changed to process-local bundled Node `24.14.0`; no
  global installation or PATH mutation occurred. Both detached checkouts then
  produced byte-identical `.6` archives.
- The configured npm mirror returned HTTP 404 for `bun audit`; the same lockfile
  passed against the official npm registry with zero vulnerabilities. No npm
  configuration was changed.

## Windows lifecycle hardening

- A failed or uncertain task creation is cleaned; rollback failures are visible.
- A managed prior task is verified before upgrade and restored only if it existed.
- An unmanaged same-name task, task-name drift, or incomplete rollback material
  fails before mutation.
- Uninstall stops exact entrypoint writers using PID plus creation time, verifies
  task absence, preserves the manifest until cleanup completes, and remains
  retryable when the task is already absent.
- Rollback files receive owner-only ACL verification. Existing junction/reparse
  components and non-canonical owned paths fail closed.

## Remaining hard gates

The no-checkout clean-Windows job for candidate branch
`candidate/novice-0.8.0-novice.6` has not run. `DIST-002` and `NOVICE-001..003`
remain `PARTIAL`; `DIST-003` and installed `DESKTOP-001..003` remain `MISSING`.
Task 12, production writes/restarts, real `~/.codex`, Hook trust, Desktop restart,
Computer Use, real Weixin login/outbound, and the terminal success notice remain
unexecuted and separately gated.
