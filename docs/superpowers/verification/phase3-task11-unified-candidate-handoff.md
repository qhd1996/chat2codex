# Phase 3 Task 11 unified candidate handoff

Date: 2026-08-03 Asia/Shanghai

Verdict: **Tasks 0–11 are complete at the repository/pre-install level on the
unified candidate. Task 12 and every installed, production, Desktop, Computer
Use, and real-Weixin behavior row remain unexecuted.**

## Bound candidate

- Product source commit: `0466e126d0d0d6d4b639a66e3e4932ba001d00f5`.
- Handoff/report branch head before this report: `3d475ba399ae16275fb13cb87409b5c472336193`.
- Phase 3 integration ancestor: `3ada8fa70ba63bb8e922f9678d37d3b499eb4dc2`.
- Windows distribution ancestor: `5763f68b1c4dbd4ba878c4bafa67ea657ab7bfe7`.
- UsageAdvisor ancestor: `47c2272faf764904a5c8cba903b05b679b20a0cb`.
- Approved design/plan: `79fc097` / `599b3a9`.
- Package: `chat2codex-0.8.0-novice.2.tgz`, 387,190 bytes, 131 files.
- SHA-256: `5949cdc7dfd76575928eab9d6bfa3f007359f2a5c4ff5a243ab073c0da186e84`.
- Two independent detached clean checkouts produced byte-identical archives.

No production file, real Codex Home, Hook trust store, Desktop process, real
Weixin conversation, or Computer Use state was changed. The damaged task
`019fc002-590e-7023-b7e5-2a802168f00a` was not read, restored, or replayed.

## Task 0–11 evidence map

| Task | Direct committed evidence | Latest unified-candidate verification |
| --- | --- | --- |
| 0 contracts | `f729590`, interface-freeze report | included in 126-test focused gate |
| 1 ownership/schema v6 | `7334364`, merge `81f6d76` | ownership/state and property tests pass |
| 2 HMAC/loopback | `8be3582`, merge `7adbfe3` | auth/server/key/ACL tests pass |
| 3 Hook/MCP surface | `3a0a7f4`, merge `83df44b` | client/Hook/MCP tests and temporary Home pass |
| 4 authoritative reconciliation | `3170511`, merge `c4c6bb6`, repair `a6d36ce` | reconciler and stable-read tests pass |
| 5 fan-out merge | `30c5b1e` | all four no-ff histories remain ancestors |
| 6 controller/fence | `469d2d3`, merge `dc837b7` | integration/race/runtime-order tests pass |
| 7 outbox reconcile | `1d93708` | text/media/crash/dedup/child tests pass |
| 8 seven primitives | `764e0ea` | 8 tests once and 160/160 over 20 reruns |
| 9 v5/v6 rehearsal | `c165681`, merge `f120139` | copy-only/fresh-process focused tests pass |
| 10 runbooks/assets | `582de84`, `a351c3f`, merge `50c46f1` | packaged assets, hashes, and temp Home pass |
| 11 release gate | `3ada8fa`, superseded by unified candidate `0466e12` | all gates below pass on `.2` |

## Fresh latest-candidate gates

| Gate | Result |
| --- | --- |
| Phase 3 focused suite | 126 pass, 0 fail, 2,551 assertions across 16 files |
| Seven primitives ×20 | 160 pass, 0 fail, 580 assertions |
| Exact Router shards | 8/8 reports; 184 accounted; 183 pass, 1 Windows symlink skip |
| Router process safety | 0 fail, timeout, residual root/child, or bad exit |
| Full stable gate | 879 pass, 8 platform-conditional skip, 0 fail |
| Typecheck/contracts/build | pass |
| Official npm audit | no vulnerabilities |
| OpenSpec/authority/evidence/package gates | pass; checked templates stay unproven |
| Extracted package | version `.2`; 131 files; three Hook hashes match |
| Novice matrix | schema v3; 30×19; 1,890 tests; 570 execution records; zero negative count |

## Temporary Codex Home evidence

The exact extracted `.2` archive was staged into a new operating-system temporary
Codex Home and parsed by signed Codex CLI `0.146.0` using
`app-server --stdio --strict-config`. Direct result:

```text
hooks=2 events=[stop,userPromptSubmit]
trust=[untrusted,untrusted] hookErrors=0 hookWarnings=0
mcpDefinitions=1 mcpStarted=false strictConfig=true pluginDiscoveryUsed=false
matchingProcesses=0
```

Hook SHA-256 values match the packaged manifest:

| File | SHA-256 |
| --- | --- |
| `hook-client.mjs` | `97d50e2e311e352cde674f58eb62eb53e4b956a5255adc6a00c137aaf63d9f00` |
| `stop-wake.mjs` | `96e6d66f3a9eafca658459c124d33fd4b045de8aba2b998ad21f0930de789169` |
| `user-prompt-submit.mjs` | `9388ddd4d4900534729dcfc44d14928cb3f8cab306bf6a5cbdd9708ed08745e6` |

The first temporary-Home command used PowerShell variable `$home`, which aliases
the read-only `$HOME`; the staging guard rejected the resulting non-temporary
target. No real Codex Home write occurred. The fresh rerun used
`$tempCodexHome` and passed. The failure remains negative evidence.

## Task 12 action compression and hard stop

All repository inputs are ready: versioned package, inert configuration patch,
three Hook hashes, temporary-Home parser proof, seven-primitive automation, schema
rollback rehearsal, installation/rollback runbooks, and evidence templates. After
separate approvals, remaining machine work is limited to current-state inventory
and backup, package installation, three key creation plus owner-only ACL, exact
config materialization, Hook trust, Desktop restart, and installed behavior
acceptance. Production deployment, Computer Use, and each real Weixin action keep
their own later confirmation.

This report does not authorize or claim any of those actions. `DESKTOP-001..003`,
real Weixin, production, `DIST-002/003`, and `NOVICE-001..003` remain incomplete
until their named direct evidence exists. A package, unit test, repository matrix,
or Task 11 completion cannot close the overall Goal.
