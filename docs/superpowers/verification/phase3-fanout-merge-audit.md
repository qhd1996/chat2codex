# Phase 3 fan-out merge audit

## Baseline and merge graph

- Frozen fan-out base: `969c5ae`.
- Ownership: `7334364`, merged by `81f6d76`.
- Auth: `8be3582`, merged by `7adbfe3`.
- Desktop surface: `3a0a7f4`, merged by `83df44b`.
- Reconciler: `3170511`, merged by `c4c6bb6`.
- Integration-only authoritative-position repair: `a6d36ce`.

The four planned histories are preserved as distinct non-fast-forward merges in the approved order.

## Exclusive write-set evidence

`git diff --name-only 969c5ae..<branch>` produced only the approved files:

- Ownership: state types/store, ownership coordinator, and their two tests.
- Auth: auth/protocol/server and their two tests.
- Desktop surface: repository Hook/MCP/client assets and their tests.
- Reconciler: Codex read adapter, pure reconciler, and their tests.

No child line edited shared composition, another child line's files, user Codex home, production paths, credentials, or real E2E artifacts. Integration alone added the array-position state fields required by authoritative reconciliation.

## Shared contract and interoperability

The exact takeover and release prompt bytes are exported by `contracts.ts`; the Auth protocol re-exports that source. The repository Hook duplicate is guarded byte-for-byte by the contract/Hook test because the installed `.mjs` cannot import unbuilt TypeScript. Auth and client interoperability is proven by a fixed independent HMAC vector and a signed response envelope test.

## Fresh verification

```text
173 pass, 0 fail, 697 assertions across 10 focused files
typecheck: pass
contract typecheck: pass
```

Task 12 remains unexecuted. No `~/.codex`, installation/trust, Desktop restart, production, Computer Use, or real Weixin action occurred.
