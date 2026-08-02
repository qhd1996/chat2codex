# Minimal Quality Acceleration Package A Verification

**Verdict:** Repository-local Package A gates pass at commit `efec4a5ec8c995fbbd7cc2dac00130638f095bfd`. Remote GitHub-hosted `windows-latest` execution has not run and remains pending. This report does not prove installed Desktop behavior or real Weixin E2E.

## Scope and authority

- Baseline: integration `969c5ae686ab0015e634dd14c7d057eefc93141f`.
- Approved design: `cc50609`.
- Package A implementation plan: `499f4f3`.
- Requirements authority snapshot: `07603ee8ddd38546aca003ff7be8370aa9a51203`.
- Authority lock: 24 requirement IDs, 4 accepted CRs, and 13 requirement-file SHA-256 values.
- The requirements ledger remains authoritative; OpenSpec and this evidence report are not.

## Tooling and dependency evidence

- Node: `v24.14.0` from the bundled workspace runtime, prepended only for verification processes.
- Local Bun observed: `1.3.14`; repository/CI pin: `1.3.9`.
- Candidate package: `0.8.0-media.1`.
- OpenSpec is an exact local development dependency at `1.7.0`.
- No global OpenSpec installation, `openspec init`, user-home prompt generation, Hook/MCP installation, or trust action occurred.
- Bun blocked the OpenSpec postinstall and it remained untrusted; the read-only CLI validation worked without trusting it.
- A temporary official Bun `1.3.9` archive was downloaded to ignored evidence storage, checked against GitHub release size and SHA-256 `f4c1cf3549f6af986dc6535c40b4785ff1a7e7805e59637ec450fc11adb0c874`, and used to verify `--frozen-lockfile --ignore-scripts`.
- The lock preserves the pre-existing Lark SDK, protobuf UTF-8, Node types, axios, and ws resolutions and contains no mirror URL or premature `fast-check` dependency.

## TDD evidence

RED was observed before implementation for:

- missing OpenSpec authority validator and local wrapper;
- lock duplicate/unknown/path/hash/authority inflation;
- changing both the lock and artifacts to a different authority root;
- missing evidence validator;
- unknown/duplicate/dangling/stale/dirty/secret-shaped evidence;
- weaker evidence promotion, contradicted-without-evidence, and orphan evidence;
- missing Windows ACL inspector and workflow;
- missing `fetch-depth: 0` for ancestor-commit verification;
- missing runbook; and
- missing deterministic complete repository gate.

All corresponding GREEN suites passed after minimal implementations.

## Focused repeat evidence

The authority, evidence, runbook, Windows ACL/workflow, architecture boundary, process-identity, and shard-wrapper suites ran three consecutive times. Each run reported:

- 58 passed;
- 0 failed; and
- the native Windows disposable-file ACL accept/reject cases plus the timeout process-tree cleanup case.

After final review hardening, focused authority/evidence/wrapper tests reported 39 passed, 0 failed. The final focused quality/Windows/architecture run reported 59 passed, 0 failed.

## Stable complete repository gate

Default `bun test` uses file concurrency 20. The repository has approximately 205 `waitFor`/`waitForState` uses sharing a 1-second condition deadline. Default concurrent full runs produced two retained negative samples:

| Sample | Result | Failure | Timeout/residual |
| --- | --- | --- | --- |
| `package-a-final-full-check` | 624 pass, 8 skip, 1 fail | output-only isolated-directory router scenario, 1116 ms | none, root/children 0/0 |
| `package-a-clean-committed-full-check` | 626 pass, 8 skip, 1 fail | declared-media suffix router scenario, 718 ms | none, root/children 0/0 |

The failing test changed between samples; each passed independently and in a 234-test local subset. This contradicts a single product assertion failure and identifies repository-wide test-file concurrency versus the shared 1-second condition deadline as the stability cause. Increasing individual timeouts or editing product code was rejected.

The deterministic gate preserves every test and uses Bun's official `--max-concurrency=1` option:

```text
test:stable  = bun test --max-concurrency=1
check:stable = typecheck + contracts + test:stable + build
```

Two implementation-state stable runs both passed with 628 pass, 8 skip, 0 fail and zero timeout/residual identities. The final clean committed run at `efec4a5` reported:

- command: `bun run check:stable`;
- started: `2026-08-02T12:16:57.033Z`;
- wall: 52,725 ms;
- 628 passed, 8 skipped, 0 failed;
- typecheck, contract typecheck, and build exit 0;
- timeout: false;
- residual root: false;
- residual children: 0; and
- external raw wrapper report SHA-256: `dd156a010e03efe5e022783332a9a098dc1acd2ecaf14ebce3548cadb2691c00`.

The original `test` and `check` scripts remain available as fast diagnostics. Windows CI uses the deterministic gate and also runs eight explicit MessageRouter shards through the PID-plus-CreationDate wrapper.

## Quality gates

At `efec4a5`:

- strict local OpenSpec validation: 1 change passed, 0 failed;
- custom authority validation: 4 artifacts, 3 applicable requirement IDs;
- preinstall evidence index before this report: 4 targets, 0 evidence, 0 passed;
- `quality:windows`: 19 passed, 0 failed;
- native private ACL file accepted without changing SDDL; broad Everyone-read fixture rejected;
- PID reuse and descendant-boundary tests passed;
- timeout wrapper removed the disposable process tree and left zero residual identities;
- workflow YAML parsed with push/pull-request triggers, one job, ten steps, and `fetch-depth: 0`;
- official-registry `bun audit`: no vulnerabilities;
- pack dry-run: 75 files, 1.72 MB unpacked; and
- package contents exclude OpenSpec, quality manifests, `AGENTS.md`, tests, and evidence assets.

## Specification and quality review

Two collaboration reviewer attempts received empty task payloads and produced no usable findings. They are not counted as review evidence. The primary agent performed two explicit passes against the approved design and plan:

1. specification pass: authority precedence, Package A/Package B sequencing, evidence levels, external approval gates, Windows workflow, rollback, and no product/state implementation;
2. quality pass: wrapper least capability, authority-root tamper resistance, lock closure, evidence reference closure, stale commit handling, symlink/canonical path behavior, Windows ACL read-only behavior, shallow-checkout behavior, lockfile provenance, pack boundaries, and test stability.

Review findings were fixed in `decec9d`, `3ee2f91`, and `efec4a5`, then reverified.

## Side-effect and boundary audit

- No production path was written or restarted.
- No `~/.codex`, Hook, MCP, Desktop, Computer Use, or real Weixin action occurred.
- The Windows ACL inspector uses only `Get-Acl`; ACL mutation exists only in disposable test fixtures.
- The local OpenSpec wrapper permits only `validate` and disables telemetry/update checks.
- The evidence manifest keeps `DESKTOP-001..003` and `WX-REAL-E2E` unproven.
- Package B and `fast-check` remain pending until reviewed Phase 3 Tasks 1–4 are merged.

## Pending evidence

- The checked-in workflow has not run on a GitHub-hosted `windows-latest` runner. Static YAML parsing and local Windows behavior do not substitute for that remote run.
- No branch-protection change was made. Three remote green runs remain required before any separately authorized branch-protection proposal.
- No installed Desktop/Hook/Gateway behavior or real Weixin E2E row is satisfied by Package A.

## Rollback

Package A is isolated in `feat/minimal-quality-acceleration`. Revert its exact commit interval to remove the local OpenSpec overlay, evidence validator, Windows workflow, ACL inspector, stable test gate, and runbook. This does not touch product runtime files, state schema, production, or user Codex configuration.
