# Post-approval execution packets

Date: 2026-08-03 Asia/Shanghai

Status: **prepared, not authorized or executed.** Each packet requires its own
action-time confirmation. Approval of one packet never authorizes another.

## Immutable candidate inputs

- Candidate version: `0.8.0-novice.6`.
- Source: `11919dddfb20d3510fa0587c42926630ed0ce7c7`.
- Package: `chat2codex-0.8.0-novice.6.tgz`; 392,178 bytes; 131 files.
- SHA-256: `81cdcb130550bff426e2386f8a921609ea7b3ad1255eec75b0c1cfa6bf784079`.
- Reproduction: two new detached clean checkouts produced byte-identical archives.
- Do not use superseded `.3`, `.4`, `.5`, or intermediate
  `122d624`/`b216232`/`8ff7ee3`/`e917aa5` provenance.
- Hook hashes: `97d50e...d9f00`, `96e6d6...9169`, `9388dd...45e6`.
- Requirements ledger: `e3553f9`.
- Task 11 handoff: `3b0698c`.
- Final temporary-Codex-Home config SHA-256: `a70084...db0ce`; exactly two
  untrusted Hooks, one disabled/unstarted MCP definition, zero error/warning, and
  no `plugin/list`.
- Final seven-primitives report: 160/160, zero residual process, SHA-256
  `0f8400...5a93d`.

Any byte, version, process, state, task, or target drift invalidates this packet and
requires a fresh read-only inventory before action.

## Packet A — production supervision recovery

Separate confirmation: **production process stop/start**. This does not deploy the
candidate.

Current read-only target snapshot:

- Scheduled Task: `Chat2Codex-Weixin`, action
  `F:/Chat2Codex/Start-Chat2Codex.ps1`; state `Ready`; result `0x1`.
- Orphan chain: `cmd.exe` PID 33440 created
  `2026-08-02T03:40:06.3342960Z` → `node.exe` PID 10448 created
  `2026-08-02T03:40:06.4096280Z`.
- Installed package `0.8.0-orchestrator.4`; state schema 4.
- State SHA-256:
  `CB1BF1F39ACDE7DADCAE52679C650236197C8570EDC7A253E5A1326E04552BD4`.
- Obligations: 0 non-terminal jobs, pending outbox/messages/drafts/clarifications,
  and Desktop bindings.

After approval: recheck the exact identities and obligations; stop only the exact
orphan subtree; start the existing Scheduled Task; prove one new managed chain,
one state lock, adapter health, unchanged package/state bytes, and no duplicate
writer. Stop on any drift. Rollback is to stop only the new identity and restore
the prior process plan; do not deploy or migrate in this packet.

## Packet B — package backup and Task 12 installation

Separate confirmation: **production write/install**.

Before any write, create a new timestamped backup of package, launcher, config,
state, task XML, and process inventory. Record SHA-256 and byte-compare the backup.
Install only the exact package above using the shipped Windows lifecycle. Require
owner-only key ACLs, real Scheduled Task query, doctor, one writer, schema backup,
and rollback eligibility. Stop before changing the real Codex Home or trusting a
Hook. Rollback uses the recorded old package/config/state/task and never deletes
user data.

## Packet C — real Codex Home materialization

Separate confirmation: **real `~/.codex` write**.

Show the final `config.toml` patch, two Hook definitions, one MCP definition, three
absolute token-file paths, port/Host, exact Node/package paths, and current config
hash before writing. Generate three independent 256-bit keys locally; record no
token bytes. Set and independently verify owner-only ACLs and non-owner denial.
MCP remains disabled until its approved enable point. Stop before Hook trust or
Desktop restart. Rollback restores the pre-write config bytes and removes only the
newly owned definitions/keys.

## Packet D — Hook hash review and trust

Separate confirmation: **Hook trust**.

Recompute installed hashes and compare all three manifest values. Inspect exact
command, environment, timeout, events, and absence of `SubagentStop`. Grant trust
only for exact matching paths/bytes. Exercise missing executable, crash, timeout,
changed/untrusted hash, disabled Hook, and conflicting configuration. Any ordinary
prompt that silently continues is a hard failure: create no binding and roll back
trust/config. Stop before Desktop restart.

## Packet E — Desktop restart and seven installed primitives

Separate confirmation: **Desktop restart**.

Re-enumerate the exact Desktop package/process, restart only that identity, then
verify signed status, MCP inventory, `127.0.0.1` bind, identical concrete root
threadId and stable `thread/read` digest. Run all seven installed rows, recording
versions, timestamps, redacted envelopes, generations/fences/wakes, state/outbox
hashes, and zero unexpected turn/delivery/process. No Computer Use or real Weixin
send is implied.

## Packet F — clean Windows qualifying run

Separate confirmation: **remote push/PR/workflow dispatch or an equivalent clean
Windows environment**, plus any real login/Desktop actions required there.

Use the exact candidate and fixed old package. Require schema-v5 bound attestation,
same owned environment, Scheduled Task lifecycle, another-user ACL denial, real
old/new upgrade chain, 30 unique stopped process identities, 30×19 executions,
and zero residual task/user/process/root. This can promote `NOVICE-*` and
`DIST-002` only after independent artifact verification; it cannot close real
Weixin/Desktop `DIST-003` by itself.

## Packet G — Computer Use and real Weixin E2E

Two separate confirmations: **Computer Use**, then immediately before first send
**real Weixin outbound**.

Freshly enumerate the intended Weixin handle/conversation and show final payload.
Prove inbound plus ordered text → image → file, byte hashes, retry/restart/dedup,
task targeting, workspace/Plan/approval/structured input, and no Codex rerun. Stop
on stale handle, ambiguity, changed payload, unexpected recipient, or any write not
covered by the confirmed packet.

## Terminal message

Only after every accepted Goal row has direct evidence may the already authorized
terminal message be sent exactly once to Haoda: `codex连接微信成功，请试用`. The
current Goal is active, so this message remains unsent.
