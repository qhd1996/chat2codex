# Weixin Desktop Phase 3 Primitive Probe

## Verdict

**Blocked at the installed Codex desktop boundary as of 2026-08-02 13:14 Asia/Shanghai.** No Phase 3 requirement is accepted as implemented. The installed desktop package exposes relevant protocol schemas, but schema presence is not behavior evidence. The desktop-bundled executables cannot currently be exercised by the external bridge probe, and the sandbox helper reports a missing module. Other program work may continue; Phase 3 implementation must not claim a status mirror as same-thread handoff.

## Installed artifacts and direct evidence

- App package: `OpenAI.Codex 26.727.6591.0`, package status `Ok`.
- User screenshot: `C:/WINDOWS/TEMP/codex-clipboard-687521cb-b022-4bb2-8951-4e4ab540e77d.png`, 45,142 bytes, SHA-256 `9864FF0B68445A2E2032F0C1FEDD6F18B20D18B5759F3C6F1811C145DCF3F36F`, timestamp 2026-08-02 11:43:47 +08:00. It shows `codex-windows-sandbox-setup.exe` failing with `The specified module could not be found.`
- Sandbox helper: 8,803,120 bytes, valid OpenAI signature, SHA-256 `A82BC08CF63F59BB5D157DCCCB2141DEA630985552866082B824384A54673E2A`. Static PE parsing found 14 direct imported DLLs and every one existed in the helper directory or Windows system directories. The error is therefore not explained by a missing direct PE import; a dynamic dependency, packaged runtime component, or launch environment remains suspect.
- Desktop-bundled `codex.exe`: 358,182,192 bytes, SHA-256 `ECD7A3EAFF5E42723DBBA03B5C91514B3986B5DB5CBCA8F34619620B5356F31F`. Direct PowerShell execution fails `Access is denied`; Bun spawn fails `EPERM uv_spawn`. Therefore an external Chat2Codex process cannot currently behavior-probe this exact desktop binary.
- Independent CLI comparator: `codex-cli 0.144.5`, SHA-256 `EFDB3540EF74B9909408C8D38DA79483454797B36F471E3E004FC2BF2B70E22A`. With an isolated test `CODEX_HOME` and no turn creation, it behavior-responded to `initialize`, `hooks/list`, `plugin/list`, `plugin/installed`, `mcpServerStatus/list`, and `thread/list`. The probe cwd had zero existing threads, so `thread/read` was not exercised. This comparator is not desktop acceptance evidence.
- Probe result: `.tmp/readonly-cli-0.144.5.json`. Probe source: `scripts/phase3-readonly-primitives.mjs`. The script contains no `thread/start`, `turn/start`, or sandbox request.

## Required primitive matrix

| Primitive | Verdict | Direct behavior evidence | Gap |
| --- | --- | --- | --- |
| Desktop plugin/MCP status interface | `UNKNOWN` | CLI comparator returned real plugin/MCP inventory responses. | No desktop plugin was loaded and no desktop UI/status surface was observed. |
| `UserPromptSubmit` lease blocking | `UNKNOWN` | CLI comparator returned one hook inventory entry. | Hook type/content and prompt-submit enforcement were not behavior-tested; turn probes are prohibited while helper health is unresolved. |
| Same-thread takeover | `UNKNOWN` | Protocol schema contains thread APIs; CLI comparator listed zero threads in its isolated home. | No desktop-bound disposable thread could be created/read safely, and the AppX binary cannot be externally spawned. |
| `Stop` notification | `UNKNOWN` | No qualifying behavior evidence. | Requires a trusted desktop hook/notification and a completed disposable turn. |
| Authoritative `thread/read` reread | `UNKNOWN` | Endpoint is present; comparator had no thread to read. | A real completed bound thread is required. |
| Single-writer competition | `UNKNOWN` | Existing Chat2Codex session tests cover one-process thread serialization only. | No bridge-vs-desktop lease race was run. |
| Unbound thread non-leakage | `UNKNOWN` | No qualifying behavior evidence. | Requires desktop threads and a live bridge status/ownership service. |

## Impact

- Phase 3 implementation cannot safely begin against the current installed desktop because the required enforcement and wake-up primitives are not behavior-proven.
- A dashboard-only status mirror would not satisfy the accepted design: it cannot enforce one writer or prove authoritative completion.
- Phase 2, test stability, upstream rehearsal, and state-copy migration are independent and may continue.

## Options

1. **Repair or reinstall the current Codex AppX, then rerun the exact seven-row probe.** Preserve app data first and verify the sandbox helper plus external/supported plugin access. Lowest architecture risk; estimated 1–3 hours after a healthy installer is available.
2. **Use a supported desktop MCP/app surface but move lease enforcement to an authenticated loopback bridge proxy.** Desktop must submit through a supported proxy/tool entrypoint that can reject a lease conflict; a mere dashboard button is insufficient. Medium design change, estimated 1–2 engineering days plus desktop E2E.
3. **Wait for a desktop release that documents plugin/hook execution and external app-server access.** Lowest immediate implementation risk but unbounded schedule risk; other phases continue.

## Recommendation

Choose option 1 first. The installed AppX is not healthy enough for a conclusive primitive gate. If repair/reinstall does not make the exact seven behaviors testable, accept a new design CR for option 2. Do not implement the alternative while its CR is DRAFT.

## Safety notes

- No `turn/start` or `thread/start` was issued after the helper error was reported.
- No production Chat2Codex process, state file, Weixin transport, account, credential, allowlist, or desktop package was modified by this probe.
- No terminated or timed-out probe is counted as passing evidence.
