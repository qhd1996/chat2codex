# Weixin Desktop Phase 3 Read-only Recheck

## Verdict

**The installed AppX is running its internal Codex app-server; repair or reinstall is not justified by current evidence. Phase 3 remains unimplemented and all seven primitives still require behavior tests.** The earlier external-launch failures prove an AppX execution boundary, not that the desktop package cannot run its own bundled Codex binary. The shortest conforming next route is the accepted authenticated loopback Desktop Gateway fallback, subject to Haoda's design approval before a specification or implementation is written.

Observed: 2026-08-02 16:13 Asia/Shanghai.

This recheck is additive evidence. It does not rewrite or erase the earlier screenshot, external spawn failures, or signed-helper observation in 2026-08-02-weixin-desktop-phase3-probe.md.

## Installed desktop evidence

- AppX: OpenAI.Codex_26.727.6591.0_x64__2p2nqsd0c76g0, package status Ok.
- App manifest SHA-256: 4AD5CB93C9DBEF972AF353C7E323E4126830F6CB218924D85E8DBDC2A3554A80.
- Bundled signed codex.exe SHA-256: ECD7A3EAFF5E42723DBBA03B5C91514B3986B5DB5CBCA8F34619620B5356F31F.
- Signed sandbox helper SHA-256: A82BC08CF63F59BB5D157DCCCB2141DEA630985552866082B824384A54673E2A.
- The live desktop process tree includes ChatGPT.exe, its bundled codex.exe launched as app-server --analytics-default-enabled, and codex-code-mode-host.exe.
- The internal app-server exposes no observed supported external listener. Its observed TCP rows were proxy-bound outbound connections, not a loopback app-server listener.
- The AppX manifest declares one full-trust application plus protocol/file associations. It declares no app execution alias and no framework-package dependency beyond the Windows Desktop target device family.
- AppX deployment/runtime event logs contain no matching module-not-found or sandbox-helper event for the observed failure interval.

The earlier screenshot and external EPERM/Access Denied evidence remain genuine. They show that an ordinary external process cannot launch the protected AppX binaries in the same way as the desktop package. They do not prove that AppX repair will expose a supported bridge attachment point or repair the missing one-writer/binding protocol.

## Supported capability evidence

The current official Codex manual states:

- The Windows app and native CLI share the user Codex home for config, auth, and sessions.
- UserPromptSubmit can block a prompt with a block decision or exit code 2.
- Stop and UserPromptSubmit are supported lifecycle hook events.
- Non-managed hooks are skipped until the exact current hook hash is reviewed and trusted.
- hooks/list, mcpServerStatus/list, and thread/read are app-server methods.
- plugin/list is under development and must not be used by a production client.
- The desktop app-server's default transport is stdio; WebSocket transport is experimental and unsupported.

Static inspection of the installed desktop bundle independently shows that the Electron client calls hooks/list, mcpServerStatus/list, and thread/read, and renders blocked userPromptSubmit hook state. Static presence is strong feasibility evidence but not an acceptance test.

Official OpenAI Codex source commit 2b5bdcf67547860f2e5c5a605009a70026796b2b establishes the identity semantics needed by a hook:

- For a resumed root thread, session_id equals that root threadId UUID.
- A spawned subagent has its own threadId but deliberately retains the root session_id.
- App-server hook/started and hook/completed notifications carry the concrete threadId and optional turnId.

Therefore a root-thread UserPromptSubmit hook can use its session_id as the binding key. A child/subagent must never inherit the root thread's Weixin binding merely because it shares the root session_id; child threads remain unbound and non-exportable unless a future explicit concrete-thread binding is authorized.

## Current primitive matrix

SUPPORTED below means documented and present in the installed/static surface. It does not mean the required behavior passed.

| Primitive | Current evidence | Verdict | Remaining direct test |
| --- | --- | --- | --- |
| Desktop status/MCP surface | Installed bundle calls hooks/list and mcpServerStatus/list; Windows app supports plugins/skills | SUPPORTED, UNVERIFIED | Load the Gateway surface in Desktop, display authenticated redacted state, reconnect, and fail closed on Gateway loss |
| Prompt-submit lease enforcement | Official UserPromptSubmit block contract; installed bundle renders blocked hook state | SUPPORTED, UNVERIFIED | Trusted hook blocks ordinary composer submission for bridge owner, stale generation, missing binding, uncertain state, and unavailable Gateway |
| Same-thread takeover | Shared Codex home; root session_id equals threadId; app-server resume/read APIs | SUPPORTED, UNVERIFIED | Transfer a durable generation lease and continue the exact recorded threadId without copying history |
| Stop/completion wake-up | Official Stop hook and app-server completion notifications | SUPPORTED, UNVERIFIED | Emit only IDs/high-water metadata, survive missed notification, and reconcile after crash |
| Authoritative thread/read | Official stable read method; desktop bundle invokes it | SUPPORTED, UNVERIFIED | Complete a disposable bound turn and reread its exact authoritative result without trusting hook output |
| Single-writer competition | Existing in-process Chat2Codex serialization and a local writer-lock directory are insufficient cross-process proof | MISSING | Race bridge/Desktop owners; reject stale generation and concurrent writer before turn/start |
| Unbound-thread exclusion | No current durable bridge/Desktop binding table | MISSING | Complete an ordinary unbound desktop root and a child thread; prove neither enters the Weixin outbox |

No Phase 3 row passes yet. No Desktop UI action, prompt submission, new turn, thread mutation, hook installation/trust, config write, repair, reset, reinstall, or Computer Use occurred during this recheck.

## Recommended fallback boundary

The accepted fallback should use a Chat2Codex-owned authenticated loopback Gateway:

1. Listen only on 127.0.0.1 and authenticate every request with a separately stored high-entropy capability token.
2. Persist an explicit binding of threadId, task, conversation, owner, generation, and high-water mark in the existing single-writer state transaction.
3. Run a trusted UserPromptSubmit hook before every ordinary desktop root prompt. Permit only a current Desktop lease for the same root session_id/threadId. Missing binding, Gateway unavailability, owner uncertainty, or generation mismatch returns a blocking decision.
4. Treat subagents/child threads as unbound and non-exportable by default because they share the root session_id but not the concrete threadId.
5. Use Stop/completion only as a wake-up containing identifiers and high-water metadata. Reread final text and declared files through supported Codex APIs before durable outbox insertion.
6. Keep one production writer. Reconciliation, not lease expiry, establishes completion. An unavailable Gateway never grants a second writer.
7. Never use plugin/list as a production security boundary and never treat a dashboard button as enforcement.

Estimated implementation and automated verification: 2-2.5 engineering days. Real Desktop and Weixin acceptance is additional. The previous 1-3 hour AppX repair estimate is no longer the recommended critical path because the internal app-server is already running and repair cannot create the missing cross-process generation lease or binding table.

## Approval and next gates

- Writing the fallback design specification and implementation plan requires Haoda's explicit design approval under the active brainstorming gate.
- Implementing in the isolated Phase 3 worktree follows that approved specification and TDD.
- Installing or trusting the hook/MCP surface in the user Codex home, restarting Desktop, or repairing/reinstalling AppX requires a separate action confirmation.
- Computer Use and any real Weixin send require their own explicit confirmation immediately before execution.
- Phase 3 and the overall seven-group Goal remain active.
