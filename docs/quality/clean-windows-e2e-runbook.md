# Clean Windows E2E runbook

This runbook prepares `DIST-003` evidence. It does not authorize execution. A
qualifying environment is a second computer or resettable VM with a fresh Windows
profile and no repository, Chat2Codex package/service/state/config/secrets, trusted
project Hooks/MCP, or copied profile. A mock, container, current computer, or copied
profile cannot pass.

Use `quality/evidence/clean-windows-template.json`. Record redacted OS/architecture,
Node/npm, archive, Codex CLI/Desktop versions, exact commands, hashes, timestamps,
schema transitions and results. Never record key bytes, credentials, personal IDs,
or unnecessary message contents.

## Sequence and stops

1. Prove environment qualification and absence of prior artifacts.
2. Verify the reviewed archive SHA-256 and install it with npm.
3. Create config from the packaged template. After install approval, generate keys,
   verify ACL negative behavior, install/start/query the task, and run doctor.
4. **Approval stop: Weixin login.** Record account only in redacted form.
5. **Approval stop: real `~/.codex` materialization.** Back up exact files first.
6. **Approval stop: Hook trust.** Compare packaged bytes and hashes.
7. **Approval stop: Desktop restart.** Then prove authenticated status and all seven
   installed primitives on one disposable root.
8. **Approval stop: Computer Use and each real Weixin send.** Run the named inbound,
   outbound, media, retry/restart/dedup/no-rerun E2E matrix.
9. Install the reviewed upgrade, record schema migration, inject a reversible
   failure, roll back to the old package/state/config, restore the new version, and
   prove health.
10. Uninstall; prove task/owned secrets are gone while state/config/logs remain.
    Reinstall to prove repeatability, then perform separately approved cleanup.

Any missing approval, unexpected process, key/ACL/hash mismatch, uncertain writer,
state obligation, Desktop thread mismatch, or message target mismatch stops the
run. Leave the affected stage `unproven` or `contradicted`; never infer success.
