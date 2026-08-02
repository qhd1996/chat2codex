# Weixin Desktop Phase 3 Design Delta

Status: `PROPOSED` — requires an accepted requirements CR before implementation

## Trigger

The installed Codex desktop primitive gate is blocked by two direct installation-boundary failures: the signed sandbox setup helper reports a missing module, and external processes cannot execute the AppX-bundled `codex.exe`. The accepted seven primitive requirements remain unchanged.

## Preserved requirements

- Same persisted `threadId`, one durable generation lease, fail-closed prompt submission, trusted completion wake-up, authoritative reread, exactly-once mirroring, and unbound-thread exclusion remain mandatory.
- A status mirror or dashboard button alone is not a security boundary.
- Desktop and Weixin may observe/control one task only through a proven owner binding.

## Proposed fallback if AppX repair fails

Add an authenticated loopback Desktop Gateway owned by Chat2Codex:

1. The desktop MCP/app reads redacted live task status from the gateway.
2. A desktop takeover request identifies the existing `threadId` and asks the gateway to transfer a generation lease.
3. Desktop submission is allowed only through a supported MCP/app command that calls the gateway enforcement endpoint immediately before `turn/start`. If the desktop permits ordinary prompts to bypass this endpoint, the design fails closed and cannot claim handoff.
4. Completion sends only thread/turn IDs and high-water metadata. Chat2Codex rereads the authoritative turn from supported Codex persistence before durable Weixin delivery.
5. Lease expiry produces `ownership_uncertain`, never permission to start a second writer.

## Acceptance gate

Before implementation, behavior-prove that the repaired desktop or proposed gateway surface can: render status, enforce prompt block, continue the same thread, emit a stop/completion wake-up, reread the completed turn, reject a concurrent writer, and exclude unbound threads. Otherwise keep Phase 3 blocked and revise again through requirements governance.

## Rework estimate

- AppX repair and original design retest: 1–3 hours after installer availability.
- Gateway fallback implementation: 1–2 engineering days plus real desktop/Weixin acceptance.
