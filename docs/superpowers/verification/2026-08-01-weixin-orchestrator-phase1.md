# Weixin Orchestrator Phase 1 Verification

## Verdict

**Incomplete as of 2026-08-02 01:00 Asia/Shanghai.** The candidate is deployed and one repaired natural-language `create_task` flow completed through the real Weixin bot, but the complete Phase 1 acceptance matrix has not been exercised through Weixin. In particular, real multi-task control, concurrency, task-scoped approvals, the four-image state machine, queued-task recovery, and rollback remain unverified. Phase 1 must not be called accepted yet.

This record distinguishes three evidence levels:

- **Real Weixin:** an inbound message reached the production Weixin adapter and durable runtime state/logs prove the resulting action and outbound delivery.
- **Installed runtime:** the deployed package or installed Codex binary was exercised locally.
- **Automated:** repository tests prove implementation behavior but do not replace a real Weixin acceptance flow.

All user, conversation, task, thread, job, and outbox identifiers below are redacted to their final six characters. No credentials or allowlist values are recorded. Times from JSON/logs are UTC; local operator times are Asia/Shanghai.

## Candidate and deployment evidence

| Item | Evidence | Result |
| --- | --- | --- |
| Installed candidate | `chat2codex version` returned `0.8.0-orchestrator.3`. Installed `package.json` SHA-256: `ACED28E6697B1D8BE408F703B4534F9AC8EAA1E099A6E44A18758867F0113C67`. | Pass |
| Candidate archive | `chat2codex-0.8.0-orchestrator.3.tgz`, 280,386 bytes, SHA-256 `A568CD834456DB80F993A340125AED396CC3C62B3D681588FC4BEB5AF283892D`. The archive remains untracked and was not staged. | Recorded |
| Installed/build identity | SHA-256 equality was checked for `dist/core/bridge-runner.js`, `execution-workspaces.js`, `runtime/openai-intent-classifier.js`, and `state/store.js`; all four installed files equal the freshly built worktree files. | Pass |
| Scheduled gateway | Scheduled task `Chat2Codex-Weixin` was `Running` at 2026-08-02 00:58 local; last start 00:24:09; result `0x41301` means the task is still running. Exactly one gateway process used `F:\Chat2Codex\node\node.exe` (PID 53596 at observation time), with one PowerShell launcher and one `cmd.exe` wrapper. | Pass |
| Instance lock | One active `state.json.lock` exists. Older locks are retained with `.stale-*` names and are not active locks. | Pass |
| Runtime log | The last production ready event before the real repaired flow was `2026-08-01T16:24:28.735Z`. No repeated auth or poll failure followed it in the captured log. Earlier network `fetch failed` bursts are retained in the log and predate this deployment. | Pass with historical warnings |
| Non-secret launcher policy | `workspace-write`, `on-request`, `ALLOW_GROUPS=false`, `CODEX_MAX_CONCURRENT_RUNS=4`, and `CODEX_MAX_APP_SERVER_SESSIONS=8` are set in `F:\Chat2Codex\Start-Chat2Codex.ps1`. | Pass |
| Six roots | Work, Travel, Personal, Finance, AI-Lab, and Learning all exist, canonicalize to six distinct directories under `F:\workspace\workbuddy`, and are supplied by launcher JSON. | Pass |

The persistent `.env` still contains `CODEX_MAX_CONCURRENT_RUNS=2` and no workspace-route JSON. This is not the effective scheduled-task configuration because the launcher sets both values after loading paths, but ad-hoc commands must reproduce the launcher environment. This operational distinction should be removed or documented before general maintenance.

## Backup and migration evidence

Pre-Phase-1 backup: `F:\Chat2Codex\rollback\phase1-20260801-231045`. It contains the installed package, launcher, and state. No older backup was deleted.

- Backed-up version: `0.8.0-natural.9`.
- Backed-up state: schema 3, one legacy chat, SHA-256 `7611B4E0AD8637CFAD54C0DEB644C042B2136E0674DF4DCA54B5F15B59E26F97`.
- `F:\Chat2Codex\data\state.json.v3.bak` exists and has the same size and SHA-256 as the pre-deploy state.
- Current state is schema 4. It contains one deterministic imported task (`***56a797`) owning the prior thread (`***3b8dc8`) and one later Phase 1 E2E task (`***7d6d6f`). Thread ownership is unique.
- The earlier running legacy job is now `interrupted`, not replayed.
- Current state SHA-256 at 2026-08-02 00:58 local: `1C7896367035DF0330C7CEEE2189D3822FFCA1306E1236A79BEC43E5B3A7FE68`. This hash is a point-in-time observation and will change as messages arrive.

A second hotfix backup exists at `F:\Chat2Codex\rollback\phase1-probe-hotfix-20260801-235522` and contains version `0.8.0-orchestrator.1`, its launcher, and state. A restore from copied disposable state has **not** yet been exercised.

## Fresh local gates

Commands were run on 2026-08-02 between 00:39 and 00:55 Asia/Shanghai.

### Installed runtime

With `F:\Chat2Codex\node` first on `PATH` and the launcher-equivalent non-secret environment:

```powershell
F:\Chat2Codex\npm-global\chat2codex.cmd doctor
F:\Chat2Codex\npm-global\chat2codex.cmd smoke
F:\Chat2Codex\npm-global\chat2codex.cmd smoke --mode turn
F:\Chat2Codex\npm-global\chat2codex.cmd smoke --mode approval
```

Results:

- Doctor: pass on Node `v22.23.2`; Codex `0.144.5`; bundled protocol matches; Weixin credentials and private-chat boundary pass.
- Handshake smoke: pass; new thread created under `read-only`/`never`.
- Turn smoke: pass; exact final text `chat2codex-app-server-smoke-ok`.
- Approval smoke: pass; one `item/commandExecution/requestApproval`, accepted; expected file content and final text observed.

An initial ad-hoc doctor invocation without the packaged Node first on `PATH` failed because it selected system Node `v16.17.0` (minimum is `20.12.0`). The three smoke commands still passed in that invocation. This was an operator-environment failure, not hidden; the corrected doctor command above passed.

### Repository and installed-Codex checks

```powershell
bun run check
$env:CHAT2CODEX_TEST_CODEX_BIN = '<installed codex.exe>'
bun test tests/execution-workspaces.test.ts -t 'installed Codex enforces the output-only sandbox contract'
```

- Full check: **489 pass, 8 skip, 0 fail**, 497 tests across 36 files, 2,123 assertions; typecheck, contract typecheck, and build passed.
- Skips: four Windows symlink-capability tests, one opt-in installed-Codex probe, one symlink group-boundary test, and two non-Windows service renderers.
- The skipped installed-Codex test was then rerun with the real binary: **1 pass, 0 fail** in 19.9 seconds. This proves the installed Codex output-only negative sandbox contract.

## Real Weixin evidence

### Action-time authorization

At approximately 2026-08-02 00:04 local, the operator explicitly replied with the approved non-sensitive payload in the target bot conversation after the assistant requested an action-time confirmation. The payload was a natural-language request to create `C2C-P1-E2E 日本酒店` in the Travel workspace and prepare a Tokyo Shinjuku hotel-selection framework. No slash command was used.

### First attempt: failed and retained as regression evidence

The bot answered `请说明要操作哪个任务。` even though the message explicitly requested a new task. Durable state records the corresponding legacy job as cancelled. Root cause was an overly broad classifier action schema: fields belonging to other action kinds could be emitted and strict parsing then failed closed. This attempt is **not** a pass.

Regression repair:

- Commit `e2a1589` constrains each classifier action kind to its exact allowed fields.
- Focused classifier tests: 14/14 passed; typecheck and build passed before deployment.
- Release commit `1320f6e` produced and deployed `0.8.0-orchestrator.3`.

### Repaired create flow: passed

At `2026-08-01T16:30:07.984Z` (2026-08-02 00:30 local), a real Weixin natural-language message created task `***7d6d6f`. Current durable evidence shows:

- workspace kind `travel`; workspace root and execution cwd `F:\workspace\workbuddy\Travel`;
- one task-scoped durable job `***590000`;
- run started at `16:30:12.522Z` and completed at `16:30:22.455Z`;
- runtime log records Codex start for task `***7d6d6f` in the Travel root and completion after 9,933 ms;
- one task-scoped Markdown outbox item `***312c0f` was delivered once at `16:30:22.722Z`;
- the task reached `completed`; the prior imported task retained its own state and thread.

This directly proves Weixin connection, inbound natural-language `create_task` classification, Travel routing, Codex execution, and outbound text delivery for one task. It does not prove the rest of the multi-task control surface.

## Phase 1 acceptance matrix

| Requirement | Strongest current evidence | Status |
| --- | --- | --- |
| Natural create in named workspace | Real Weixin repaired flow above | **Pass** |
| Natural continue and steer by task | Automated task/session/router tests only | **Real E2E missing** |
| Natural stop of one named task | Automated cancellation and scheduler tests only | **Real E2E missing** |
| Concurrent named Travel and Finance tasks in one conversation | Unit/integration test `runs two named tasks in one Weixin conversation` | **Real E2E missing** |
| Ambiguous target and bounded no-action clarification | Resolver/router automated tests; failed create attempt is not a valid ambiguity test | **Real E2E missing** |
| Two task-scoped approvals; resolve only the named task | Automated interaction scoping and installed approval smoke | **Real Weixin E2E missing** |
| Generic consent never grants session scope | Automated natural-interaction/router tests | **Real E2E missing** |
| Different roots overlap | Scheduler automated test | **Real Weixin timing evidence missing** |
| Same Git root uses distinct worktrees and overlaps | Git fixture exists; execution-workspace/scheduler tests pass | **Real Weixin timing evidence missing** |
| Output-only tasks use distinct output dirs and overlap | Automated tests plus real installed-Codex sandbox probe | **Real Weixin timing evidence missing** |
| General non-Git work is FIFO with wait reason | Non-Git fixture exists; automated scheduler/router tests pass | **Real Weixin timing evidence missing** |
| One through four inbound images wait for text | Automated image-draft tests; five non-sensitive fixtures prepared | **Real Weixin image E2E missing** |
| Fifth image rejected while four remain | Automated test only | **Real Weixin image E2E missing** |
| Text submits exactly four `localImage` items | Runner and image-draft automated tests | **Real Weixin image E2E missing** |
| Explicit abandon starts Learning task without images | Automated discard test only | **Real Weixin image E2E missing** |
| Image ambiguity preserves draft | Automated ambiguity/clarification tests only | **Real Weixin image E2E missing** |
| Draft TTL expiry | Automated image-draft expiry coverage | **Real Weixin E2E missing** |
| Pending draft survives restart and revalidates | Automated state/recovery tests only | **Real restart E2E missing** |
| Queued task survives restart | Automated recovery test only | **Real restart E2E missing** |
| Running controlled task becomes interrupted and is not replayed | Real migration shows one legacy running job became `interrupted` | **Pass for migrated legacy run; controlled Phase 1 restart still missing** |
| Rollback restores candidate and health from disposable copied state | Backups and hashes exist | **Exercise missing** |
| Existing text delivery has no regression | Real repaired task produced one exactly-once delivered Markdown outbox item | **Pass for one flow** |

No real image was sent during this verification record. Current durable image-draft count is zero; therefore image counts cannot be inferred from the presence of local fixture files.

## Next acceptance session

Before any additional external Weixin messages, obtain a fresh action-time confirmation describing the exact target conversation and non-sensitive payloads. Then execute, timestamp, and capture in order:

1. Travel and Finance concurrent named tasks, targeted steer, targeted stop, ambiguity, and no-action clarification.
2. Two simultaneous task-scoped approvals plus a generic-consent negative case.
3. Different-root, same-Git, output-only, and canonical non-Git FIFO timing probes.
4. Four images without text, fifth-image rejection, text submission, discard-to-Learning, ambiguity preservation, TTL expiry, and restart revalidation.
5. Queued/running restart behavior and a rollback rehearsal against disposable copied state.

Record redacted Weixin screenshots or message transcripts, state snapshots, relevant log intervals, start/end timestamps, execution paths, outbox attempt counts, and rollback hashes. Until all rows above have direct evidence, Phase 1 remains incomplete and the overall four-phase objective remains active.
