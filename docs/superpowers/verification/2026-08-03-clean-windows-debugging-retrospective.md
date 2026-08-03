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
