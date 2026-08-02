# Novice acceptance runbook

This gate covers three table-driven environments: `fresh_user`, `upgrade_user`,
and `recovery_user`. It is a hard delivery blocker. A repository run or current-
host `package_smoke` never substitutes for a qualifying `clean_windows_vm` or
`equivalent_isolated_windows` run, and neither substitutes for real E2E.

## User journey

1. Verify the reviewed archive SHA-256, Node/npm/Codex versions, and private npm prefix. Install Node, Codex CLI, and the archive only in the disposable profile.
2. Exercise `setup weixin` through mock HTTP/QR responses, then run `doctor`. No real scan or account is used by automation.
3. Install/start/stop/restart the simulated current-user task twice, then upgrade, uninstall twice, and reinstall. Native key and ACL checks use temporary files; no real scheduled task is registered by repository automation.
4. Create/continue/stop/retry tasks; validate multi-task selection, six workspace routes, Plan mode, scoped approvals/permissions, and structured input.
5. Receive/send text → image → file through the authenticated mock transport and real durable outbox. Prove order, exact identity, duplicate handling, and one Codex run.
6. Inject config, network, duplicate/reordered message, wrong token, expired generation, Gateway offline, disk full, permission, future schema, and kill/restart faults. Verify unbound roots and child Agents never export.
7. Run the complete matrix 30 times. Every repetition must record fixed seeds, commands, state hashes, 0 fail/skip/timeout, and zero residual owned processes.

## Evidence levels

- `repository_pass`: 30 stable repetitions from committed source; acceptance stays unproven.
- `package_smoke`: exact archive installed into an isolated profile projection on the current host; acceptance stays unproven.
- `pass`: exact archive on a qualifying clean Windows VM or equivalent isolated Windows profile with environment qualification and complete evidence.

Record Windows/Node/npm/Bun/Codex/package versions, archive and installed manifest SHA-256, commands, seeds, test counts, failure/fix history, state hashes, and zero residual process proof. Never discard a failed report when producing a repaired one.

## Approval boundaries

This runbook does not authorize production, real ~/.codex, Hook installation or trust, Desktop restart, Computer Use, real Weixin login, or real Weixin outbound. Those actions remain individually approval-gated. All corresponding real rows remain `unproven` until their direct evidence exists.
