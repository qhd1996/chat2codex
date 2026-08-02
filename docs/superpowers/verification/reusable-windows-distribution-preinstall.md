# Reusable Windows distribution pre-install verification

Date: 2026-08-02 Asia/Shanghai

Repository candidate SHA: `22b829e4096f88650b35f76b2d5b8a2adbb3837a`

Verdict: **Repository implementation and non-production pre-install verification
pass. Installed behavior and clean-Windows direct E2E remain unproven.** The Goal
stays active.

## Authority and scope

- Requirements authority: ledger `21a5800c4d725375af256a1e1c827bab75c3f034`
  with accepted CR-0006 (`DIST-001..003`) and CR-0007.
- Design: `2a1c740`; plan: `817c4b0`.
- Worktree/branch: `.worktrees/reusable-windows-distribution` /
  `feat/reusable-windows-distribution`.
- The project-local OpenSpec overlay is implementation metadata only. Both changes
  passed strict validation and the custom non-authoritative ledger lock.
- No production write/restart, real `~/.codex` change, Hook install/trust, Desktop
  restart, Computer Use, real Weixin action, or other irreversible external action
  occurred.
- No real current-user Scheduled Task was registered. Key-generation tests used
  fresh temporary directories and removed them.

## Delivered repository capabilities

- Versioned package `0.8.0-windows.1` with a closed archive manifest, compatibility
  matrix, provenance, required assets, Hook hashes, machine-path and secret scan.
- `windows-task` service target with current-user/least-privilege/logon XML, no
  overlap, bounded restart, unlimited long-run execution time, and an absolute
  package-owned launcher.
- Absolute Node/entrypoint/home/state/attachment/log paths and PowerShell/XML
  encoders; no developer username or drive is required.
- Three distinct 256-bit role keys, create-exclusive writes, SID-based ACL creation,
  independent owner-only ACL reread, symlink/format/duplicate rejection, buffer
  zeroing, and failure cleanup.
- Closed installation manifest; managed env block; atomic owned-file writes and
  exact readback verification; task registration last; queried launcher identity;
  failure unregister/restore.
- Upgrade rollback directory with copies of prior env/launcher/task XML/manifest/
  state plus SHA-256 record. Raw keys are not copied into the record.
- Installer ownership of created keys survives upgrades; preexisting valid keys are
  preserved and not deleted by uninstall. State, logs, credentials, user env lines,
  and deliverables remain by default.
- Read-only installed-distribution doctor decisions for platform/package/task/
  writer/lock/schema/keys/loopback/Hook/Desktop state with redacted recovery codes.
- Windows lifecycle, compatibility, troubleshooting, and clean-Windows E2E
  runbooks plus a fail-closed all-`unproven` evidence template.

## Fresh verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Distribution-focused gate | 107 pass, 0 fail; typecheck/contracts/build pass | final terminal run on `b5f735b`/unchanged product tree through `22b829e` |
| Full stable gate | 800 pass, 8 skip, 0 fail | `.tmp/windows-dist-final-check-22b829e.json` |
| Full gate process safety | 57.914 seconds; 0 timeout, root residual, or child residual | same report |
| Exact Router shards | 8 reports; 185 accounted; 184 pass, 1 skip, 0 fail | `.tmp/router-windows-dist-22b829e-0.json` through `-7.json` |
| Router process safety | 0 timeout, residual root/child, or bad exit | same reports |
| Failed-delivery recovery stress | 100 pass, 0 fail/timeout/residual with fail-fast state diagnostics | `.tmp/replay-final-diagnostic100.json` |
| Gateway concurrency stress | 100 pass, 0 fail/timeout/residual after event synchronization | `.tmp/gateway-concurrency-event100.json` |
| OpenSpec strict | 2 passed, 0 failed | `bun run openspec:validate` |
| Authority/evidence | two changes valid; Phase 3 automated manifest valid | `bun run quality:authority`, `quality:evidence` |
| Distribution verifier | version valid; 3 Hook hashes; 23 packaged input assets scanned; 0 forbidden | `bun run quality:distribution` |
| Clean-Windows template | qualifying=false; directPasses=0 | `bun run quality:clean-windows` |
| Official audit | no vulnerabilities | `npm_config_registry=https://registry.npmjs.org bun audit` |

The two full-gate failures before the final pass remain negative evidence. One
revealed that a restart-replay test could wait for an impossible state after an
unexpected terminal; it now fails fast with bounded redacted diagnostics and then
passed 100 reruns. The other revealed a fixed 20 ms guess in the Gateway
concurrency test; the second request now waits for the first controller-entry event
while the production concurrency limit and 100 ms deadline remain unchanged.

## Archive

`F:/workspace/chat2codex-custom/.worktrees/reusable-windows-distribution/.tmp/windows-dist-package-22b829e/chat2codex-0.8.0-windows.1.tgz`

| Property | Value |
| --- | --- |
| Size | 346,802 bytes |
| SHA-256 | `c48368fcfb96a5004ffeb753877b91022cbbdb06ece3ea3acf975a17c963acd6` |
| Files | 110 |
| Extracted-tree verifier | pass; closed top-level roots and provenance |
| High-confidence secrets/developer paths | 0 |
| `hook-client.mjs` | `97d50e2e311e352cde674f58eb62eb53e4b956a5255adc6a00c137aaf63d9f00` |
| `stop-wake.mjs` | `96e6d66f3a9eafca658459c124d33fd4b045de8aba2b998ad21f0930de789169` |
| `user-prompt-submit.mjs` | `9388ddd4d4900534729dcfc44d14928cb3f8cab306bf6a5cbdd9708ed08745e6` |

The verifier was run on the extracted archive `package/` tree, not only on the
source checkout.

## Routing and escalation

Status routing followed CR-0005. The main-agent inherited model/effort was not
observable. Explicit Sol/xhigh agents repeatedly received empty task payloads, so
the primary agent changed paths and performed implementation, diff/security review,
and verification directly. Consecutive failures triggered evidence-oriented path
changes: explicit event boundaries instead of sleeps, exact process identity,
closed manifest parsing, archive extraction validation, and transaction failure
injection. No unavailable model identity is claimed.

## Remaining direct evidence

| Requirement | Current state | Missing evidence |
| --- | --- | --- |
| `DIST-001` | Strong automated candidate | Independent clean-checkout reproduction and release handoff record |
| `DIST-002` | Automated implementation/rollback tests pass | Direct disposable/clean Windows install, task start/restart, ACL negative, doctor, upgrade, rollback, uninstall, reinstall |
| `DIST-003` | MISSING | Qualifying second computer/resettable clean VM from exact archive through Weixin login, Codex/Desktop, required E2E, upgrade/rollback/uninstall |
| Task 12 / `DESKTOP-001..003` | Unproven | Real backup, key/ACL, install, Hook trust, Desktop restart and seven installed primitives |
| Real Weixin/production rows | Unproven/partial | Separately approved real sends and production single-writer deployment/recovery |

## Next approval boundary

After 09:00 Beijing time, present separate action packets for a qualifying clean
environment: package installation/task registration, Weixin login, real
`~/.codex`, Hook trust, Desktop restart, Computer Use, and real Weixin sends.
Production remains a separate single-writer packet. Approval of one action does not
authorize another.
