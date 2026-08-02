# Windows lifecycle

The supported Windows target is a current-user Scheduled Task. Use the exact
reviewed npm archive; record its SHA-256 before installation. These commands mutate
the selected Chat2Codex home and Task Scheduler and therefore require action-time
approval in environments covered by the project approval boundary.

## Install

1. Set `CHAT2CODEX_HOME` or accept `%USERPROFILE%\.chat2codex`.
2. Create `.env` from the packaged template and set an absolute `CODEX_WORKDIR` and
   `CODEX_BIN`.
3. Run `chat2codex service print --target windows-task` and review paths.
4. After approval, run `chat2codex service install --target windows-task`.
5. Run `chat2codex doctor`, then explicitly start/query the task.

Install generates three distinct local Gateway keys, applies current-user/SYSTEM/
Administrators-only ACLs, writes a managed env block and lifecycle manifest, and
registers the task last. It never writes the real `~/.codex` or trusts Hooks.
Re-running install requires the same task identity; changing the name requires an
explicit uninstall first. Rollback copies are owner-only and canonical-path checked.

## Upgrade and rollback

Before upgrade record the archive, package, manifest, config, state, task, process,
lock, and log hashes. Copy state/config to a new rollback directory. Install the new
reviewed archive and rerun service install; valid keys and user config are
preserved. Run doctor and smokes before real E2E. On failure unregister the exact
task, restore the compatible old package/config/state, reinstall its definition,
and run the old doctor. Schema downgrade is refused while obligations remain.

## Uninstall

`chat2codex service uninstall --target windows-task` removes the exact task,
installer-owned launcher/manifest/task XML and installer-owned Gateway keys, and
the managed env block. It preserves user-authored env lines, durable state, logs,
credentials, deliverables, and backups. No purge mode exists.
Uninstall stops only writers matching the exact installed entrypoint and verifies
their PID/creation identity, task absence, and owned-path containment before
deleting files. The manifest is removed last so an interrupted cleanup is retryable.
