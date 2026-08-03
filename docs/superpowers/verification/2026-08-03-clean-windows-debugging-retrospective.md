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
| 11:37–11:45 | `.8` / `e7d5f05` | [30782268855](https://github.com/qhd1996/chat2codex/actions/runs/30782268855), jobs `91589133547`, `91589934140` | repository job passed; clean job failed | Exact failure was `Qualifying attestation requires an untouched real Codex Home`; setup actions create runner `~/.codex` before the no-checkout job |
| 11:39–11:48 | `.8` / `4ae9bb9` | [30782360782](https://github.com/qhd1996/chat2codex/actions/runs/30782360782), jobs `91589402258`, `91590274544` | repository job passed; clean job repeated same failure | Full clean log SHA-256 `8513BD57AC394B146D7CC60514C7550C5847F82E3E65810FC9AF9459C64BAE58`; cleanup artifact again proves zero residual |
| 11:54–12:02 | `.8` / `d3e3078` | [30782944296](https://github.com/qhd1996/chat2codex/actions/runs/30782944296), jobs `91591021226`, `91591919803` | repository passed; clean failed | Confirmed: projected Codex Home already existed; clean log SHA-256 `883B86CEE34718F48A6143338F0F61A5D15A87CE052D646A343CD44DCBDE7D02` |
| 11:54–11:55 | `.8` / `fccd0b8` | [30782984050](https://github.com/qhd1996/chat2codex/actions/runs/30782984050), job `91591126933` | repository failed before 30 repetitions | Exact ACL child timed out with empty stdout/stderr; this failure did not establish a new root cause |
| 11:59–12:06 | `.8` / `146abb1` | [30783164418](https://github.com/qhd1996/chat2codex/actions/runs/30783164418), jobs `91591620462`, `91592465692` | repository passed; clean repeated projected-Home failure | Reproduced |
| 12:06–12:07 | `.8` / `66163aa` | [30783483753](https://github.com/qhd1996/chat2codex/actions/runs/30783483753), job `91592499215` | repository failed in ACL child | Same empty-output child timeout; no clean job |
| 12:14–12:21 | `.8` / `bc992df` | [30783833662](https://github.com/qhd1996/chat2codex/actions/runs/30783833662), jobs `91593504408`, `91594447965` | repository passed; clean failed | Confirmed: protected/global npm state leaked into projected novice boundary |
| 12:27–12:34 | `.8` / `ce98e5d` | [30784466866](https://github.com/qhd1996/chat2codex/actions/runs/30784466866), jobs `91595289585`, `91596161257` | repository passed; clean failed | Confirmed: projected and protected global npm roots overlapped |
| 12:39–12:47 | `.8` / `8b10fe3` | [30785022833](https://github.com/qhd1996/chat2codex/actions/runs/30785022833), jobs `91596836087`, `91597614681` | repository passed; clean lifecycle failed without inner diagnostic | Diagnostic gap confirmed; fixed by retaining redacted lifecycle stderr |
| 12:51–13:01 | `.8` / `a633c4e` | [30785545916](https://github.com/qhd1996/chat2codex/actions/runs/30785545916), jobs `91598288106`, `91599110008` | repository passed; clean failed | Direct error: `Windows task state is uncertain` |
| 13:06–13:14 | `.8` / `a886723` | [30786190323](https://github.com/qhd1996/chat2codex/actions/runs/30786190323), jobs `91600064025`, `91600972255` | repository passed; clean failed | Direct rollback error: `/Delete` said task file not found |
| 13:19–13:28 | `.8` / `f027400` | [30786862444](https://github.com/qhd1996/chat2codex/actions/runs/30786862444), jobs `91601967155`, `91602866836` | repository passed all 30 repetitions; clean repeated rollback error | Confirmed: rollback treated an already-absent task as incomplete and masked the original `/Create` error; clean log SHA-256 `989150EC03E1FED604B4A4019560E65E1CB20888949D5F5DF19602DDDCCD32E0` |
| 13:43–13:52 | `.8` / `227e618` → `ff5502e` | [30788022310](https://github.com/qhd1996/chat2codex/actions/runs/30788022310), jobs `91605441460`, `91606400624` | repository passed; clean failed | Original create error now visible: task XML `(1,40) unable to switch the encoding`; clean log SHA-256 `3B15E549CE315D90A626C818CC00AA4BBFB5CCFC65675526693BC262F64E0B46`; zero residual artifact passed |
| 13:54–14:12 | `.8` / `c744f51`, `f490e6a` → `4bea083` | [30788904261](https://github.com/qhd1996/chat2codex/actions/runs/30788904261), jobs `91608153209`, `91609245138` | repository passed; clean failed | Advanced past task registration; another-interactive-user ACL helper failed. Clean log SHA-256 `57721CB6829153B0766DA9FC9C229968D3FCB658E018C086E6F38552D681E1C2`; zero residual artifact passed |
| 14:17–14:24 | `.8` / `4b4ce65` → `be6742f` | [30789668320](https://github.com/qhd1996/chat2codex/actions/runs/30789668320), jobs `91610363631`, `91611452428` | repository passed; clean failed | Redacted helper error confirmed `ConvertTo-SecureString` module autoload failure; clean log SHA-256 `40F8479029ED6B79AED591B18F316929A3DF4B2928B093E24053AF8C6EC8EBD5`; zero residual artifact passed |
| 14:29–14:36 | `.8` / `79591c2` → `7f83ed6` | [30790277747](https://github.com/qhd1996/chat2codex/actions/runs/30790277747), jobs `91612127542`, `91613255856` | repository passed; clean failed | Helper user launched but unexpected exit code was still generic; clean log SHA-256 `24B3C5684F5BC7DFD29F61159FAB3FB2785FE17138BA8AD642C700E85F58EF81`; zero residual artifact passed |
| 14:43–14:53 | `.8` / `9f46d55` → `3afd717` | [30791096324](https://github.com/qhd1996/chat2codex/actions/runs/30791096324), jobs `91614605402`, `91615730276` | repository passed; clean failed | Cross-user redirected-file SID proof was invalid; clean log SHA-256 `893D4420986A6C4D7255B8530A24D12BA96B48A9693A653E76366CCBB111906B`; zero residual artifact passed |
| 15:00–15:58 | `.8` / `f0466ed` → `faa494c` | [30791876218](https://github.com/qhd1996/chat2codex/actions/runs/30791876218), job `91616927253` | repository failed; clean skipped | Native lifecycle ACL inspector timed out at fixed 5 s with empty output; log SHA-256 `ED3C7720E14B9906569F684477D5DF5982C38B46BE5096B5001FD0147A4E539D` |
| 16:05–16:11 | `.8` / `db088ff` → `ba0ac79` | [30792210012](https://github.com/qhd1996/chat2codex/actions/runs/30792210012), jobs `91617951793`, `91619215078` | repository passed; clean failed | ACL timeout fixed; `Start-Process` passed pipe as a literal `whoami` option. Clean log SHA-256 `297D47873CD1A4F6E1C35AABFCCB0D4B8304E24879883B8BD2C67A4427997FC1`; zero residual artifact passed |
| 16:18–16:24 | `.8` / `8a04b3e` → `3120db0` | [30793010125](https://github.com/qhd1996/chat2codex/actions/runs/30793010125), jobs `91620355323`, `91621591908` | repository passed; clean failed | Advanced beyond another-user helper; second install SID PowerShell child failed empty. Clean log SHA-256 `E9C0402E470FF8A101943A0CAB571981BD7CD6F84AAF5F21D1470D22558B4A02`; zero residual artifact passed |
| 16:31–16:39 | `.8` / `b0a9b22` → `a8fee1c` | [30793753462](https://github.com/qhd1996/chat2codex/actions/runs/30793753462), jobs `91622623891`, `91623994418` | repository passed; clean failed | Advanced through ACL/SID gates to Scheduled Task readiness; no ready file in 15 s. Clean log SHA-256 `A2B4A85184615541BFA975EAF2FC23DB677E62DD10246DC47DEE8C366947D308`; zero residual artifact passed |
| 16:46–16:50 | `.8` / `4a344fc` → `2f6aefc` | [30794632293](https://github.com/qhd1996/chat2codex/actions/runs/30794632293), jobs [`91625320208`](https://github.com/qhd1996/chat2codex/actions/runs/30794632293/job/91625320208), [`91626525352`](https://github.com/qhd1996/chat2codex/actions/runs/30794632293/job/91626525352) | repository passed; clean failed | Readiness diagnostic itself threw `ReferenceError: logFile is not defined`, masking the Scheduled Task failure. Clean log SHA-256 `4880EA5BD82F49CA6669BDFB32CC64F5393A832E68F47EC6FB4A1A8E5F857464`; cleanup proved 0 processes, 0 users, 0 task and both owned roots absent |
| 16:53–17:01 | `.8` / `80f8093` → `992dcaa` | [30795295379](https://github.com/qhd1996/chat2codex/actions/runs/30795295379), jobs [`91627379356`](https://github.com/qhd1996/chat2codex/actions/runs/30795295379/job/91627379356), [`91628441400`](https://github.com/qhd1996/chat2codex/actions/runs/30795295379/job/91628441400) | repository passed; clean failed | Both calls accepted `logFile`, but no outer declaration existed; clean failed at the first call with `ReferenceError: logFile is not defined`. Log SHA-256 `309CBED0BC9C93BE888AD4C522FD8D89430F5DF402D901643B1C8061045DEC11`; cleanup again proved 0 processes/users/task and absent roots |
| 17:07–17:19 | `.8` / `8bc12c7` → `90c7367`, evidence heads `8d014f8` and `26b0aae` | [30796160808](https://github.com/qhd1996/chat2codex/actions/runs/30796160808), jobs `91630108769`, `91631687008`; [30796194757](https://github.com/qhd1996/chat2codex/actions/runs/30796194757), jobs `91630214001`, `91631653758` | both repository jobs passed; both clean jobs identically failed | Task was Enabled but returned `-196608`, with writers `0` and missing launcher log. Log SHA-256 values `722FC3D2D861514E0D0335B502C5198F6520BA7CDF8D55483BC39A8FD96A37C8` and `33ED60C32CBD4A7BC176849CC6E77FD73CB379606B4B7DF04D63234386A3E831`; both cleanup artifacts reported zero residuals |
| 17:36–17:41 | `.8` / `1baee84` → `30a3fed` | [30798020569](https://github.com/qhd1996/chat2codex/actions/runs/30798020569), jobs `91635935052`, `91636097432` | clean-package-only diagnostic run advanced through the full lifecycle and failed evidence validation | Repository packaging job completed in 46 s with deliberately deferred stable/audit gates; clean direct error `Novice process createdAt is invalid`. Log SHA-256 `3AC1DF474E246E54D23C65294B45EC5F58E90741C71B31E1EF3816C9CEAEAE58`; fail-closed cleanup proof had `InspectionComplete=true`, no error codes and zero residuals |
| 17:45–17:56 | `.8` / `972d678` → `546a293` | [30798631293](https://github.com/qhd1996/chat2codex/actions/runs/30798631293), jobs `91637843664`, `91639180587` | full repository/30-run job passed; clean repeated the process-proof timestamp failure | Final permitted hosted attempt. Clean log SHA-256 `ABC13455B41E5C2E35469DD2DE4930A24ECAB91887EE1EDA77DB935FD6A1B919`; cleanup again complete and zero-residual. No further push or hosted rerun is authorized under the 45-minute stop-loss box |

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
6. **A GitHub hosted account is ephemeral but setup actions may pre-create
   `~/.codex`.** Treating physical runner home as the fresh novice profile was too
   strict and not the tested user boundary. `9d51611` runs the lifecycle under the
   owned projected profile/Codex Home, requires that projected Home to start absent,
   and snapshots the pre-existing runner Home before/after to prove no mutation.
7. **Projected and protected npm state must be disjoint.** The first projected
   profile still resolved the hosted account global npm tree; later path composition
   overlapped the protected snapshot. `9d54efc` and `55d9b51` isolate the projected
   npm prefix and resolve the protected global root exactly.
8. **Task discovery cannot depend on Task Scheduler COM in this runner path.**
   The retained lifecycle diagnostic first exposed uncertain task discovery.
   `1c8d54b`, `9477f32`, and `d2979e1` use `schtasks.exe /Query`, type the spawn
   failure, and classify the observed hosted not-found statuses.
9. **Rollback must reconcile a failed `/Delete` against authoritative task
   absence.** Runs `30786190323` and `30786862444` showed `/Create` failure
   followed by `/Delete` reporting that the task file did not exist. The old code
   recorded that delete error as incomplete rollback and hid the create error.
   `227e618` accepts the delete failure only when a new `taskExists()` query proves
   absence; present or uncertain state still fails closed.
10. **Repository-local `.tmp` is not a valid Windows ACL lifecycle root on this
    machine.** Two complete matrix attempts failed on repetition 1 because the F:\-
    drive worktree grants the current user inherited Modify rather than FullControl.
    The same owner-only `SetAccessControl` primitive fails there and succeeds below
    `C:\Windows\Temp`. `c744f51` keeps the report in `.tmp` but moves disposable
    execution roots to `os.tmpdir()`.
11. **Task Scheduler rejects the declared UTF-8 task XML on both local and hosted
    Windows.** Run `30788022310` exposed `(1,40) unable to switch the encoding`. A
    four-way local native probe showed UTF-8 with or without BOM failed, while
    UTF-16LE+BOM and UTF-8 without an XML declaration both created, queried, and
    deleted unique tasks. `f490e6a` retains UTF-8 atomic writes and removes only the
    declaration, avoiding a new binary snapshot/rollback protocol.
12. **The another-user helper used a .NET API unavailable to Windows PowerShell
    5.1.** Local execution failed before user creation because
    `[IO.Path]::IsPathFullyQualified` does not exist in that runtime. `4b4ce65`
    replaces it with a closed local-drive absolute-path pattern and carries only
    redacted helper stderr into failure evidence. A local non-admin rerun advanced
    to the expected `New-LocalUser: Access denied`; the hosted elevated result is
    pending.
13. **PowerShell 5.1 module autoload also affected password construction.** The
    redacted run `30789668320` showed `ConvertTo-SecureString` could not load
    `Microsoft.PowerShell.Security`; the helper still had not reached user creation
    or key access. `79591c2` constructs a read-only .NET `SecureString` directly and
    retains the same password lifetime and cleanup boundary.
14. **A magic child exit code was not sufficient proof that another-user code
    executed.** Run `30790277747` returned an unexpected code after user creation,
    but did not identify the child security principal. `9f46d55` first launches
    `whoami.exe` with the temporary credential, verifies its SID against the created
    local user, and only then runs an independent `cmd.exe` read of the controlled
    key. Any wrong identity or launch failure remains fail-closed.
15. **Cross-user output redirection is not a reliable SID evidence channel.** Run
    `30791096324` reached the created-user child but its redirected `whoami` output
    did not validate. `f0466ed` removes the shared output file: the temporary-user
    process pipes its own `whoami /user` into `findstr` for the exact created SID,
    then a second process independently reads the key. Paths reject cmd
    metacharacters; key bytes never enter stdout.
16. **ACL inspection performed avoidable account-name lookup.** Run `30791876218`
    timed out with empty output inside the fixed 5 s ACL inspector. The script read a
    local ACL, converted its owner to `NTAccount`, then translated owner and ACEs back
    to SID. `db088ff` requests `SecurityIdentifier` directly through `GetOwner` and
    `GetAccessRules`; it does no account lookup. Thirty real create/inspect checks
    passed locally, maximum 725 ms, with the 5 s boundary unchanged.
17. **`Start-Process -Credential` did not preserve the composed cmd pipeline.** Run
    `30792210012` proved the ACL inspector fix (repository job passed) but `whoami`
    received `|` as an invalid literal option in the clean helper. `8a04b3e` replaces
    `Start-Process` with .NET `ProcessStartInfo` carrying explicit user/domain/secure
    password, captures `whoami` SID in memory, then separately reads the key with
    all output redirected to `nul`. No key bytes or plaintext password are logged.
18. **Current-user SID discovery did not need a PowerShell child.** Run
    `30793010125` advanced beyond the cross-user helper, then a second install failed
    while evaluating `WindowsIdentity` in an otherwise silent PowerShell child.
    `b0a9b22` calls `whoami.exe /user /fo csv /nh` and accepts exactly one bounded
    SID; empty, malformed, or multi-SID output fails closed.
19. **Scheduled Task readiness failures lacked the evidence needed to distinguish
    non-start from early crash.** Run `30793753462` advanced through install,
    another-user ACL, second install, and task registration, but no ready file
    appeared inside the unchanged 15 s boundary. `4a344fc` retains redacted verbose
    task status, exact writer count, and launcher log tail on that same failure.
20. **The new readiness diagnostic did not receive a complete log-path data flow.** Run
    `30794632293` reached the same failure path, then `startTask()` referenced a
    free `logFile` and threw `ReferenceError` before emitting task/writer/log
    evidence. `80f8093` added `logFile` to the function signature and both call
    sites, but run `30795295379` proved the value was still undeclared at the first
    call. `8bc12c7` now declares one path and reuses it for installer `--stderr`, both
    calls and the diagnostic reader. This confirms both diagnostic defects, but the
    underlying Scheduled Task start failure remained **unknown** at this point; the
    next two byte-identical runs isolated it below.
21. **Task Scheduler Exec arguments use Windows command-line quoting, not PowerShell
    expression quoting.** Runs `30796160808` and `30796194757` showed an Enabled task,
    Last Result `-196608`, zero writers and no launcher log; its action carried
    `-File '<owned-path>'`. A local two-task probe held everything constant: the
    single-quoted variant created no output while a double-quoted variant succeeded,
    and cleanup left zero probe tasks. `1baee84` emits XML-escaped double quotes,
    retains legacy single-quoted task parsing for upgrade/rollback, and creates the
    log parent before redirection. The exact product install/start/ready/stop/uninstall
    probe then passed under the unchanged 15 s boundaries with zero residual tasks.
22. **Windows PowerShell round-trip timestamps are not JS canonical timestamps.**
    Local CIM proof returned `...7199610Z` for `ToString('o')`, whereas the evidence
    contract intentionally requires `new Date(value).toISOString() === value`, or
    millisecond form `...719Z`. Run `30798020569` first exposed the attestation-side
    value; `972d678` corrected that branch. Full run `30798631293` then proved the
    package-matrix restart process proof had the same independent defect. `9936f7d`
    applies the same UTC millisecond format there; hosted proof is **not yet obtained**
    because the declared stop-loss forbids another GitHub attempt on this route.

### Inferences

- Hosted Windows may expose a short-name or runner alias under `%TEMP%`; the exact
  alias form was not logged. The product defect is still confirmed because the
  lexical/canonical split and manifest rejection were explicit.
- The repetition-2 failure on run `30782067568` may be a remaining timing/resource
  issue, but this is only an inference until the retained report from `e7d5f05` or
  a later run identifies the actual shard output.
- The exact original `/Create` error behind runs `30786190323` and `30786862444`
  remains unknown because the older rollback exception replaced it. The masking
  defect and absent-task delete result are confirmed; the hidden create cause is not.

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
| `9d51611` / `f787dbd` fresh projected Home | clean runs rejected the hosted `~/.codex`, then rejected a projected Home already created by setup | projected Home is owned, required initially absent, and the real runner Home is immutable by before/after snapshot |
| `9d54efc` / `55d9b51` projected npm isolation | runs `30783833662` and `30784466866` rejected prior/overlapping global npm state | later clean runs advanced to Scheduled Task discovery |
| `1c8d54b` / `9477f32` / `d2979e1` non-COM task query | run `30785545916` reported `Windows task state is uncertain` | repository gates passed and later clean logs returned the concrete hosted not-found status |
| `227e618` authoritative rollback absence | new regression failed with 18 pass / 1 fail: expected original `create result uncertain`, received rollback-incomplete delete error | 22/22 lifecycle tests; 46/46 related Windows tests; stable suite 906 pass, 8 documented platform skips, 0 fail; present and query-uncertain negatives remain closed |
| `c744f51` OS-temp matrix execution | two complete matrix starts failed at repetition 1 with .NET `UnauthorizedAccessException`; minimal ACL probe failed on repository F:\ `.tmp` and passed on OS temp | focused package/native probes passed; a subsequent 30×19 run passed but overlapped the next XML source edit and is retained as non-final evidence |
| `f490e6a` task XML encoding | rendering test failed 3 pass / 1 fail; native probe reproduced hosted `(1,40) unable to switch the encoding` for UTF-8 declaration with and without BOM | 26/26 task/lifecycle tests; native variants all create/query/delete after declaration removal; no test task remained |
| `4b4ce65` PowerShell 5.1 another-user helper | hosted run `30788904261` stopped at another-user denial; local helper reproduced missing `IsPathFullyQualified` before user creation | source contract and distribution tests 8/8; local helper advances to the non-admin user-creation boundary; hosted proof pending |
| `79591c2` module-free SecureString | hosted run `30789668320` failed before user creation because `ConvertTo-SecureString` could not autoload its module | source/distribution tests 8/8; local helper advances to non-admin `New-LocalUser` boundary; hosted proof pending |
| `9f46d55` identity-verified ACL child | hosted run `30790277747` reported only an unexpected magic exit code | tests require separate `whoami.exe` SID proof, cmd read, path metacharacter rejection, no encoded PowerShell; hosted proof pending |
| `f0466ed` in-process SID proof | hosted run `30791096324` rejected the redirected-file identity evidence | tests require exact SID match inside the temporary-user process, an independent key read, no redirect file and no encoded PowerShell; hosted proof pending |
| `db088ff` SID-only ACL inspection | hosted run `30791876218` killed the ACL inspector at 5 s with empty output | 30 real ACL create/inspect checks passed, max 725 ms; focused 36/36 and typecheck passed; timeout remains 5 s |
| `8a04b3e` explicit-credential process launch | hosted run `30792210012` passed the literal pipe to `whoami` | helper uses .NET process credentials, in-memory SID proof, an independent no-output key read, and rejects cmd metacharacters; hosted proof pending |
| `b0a9b22` native current-user SID | hosted run `30793010125` advanced past the helper, then the PowerShell SID child failed empty | parser RED covered missing implementation; 40 pass, 2 platform skips, 0 fail plus typecheck; hosted proof pending |
| `4a344fc` readiness diagnostics | hosted run `30793753462` reached task start but timed out without a ready file | tests require redacted task/writer/log diagnostics and retain the 15 s boundary; remote evidence pending |
| `80f8093`, superseded by `8bc12c7` readiness log binding | hosted run `30794632293` failed because the helper had no parameter; `30795295379` then failed at the first call because the value was undeclared; the final source-contract assertions fail against `80f8093` | one `logFile` declaration now feeds installer `--stderr`, both calls, the helper parameter and reader; 41/41 related tests, typecheck, contracts and build passed under Node 24.14.0/Bun 1.3.9; hosted proof pending |
| `1bc6644` fail-closed cleanup inspection | review and RED assertions showed `SilentlyContinue`, unchecked delete/query exits and CIM/user failures could yield false zeroes | hosted runs `30798020569` and `30798631293` both emitted `InspectionComplete=true`, empty `CleanupErrorCodes`, absent roots, 0 processes/users/task; query errors now force cleanup failure |
| `1baee84` Task argv/log parent | two hosted runs returned `-196608`, writers 0, log missing; local same-input probe: single quote no output, double quote output | exact product install/start/ready/stop/uninstall passed locally within original 15 s boundaries; 40/40 focused tests, typecheck/contracts; both legacy and current task XML accepted for upgrade |
| `972d678`, `9936f7d` process timestamp normalization | local Windows PowerShell produced seven fractional digits; remote runs rejected attestation and package-matrix process proofs as non-canonical | attestation/evidence/matrix tests 25/25 and 33/33 passed; exact product task probe remained green; final package-matrix change awaits equivalent-isolation proof |
| `2fb200f` task discovery fail-closed | review showed `ENOENT`, generic exit `1`, and `-1073741510` were all classified as absence, so a missing executable or interrupted query could authorize mutation | successful full CSV enumeration is now required; malformed/query-failed output rejects. A real temporary task proved absent→present→absent, and focused tests passed |
| `527ddfb` lifecycle ownership preflight | RED tests showed upgrade accepted hash-drifted rollback bytes, did not stop an orphaned prior writer, and uninstall deleted a drifted same-name task | hash/action checks and exact writer stop now precede every mutation; real install/start/ready/stop/uninstall passed with zero task residual; focused lifecycle/security gate 65 pass, 2 platform skips, 0 fail |

## Environment differences and immutable candidate evidence

- Local tests use Node `24.14.0`; hosted setup reported Node `24.18.0`. Both satisfy
  the declared Node requirement. System PATH on this machine still contains old
  Node `16.17.0`, so gates explicitly prepend the bundled Node.
- Local and hosted workflows pin Bun `1.3.9`; release zip SHA-256 is
  `f4c1cf3549f6af986dc6535c40b4785ff1a7e7805e59637ec450fc11adb0c874`.
- Current hosted candidate is `0.8.0-novice.8`. Two detached clean checkouts at
  product source `972d678` produced byte-equal 412,247-byte archives, SHA-256
  `85432737A75439FDCB8BF8218B8588F3F863A909D500F5889BE92C428F19F101`,
  131 files. Workflow binding commit is `546a293`. Local-only product head `9936f7d`
  changes package bytes and is superseded by current local product head `527ddfb`.
  Two detached clean checkouts at `527ddfb` produced byte-equal 412,622-byte archives,
  SHA-256 `CE912778D1A6B011FF5E291108C22D2563513913C8C65EF25379E255CCFF4179`,
  131 files. This local package is not yet a qualifying release candidate.
- Local temporary-Codex-Home proof used the exact final archive, signed Codex `0.146.0`
  (SHA-256 `BC343BA420DC2E2E9F59E6FC5E5BF0AAE1CD8C771FC319665241FC9C0271FDDB`)
  and Node `24.14.0`: 2 untrusted Hooks, 0 errors/warnings, 1 disabled MCP, no
  `plugin/list`; config SHA-256
  `A86CE3499F0EB64984C187AE594427D04C1D9662DBD931C717546BFEC1124526`.
- Latest local stable suite at `527ddfb`: 913 pass, 8 documented platform-conditional skips,
  0 fail across 87 files; typecheck/contracts/build passed.
- Exact `527ddfb` archive package worker ran 30 installed-package repetitions with
  19 scenarios each, 30 independent canonical process proofs, 0 residual process,
  package/CLI version equality, and no repository import. Summary SHA-256
  `86CC73D16C380396484DFE2433D555211076ED374B54B63D73A3837B904A7F02`.
  This proves the corrected process-proof branch but not the separate elevated
  another-user ACL and lifecycle attestation.
- Latest complete local matrix at final product `f490e6a`: 30 × 19, 570 scenario executions,
  1,980 test passes, 0 fail/skip/timeout/residual; report SHA-256
  `282F1C80660673C7B557361ECE10088D8CDC06BE18E3286D011625142C416439`.
- Seven primitives: 20 × 8 = 160 pass, 0 fail; report SHA-256
  `169986AB73FC3361619CC2D97D3786DAE204F49AD6C753389904C4E003DE8168`.
- Final archive `.4 → .8` private npm chain: 2 installs/upgrades/rollbacks/uninstalls/reinstalls,
  v5→v6→v5→v6, exact task/delivered/pending identities, 0 residual; report SHA-256
  `51B659034F4A6E1B4B8708F003D132D2DE54761D8A78020B531BC0AD8E8CBE28`.

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
- The hosted runner's pre-existing `.codex` is not deleted, renamed, or treated as
  fresh; it is a protected external tree whose content hash must remain identical.
- Historical failures and negative reports remain under `.tmp/` and GitHub Actions;
  no prior report was overwritten.

## Current blocker, next step, ETA, rollback

Current blocker: the current package at `527ddfb` now has direct
package-bound 30-repetition local-isolation proof, but no complete qualifying
clean-Windows pass combining the elevated another-user ACL, lifecycle attestation,
worker, real upgrade and evidence verifier. The GitHub route reached the declared
stop-loss: one targeted run plus one final full run. No more push or hosted rerun will
occur on that path. Next step is a qualifying elevated equivalent-isolated Windows
execution using the exact `CE9127...4179` package, then one reviewed release freeze
only if it passes. The current non-elevated token cannot create the required temporary
local user; if no elevated isolation runner is available, status remains unknown rather
than weakening the requirement.

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
7. The first readiness-diagnostic test asserted the helper body but not parameter
   flow through both call sites. Before a remote rerun, force the local failure path
   and add source/runtime checks that every diagnostic dependency is explicitly
   bound; do not accept a happy-path-only test for an error reporter.
8. Task action tests asserted XML text but never executed the actual Windows argv
   boundary. Before the first remote run, register paired single/double quote probes
   and then run the exact built product install/start/ready/stop/uninstall path.
9. Process evidence reused `.ToString('o')` without round-tripping it through the
   verifier. Every evidence producer must feed its exact output into the same schema
   verifier locally before a remote run.
10. Repository stability gates dominated each diagnostic turn. The workflow now has
    a bounded `clean-package` diagnostic input/commit marker; it never counts as final
    acceptance, and a full unskipped run remains mandatory before release.

## Interim statistics

- Remote Windows workflow attempts listed here: 42 completed through final stop-loss
  run `30798631293`, all preserved.
- Completed failure classes: stale/missing build/package state; wrapper/process
  enumeration; PowerShell ACL autoload; lexical/canonical root; manifest/key path;
  fixed-deadline test overhead; Codex npm layout; projected Codex Home; projected/
  protected npm overlap; task discovery and rollback reconciliation; task XML
  encoding; local repository-volume ACL mismatch; PowerShell 5.1 helper/module compatibility; one remote
  repetition failure whose inner cause is still unknown.
- Product/test/workflow repair commits after `8df77f3`: 92 commits through
  local-only `527ddfb`, including package hash rebinds and one explicit revert.
- Latest failed clean job `30798631293` zero-residual artifact: inspection complete,
  cleanup error codes empty, owned root false, environment root false, matching
  processes 0, residual users 0, residual task false.
- Final local `527ddfb` package-only evidence: 30 repetitions, 570 scenario
  executions, 30 process proofs, 0 residual, plus stable suite 913 pass / 8 documented
  platform skips / 0 fail.
- Final counts and the terminal run conclusion will be appended after the first full
  green repository + clean-package run.

## 18:00–18:23 lifecycle follow-up and local elevation result

Classification: the lifecycle defects below are **confirmed root causes**. The UAC
result is a **confirmed external interaction failure**, not a product failure. A
qualifying second-machine/resettable-VM result remains **unknown**.

- `3871be1` stopped an existing writer before upgrade and restored a writer on one
  rollback path, but success returned after task registration without starting the
  replacement writer. Its rollback restart accepted writer count alone and did not
  require the state lock or a parseable schema. An unhealthy replacement could also
  remain while prior bytes were restored.
- TDD RED: three new lifecycle tests failed for exactly those missing behaviors.
  GREEN commit `508fae0` starts and verifies the replacement when an online writer
  existed, stops a failed replacement before rollback, and requires one exact writer,
  a proper-lockfile lease, and a parseable state schema before declaring restored
  health.
- A real-I/O review then found that proper-lockfile creates `<state>.lock` with
  `mkdir`, while the first health implementation checked `isFile()`. The production
  read-only observation confirmed `F:/Chat2Codex/data/state.json.lock` is a directory.
  A new RED source contract failed; changing the check to `isDirectory()` made the
  focused gate GREEN.
- Focused verification after the fix: 71 pass, 0 fail. TypeScript product and
  contract projects both exited 0. Full stable verification first recorded 916 pass,
  8 platform skips, 1 fail because the shell resolved unsupported Node 16.17.0 and
  TypeScript's extensionless launcher failed. Source Hook hashes all still matched.
  With supported Node 24.14.0 at the front of PATH, the exact Hook-pack test passed
  and the full stable gate completed with 917 pass, 8 documented platform skips,
  0 fail. No timeout, skip, or boundary relaxation was added.
- Candidate bind commit `fded46f` advances the immutable package to
  `0.8.0-novice.9`. Two new detached clean worktrees independently produced 131
  files, 394,556 bytes and identical SHA-256
  `33AFB36A44709F23B3B208BCE12CBD488C8D14253C8DCF397D08D817EEC54A3B`.
- A PowerShell 5.1 administrator rehearsal script was parsed and reviewed with
  SHA-256 `0DAFCACEABB7DCC18C763AB873563F8DCED1F45EF16F5E33A02B814960A8C2A0`.
  It scopes mutation to `Chat2Codex-Novice-fded46f`, one `C2CN...` user, and
  `C:/C2C-Novice-fded46f`, with `finally` cleanup and production hash/process
  comparison. Two UAC launches were attempted; each returned "The operation was
  canceled by the user" after wall times 123.7 s and 123.6 s. The elevated script
  never started and emitted no report. Direct follow-up observed zero matching test
  users, no test task, no owned root and no result file. Production PID 10448 and
  state SHA-256 `CB1BF1...52BD4` were unchanged. The two-attempt escalation boundary
  was honored; no third UAC was generated.

Current blockers are therefore: administrator acceptance for the local cross-user
ACL/Task 12 rehearsal; a real second machine or resettable VM for `DIST-003`; and
the later installed Desktop/real Weixin rows. Production deployment can proceed only
from the exact `.9` archive with a timestamped byte-verified backup and automatic
v4 rollback. Estimated remaining engineering time is unchanged at 2–4 hours for
local production/Desktop/Weixin evidence after elevation, plus 3–6 hours when a
qualifying clean Windows environment is available.

## 18:35–19:50 local ACL, UAC, and production attempts

Classification: items explicitly marked **confirmed** have direct local evidence;
items marked **unknown** remain hypotheses. No production failure was hidden by a
successful rollback.

- **Confirmed:** `.9` production preflight exposed that constructing a new
  `FileSecurity` and setting the already-correct owner requires `WRITE_OWNER` on this
  Windows volume. Direct .NET `SetAccessControl` failed for a normal user while a
  DACL-only update succeeded. TDD commit `e835d76` first verifies the existing owner
  SID and then replaces only the DACL. The exact product API subsequently produced
  only current-user/SYSTEM/Administrators ACEs on a disposable file.
- **Confirmed:** file-only ACLs were insufficient because the parent key directory
  inherited `Authenticated Users: Modify`, allowing deletion/replacement risk. Commit
  `6f3bba3` adds an owner-verified protected directory DACL with OI/CI inheritance and
  checks it with the same closed allowlist. A real disposable directory and child
  file both contained only current-user/SYSTEM/Administrators. Commit `7fe2e46` also
  requires another-user read, delete, and replacement attempts to fail and preserves
  the exact key hash.
- Candidate `.12` / `b6a82e1` passed the stable gate with 917 pass, 8 documented
  platform skips and 0 fail. Two detached clean worktrees produced byte-identical
  archives: 131 files, 395,205 bytes, SHA-256
  `EC3C7956E561AB95543CB0588BEFAD0834BC8881A0232CAD0AC25743D5D7E778`.
  The exact archive then passed a non-elevated disposable Windows lifecycle:
  owner-only directory plus three owner-only keys, task start, directory lock,
  doctor exit 0, stop, uninstall with state preservation, and zero residual
  task/root/process.
- **Confirmed external blocker:** multiple visible UAC requests used the frozen
  script (latest SHA-256
  `3FCD480205A75FA91FC86674BA3A062936EF269AF4C3E28A07E3FD77D62E3A4A`)
  and were canceled by the Windows security desktop after approximately 123.6–124.1
  seconds. The elevated script never started. Every follow-up found zero temporary
  user, task, root, profile, process, and result file. Haoda must click **Yes** during
  that system window; after a successful click the expected run time is 2–4 minutes.
- **Confirmed production safety outcome:** each failed `.9`/`.12` deployment retained
  a timestamped owner-only backup and ultimately restored the exact `.4` state, env,
  launcher and task. The latest independent recovery check observed one `.4` writer
  PID 47212, a fresh directory lock, state SHA-256 `CB1BF1...52BD4`, schema 4,
  4 tasks / 9 jobs / 4 delivered outbox, zero active/undelivered obligations, and
  doctor exit 0. Candidate tasks were removed.
- **Confirmed diagnostic evidence:** the exact `.12` state runtime converted a copy
  of production schema v4 to v6, preserved all four task IDs and four delivered
  outbox IDs, and wrote a byte-exact `.v4.bak`. The exact real `dist/index.js` also
  started against a disposable v4 copy and reached adapter ready. An independent
  Windows task flight recorder captured the candidate command line and schema-v6
  state.
- **Unknown:** the remaining difference that prevents the production candidate task
  from satisfying the combined writer+lock+schema health gate. Four bounded
  production attempts ended in explicit rollback; the last three rollback reports
  were successful. The production retry line is stopped. No timeout was increased,
  no test was skipped, and no ACL/health boundary was weakened.

Routing remained `gpt-5.6-sol / ultra`. After two failed attempts each investigation
changed path: remote CI to local package evidence; abstract lifecycle to real lock
shape; product install to direct ACL reproduction; production retry to disposable
v4 runtime/task probes and flight recording. Several subagent follow-ups returned
empty payloads; their claims were not used. Goal remains active.

## 20:19–22:06 launcher, Task 12, and hosted lifecycle follow-up

Classification: items marked confirmed have direct evidence; unknown items remain
open. Times are Asia/Shanghai.

- 20:19–20:31 confirmed: candidate .13 failed a disposable Scheduled Task with
  spawn powershell.exe ENOENT. TDD commit 5c5ac2d added the running PowerShell
  directory before the requested PATH. RED was one failed launcher assertion;
  focused GREEN was 8 pass / 2 platform skips and full stable was 917 / 8 / 0.
- 20:32–20:52 confirmed: .14 / 7d5e64e produced three byte-identical
  395,341-byte, 131-file archives with SHA-256
  8490BBA8EED61E56645E19E193C77EE637710D25CDC5790E7DF9D90CB761BA28.
  Its package lifecycle passed owner-only key root and keys, one writer, directory
  lock, doctor 0, state-preserving uninstall, and zero task/root/process.
- 20:55–21:19 confirmed negative evidence: accepted UAC runs exposed harness
  defects in missing-task reporting, the PowerShell HOME variable, and elevated
  root ownership. The final ACL micro-probe SHA was B50D3742...B38A6; report SHA
  A1203E1A...A448 proved stage=owner-read, owner/current hashes differed,
  ownerMatchesCurrent=false, no DACL apply, and zero residual root. This disproved
  the WRITE_OWNER hypothesis for that run; no product owner was seized.
- 21:20–21:40 confirmed RED to GREEN: commit 0d9aeb3 added bounded structural ACL
  diagnostics across PowerShell, Node, and CLI. It omits command, path, SID,
  message, and key material. Full stable passed 922 / 8 / 0. Commit 8f9c8fb added
  equivalent native-lifecycle stage/type/code/errno/HResult and cleanup status;
  .16 stable passed 924 / 8 / 0.
- 21:29–22:03 confirmed Task 12: .15 / 18cbb33 archive SHA
  9EA80636...172D3 passed current-user lifecycle and 30 x 19 package scenarios
  (570 pass, zero fail/skip/timeout/residual). Phase A froze a stopped service and
  three key hashes with production state/env/launcher unchanged. Accepted UAC PID
  50252 ran Phase B: all three keys denied another-user read/delete/replace and kept
  exact hashes. Phase C proved state preservation, complete key rotation, final
  uninstall, production unchanged, and zero user/profile/task/root/process. This is
  current-host Task 12 evidence, not DIST-003 or installed Desktop/real Weixin.
- 21:02–22:06 confirmed CI: runs 30816094624, 30819358611, and 30820105515 failed
  only at Run native temporary lifecycle gate; fast/restart passed and clean-package
  was dependency-skipped. Exact Bun 1.3.9 passed locally. Commits 4d2df00/e749898
  publish only bounded failure detail as a check annotation and remove the false
  missing-30-file secondary error while retaining real negative artifacts. Run
  30821095614 was still running when this section was written.

No timeout was extended, no test was skipped, and no ACL, writer, cleanup, archive,
or cross-user boundary was weakened. Routing stayed gpt-5.6-sol / ultra. Remaining
blockers are the hosted Windows conclusion, production deployment, real Codex Home
Hook/MCP trust, Desktop restart and seven installed primitives, real Weixin E2E,
and qualifying second-Windows DIST-003. Goal remains active.

### 22:06–22:20 final stop-loss snapshot

- Task 12 Phase B ultimately passed under accepted UAC PID 50252. Result SHA-256
  DAA3ACB9...0F49B records three key hashes and nine direct denial facts: read,
  delete, and replacement denied for each key. The temporary user and profile were
  absent afterward. Phase C then preserved state, rotated all three keys, performed
  final uninstall, kept production hashes unchanged, and proved zero task/root/
  process residual.
- Candidate .17 / d18936e froze 133 files, 397,496 bytes, SHA-256
  D2BE7C3BA6CE3CD6373E75664F5E8CDF7391E045425E0AC4E5F662D21E74EF43;
  three independent archives were byte-identical. Full stable was 924 pass, 8
  documented platform skips, 0 fail.
- Runs 30821095614, 30821666226, and 30822112628 still failed only in the hosted
  native lifecycle step. The last run uploaded bounded evidence artifact
  8859284678 (312 bytes); artifact 8859136099 from the prior run is also retained.
  This thread cannot authenticate artifact download, so the inner hosted-only field
  values remain unknown. Local exact Bun 1.3.9 and 1.3.14 both pass the same step.
- Remote reruns are stopped. No further full run is allowed until the retained
  artifact is read or an equivalent local RED is obtained. Production dry-run for
  .17 passed with script SHA-256 35FB994B...FCA9, but production write is withheld
  while this CI blocker remains open.

### 22:29 production .17 attempt and rollback

- The dry-run-pinned .17 transaction created a byte-verified owner-only backup and
  attempted the production transition once. The candidate did not reach the combined
  one-writer + directory-lock + schema-v6 gate in 30 seconds. No timeout was changed.
- Automatic rollback succeeded with no reported cleanup error. Failure report SHA-256
  is 0037A10DE4F84A092B502EE816B62FCF047615CCB0BD0880560ADE78B9FCA7B2.
- Independent postcheck observed restored .4 Node writer PID 9408, doctor exit 0,
  directory lock, schema 4, exact state/env/launcher hashes, 4 tasks / 9 jobs /
  4 delivered outbox, zero active/undelivered/pending/drafts/clarifications, and no
  candidate task. Production retry is stopped.

## 2026-08-04 04:01–05:02 personal-portable local stop-loss loop

Classification: all timestamps below are Asia/Shanghai and come from the preserved
local run directories. These are current-host pre-candidate runs, not hosted CI,
clean-Windows DIST-003, production, Desktop, or real-Weixin evidence. No GitHub run
or job link exists for these local attempts.

| Time | Run | Archive SHA-256 | Direct result |
| --- | --- | --- | --- |
| 04:01 | run5 prepack | none | confirmed environment failure: prepack selected Node 16.17.0 and TypeScript 7 failed with ERR_UNKNOWN_FILE_EXTENSION before an archive existed |
| 04:02 | run5 | c28d1709fa363122316cad3121372a3945486989e8d88bd1d4272ae51f544509 | confirmed RED at install_1: PORTABLE_ROLLBACK_INCOMPLETE at doctor; cleanup task false, process 0, root false |
| 04:24 | run6 | ceded48028b29efbecce47f28be7d5074cc89c202793cdc3d1a27ea61b5a1672 | confirmed RED at install_1: transaction rolled back at doctor; cleanup zero |
| 04:27 | run7 | 195e74676e58ee09b790865c20ddbc0b97273800b4d5824838eae96145cbe14a | confirmed bounded root cause DIST_NPM_MISSING; cleanup zero |
| 04:29 | run8 | 82020a416833a2503c8b1e0405b65d2270243eab335d38142ee1f8cf9615b0fe | first complete package-only pass |
| 04:35 | run9 | 29df71f18246de5effe82e7b906202f3273cf1a0911a6a4a1eb5989b69593f2f | pass after conservative rollback and installed-root doctor hardening |
| 04:43 | run10 | 7dfeb3b72a83562f86c96d45a992fe66f0c80e3807ed4b4e837daf35e26c4d19 | confirmed RED at start_service when a pre-login fresh install was incorrectly forced online |
| 04:45 | run11 | 46062a96d170f09e875381d18e5fa650597df8b44b58594222fc5381060e978f | pass with offline pre-login state and archive-free second Uninstall |
| 04:54 | run12 | b5e4150e54d057ae6377818f709883cb6711e198cdb8236c870064912c04139a | pass; exposed misleading DIST_ROLLBACK_PENDING for a terminal onboarding receipt |
| 04:57 | run13 | afe2db8b8ccbd34384cf568854d0d7796dae902ceef504561b281935266eae77 | pass with DIST_ROLLBACK_CLEAR |
| 05:01 | run14 | afe2db8b8ccbd34384cf568854d0d7796dae902ceef504561b281935266eae77 | byte-identical repeat pass on the final submitted tree |

### Confirmed roots and rejected paths

- Confirmed: the original install_1 ERR_MODULE_NOT_FOUND came from executing an
  extracted archive before installing dependencies. The bootstrap now installs the
  SHA-verified archive into a unique temporary controller prefix and removes it in
  finally. Package-tree verification binds the packaged bootstrap to source bytes.
- Confirmed: run5 rollback was falsely incomplete because an empty owned directory
  hashed as a present tree. Empty trees now normalize to null. Fresh all-null backup
  rollback skips nonexistent old doctor while existing installs still require it.
- Confirmed: run7 DIST_NPM_MISSING came from doctor ignoring the canonical npm CLI
  already validated by the bootstrap. Inspector now executes the absolute regular,
  non-reparse CHAT2CODEX_NPM_CLI through the running Node; invalid overrides fail
  closed and do not expose the path.
- Confirmed: forcing fresh install online before setup weixin caused run10
  start_service failure. The accepted journey orders Install twice before setup.
  The final receipt uses terminal awaiting_setup, records only through
  install_service, retains candidate hashes for rollback, and does not claim start
  or doctor. Doctor reports the actionable Weixin/writer/Hook/MCP onboarding gaps.
- Confirmed review fixes: writer enumeration rejects negative, NaN, unsafe, or >1;
  uninstall binds manifest home/prefix to the trusted plan; rolled-back receipts
  require every conservative restoration step; backup metadata/material hashes,
  canonical path, owner-only ACL, and no-reparse checks run before target deletion;
  transient receipt-write failure cannot truncate compensation.
- Rejected hypothesis: Directory.SetAccessControl/WRITE_OWNER was not the run5–14
  cause. The earlier elevated ACL report remains separate evidence.
- Rejected approach: immediately running another full Windows CI after each local
  failure. This loop used one bounded hypothesis, focused RED→GREEN, then only the
  package-only lifecycle. No remote CI was triggered.

### Environment, routing, integrity, and residuals

- Default PATH Node was 16.17.0; all valid builds/tests used bundled Node 24.14.0.
  Local Bun was 1.3.14, so these archives are not the final Bun 1.3.9 .18 candidate.
  The final run13/run14 archive was 418,805 bytes, 138 files, and byte-identical.
- The temporary controller uses npm 8.15.0 from its canonical npm-cli.js; the npm
  upgrade notice was bounded diagnostic noise, not a failure. Windows temporary
  roots, task names, profiles, Codex Home, and PowerShell ModuleAnalysisCache were
  directed under disposable roots. One earlier 8,246-byte ModuleAnalysisCache was
  created under the worktree before that fix; it remains untracked and excluded
  from package/commit because local policy rejected both recursive and exact
  non-recursive cleanup commands. It is not a product task/process/install root.
- Every run5–14 lifecycle report proves taskResidual=false, processResidual=0, and
  rootResidual=false. run11+ additionally prove archive-free second Uninstall;
  run13/run14 prove two awaiting_setup installs, named rollback, double uninstall,
  reinstall with three rotated keys, final uninstall, and rollback clear.
- Final focused gate: 115 passed, 0 failed. Broader Windows/state gate: 155 passed,
  0 failed. Latest full check: 1,023 passed, 8 documented platform skips, 0 failed,
  plus Node 24 typecheck, contracts, and build. OpenSpec 4/4, authority, distribution
  tree, hardcoded-path scan, secret scan, and diff-check passed.
- No timeout was increased, no test was skipped to manufacture success, and no ACL,
  writer, rollback, redaction, manifest, or external-action boundary was weakened.
  Failures and superseded archives remain preserved under .tmp.
- Routing stayed gpt-5.6-sol / ultra. It was already at the maximum available model
  and reasoning tier. After repeated failures the investigation path changed from
  archive reruns to bounded doctor codes, TDD fixtures, package-only execution, and
  independent specification/quality review.

### Remaining blockers, estimate, and rollback

Commit 0b5c081 contains the personal-portable executor. It does not bump .18 or
change production. Remaining P0 path is final Bun 1.3.9 deterministic .18 freeze and
full Windows CI, clean personal Windows DIST-003 including setup-to-start-to-doctor,
production single-writer deployment/rollback, real Codex Home Hook/MCP trust,
Desktop seven primitives, Haoda-only real-Weixin E2E, and final matrix audit. The
remaining estimate stays 1–2 engineering days when clean Windows and Desktop are
available. Repository rollback is revert of 0b5c081; runtime rollback continues to
use the named receipt and exact backup hashes. Goal remains active.

## 2026-08-04 05:23-05:42 novice.18 freeze and CI stop-loss

- Confirmed official toolchain: GitHub release `bun-v1.3.9` published the
  40,809,955-byte Windows x64 zip with SHA-256
  `f4c1cf3549f6af986dc6535c40b4785ff1a7e7805e59637ec450fc11adb0c874`.
  Its extracted bun.exe and the local cache were byte-identical at SHA-256
  `2d901f3dea0a14c7acc4434622bf43b20250f1c787b3795dae0635c2e139a067`.
- Three detached clean worktrees using Bun 1.3.9 and Node 24.14.0 produced
  byte-identical 138-file, 437,577-byte novice.18 archives with SHA-256
  `87d115436e521131fdfba59e65f1b1ed71533d694511301bcdbb2ad57f8157a7`.
- Full Windows run 30854454515 on `61ee173` failed only at Run thirty
  repetitions after the standalone native diagnostic retained the known
  `journey/file_acl_owner_read` / `exit_86` P1 result with complete cleanup.
  Clean-package was dependency-skipped. Public annotations had no detailed 30-run
  error; run-log download returned 403 and the public step endpoint disconnected.
- Confirmed defect, not confirmed sole root cause: every repository repetition
  re-ran the same hosted-owner-sensitive native probe, allowing P1 evidence to
  determine a blocking P0 verdict. TDD required the blocking runner to omit that
  probe while the standalone workflow diagnostic remained. Commit `85e2dae`
  implements the separation. Run 30854454515 did not publish the 30-run report or
  exact exception, so it could not establish that this was the only failure.
- Exact Bun 1.3.9 GREEN after the fix: one repetition recorded 65 P0 passes and
  19 scenarios; 30 repetitions recorded 1,950 passes and zero fail, skip, timeout,
  or residual. Report SHA-256 is
  `b260538b422d54fabc79756b8e1751def7a84aca12d35ba233f7defddae94863`.
  Full stable remained 1,023 pass / 8 documented conditional skips / 0 fail.
- A concurrent main-worktree pack is invalid evidence because stable and pack
  both wrote ignored dist bytes. SHA `593e64...f3fe` is rejected. A detached clean
  `85e2dae` worktree reproduced the reviewed candidate hash exactly.

No timeout was extended, no blocking P0 scenario, property, or package proof was
removed, and the P1 native diagnostic was not skipped. Routing remained
gpt-5.6-sol / ultra; investigation changed to exact-step evidence, local Bun 1.3.9
reproduction, then one corrected full-CI attempt.

## 2026-08-04 05:47-06:08 corrected CI and bounded pre-loop diagnosis

- Full run [30855991670](https://github.com/qhd1996/chat2codex/actions/runs/30855991670)
  on `5df7634` again failed Run thirty repetitions in about six seconds. The
  expected `.tmp/novice-repository-30.json` was absent, so artifact upload was
  skipped. This is direct negative evidence that the removed P1 duplicate was not
  the sole cause.
- **Unknown:** the exact hosted exception. GitHub annotations expose only exit 1;
  log download returned 403 and the public step endpoint disconnected. No report
  exists to classify a narrower cause.
- **High-confidence inference:** the old runner could throw before report creation
  in argument/runtime/scenario/Git/package/temp setup, shard read/parse, package
  repetition, validation, or cleanup. A hosted-sensitive ACL seam may be involved
  in the first package repetition, but no direct hosted error proves that.
- Stop-loss: no further push/full CI until real subprocess fixtures prove a
  bounded, redacted report for pre-loop and missing/invalid shard failures, the
  publisher validates the complete schema-5 pass before annotation, and the old
  failure history survives an early failure. The original 30-run step remains
  blocking.
- No timeout, skip, retry loop, or security relaxation was introduced. Routing
  remains `gpt-5.6-sol / ultra`, already the maximum tier; after the second remote
  failure the path changed from candidate reruns to local diagnostic-chain TDD.

### 06:08-06:22 bounded diagnostic RED to GREEN and candidate revalidation

- RED: the original runner produced no report for tracked-dirty, missing-shard,
  or invalid-shard subprocess fixtures. Its report-write-failure path still ran
  the shard, its placeholder overwrote prior failure history, and the first
  publisher implementation accepted a hollow 30-element array as pass.
- Confirmed local causes: report creation sat after multiple throw sites; the
  placeholder was written before reading history; `reportReady` was set before
  the first durable write; and the publisher checked only shallow pass fields. A
  first GREEN attempt also exposed a top-level-await temporal-dead-zone error for
  `MatrixFailure`; moving the class definition before execution fixed that exact
  implementation defect.
- GREEN commit `d953e7c`: closed stage/code enums cover initialization, runtime,
  scenarios, Git, package, temp setup, spawn, shard report, package report,
  repetition/final validation, and cleanup. Reports contain no stdout, stderr,
  path, SID, token, prompt, or identity. The publisher reuses the full schema-5
  validator and always exits zero only after emitting bounded annotation/summary;
  the original 30-run step still owns the blocking exit.
- Focused Bun 1.3.9 / Node 24.14.0 evidence: 10 diagnostic/documentation tests,
  then 75 novice tests, all passed. Typecheck, contracts, OpenSpec 4/4, authority,
  distribution, and build passed. Full stable was 1,030 pass / 8 documented
  conditional skips / 0 fail.
- Committed-tree 1 x 19 completed in 10.2 seconds. Committed-tree 30 x 19
  completed in 194.6 seconds with 1,950 pass and zero fail, skip, timeout, or
  residual. Validator and publisher passed; report SHA-256 is
  `0a2e99a7bf8ecf4a9c64b46fb20a9ff46fde9d12915166d197fc3ce18a4db902`;
  matching temp roots after the run were zero. A PowerShell evidence summarizer
  initially used an invalid nested-property expression and printed null totals;
  it did not affect the runner exit. A separate explicit-loop read produced the
  counts above.
- A detached clean `d953e7c` frozen install/build/pack/extract/verify reproduced
  138 entries, 437,577 bytes, and exact candidate SHA-256
  `87d115436e521131fdfba59e65f1b1ed71533d694511301bcdbb2ad57f8157a7`;
  tracked residuals were zero.
- Routing: main and reviewers used `gpt-5.6-sol / ultra`, already maximum. Two
  repeated remote failures caused the investigation path change; later review
  agents returned empty payloads, so empty messages were rejected as evidence and
  the main Agent independently re-read the diff and ran every gate. No timeout was
  lengthened, no blocking check was skipped, and no ACL/security boundary changed.
- Remaining blocker: one new full Windows CI must prove the hosted failure stage or
  pass the full repository and clean-package jobs. After that, the critical path
  is qualifying clean Windows DIST-003, production, real Hook/MCP, Desktop seven
  primitives, Haoda-only real-Weixin E2E, and final matrix audit. Estimate remains
  1-2 engineering days when clean Windows and Desktop are available. Repository
  rollback is revert of `d953e7c`; package/runtime rollback remains the named
  receipt and exact backup-hash path.
