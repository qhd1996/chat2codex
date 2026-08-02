# Repository collaboration rules

- Product requirements are authoritative only in the requirements-ledger worktree at its recorded baseline, accepted CRs, ADRs, acceptance matrix, and current snapshot. OpenSpec is an implementation-delta overlay and never changes acceptance status.
- Never read, recover, summarize, or replay task `019fc002-590e-7023-b7e5-2a802168f00a`; its identifier may appear only in explicit rejection rules.
- Use Superpowers for design approval, planning, isolated worktrees, TDD, review, and verification. OpenSpec does not replace those gates.
- Use only the exact project-local OpenSpec dependency through `bun run openspec:validate`. Never globally install OpenSpec or run its `init`, `update`, `archive`, store, config, schema, completion, or feedback commands for this repository.
- Automated evidence cannot satisfy an installed-behavior or real-Weixin/Desktop E2E requirement. Production writes/restarts, `~/.codex` or Hook/MCP changes, Desktop/Computer Use, and each real-Weixin send require separate action-time approval.
- Preserve independent worktrees and production single-writer ownership. Do not redo committed work or clean another stream's untracked evidence.
