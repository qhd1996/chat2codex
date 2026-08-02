# Novice acceptance schema-v4 supersession

Date: 2026-08-03 Asia/Shanghai

Verdict: **repository and exact-archive pre-install gates pass for the schema-v4
candidate, but qualifying clean-Windows evidence remains missing.**

## Supersession reason

Security review found two weaknesses in schema v3: `realUpgrade` accepted unknown
fields, and the lifecycle attestation did not independently bind the pinned old
archive hash/commit. Although the runner verified actual old bytes, a generated
artifact could splice another old-package record into the same run/environment.

TDD RED proved both defects. Schema v4 now requires exact `realUpgrade` fields and
binds candidate archive/commit, old archive/commit, run identity, and owned
environment inside the independently hashed lifecycle attestation. Commit
`01cf6019b8d47cedcf412374e5c76119a0305002` contains the fix.

The prior `.2` candidate and schema-v3 reports remain historical evidence but are
superseded for all future approvals and clean-Windows runs.

## Immutable candidate

| Item | Direct result |
| --- | --- |
| Version | `0.8.0-novice.3` |
| Source | `01cf6019b8d47cedcf412374e5c76119a0305002` |
| Size | 387,404 bytes |
| SHA-256 | `7ac689a3058ae7d64c785630a34768341ad8934e70c70ac755cc1b7054d97ac8` |
| Files | 131 |
| Reproduction | two detached clean checkouts; byte-identical |
| Extracted package | closed-set verifier passed; 3 Hook hashes match |
| Package smoke | `.3` package/CLI equality; non-qualifying; cleanup root absent |
| Real old-package chain | `0.8.0-orchestrator.4` → `.3`; v5→v6→v5→v6; config/state/obligations preserved; zero process |

## Fresh gates

- Full stable: 879 pass, 8 platform-conditional skip, 0 fail; typecheck, contract
  typecheck, and build pass.
- OpenSpec/authority/quality/package: pass; templates remain `unproven`.
- Schema-v4 matrix: 30×19 scenarios, 570 execution records, 1,890 tests, zero
  fail/skip/timeout/residual.
- Report: `.tmp/novice-repository-30-01cf601.json`.
- Report SHA-256:
  `ca9d39616d6560618338fd36ebda4eba51078696ec3ed4994c5b54f75a0bae54`.
- Matrix process exited normally; stderr 0 bytes; matching processes 0.

## Remaining hard gate

The no-checkout GitHub-hosted job has not run. Therefore `DIST-002` and
`NOVICE-001..003` remain `PARTIAL`; `DIST-003` remains `MISSING`. The current
GitHub MCP identity is `qhd1996`, but upstream collaborator enumeration returned
`403 Must have push access` and upstream has only protected `main@f843ba5`. No
candidate branch or PR exists. A push/fork/PR/workflow dispatch is an external
write and remains separately approval-gated after 09:00.

Task 12, real `~/.codex`, Hook trust, Desktop restart, production writes/restarts,
Computer Use, and real Weixin actions remain unexecuted and separately gated.
