# Novice daily-use acceptance pre-install verification

Date: 2026-08-03 Asia/Shanghai

Repository candidate SHA: `0466e126d0d0d6d4b639a66e3e4932ba001d00f5`

Requirements authority: `01e827bbdc6584136627d9f1f137e8051f0a8c97`

Verdict: **repository and exact-archive pre-install gates pass, but the novice
delivery gate remains incomplete.** The checked-in template remains
`qualifying=false` / `unproven`. A qualifying clean Windows VM or equivalent
isolated Windows run has not been obtained, so `NOVICE-001..003` are only
`PARTIAL`, `DIST-003` remains `MISSING`, and the Goal stays active. A failed
or missing novice row blocks delivery regardless of unit tests or package success.

## Scope and safety boundary

- Worktree/branch: `.worktrees/novice-acceptance-simulation` /
  `feat/novice-acceptance-simulation`.
- Scenario inventory: 19 closed, table-driven scenarios in
  `quality/scenarios/novice-daily-use.json` covering fresh, upgrade, and recovery
  users.
- Real state/security boundaries are exercised through lifecycle, schema,
  ownership/generation, Gateway authentication, reconciler, outbox, process
  identity, and redaction code. Only prohibited external transports and peers are
  simulated.
- No production write/restart, real user Codex Home change, Hook install/trust,
  Desktop restart, Computer Use, real Weixin login/outbound, or Task 12 action was
  performed.
- The conditional terminal Weixin message was not sent because the Goal is not
  complete.

## Final reproducible archive

Both archives were produced from independent detached clean checkouts of the same
commit, after `bun install --frozen-lockfile` against the official npm registry
and a Node 24 build.

| Property | Candidate A | Reproduction B |
| --- | --- | --- |
| Commit | `0466e126d0d0d6d4b639a66e3e4932ba001d00f5` | same |
| Version | `0.8.0-novice.2` | same |
| Size | 387,190 bytes | 387,190 bytes |
| SHA-256 | `5949cdc7dfd76575928eab9d6bfa3f007359f2a5c4ff5a243ab073c0da186e84` | same |
| Byte comparison | equal | equal |
| Files | 131 | 131 |

Candidate A:
`F:/workspace/chat2codex-custom/.worktrees/novice-final-0466e12/.tmp/pack/chat2codex-0.8.0-novice.2.tgz`

The extracted-package verifier passed on Candidate A: 131 files scanned, three
Hook hashes matched, the closed top-level set matched, and machine-path/secret
hits were zero. Package provenance, Windows/Node/Codex/Desktop support fields,
state-schema read range `4..6`, and write schema `6` are present.

Hook SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `hook-client.mjs` | `97d50e2e311e352cde674f58eb62eb53e4b956a5255adc6a00c137aaf63d9f00` |
| `stop-wake.mjs` | `96e6d66f3a9eafca658459c124d33fd4b045de8aba2b998ad21f0930de789169` |
| `user-prompt-submit.mjs` | `9388ddd4d4900534729dcfc44d14928cb3f8cab306bf6a5cbdd9708ed08745e6` |

## Exact-archive package smoke

The runner and worker were invoked only from Candidate A's extracted package. The
archive hash was checked before private installation. The owned root was outside
the repository, production, and real user profile.

| Probe | Result |
| --- | --- |
| Evidence level / verdict | `isolated_profile_projection` / `package_smoke`; deliberately non-qualifying |
| Package / installed CLI | `0.8.0-novice.2` / `0.8.0-novice.2` |
| Durable tasks / outbox | 2 / 3 |
| Network recovery | pass |
| Gateway wrong-token, unbound-root, child-thread exclusion | fail closed |
| Schema migration backup / rollback | exact source and rollback hashes |
| Install / uninstall attempts | 2 / 2 |
| Fresh key fingerprints | 3 distinct keys |
| Default uninstall data preservation | pass |
| Owned residual files | 0 |
| Post-cleanup owned root | absent |
| Post-cleanup matching processes | 0 |

Worker hashes: manifest
`fcee658f28a937a88981d3aad5691ec2373c5a2cb8a6464a64259c7ea7a8e551`;
rollback state
`4e0596c113a538a2a0c8b4660716e27bf0b111fc8b82f4b5a8dd4723ea9f0f14`.

## Repository stability and novice matrix

| Gate | Result |
| --- | --- |
| Full stable gate | 879 pass, 8 platform-conditional skip, 0 fail; typecheck, contracts, and build pass |
| Router closed set | 184 tests across eight exact-name shards |
| Router result | 183 pass, 1 Windows symlink skip, 0 fail/timeout/residual; 2.390-3.861 seconds per shard |
| Novice matrix | 30 complete repetitions x 19 scenarios |
| Novice result | 1,890 test passes, 30 x 19 scenario coverage, 570 per-scenario execution records, 0 fail/skip/timeout/residual |
| Repository binding | `repositoryCommit=0466e126d0d0d6d4b639a66e3e4932ba001d00f5` |
| Evidence level / verdict | `repository` / `repository_pass` |
| Matrix report | `.tmp/novice-repository-30-0466e12-rerun.json` |
| Matrix report SHA-256 | `855d47084caca706469e48683d0f9854ed85d974c21e86f7b13de58a66101fb7` |
| Matrix residual processes after completion | 0 |
| Property runs | fixed seeds, at least 100 runs per declared property |

The repository report intentionally records archive size/hash as zero values and
`freshProfile=false`; this prevents repository evidence from being promoted to
package or clean-Windows evidence.

OpenSpec strict validation passed 3/3 changes. Authority, Phase 3 evidence,
distribution, clean-Windows-template, and novice-template validators passed. The
official npm registry audit reported no vulnerabilities.

Recorded environment versions: Windows `10.0.26200` x64; Bun `1.3.14` with
embedded Node `24.3.0` for the matrix; Node `24.14.0` for build/package
verification; npm `8.15.0`; Codex CLI `0.146.0`.

Key commands, with machine-owned roots redacted:

```powershell
$env:Path='<node-24-bin>;' + $env:Path
$env:NPM_CONFIG_REGISTRY='https://registry.npmjs.org/'
bun install --frozen-lockfile
bun run check:stable
bun run quality:check
bun audit
bun pm pack --destination '<candidate-output>'
node '<extracted-package>/scripts/verify-distribution-package.mjs' '<extracted-package>'
node '<extracted-package>/scripts/run-novice-acceptance.mjs' --archive '<candidate.tgz>' --sha256 '5949cdc7dfd76575928eab9d6bfa3f007359f2a5c4ff5a243ab073c0da186e84' --owned-root '<owned-root>' --production-root '<excluded-production-root>' --cleanup
bun scripts/run-novice-matrix.mjs --repetitions 30 --report '.tmp/novice-repository-30-0466e12-rerun.json'
bun scripts/make-router-shards.mjs tests/message-router.test.ts 8
node scripts/run-test-shard.mjs --name '<router-shard>' --timeout-ms 90000 --report '<report>' -- bun test tests/message-router.test.ts --test-name-pattern '<exact-suffix-pattern>'
```

## Scenario coverage

| Environment | Direct automated coverage | Remaining qualification gap |
| --- | --- | --- |
| Fresh user | archive/hash and prerequisites; setup/login simulation; doctor; double lifecycle; task/text/image/file; multi-task/workspace/Plan; approvals/permissions/structured input; uninstall preserve and confirmed-only purge | fresh Windows profile and from-zero package-to-mock-E2E report |
| Upgrade user | pinned old commit `47c2272` built as `0.8.0-orchestrator.4`; exact old/candidate tgz hashes; real private npm install/upgrade/rollback/uninstall/reinstall, each twice; fresh-process v5/v6 stores; config/state/task/outbox/hash preservation | the same bound chain inside a qualifying clean Windows run |
| Recovery user | config/network/duplicate/crash/disk/permission/schema faults; Gateway offline/wrong token/expired generation; unbound/child non-export; property/fuzz and kill/restart | qualifying clean Windows fault and recovery run |

All novice-facing evidence is scanned for token/private-key/prompt/identity canaries
and unredacted Windows user paths. Prompts require what happened, what remains
safe, and a rollback-safe next action. An unknown action, missing prompt, failed
invariant, skip, timeout, or uncertain cleanup fails the scenario.

## Failure and repair record

Failures remain evidence and are not counted as passes.

1. Candidate `3e665a7` (368,910 bytes; SHA-256
   `4a84425ab93c7d191221b529fe588e19ba94b523f7753e503a265bbb1cfda81f`)
   could not start `npm.cmd` through Windows `spawnSync`, and the error path
   omitted `spawnError`. TDD added exact Windows npm CLI resolution through the
   current Node executable, no shell, canonical regular-file checks, an actionable
   fail-closed error, and a negative `npmXcmd` case. Fixed by `ea0bab2`.
2. Candidate `ea0bab2` passed package smoke, but its 369,214-byte SHA-256
   `98813da01c5b8ce3c2fc0f361ac74003e5da193d88bdc97cf3cfbc659734c10e`
   differed from a clean checkout's 369,124-byte SHA-256
   `71bcb086640f5e1edf6c0c0627cfa2aa85a2db5ca14e62a9bf6183eb3bd53606`.
   Ten packaged source files had history-dependent LF/mixed versus CRLF working
   bytes under global `core.autocrlf=true`. A RED distribution contract and
   repository `* text=auto eol=lf` policy fixed the cause in `d3c214f`.
3. The first official audit request reached a configured mirror that returned HTTP
   404. Re-running with the official npm registry returned zero vulnerabilities;
   the failed mirror request is not a pass.
4. The outer command wrapper stopped observing the 30-run matrix at 124 seconds,
   while the single matrix process remained alive under its own 90-second
   per-shard supervision. No second writer was started. The original process
   completed all 30 repetitions, wrote a validator-accepted report, removed its
   temporary shard directory, and left zero processes. This was an observation
   timeout, not a test timeout.
5. Four exact owned roots from the failed pre-fix npm-start investigations retain
   non-production failure artifacts because the local command safety layer refused
   recursive cleanup. Each was checked for zero matching process. They are not
   counted in Candidate A's zero-owned-residual result and must be removed only by
   a separately validated cleanup action.
6. The first package-level clean-Windows design allowed caller freshness flags and
   simulated lifecycle results to create a qualifying `pass`. Independent review
   rejected that evidence. Commit `8d7f04a` introduced schema-v2 evidence; the
   current schema-v3 contract additionally binds the archive, repository commit,
   run identity, owned environment, and every executed scenario token so separate
   lifecycle and journey runs cannot be spliced into a pass. It requires a
   hash-bound GitHub-hosted no-checkout attestation, real current-user
   Scheduled Task install/start/graceful stop/restart/double-uninstall/reinstall,
   exact PID+CreationDate single-writer/lock proof, another-interactive-user ACL
   denial, eight installed-file hashes, thirty unique stopped-process proofs, and
   fixed failure history. The remote job has not run; this is implementation
   readiness, not direct clean-Windows evidence.
7. Two full/isolated Router runs exceeded the durable-capacity test's five-second
   test budget. Exact diagnosis showed two sequential convergence waits sharing
   one budget. The test now waits for the sender durable-failure event and verifies
   the capacity notice persisted; the independent retry-scheduler test retains
   retry behavior. The exact test moved from 6.53 seconds/fail to 1.84 seconds/pass
   without extending a timeout, and the fresh full gate passed.
8. Review found the first schema-v3 repository matrix copied per-scenario records
   from the inventory without executing the package matrix in every repetition.
   A RED workflow contract failed, and `0466e12` added both the package matrix and
   real-upgrade validator to every repetition. An older run was allowed to finish
   but was retained only as negative evidence.
9. The first `0466e12` matrix observation reached 30 fast / 29 native reports when
   the outer 304-second wrapper terminated the root process. It produced no final
   report and was not counted. A new hidden background run started from zero with
   PID/CreationDate identity, completed 30/30, exited normally with zero-byte
   stderr, passed schema-v3 validation, and left zero matching processes. No
   internal timeout was extended and no partial repetitions were reused.

## Clean Windows qualification audit

Read-only host inspection found no Windows Sandbox executable, Docker runtime, or
available Hyper-V management cmdlet. WSL cannot provide an equivalent clean
Windows environment. The host exposes two ordinary non-administrator sandbox user
accounts, but one existing profile is unreadable from this context and the other
has no created profile. No current evidence proves all required fresh-profile,
repository-absent, prior-package-absent, service/state/secret-absent flags. Neither
account is therefore claimed as a qualifying environment. No account, password,
profile, ACL, VM, or process was changed.

The package now ships a no-checkout `windows-latest` job and strict schema-v3
validator. The build job produces the reviewed candidate and a hash-bound old
package from pinned commit `47c2272`; the no-checkout clean job downloads both,
privately runs the old/new lifecycle in one owned environment, creates and removes
a unique non-production Scheduled Task and temporary ACL test user, runs thirty
package repetitions, and emits redacted evidence and zero-residual artifacts. It
remains pending until an actual remote
run supplies those artifacts and cannot satisfy real Weixin/Desktop `DIST-003`.

## Routing and escalation

- Main-agent model and reasoning effort are not observable in this environment and
  are not invented.
- The independent npm/Windows review was requested as `gpt-5.6-sol/high`; it
  confirmed the old archive failure and 124/3/0 distribution closed set, but its
  report predated the final candidate. Final candidate claims rely on fresh direct
  verification above.
- Earlier agents repeatedly received empty or unrelated task payloads. Their
  outputs were rejected, and the primary agent changed to direct, boundary-by-
  boundary verification.
- Consecutive failures triggered changed paths: wrapper-layer tool calls to the
  correct orchestrator; Windows npm shell-wrapper attempts to a TDD process-launch
  fix; noisy PowerShell comparison to Node 24 byte comparison; and historical
  worktree packaging to two fresh detached checkouts.

## Remaining hard blockers

| Requirement | Status | Missing direct evidence |
| --- | --- | --- |
| `DIST-001` | PASS candidate evidence | release handoff remains coupled to final acceptance, but archive/version/manifest/hash/provenance/reproduction are direct |
| `DIST-002` | PARTIAL | clean/disposable Windows installed task, another-user ACL denial, doctor, upgrade, rollback, uninstall, reinstall direct run |
| `DIST-003` | MISSING | same reviewed archive on a qualifying clean Windows environment through install, real login, Codex/Desktop, E2E, upgrade, rollback, uninstall |
| `NOVICE-001..003` | PARTIAL | no-checkout clean Windows job is implemented with schema-v3 bound attestation but has not produced direct remote artifacts |
| Task 12 / `DESKTOP-001..003` | MISSING/PARTIAL | separately approved real backup, install, Hook trust, Desktop restart, and seven installed primitives |
| Real Weixin / production rows | PARTIAL/MISSING | separately approved production single-writer recovery/deploy and real inbound/outbound evidence |

## Rollback and next boundary

Before installation, rollback is to discard Candidate A and revert only the
isolated novice commits; no installed system changes exist. Generated evidence is
untracked and must not be confused with release inputs. After an approved install,
use the shipped hash-verified backup and lifecycle rollback, revoke only newly
owned keys/trust records, preserve user data by default, and re-prove one writer.

Next work is a qualifying clean Windows or equivalent isolated run. Real
`~/.codex`, Hook trust, Desktop restart, production, Computer Use, and each real
Weixin action remain separate action-time approval gates.
