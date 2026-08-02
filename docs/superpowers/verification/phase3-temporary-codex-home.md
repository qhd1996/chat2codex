# Phase 3 temporary Codex Home verification

Date: 2026-08-02 Asia/Shanghai

## Result

PASS for repository-only pre-install compatibility. This is not installed Desktop
or Task 12 acceptance evidence.

- Package source: Task 10 branch based on c4c6bb6.
- Codex CLI: 0.146.0, F:/codex/bin/codex.exe.
- CLI SHA-256: BC343BA420DC2E2E9F59E6FC5E5BF0AAE1CD8C771FC319665241FC9C0271FDDB.
- Authenticode: valid, OpenAI OpCo LLC.
- Node: bundled 24.14.0.
- Codex Home: a new path below C:/Windows/Temp/chat2codex-phase3-temp-*.
- Parser: app-server --stdio --strict-config.
- Hook inventory: exactly userPromptSubmit and stop; both untrusted; zero Hook errors/warnings.
- MCP: one disabled chat2codex_desktop_gateway definition; no server process/tools/resources initialized.
- plugin/list was not called.
- No token was created, copied, logged, or placed in config.
- No existing ~/.codex, Desktop process, production directory, or Weixin transport was modified.

The first wrapper probe selected an invalid 0.144.5 native payload and failed with
spawn UNKNOWN/EFTYPE; its bundled codex.exe had a valid PE header but Windows
refused it as not a valid application. Verification escalated to the current
signed F:/codex/bin/codex.exe. A separate first strict-config attempt found and
fixed Windows TOML backslash escaping. Both failures remain negative engineering
evidence and were not counted as passes.

The final redacted result was:

    hooks=2 events=[stop,userPromptSubmit]
    trust=[untrusted,untrusted] hookErrors=0 hookWarnings=0
    mcpDefinitions=1 mcpStarted=false strictConfig=true pluginDiscoveryUsed=false

Task 12 remains required for real backup, key creation/ACL validation, installation,
Hook hash review/trust, Desktop restart, installed failure-mode behavior, Computer
Use, production writes, and real Weixin acceptance.
