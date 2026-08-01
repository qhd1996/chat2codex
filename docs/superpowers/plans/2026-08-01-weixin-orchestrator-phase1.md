# Weixin Orchestrator Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the one-Weixin-chat/one-Codex-thread runtime with a durable task registry, natural multi-task routing, safe workspace-aware concurrency, and a four-image-before-text ingress workflow.

**Architecture:** Keep Chat2Codex transport, durable inbox/outbox, approvals, and Codex app-server protocol as the base. Introduce focused platform-neutral modules for task state, command actions, semantic routing, workspace routing, execution isolation, and scheduling; migrate bridge state to schema v4; then make BridgeRunner and CodexRunner key execution and interaction state by task ID instead of chat ID. Preserve slash commands as a compatibility adapter into the same command AST.

**Tech Stack:** TypeScript 7, Node.js ESM, Bun 1.3 tests, Zod 4, Codex app-server JSON-RPC, Git worktrees, JSON durable state, native Weixin iLink adapter.

---

## Scope and completion boundary

This plan implements only Phase 1: durable multi-task state; natural routing across the complete current command surface; six semantic workspaces; task-labelled progress and interactions; different-workspace concurrency; same-workspace Git-worktree and output-only concurrency; safe FIFO serialization for general non-Git changes; task-keyed Codex sessions; one-to-four inbound images with text required; migration from natural.9; deployment; and real Weixin acceptance.

Phase 1 does not implement outbound image/file upload, desktop handoff/dashboard, or UsageAdvisor aggregation. Those remain required in Phases 2-4. Do not mark the overall goal complete after this plan.

## File structure

New focused modules:

- **src/core/task-registry.ts** — durable task lifecycle, aliases, recent requests, thread binding, and legacy-chat import.
- **src/core/command-actions.ts** — exhaustive internal command AST and slash-command adapter.
- **src/core/natural-task-router.ts** — strict semantic routing schemas and fail-closed validation.
- **src/core/task-target-resolver.ts** — deterministic candidate construction and ambiguity rules.
- **src/core/workspace-router.ts** — six workspace categories, aliases, canonicalization, and authorization.
- **src/core/task-scheduler.ts** — task queues, global permits, isolation choice, and FIFO fallback.
- **src/core/execution-workspaces.ts** — Git worktree and non-Git output-only workspace lifecycle.
- **src/core/task-labels.ts** — compact labels for progress, approval, failure, and terminal replies.
- Matching focused tests under **tests/**.

Existing integration files:

- **src/state/types.ts**, **src/state/store.ts**, **tests/state-store.test.ts** — schema v4 and natural.9 migration.
- **src/config/env.ts**, **.env.example**, **tests/config.test.ts** — workspace map and concurrency configuration.
- **src/runtime/openai-intent-classifier.ts**, **src/runtime/bridge-runtime.ts** — classifier and service construction.
- **src/agent/codex-runner.ts** and session tests — task-keyed reusable sessions.
- **src/core/bridge-runner.ts**, **tests/message-router.test.ts** — orchestration integration.
- **src/core/image-drafts.ts**, **tests/image-drafts.test.ts** — explicit draft inspection and disposition.
- README files, architecture, package version, deployment evidence.

## Cross-task invariants

1. conversationId identifies transport; taskId identifies a logical Codex task.
2. A Codex thread belongs to at most one task and has one active turn.
3. Active, queued, steer, approval, permission, input, MCP, retry, and status records are task-qualified.
4. Ambiguous destructive or permission-bearing routing asks one question and preserves state.
5. Generic consent grants at most one turn; session permission requires explicit wording.
6. Image drafts stay keyed by conversation and stable sender until text binds them to a task.
7. Durable jobs record task ID, workspace root, execution cwd, and isolation mode before execution.
8. Different workspaces can overlap; general non-Git mutations in one workspace are FIFO.
9. Running jobs are not replayed after crash; queued jobs remain recoverable.
10. Every task-specific reply begins with a sanitized task label.

---

### Task 1: Add schema-v4 task state and TaskRegistry

**Files:**
- Create: **src/core/task-registry.ts**
- Create: **tests/task-registry.test.ts**
- Modify: **src/state/types.ts**
- Modify: **src/state/store.ts**
- Modify: **tests/state-store.test.ts**

- [ ] **Step 1: Write failing registry lifecycle tests**

Define the intended API and test create, list by conversation, alias normalization, bounded recent requests, guarded transitions, unique thread ownership, archive, and sender isolation:

~~~typescript
const registry = new TaskRegistry({ now: () => Date.parse("2026-08-01T00:00:00Z") });
const task = registry.create(state, {
  conversationId: "wx_chat", chatType: "direct", senderKey: "ilink:user-1",
  title: "日本酒店", aliases: ["酒店任务"], workspaceKind: "travel",
  workspaceRoot: "F:\\workspace\\workbuddy\\Travel", objective: "比较东京酒店",
});
expect(task.taskId).toMatch(/^tsk_[a-f0-9]{24}$/u);
expect(registry.listConversation(state, "wx_chat")).toEqual([task]);
expect(() => registry.transition(state, task.taskId, "running")).not.toThrow();
expect(() => registry.transition(state, task.taskId, "draft")).toThrow(/transition/i);
~~~

- [ ] **Step 2: Run RED**

Run: **bun test tests/task-registry.test.ts**

Expected: FAIL because TaskRegistry and task state do not exist.

- [ ] **Step 3: Add exact task state types**

Add TaskStatus, WorkspaceKind, IsolationMode, RegisteredTask, and ConversationTaskState. RegisteredTask contains taskId, conversationId, chatType, senderKey, title, aliases, workspace kind/root, executionCwd, isolation mode, session epoch, optional thread/turn IDs, status, objective summary, bounded recent requests, timestamps, and optional LastRunSummary. Add tasks and conversations to BridgeState. Add taskId/workspaceRoot/executionCwd/isolationMode to DurableCodexJob.

- [ ] **Step 4: Implement TaskRegistry minimally**

Expose create, get, listConversation, bindThread, transition, appendRequest, addAlias, and archive. Generate IDs from 12 random bytes. Bound aliases to 12, recent requests to 8, title to 48 code points, objective to 500 characters, and request summaries to 300 characters.

- [ ] **Step 5: Write failing v3-to-v4 migration test**

Persist schema v3 with one natural.9 ChatSession. Assert load/save creates one deterministic imported task with canonical_fifo isolation, preserves thread/cwd/epoch, links it from conversations, and writes a private **.v3.bak**. Assert schema 5 remains rejected.

- [ ] **Step 6: Run migration RED**

Run: **bun test tests/state-store.test.ts -t "migrates schema v3 tasks"**

Expected: FAIL because schema v4 import is missing.

- [ ] **Step 7: Implement schema v4 migration**

Bump bridgeStateSchemaVersion to 4. Derive legacy task ID from adapter ID, conversation ID, and session epoch using SHA-256 truncated to 24 hex digits. Retain v0.6/v2 routes and normalize missing task collections safely.

- [ ] **Step 8: Run GREEN**

Run: **bun test tests/task-registry.test.ts tests/state-store.test.ts**

Expected: PASS, zero failures.

- [ ] **Step 9: Commit**

~~~bash
git add src/core/task-registry.ts src/state/types.ts src/state/store.ts tests/task-registry.test.ts tests/state-store.test.ts
git commit -m "feat: add durable task registry"
~~~

---

### Task 2: Configure and resolve six semantic workspaces

**Files:**
- Create: **src/core/workspace-router.ts**
- Create: **tests/workspace-router.test.ts**
- Modify: **src/config/env.ts**, **tests/config.test.ts**, **.env.example**

- [ ] **Step 1: Write failing configuration and routing tests**

Use one JSON environment value named CHAT2CODEX_WORKSPACE_ROUTES with strict work, travel, personal, finance, ai_lab, and learning keys. Test absolute/canonical paths, duplicate roots, missing directories, aliases, explicit existing paths, group path authorization, and ambiguity.

- [ ] **Step 2: Run RED**

Run: **bun test tests/workspace-router.test.ts tests/config.test.ts -t "workspace routes"**

Expected: FAIL because the option and router do not exist.

- [ ] **Step 3: Implement config parsing and WorkspaceRouter**

Expose list, resolveKind, resolveExplicit, and candidatesForClassifier. Canonicalize with realpath and apply existing directoryAllowedForChat semantics. If config is absent, preserve upstream compatibility with one work route using CODEX_WORKDIR; production must supply all six before E2E.

- [ ] **Step 4: Run GREEN**

Run: **bun test tests/workspace-router.test.ts tests/config.test.ts**

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add .env.example src/config/env.ts src/core/workspace-router.ts tests/config.test.ts tests/workspace-router.test.ts
git commit -m "feat: add semantic workspace routing"
~~~

---

### Task 3: Create exhaustive command AST and strict natural task decisions

**Files:**
- Create: **src/core/command-actions.ts**, **src/core/natural-task-router.ts**
- Create: **tests/command-actions.test.ts**, **tests/natural-task-router.test.ts**
- Modify: **src/runtime/openai-intent-classifier.ts**, **tests/openai-intent-classifier.test.ts**

- [ ] **Step 1: Write failing command coverage tests**

Define a discriminated CommandAction union covering create/continue/steer/stop/inspect/retry/archive/resume/fork/compact; approve/deny/grant-turn/grant-session; user-input and MCP answers; image attach/discard/clarify; task/project/thread/history/search/status/host/usage/summary/files/diff/logs/identity listings; project selection; unarchive; and service status/logs/restart. Test every README slash command maps to exactly one action. Unknown slash text must not become a privileged action.

- [ ] **Step 2: Run RED**

Run: **bun test tests/command-actions.test.ts**

Expected: FAIL because the AST is missing.

- [ ] **Step 3: Implement pure slash adapter**

Move parsing out of BridgeRunner into parseSlashCommand. Preserve reply-code and option validation in task-specific handlers; never manufacture approval choices.

- [ ] **Step 4: Write failing natural routing schema tests**

NaturalTaskRoutingInput contains bounded text, conversation, task candidates, workspace candidates, image count, and pending interactions. NaturalTaskDecision contains one CommandAction, imageDisposition (none/attach/discard/clarify), and confidence. Reject unknown fields, missing/non-candidate task IDs, low confidence, multiple destructive targets, implicit session permission, and quoted-only approval.

- [ ] **Step 5: Run RED**

Run: **bun test tests/natural-task-router.test.ts**

Expected: FAIL because the schema is missing.

- [ ] **Step 6: Implement strict validation and classifier prompt**

Use a Zod discriminated union mirroring CommandAction. Runtime-validate decisions against candidates. Classifier input includes only task ID, title, aliases, workspace kind, status, objective summary, bounded recent requests, and pending interaction kinds. Cap task candidates at 12 and serialized input at 16 KiB. On timeout, malformed output, conflict, or low confidence, return clarify.

- [ ] **Step 7: Run GREEN**

Run: **bun test tests/command-actions.test.ts tests/natural-task-router.test.ts tests/openai-intent-classifier.test.ts**

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add src/core/command-actions.ts src/core/natural-task-router.ts src/runtime/openai-intent-classifier.ts tests/command-actions.test.ts tests/natural-task-router.test.ts tests/openai-intent-classifier.test.ts
git commit -m "feat: add natural task command model"
~~~

---

### Task 4: Resolve targets and label task messages

**Files:**
- Create: **src/core/task-target-resolver.ts**, **src/core/task-labels.ts**
- Create: **tests/task-target-resolver.test.ts**, **tests/task-labels.test.ts**

- [ ] **Step 1: Write failing tests**

Cover exact task ID/title/alias, unique pending interaction, semantic candidate, recency tie-break, archived exclusion, wrong sender/conversation, ambiguity, and missing target. Labels must strip controls/newlines, be at most 20 code points, and fall back to an ID prefix.

- [ ] **Step 2: Run RED**

Run: **bun test tests/task-target-resolver.test.ts tests/task-labels.test.ts**

Expected: FAIL.

- [ ] **Step 3: Implement deterministic resolution**

Resolve exact/security-sensitive matches before model classification. Recency may break ties only for non-destructive actions. Never use recency to guess stop, approval, permission, archive, or delivery targets.

- [ ] **Step 4: Run GREEN and commit**

Run: **bun test tests/task-target-resolver.test.ts tests/task-labels.test.ts**

Expected: PASS.

~~~bash
git add src/core/task-target-resolver.ts src/core/task-labels.ts tests/task-target-resolver.test.ts tests/task-labels.test.ts
git commit -m "feat: resolve and label Weixin tasks"
~~~

---

### Task 5: Key reusable Codex sessions by task

**Files:**
- Modify: **src/agent/codex-runner.ts**
- Modify: **tests/codex-session-manager.test.ts**, **tests/codex-runner.test.ts**

- [ ] **Step 1: Write failing same-chat/different-task tests**

Start two runs with one conversation and distinct task IDs. Assert two sessions, independent thread binding, and invalidating one task leaves the other alive.

- [ ] **Step 2: Run RED**

Run: **bun test tests/codex-session-manager.test.ts -t "different tasks in one conversation"**

Expected: FAIL with current one-session-per-chat behavior.

- [ ] **Step 3: Change CodexSessionScope**

Replace chatId with conversationId plus taskId. Rename sessionsByChat to sessionsByTask, key by adapter plus task, expose invalidateTaskSession, and retain a temporary compatibility adapter until BridgeRunner migrates.

Also extend CodexRunInput with an optional per-turn sandbox policy that is passed unchanged to app-server turn/start. It must support the existing readOnly, dangerFullAccess, and workspaceWrite shapes; workspaceWrite includes explicit writableRoots. When omitted, retain the configured global policy.

- [ ] **Step 4: Preserve one owner per thread and one turn per task**

Distinct tasks may run concurrently only with distinct threads. Reject a second active owner of one thread.

- [ ] **Step 5: Run GREEN and commit**

Run: **bun test tests/codex-session-manager.test.ts tests/codex-runner.test.ts**

Expected: PASS.

~~~bash
git add src/agent/codex-runner.ts tests/codex-session-manager.test.ts tests/codex-runner.test.ts
git commit -m "refactor: scope Codex sessions by task"
~~~

---

### Task 6: Add execution workspaces and isolation-aware scheduling

**Files:**
- Create: **src/core/execution-workspaces.ts**, **src/core/task-scheduler.ts**
- Create: **tests/execution-workspaces.test.ts**, **tests/task-scheduler.test.ts**

- [ ] **Step 1: Write failing execution workspace tests**

Temporary fixtures prove: Git task gets CHAT2CODEX_HOME/worktrees/taskId and branch chat2codex/taskId; worktree persists across turns; output-only task gets workspace/outputs/tasks/taskId; general non-Git uses canonical_fifo; invalid IDs, missing roots, symlinks, dirty destinations, and Git failure fail closed. Add an installed-Codex sandbox contract fixture proving an output-only turn can read a named source file by absolute path, can write inside its task output directory, and cannot modify a sentinel in the source workspace.

- [ ] **Step 2: Run RED**

Run: **bun test tests/execution-workspaces.test.ts**

Expected: FAIL.

- [ ] **Step 3: Implement ExecutionWorkspaceService**

Use spawn/execFile, never shell interpolation. For Git, run git with argument arrays and create/reuse a task worktree without merging/deleting/resetting. For output-only, create the private output directory and return a workspaceWrite sandbox policy whose turn cwd is that directory and whose writableRoots contains only that directory. Supply the canonical source root separately as an absolute read context; do not add it to writableRoots. General non-Git returns canonical_fifo.

The service exposes sandboxVerified. Mark output-only isolation usable only after the negative installed-Codex write probe passes for the current Codex version. If the probe is unavailable or fails, return canonical_fifo and report the fallback; never rely on prompt text alone to make the source workspace read-only.

- [ ] **Step 4: Write failing scheduler tests**

Controlled promises prove different roots overlap, same non-Git general root serializes FIFO, verified output-only tasks overlap, unverified output-only requests fall back to FIFO, Git worktrees overlap, one task serializes turns, wait cancellation works, global capacity is enforced, and failure releases locks.

- [ ] **Step 5: Run RED**

Run: **bun test tests/task-scheduler.test.ts**

Expected: FAIL.

- [ ] **Step 6: Implement TaskScheduler**

Use one FIFO tail per task, one canonical-root tail only for canonical_fifo, and a global semaphore. Worktree/output-only modes bypass canonical-root FIFO but remain task-serialized and globally bounded. Expose schedule, cancel, and snapshot.

- [ ] **Step 7: Run GREEN and commit**

Run: **bun test tests/execution-workspaces.test.ts tests/task-scheduler.test.ts**

Expected: PASS.

~~~bash
git add src/core/execution-workspaces.ts src/core/task-scheduler.ts tests/execution-workspaces.test.ts tests/task-scheduler.test.ts
git commit -m "feat: schedule isolated Codex tasks"
~~~

---

### Task 7: Integrate task routing and task-keyed runs into BridgeRunner

**Files:**
- Modify: **src/core/bridge-runner.ts**
- Modify: **src/runtime/bridge-runtime.ts**
- Modify: **tests/message-router.test.ts**

- [ ] **Step 1: Write failing two-task/one-chat integration test**

Using controlled fake Codex runs in one Weixin conversation: create **日本酒店** in Travel, create **财报分析** in Finance before the first completes, assert both start concurrently with distinct task IDs/cwds/scopes/threads, steer only the hotel task, stop only the finance task, and assert all progress/final text has the correct label.

- [ ] **Step 2: Run RED**

Run: **bun test tests/message-router.test.ts -t "runs two named tasks in one Weixin conversation"**

Expected: FAIL because queuedRuns/activeRuns are chat-keyed.

- [ ] **Step 3: Inject OrchestratorDependencies**

Construct and inject TaskRegistry, NaturalTaskRouter, TaskTargetResolver, WorkspaceRouter, ExecutionWorkspaceService, TaskScheduler, and ImageDraftService from bridge-runtime.ts. Enable for Weixin natural orchestration. Preserve Feishu via one imported compatibility task per chat until later generalization.

- [ ] **Step 4: Replace chat-keyed execution maps**

Key queuedRuns, activeRuns, pendingRunSteers, retryable runs, and status metadata by task ID. Store conversationId separately for delivery. Change internal run entry to **runTask(taskId, request)** and read cwd/thread/epoch from RegisteredTask.

- [ ] **Step 5: Persist and schedule by task**

Before scheduling, persist durable job taskId/workspaceRoot/executionCwd/isolationMode. Resolve execution workspace, schedule it, call Codex with sessionScope.taskId, and bind onThreadBound through TaskRegistry with stale-generation checks.

- [ ] **Step 6: Stop holding the conversation queue for a full turn**

Keep a short conversation queue only for durable acceptance, classification, and atomic task creation/selection. Dispatch the durable run to TaskScheduler and track its promise for shutdown/tests so another message in the same conversation can create/control another task immediately.

- [ ] **Step 7: Add deterministic guidance**

Ambiguous task/workspace sends one question without consuming state. A non-Git general mutation that cannot overlap reports safe FIFO waiting rather than claiming concurrency.

- [ ] **Step 8: Run focused then complete router tests**

Run:

~~~bash
bun test tests/message-router.test.ts -t "task|concurrent|workspace|natural"
bun test tests/message-router.test.ts
~~~

Expected: PASS. Change legacy assertions only where task labels or task IDs intentionally alter output.

- [ ] **Step 9: Commit**

~~~bash
git add src/core/bridge-runner.ts src/runtime/bridge-runtime.ts tests/message-router.test.ts
git commit -m "feat: orchestrate multiple Weixin tasks"
~~~

---

### Task 8: Scope approvals, permissions, inputs, and controls to tasks

**Files:**
- Modify: **src/core/bridge-runner.ts**, **src/core/command-actions.ts**
- Modify: **tests/message-router.test.ts**, **tests/command-actions.test.ts**

- [ ] **Step 1: Write failing simultaneous-interaction tests**

Start two tasks in one conversation with the same synthetic request ID. Assert labelled prompts; named one-turn approval resolves only one task; generic consent with two candidates clarifies; session wording is required for grantSession; wrong sender/task, stale reply, quoted-only consent, and card mismatch fail; user-input and MCP replies obey the same binding.

- [ ] **Step 2: Run RED**

Run: **bun test tests/message-router.test.ts -t "same conversation pending interactions"**

Expected: FAIL because pending records are only chat-qualified.

- [ ] **Step 3: Qualify all pending interaction records**

Add taskId and use key **taskId:threadId:turnId:requestId**. Every prompt, card payload, natural candidate, reply code, abort, timeout, and terminal update carries task identity. Never resolve by request ID alone.

- [ ] **Step 4: Route compatibility commands through CommandAction**

Replace direct command branches with the shared dispatcher. Add table-driven tests for every README command and natural AST equivalent. Preserve the /whoami access-control exception.

- [ ] **Step 5: Run focused and full tests**

Run:

~~~bash
bun test tests/command-actions.test.ts tests/message-router.test.ts -t "approval|permission|user input|MCP|command surface"
bun test tests/message-router.test.ts
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/core/bridge-runner.ts src/core/command-actions.ts tests/command-actions.test.ts tests/message-router.test.ts
git commit -m "feat: scope interactions to Weixin tasks"
~~~

---

### Task 9: Complete the four-image-before-text state machine

**Files:**
- Modify: **src/core/image-drafts.ts**, **src/core/natural-task-router.ts**, **src/core/bridge-runner.ts**
- Modify: **tests/image-drafts.test.ts**, **tests/natural-task-router.test.ts**, **tests/message-router.test.ts**

- [ ] **Step 1: Write failing non-consuming draft tests**

Add peek, consume, and discard expectations. Verify repeated peek is non-consuming, discard securely deletes, fifth image is deleted while the first four remain, and ambiguous text leaves the draft unchanged.

- [ ] **Step 2: Run RED**

Run: **bun test tests/image-drafts.test.ts -t "peek|fifth|ambiguous"**

Expected: FAIL because explicit disposition APIs are missing.

- [ ] **Step 3: Implement minimal draft API**

Add peek; rename take to consume with a temporary deprecated wrapper; add discard that consumes then deletes. Preserve all signature, hash, root, count, and byte checks.

- [ ] **Step 4: Write failing normalized ingress flows**

Cover one-to-four image-only acknowledgements with no Codex call; fifth-image guidance with four preserved; text attach to resolved task; explicit abandon then Finance/Learning task without images; ambiguity preserves draft; TTL cleanup; restart revalidation; duplicate event idempotency; and incoming multi-image batch rollback on partial download failure.

- [ ] **Step 5: Run RED**

Run: **bun test tests/message-router.test.ts -t "Phase 1 image draft"**

Expected: FAIL until task-aware disposition is integrated.

- [ ] **Step 6: Implement validated dispositions**

- **attach:** atomically consume draft with durable job creation, store localImages, bind to target task.
- **discard:** remove state/files before dispatching the separate new action.
- **clarify:** persist bounded candidate task IDs and draft key, never image bytes/descriptors.
- **none with draft:** convert to clarify; never silently consume.

- [ ] **Step 7: Run GREEN and commit**

Run: **bun test tests/image-drafts.test.ts tests/natural-task-router.test.ts tests/message-router.test.ts -t "image|draft|discard"**

Expected: PASS.

~~~bash
git add src/core/image-drafts.ts src/core/natural-task-router.ts src/core/bridge-runner.ts tests/image-drafts.test.ts tests/natural-task-router.test.ts tests/message-router.test.ts
git commit -m "feat: complete task-aware image ingress"
~~~

---

### Task 10: Make recovery, retention, status, and shutdown task-durable

**Files:**
- Modify: **src/state/store.ts**, **src/core/bridge-runner.ts**
- Modify: **tests/state-store.test.ts**, **tests/message-router.test.ts**

- [ ] **Step 1: Write failing recovery tests**

Persist/restart: queued jobs for two tasks recover independently; running task becomes interrupted and is not replayed; queued isolated task retains execution metadata; clarification retains candidate task IDs/draft key; stale controls never hit a replacement task; outbox is job/task qualified; retention keeps active/referenced obligations; shutdown aborts all tasks and awaits active run promises.

- [ ] **Step 2: Run RED**

Run: **bun test tests/state-store.test.ts tests/message-router.test.ts -t "task recovery"**

Expected: FAIL until recovery is task-aware.

- [ ] **Step 3: Normalize durable references**

Validate job.taskId, conversation.taskIds, task.threadId, clarification candidates, and draft binding. Orphaned queued jobs fail closed with a recovery diagnostic; never invent a task target.

- [ ] **Step 4: Implement bounded task status**

Status/host list label, state, workspace kind, execution mode, queue reason, age, approval wait, and thread preview. Exclude full prompts, secrets, reply codes, and file contents.

- [ ] **Step 5: Run focused and complete tests**

Run:

~~~bash
bun test tests/state-store.test.ts tests/message-router.test.ts -t "recovery|status|shutdown|retention"
bun test tests/state-store.test.ts tests/message-router.test.ts
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/state/store.ts src/core/bridge-runner.ts tests/state-store.test.ts tests/message-router.test.ts
git commit -m "fix: recover task-scoped Weixin work safely"
~~~

---

### Task 11: Document, verify, and package Phase 1

**Files:**
- Modify: **README.md**, **README.zh-CN.md**, **docs/architecture.md**, **.env.example**, **package.json**

- [ ] **Step 1: Document behavior and limits**

Document workspace JSON, task labels, ambiguity, concurrency matrix, persistent worktrees, output-only dirs, non-Git FIFO, four-image flow, migration backup, slash compatibility, and Phase 1 exclusions. Update architecture diagram without claiming Phase 2-4.

- [ ] **Step 2: Run focused Phase 1 tests**

Run:

~~~bash
bun test tests/task-registry.test.ts tests/workspace-router.test.ts tests/command-actions.test.ts tests/natural-task-router.test.ts tests/task-target-resolver.test.ts tests/task-labels.test.ts tests/execution-workspaces.test.ts tests/task-scheduler.test.ts tests/image-drafts.test.ts tests/state-store.test.ts tests/codex-session-manager.test.ts tests/message-router.test.ts
~~~

Expected: PASS, zero failures.

- [ ] **Step 3: Run complete checks**

Run:

~~~bash
bun run check
bun audit
bun pm pack --dry-run
~~~

Expected: typechecks/contracts/tests/build pass, no unresolved production vulnerability, and dry-run contents are correct.

- [ ] **Step 4: Bump candidate version after checks**

Change package version from **0.8.0-natural.9** to **0.8.0-orchestrator.1** and update lockfile using the repository's normal Bun operation. Rerun **bun run check**.

- [ ] **Step 5: Commit and pack**

~~~bash
git add .env.example README.md README.zh-CN.md docs/architecture.md package.json bun.lock
git commit -m "docs: prepare Weixin orchestrator phase 1"
bun pm pack
~~~

Expected: one **chat2codex-0.8.0-orchestrator.1.tgz**. Record SHA-256.

---

### Task 12: Deploy safely and run real Weixin Phase 1 acceptance

**Files:**
- Modify during deployment: **F:/Chat2Codex/Start-Chat2Codex.ps1**
- Create: **docs/superpowers/verification/2026-08-01-weixin-orchestrator-phase1.md**

- [ ] **Step 1: Capture pre-deploy evidence and backup**

Record installed version/hash manifest, state hash, scheduled-task status, gateway PID, log tail, and counts. Copy installed package/state to timestamped **F:/Chat2Codex/rollback/phase1-...**. Never delete older backups.

- [ ] **Step 2: Update non-secret launcher settings**

Set six-workspace JSON, CODEX_MAX_CONCURRENT_RUNS=4, and CODEX_MAX_APP_SERVER_SESSIONS=8. Keep workspace-write sandbox, on-request approvals, direct-message-only access, and allowlists unchanged.

- [ ] **Step 3: Install with bounded interruption**

Stop the scheduled task; verify only the exact **F:/Chat2Codex/node/node.exe** gateway exits; install the hashed package; restart. Never kill unrelated Node/Codex processes.

- [ ] **Step 4: Verify migration and runtime before messages**

Run installed doctor, handshake smoke, turn smoke, and approval smoke. Prove version, schema v4 plus .v3.bak, exactly one imported prior task/thread, one gateway/lock, ready log without repeated auth/poll failures, and six canonical roots.

- [ ] **Step 5: Obtain action-time confirmation**

Restate exact bot conversation and non-sensitive payload before sending test text/images. Stop immediately if the user takes control or presses Esc.

- [ ] **Step 6: Run natural multi-task E2E**

Without slash commands: create named Travel and Finance tasks concurrently; verify labels and independent state; steer one; stop the other; trigger ambiguity and no-action clarification; trigger two approvals and resolve one named task; verify generic consent never grants session scope.

- [ ] **Step 7: Run workspace concurrency E2E**

Prove different roots overlap, same Git fixture uses distinct worktrees and overlaps, output-only tasks use distinct output dirs and overlap, and general non-Git changes execute FIFO with wait reason.

- [ ] **Step 8: Run four-image E2E**

Use non-sensitive images: four image-only messages cause no turn; fifth is rejected with four kept; text submits exactly four localImage items; explicit abandon starts another Learning task without images; ambiguity preserves; isolated short TTL expires; restart revalidates pending draft.

- [ ] **Step 9: Verify recovery and rollback**

Queued task survives restart. Running controlled task becomes interrupted and is not replayed. Exercise rollback against disposable copied state, restore candidate, and verify health.

- [ ] **Step 10: Write and commit evidence**

Record exact commands/timestamps/package hash/migration/test counts/redacted IDs/concurrency/image counts/failures/rollback and every unverified requirement.

~~~bash
git add docs/superpowers/verification/2026-08-01-weixin-orchestrator-phase1.md
git commit -m "test: verify Weixin orchestrator phase 1"
~~~

Phase 1 is accepted only with direct evidence for all real Weixin, concurrency, image, recovery, and migration checks. Otherwise report it incomplete and keep the goal active.

---

## Plan self-review checklist

- Every Phase 1 design requirement maps to implementation and verification.
- State, runtime maps, sessions, interactions, jobs, and output carry task identity.
- Existing access control, approval disclosure, attachment validation, and durable delivery remain intact.
- No Phase 2-4 capability is implemented or claimed.
- General non-Git mutation is serialized; no automatic merge is implied.
- No external message or service mutation precedes action-time confirmation.
- Existing untracked tarballs are never staged by broad **git add .** commands.
