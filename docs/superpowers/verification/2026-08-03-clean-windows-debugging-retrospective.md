# Windows CI and clean-Windows candidate debugging retrospective

Date: 2026-08-03 Asia/Shanghai

Status: `IN PROGRESS`

This is an evidence index and engineering retrospective. It is not a requirements
source. Requirements remain authoritative in `docs/requirements/` on the ledger
worktree. No evidence was read from, restored from, or replayed from damaged task
`019fc002-590e-7023-b7e5-2a802168f00a`.

## Scope and evidence vocabulary

- **Confirmed root cause** means a hosted-run log or preserved report contains the
  exact failing command/error and a later regression gate directly exercises it.
- **Inference** means the evidence is consistent but does not isolate one cause.
- **Unknown** means the failing report was not uploaded or the available log omits
  the inner shard detail. Unknowns are not rewritten as causes.
- GitHub links below are direct run links. Job IDs and downloaded log SHA-256 values
  are included where this debugging session independently inspected the full job log.

## Timeline (Beijing time)

| Time | Candidate / commit | Run / job | Direct result | Classification |
| --- | --- | --- | --- | --- |
| 09:47–09:48 | `.7` / `8df77f3` | [30777722847](https://github.com/qhd1996/chat2codex/actions/runs/30777722847), job `91576297724` | fast gate failed before clean job | Confirmed from earlier preserved run evidence: stale/missing `dist`, workspace containment false |
| 09:53–09:54 | `.7` / `58a9637` | [30777946002](https://github.com/qhd1996/chat2codex/actions/runs/30777946002), job `91576918553` | fast passed; native lifecycle failed | Candidate changed package bytes and was later reverted; failure did not qualify |
| 10:07–10:09 | `.7` / `ff37359`, `e165b26` | [30778518713](https://github.com/qhd1996/chat2codex/actions/runs/30778518713), job `91578518900`; [30778572613](https://github.com/qhd1996/chat2codex/actions/runs/30778572613), job `91578663822` | fast gate failed | Same build/stale-distribution family; no clean job |
| 10:13–10:14 | `.7` / `63c7464` | [30778775066](https://github.com/qhd1996/chat2codex/actions/runs/30778775066), job `91579229230` | fast gate failed | Explicit build step had been lost; restored by `caec69a` |
| 10:16–10:17 | `.7` / `caec69a` | [30778880333](https://github.com/qhd1996/chat2codex/actions/runs/30778880333), job `91579511746` | build passed; fast gate failed in hosted process enumeration | Confirmed environmental incompatibility in the wrapper path; changed to direct native lifecycle |
| 10:19 | `.7` / `693a293` | [30779001624](https://github.com/qhd1996/chat2codex/actions/runs/30779001624), job `91579850076` | fast passed; native lifecycle failed | Confirmed: Windows PowerShell 5 could not autoload `Microsoft.PowerShell.Security` |
| 10:21–10:22 | `.7` / `f661668` | [30779098291](https://github.com/qhd1996/chat2codex/actions/runs/30779098291), job `91580115539` | native lifecycle failed at `Get-Acl` | Full log SHA-256 `A0250742E6CA6E23835A77D5104E811B33A9684B0E2942C4B7A047E53E9C829E`; exact error `CouldNotAutoloadMatchingModule` |
| 10:34–10:37 | `.8` / `7157b99` → `a893129` | [30779732209](https://github.com/qhd1996/chat2codex/actions/runs/30779732209), job `91581875371` | ACL autoload fixed; native lifecycle reached key-root canonical check and failed | Full log SHA-256 `EC892FC4FEE3F577323BD6DC80D4811933763169532640F61B85EA4835E51EAE`; exact error `Gateway key root must not traverse a symbolic link` |
| 10:44–10:46 | `.8` / `976762f` | [30780027691](https://github.com/qhd1996/chat2codex/actions/runs/30780027691), job `91582705544` | fast gate failed | Full log SHA-256 `DBFB3888E5C9B069A06DACA26A0FD3F9E702C9C3E6E8862764DDFD325C0B299D`; 5 s native lifecycle test and restart fault-injection both timed out |
| 10:54–10:56 | `.8` / `95cb908` | [30780441421](https://github.com/qhd1996/chat2codex/actions/runs/30780441421), job `91583866844` | fast passed; native lifecycle failed | Full log SHA-256 `3BB3E5822E63407634C4E64AA9E15D17C34D7ADDBCE9002A0499971CA00DDCCF`; lexical home and canonical key paths diverged, manifest rejected keys outside home |
| 11:07–11:08 | `.8` / `8fea3d0` | [30780973740](https://github.com/qhd1996/chat2codex/actions/runs/30780973740), job `91585384532` | fast gate failed | Full log SHA-256 `46FC76148F05AB20DF4D110F05867E8A7B29F25475C58C1BF56E9CD1789F1A7F`; restart test alone hit 5 s because it synchronously queried CIM after the durable boundary |
| 11:12–11:13 | `.8` / `0d60108` | [30781253268](https://github.com/qhd1996/chat2codex/actions/runs/30781253268), job `91586177348` | fast passed; native lifecycle failed on second install | Full log SHA-256 `1578ED3266DB9F11937ADDF2451DB97BF47B5FB7C95A98AC8D8257B0CA73CDAF`; existing lexical key path failed canonical-file equality |
| 11:21–11:28 | `.8` / `46412aa` | [30781607399](https://github.com/qhd1996/chat2codex/actions/runs/30781607399), jobs `91587227286`, `91588078865` | repository job fully passed; clean job failed | Confirmed clean blocker `codex_cli_binary_missing`; failure artifact says cleanup complete, zero processes/users/task. Clean job log SHA-256 `78AE4E087AA3FD647E40F25A106569D1BE3596A09DDC065BDE4835C95FB42676` |
| 11:32–11:34 | `.8` / `b7be7e7` | [30782067568](https://github.com/qhd1996/chat2codex/actions/runs/30782067568), job `91588578476` | native/fast passed; 30-run failed at repetition 2 | Full log SHA-256 `CD2FC090AB44F422AC59584EF010C46BE58EE875F01262981C682EA0B8C7309D`. Inner failed shard was not uploaded: exact sub-failure remains **unknown** |
| 11:37–pending | `.8` / `e7d5f05` | [30782268855](https://github.com/qhd1996/chat2codex/actions/runs/30782268855), job `91589133547` | running; now always uploads repetition report | Current remaining remote blocker pending direct result |

## Confirmed root causes, hypotheses, and rejected paths

### Confirmed root causes

1. **Stale or absent `dist` in a clean checkout.** The package-bound tests had
   relied on local build residue. `a34aac3` makes every build clean old output;
   `caec69a` builds before package probes. The earlier attempt `58a9637` changed
   package bytes without a stable release identity and was reverted by `e165b26`.
2. **Windows PowerShell module autoload is not reliable on the hosted image.**
   `Get-Acl` was discoverable but `Microsoft.PowerShell.Security` could not load.
   `7157b99` imports the inbox module from `$PSHOME` before every `Get-Acl`/`Set-Acl`.
3. **Windows temporary paths have lexical/canonical aliases.** Returning realpath
   bytes for generated keys made them appear outside the lexical installation home;
   enforcing byte-equality on existing files repeated the error on second install.
   `8ae7424` and `51636ca` keep lexical paths for persisted configuration while still
   rejecting explicit junction ancestors.
4. **The restart test spent its 5 s product deadline in a separate CIM query.**
   `7dad3bb` emits PID and creation time at the already durable boundary and removes
   the unrelated shell round trip. The product wait was not increased.
5. **The official Codex npm layout puts `codex.exe` in the optional platform
   package.** The clean job searched only `node_modules/@openai/codex`. A local
   official-registry install showed the executable below
   `node_modules/@openai/codex-win32-x64/vendor/.../codex.exe`. `b7be7e7` searches
   the closed `node_modules/@openai` subtree for exact `codex.exe`.

### Inferences

- Hosted Windows may expose a short-name or runner alias under `%TEMP%`; the exact
  alias form was not logged. The product defect is still confirmed because the
  lexical/canonical split and manifest rejection were explicit.
- The repetition-2 failure on run `30782067568` may be a remaining timing/resource
  issue, but this is only an inference until the retained report from `e7d5f05` or
  a later run identifies the actual shard output.

### Unknown or rejected paths

- AppX repair/reinstall is unrelated to this CI path and was not attempted.
- `plugin/list` was not used.
- A broad `PSModulePath` override was insufficient as a root-cause reproducer on
  the local host because the module was already discoverable there; the hosted log
  remains the authoritative reproduction.
- Simply replacing lexical paths with realpaths was rejected: it repaired one
  comparison while breaking manifest containment.
- The local 30-run pass does not explain remote repetition 2; it only proves the
  failure is not deterministic on this host.

## TDD and regression evidence

| Fix | RED evidence | GREEN evidence |
| --- | --- | --- |
| `7157b99` explicit ACL module import | new source test failed at `server.ts`, received `-1`; hosted jobs `91579850076` and `91580115539` failed `Get-Acl` | 38 focused ACL/Gateway tests passed; hostile `PSModulePath` test passed; hosted run later advanced beyond ACL |
| `6dca907`, superseded by `8ae7424`/`51636ca` | hosted job `91581875371` failed key-root canonical check; hosted jobs `91583866844`/`91586177348` exposed manifest/file-path follow-ons | local native lifecycle reports 2 installs, 2 uninstalls, 3 distinct keys, no residual; junction negative remains; hosted repository job `91587227286` passed |
| `95cb908` split native lifecycle from fast shard | new combined test exceeded 5 s at repetition 27; failed report SHA-256 `597D7CD534C8D5AC6575B4A43EE2B691A8381D27ACDD0781707835FEF91FCC39` | fast shard no longer runs the native lifecycle; dedicated native step retains it |
| `7dad3bb` in-band restart identity | hosted `91585384532` timed out at 5,016 ms during CIM identity lookup | isolated restart test passed in 157 ms; local stable suite passed; no deadline change |
| `b7be7e7` optional Codex package lookup | new workflow test failed because the expected platform-tree search did not exist; clean job `91588078865` recorded `codex_cli_binary_missing` | workflow test 2/2 passed; official-registry layout probe found `@openai/codex-win32-x64/.../codex.exe`; remote clean proof pending |
| `e7d5f05` preserve failed repetition report | run `30782067568` failed repetition 2 but uploaded no artifact | workflow now has an `if: always()` repetition-evidence upload; run `30782268855` is the first direct verification |

## Environment differences and immutable candidate evidence

- Local tests use Node `24.14.0`; hosted setup reported Node `24.18.0`. Both satisfy
  the declared Node requirement. System PATH on this machine still contains old
  Node `16.17.0`, so gates explicitly prepend the bundled Node.
- Local and hosted workflows pin Bun `1.3.9`; release zip SHA-256 is
  `f4c1cf3549f6af986dc6535c40b4785ff1a7e7805e59637ec450fc11adb0c874`.
- Current candidate is `0.8.0-novice.8`. Two detached clean checkouts at product
  source `51636ca`/workflow descendant `e7d5f05` produced byte-equal 411,309-byte
  archives, SHA-256
  `73BD1D09EDBC0A09D96DA3727EE9A9237C53135395F04D9100999E8DBF0AC179`,
  131 files. Workflow-only commits do not alter package bytes.
- Local temporary-Codex-Home proof used the exact archive, signed Codex `0.146.0`
  (SHA-256 `BC343BA420DC2E2E9F59E6FC5E5BF0AAE1CD8C771FC319665241FC9C0271FDDB`)
  and Node `24.14.0`: 2 untrusted Hooks, 0 errors/warnings, 1 disabled MCP, no
  `plugin/list`; config SHA-256
  `852B1C207902C59A0A6C9C2B222D47FD15D33290DFB85D0603E70EA71837D6BD`.
- Latest local stable suite: 902 pass, 8 documented platform-conditional skips,
  0 fail across 87 files; typecheck/contracts/build passed.
- Latest complete local matrix at `0d60108`: 30 × 19, 570 scenario executions,
  1,980 test passes, 0 fail/skip/timeout/residual; report SHA-256
  `015323F7C129AACE9D27D964F6CA3945008D1A166D72661CFDAAF31C99DE115A`.
- Seven primitives: 20 × 8 = 160 pass, 0 fail; report SHA-256
  `592C47ADCDB590811F74A3BB5F6277BCE45FBE3AD9115C02DA780F136FCBB07A`.
- `.4 → .8` private npm chain: 2 installs/upgrades/rollbacks/uninstalls/reinstalls,
  v5→v6→v5→v6, exact task/delivered/pending identities, 0 residual; report SHA-256
  `40801FC8455CA0F86E7664A9E6D52AB340057230E42C6D9839027135F15B48DA`.

## Routing escalation

The main line is currently `gpt-5.6-sol / ultra`. Multiple subagent dispatches
returned empty payloads, so their claims were not used. After consecutive remote
failures the investigation changed from local-only reproduction to full hosted-log
download, exact SHA preservation, candidate supersession, and package-only evidence
inspection. This satisfies the requested escalation/change-of-path rule; no lower
model result was accepted without main-agent verification.

## Proof that gates were not weakened

- No production/test deadline was extended. The 5 s restart test remains 5 s.
- No failing test was skipped. A native lifecycle operation was moved out of a fast
  unit-test shard into an explicit required native workflow step and remains in every
  30-run repetition.
- ACL enforcement remains real: owner/SYSTEM/Administrators policy, another-user
  denial, explicit inbox-module load, and junction negatives remain.
- Clean Windows still has no repository checkout, requires a real Scheduled Task,
  exact archive hash/version, another-user ACL denial, real old-package chain,
  always-run cleanup, and zero-residual proof.
- Historical failures and negative reports remain under `.tmp/` and GitHub Actions;
  no prior report was overwritten.

## Current blocker, next step, ETA, rollback

Current blocker: run `30782268855` must complete. If its 30-run fails, the new
artifact will provide the first exact remote failed-shard payload; if repository
passes, clean job must directly confirm the Codex optional-package fix and then all
clean-Windows lifecycle/ACL/upgrade/rollback/zero-residual rows. Estimated remaining
CI time is 10–20 minutes per attempt; root-cause-dependent repair time is unknown
until the retained report is read.

Rollback is commit-scoped: revert only the offending fix/rebind pair and return the
candidate branch to the last reviewed SHA. No production files were changed by this
debugging work. Candidate package rollback retains `.7`; production remains installed
`.4`.

## Process defects and prevention

1. The first remote run happened before a hostile PowerShell-module-load probe. Add
   an image-level test that starts Windows PowerShell 5 with discovery unavailable.
2. The package tests initially consumed stale `dist`. Every package gate must build
   from an absent/clean `dist` before first remote push.
3. Lexical-versus-canonical Windows path behavior was tested for workspace routing
   but not for lifecycle manifests and second-install key reuse. Add a table covering
   temp aliases, explicit junctions, generated files, reopen, and manifest parse.
4. Codex npm layout was assumed. Before first remote run, install the exact official
   package into a disposable prefix and resolve the platform executable by exact name.
5. Failed 30-run details were not uploaded. Repetition reports are now always-run
   artifacts; make this a permanent workflow contract.
6. A five-second test contained unrelated shell/CIM work. Measure and budget each
   boundary independently; obtain identity in-band when the child already owns it.

## Interim statistics

- Remote Windows workflow attempts listed here: 15 through current run
  `30782268855`; 14 completed before it, all preserved.
- Completed failure classes: stale/missing build/package state; wrapper/process
  enumeration; PowerShell ACL autoload; lexical/canonical root; manifest/key path;
  fixed-deadline test overhead; Codex npm layout; one remote repetition failure whose
  inner cause is still unknown.
- Product/test/workflow repair commits since `8df77f3`: 23 commits through
  `e7d5f05`, including package hash rebinds and one explicit revert.
- Clean job `30781607399` zero-residual artifact: owned root false, environment root
  false, matching processes 0, residual users 0, residual task false.
- Final counts and the terminal run conclusion will be appended after the first full
  green repository + clean-package run.
