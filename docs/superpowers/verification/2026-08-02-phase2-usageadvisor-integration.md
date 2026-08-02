# Phase 2 + UsageAdvisor Integration Verification

## Verdict

**Pass as the frozen pre-Gateway integration baseline.** This merge does not
implement Phase 3, deploy production, install hooks, modify `~/.codex`, use
Desktop/Computer Use, or send a real Weixin message.

## Provenance

- Integration branch: `feat/weixin-phase3-gateway-integration`.
- Merge commit: `565981b6fb9e52e36478f3338c5ac068c2ebfa67`.
- First parent: Phase 2 `8c60b5454839c35e754f1f06c473b44df83b7ac0`.
- Second parent: UsageAdvisor `47c2272faf764904a5c8cba903b05b679b20a0cb`.
- The merge preserves both histories; no Phase 2 or UsageAdvisor commit was
  squashed, cherry-picked, or reimplemented.
- Package version remains `0.8.0-media.1`.

## Conflict accounting

The branches touched 12 common paths, but Git automatically merged source,
router tests, and the shared stability wrapper. Three documentation files had
content conflicts: `README.md`, `README.zh-CN.md`, and `docs/architecture.md`.
Resolution retained the full Phase 2 explicit-output, immutable staging, ordered
media, retry/restart/idempotency behavior and the full bounded/redacted,
review-only UsageAdvisor surface. Schema-v5 documentation now states that both
capabilities coexist. No product-code conflict required manual synthesis.

## Focused verification

The merged conflict surface ran across core advisor, state store, command/natural
routing, intent prompt, bridge router, release documentation, and architecture
boundaries:

```text
38 pass, 0 fail
typecheck: pass
contract typecheck: pass
```

This includes Phase 2 declared output and media ownership/order tests plus
UsageAdvisor list/review, friction derivation, redaction, persistence, and
failure-isolation tests.

## Complete router shards

The committed PID+CreationDate-safe wrapper ran all MessageRouter tests in eight
deterministic shards:

```text
183 total
182 pass
1 platform skip
0 fail
0 timeout
0 residual root or child process identities
aggregate wall time: 24,311 ms
```

## Full release gate

The accepted run prepended bundled Node `v24.14.0` because ambient Node
`v16.17.0` is below the package requirement and cannot start TypeScript 7's
extensionless ESM launcher. The safe wrapper recorded:

```text
bun run check
572 tests across 42 files
564 pass, 8 skip, 0 fail
typecheck: pass
contract typecheck: pass
build: pass
timeout: no
residual root/children: 0/0
wall time: 48,797 ms
```

`bun audit` against `https://registry.npmjs.org` returned no vulnerabilities.
`bun pm pack --dry-run` passed under the same Node v24 environment: 74 files,
1.72 MB unpacked, package `chat2codex-0.8.0-media.1.tgz`. The first dry-run
attempt used ambient Node v16 and failed before packing with
`ERR_UNKNOWN_FILE_EXTENSION`; it is retained as environment negative evidence
and is not counted as a product failure or pass.

## Remaining gates

- Gateway implementation remains unauthorized until Haoda approves the separate
  implementation plan.
- The approved/hardened Phase 3 design is `c48b89f` and has not been merged as
  product code; it is the plan input.
- Production supervision recovery, Phase 2 deployment, schema migration,
  `~/.codex`/Hook/MCP installation and trust, Desktop restart, Computer Use, and
  real Weixin E2E each retain separate confirmation gates.
- The overall Goal remains active and all seven Phase 3 primitives remain
  behavior-unverified.
