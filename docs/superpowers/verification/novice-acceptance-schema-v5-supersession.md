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

The `.3` schema-v4 report and every intermediate `.4` or `122d624` artifact remain
historical evidence only. They must not be used for approval or installation.

## Immutable candidate

| Item | Direct result |
| --- | --- |
| Version | `0.8.0-novice.5` |
| Source | `b2162323d21aed85866dd4ecde08c669ff3cb45b` |
| Size | 392,014 bytes |
| SHA-256 | `c657ac0743897ee758448f20aa25ba3d8d1848d68018f7c2e9909e26bf80234f` |
| Files | 131 |
| Reproduction | two new detached clean checkouts; byte-identical |
| Extracted package | 131-file closed-set verifier passed; three Hook hashes match |
| Package smoke | `.5` package/CLI equality; non-qualifying; owned root removed |
| Real old-package chain | `0.8.0-orchestrator.4` → `.5`; v5→v6→v5→v6; config/state/task/delivered/pending obligations preserved; zero process |

## Fresh gates

- Full stable after the final lifecycle and verifier changes: 894 pass, 8
  platform-conditional skip, 0 fail; typecheck, contract typecheck, and build pass.
- Official-registry `bun audit`: no vulnerabilities.
- OpenSpec/authority/quality/package: pass; checked-in templates remain `unproven`.
- Schema-v5 repository matrix: 30×19 scenarios, 570 execution records, 1,950
  tests, zero fail/skip/timeout/residual.
- Report: `.tmp/novice-repository-30-b216232.json`.
- Report SHA-256:
  `c8f18db4a3c76679d9e8832dd5e7c6b157044f8d5ccc74649745eb4a26a626f6`.
- The report intentionally has `attestation=null` and `realUpgrade=null`, so it
  is repository evidence only and cannot promote clean-Windows acceptance.
- The final `.5` extracted package generated and strict-parsed a new temporary
  Codex Home using signed Codex CLI `0.146.0` (`bc343b...1fddb`): exactly two
  untrusted Hooks, zero Hook errors/warnings, one disabled/unstarted MCP
  definition, and no `plugin/list`. The temporary config SHA-256 is
  `31bc30b14f8f267bcfe19509e65bcbd7e21be06fcda70b06a4d0ed7a209093b9`.
- Seven primitives passed 8/8 once and 160/160 over 20 fresh reruns with zero
  failure and no residual test process. Report SHA-256 is
  `2cb845e5a0ccf6c26aa27d5d3f438f3ab7db50c41fc23844da42607f41947b26`.
  Two earlier PowerShell wrapper attempts failed to parse Bun output and remain
  negative tool evidence; the route changed to direct Bun `spawnSync`.

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

The no-checkout clean-Windows job has not run. `DIST-002` and `NOVICE-001..003`
remain `PARTIAL`; `DIST-003` and installed `DESKTOP-001..003` remain `MISSING`.
Task 12, production writes/restarts, real `~/.codex`, Hook trust, Desktop restart,
Computer Use, real Weixin login/outbound, and the terminal success notice remain
unexecuted and separately gated.
