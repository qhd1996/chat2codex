# Novice Daily-Use Simulation Design

**Status:** Approved for autonomous repository execution by Haoda's explicit
2026-08-02 authorization and accepted CR-0009.

**Authority:** Requirements ledger commit `01e827b`, especially accepted
CR-0009 (`NOVICE-001..003`). This design does not authorize Task 12, production,
the real user Codex Home, Hook installation or trust, Desktop restart, Computer
Use, real Weixin login, or real Weixin outbound.

## 1. Outcome

Chat2Codex shall ship a deterministic novice-acceptance system that exercises the
reviewed npm archive through fresh installation, ordinary mock daily use, durable
upgrade, recovery, rollback, uninstall, and reinstall. It shall turn every named
novice journey into data with closed coverage, execute real package/lifecycle/state
and security code behind replaceable external peers, inject faults at durable
boundaries, run the whole automated matrix thirty consecutive times, and emit a
machine-verifiable evidence record.

The system is a delivery gate, not a demonstration. A missing, skipped, timed-out,
or failed scenario keeps `NOVICE-*` incomplete. Passing it does not promote any
real-Weixin, installed Desktop, production, or `DIST-003` row whose separate direct
evidence is still absent.

## 2. Options

### A. Process-local mocks only

Model every user action and dependency inside one test process. This is fast but
cannot prove archive identity, child-process behavior, lifecycle idempotency, or
restart recovery. It is rejected as the acceptance architecture, though pure
models remain useful for property tests.

### B. Layered simulation over real product boundaries (selected)

Install and invoke the exact archive in an isolated Windows profile/home. Exercise
real CLI parsing, lifecycle planners/executors, state migrations, Gateway
authentication, ownership/generation fences, authoritative reconciliation, and
durable outbox code. Replace only prohibited or nondeterministic external peers
with authenticated mock Weixin/Codex/Desktop transports. This provides repeatable
fault injection without weakening security boundaries.

### C. Full UI automation in a VM

Automate real installers, Weixin UI, Codex Desktop, and messages. It is closest to
human use, but crosses separate approval gates and is too nondeterministic for the
thirty-run repository gate. It remains part of later real acceptance, not a
substitute for option B.

## 3. Trust and evidence levels

Four evidence levels are kept distinct:

1. `model`: pure scenario/property behavior with no process or package claim.
2. `repository`: product modules and child processes from the worktree.
3. `isolated_package`: the reviewed archive installed into a fresh temporary
   Windows profile/home with mock external peers.
4. `real_e2e`: separately approved real Weixin/Desktop/production behavior.

`NOVICE-001..003` require level 3 plus the table/property/fault gates. Level 3
does not satisfy a level-4 row. The evidence validator rejects a higher claim when
the environment, archive, process, or scenario fields do not prove it.

## 4. Scenario contract

`quality/scenarios/novice-daily-use.json` is the sole scenario inventory. Each
entry contains:

```json
{
  "id": "fresh.download.verify",
  "requirement": "NOVICE-001",
  "environment": "fresh_user",
  "preconditions": ["no_package", "empty_config"],
  "actions": ["download_candidate", "verify_sha256"],
  "expectedPromptCodes": ["CANDIDATE_HASH_OK"],
  "invariants": ["candidate_bytes_unchanged", "no_secret_output"],
  "faults": [],
  "recovery": ["retain_candidate"],
  "requiredProbes": ["archive_identity"]
}
```

All tokens come from closed enums. IDs are unique and stable. A coverage manifest
maps every CR-0009 obligation to at least one scenario and probe. The validator
rejects unknown tokens, missing recovery, duplicate IDs, empty invariants, unsafe
purge actions, external real actions, and coverage gaps.

## 5. Components

### Scenario validator

`src/quality/novice-scenarios.ts` parses the closed JSON contract, validates
coverage, and exports normalized scenarios. It does no I/O and is property tested.

### Simulation kernel

`src/quality/novice-simulator.ts` is a deterministic state machine. A driver maps
closed actions and faults to product probes; the kernel enforces preconditions,
records prompt codes, snapshots state before and after every step, checks
invariants, runs recovery, and refuses an unimplemented action. It never converts
an exception into a pass.

### Product probe driver

`src/quality/novice-product-driver.ts` composes existing real modules:

- Windows install/uninstall/rollback planners and injected executor;
- state-v4/v5/v6 loaders and durable state snapshots;
- Gateway HMAC, route/role/nonce/freshness verification;
- ownership/generation and unbound-child exclusion;
- reconciler, high-water, media outbox, and idempotency; and
- CLI/package child-process invocation where process behavior matters.

Mock peers implement only external transport responses. They cannot bypass an
auth check, alter an ownership decision, write the state directly, or mark an
outbox delivery complete without the normal product API.

### Isolated Windows runner

`scripts/run-novice-acceptance.mjs` requires an archive path and expected SHA-256.
It creates a unique temporary root, installs the archive into a private npm prefix,
sets a temporary `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CODEX_HOME`, and
`CHAT2CODEX_HOME`, launches the installed CLI by absolute path, and records PID plus
creation identity. It refuses repository entrypoints, the real profile, the real
Codex Home, production paths, or missing isolation markers. Cleanup targets only
owned IDs recorded in its manifest; uncertainty is a failure and preserves
evidence.

### Evidence validator

`scripts/verify-novice-evidence.mjs` validates archive identity, environment
qualification, exact scenario coverage, thirty complete repetitions, fixed seeds,
commands, versions, prompt/error codes, state hashes, failure/fix records, and zero
residual owned processes. It scans all displayable fields for tokens, credentials,
sensitive prompts, identities, and disallowed absolute paths. Checked-in templates
remain `unproven`.

## 6. Environment classes

### Fresh user

Starts with a new Windows profile or an equivalently isolated profile projection,
empty configuration, no package/task/state/secrets, and a disposable workspace. It
verifies download/hash, prerequisites, package install, setup/login simulation,
doctor, lifecycle, daily task/media/workspace/Plan/approval/structured-input use,
uninstall preservation, and reinstall.

### Upgrade user

Starts from a checked-in synthetic old-version fixture containing multiple tasks,
one pending and one delivered outbox item, configuration, and schema state. Fixture
contents are artificial and hashed. It executes install and upgrade twice, schema
migration, resume, rollback, uninstall twice, and reinstall twice. Identity, order,
pending obligation, config, and data hashes are checked at every boundary.

### Recovery user

Starts from valid installed state, then injects one bounded fault at a time:
configuration, network, duplicate/reordered message, Gateway offline, wrong token,
expired generation, process kill, disk write/rename failure, permission denial,
malformed/future schema, or interrupted lifecycle. Each scenario specifies the
novice-visible code, invariant state, and rollback-safe recovery.

## 7. Prompt and redaction contract

Tests assert stable prompt/error codes plus three semantic fields: `what_happened`,
`safe_state`, and `next_action`. Messages may mention a redacted logical setting or
relative owned artifact but never token material, personal identity, sensitive
prompt/message content, or an unneeded absolute path. Recovery text must be
actionable without recommending production deletion, trust bypass, timeout
extension, generic consent, or unsafe purge.

The redaction scanner uses structured sensitive fixtures and canaries rather than
only a regex. Every emitted command, exception, log, state summary, and evidence
field is scanned.

## 8. Fault and property testing

Fast-check generates invalid/duplicated/reordered novice actions, Unicode and
control-character paths, malformed configs, lifecycle repetition, message IDs,
token/nonce mutations, and generation boundaries. Seeds and shrunk counterexamples
are recorded.

A child-process probe is killed only after it emits a named durable-boundary marker.
Restart reads persisted bytes through the normal loader and proves convergence.
Arbitrary sleeps are forbidden; the controller waits for protocol events and fails
on a bounded deadline. Raising a deadline cannot be used to fix a failed scenario.

## 9. Thirty-run gate

The complete mandatory automated matrix runs thirty times from new isolation roots.
Each repetition has a deterministic top-level seed and records all property seeds.
There may be zero skipped scenarios, unimplemented actions, timeouts, state
corruptions, duplicate deliveries, leaks, or residual owned PIDs/tasks. A failed
repetition remains in the report; rerunning does not erase it. A later passing
candidate must be a new report that includes the repair commit and failure history.

## 10. Clean Windows automation

The repository supplies a Windows CI workflow and an operator script for a
resettable VM. CI can prove Windows package isolation and mock E2E but is not
automatically a qualifying `DIST-003` environment. The final novice report must
name the environment class and prove it began without the repository/package/state
or inherited user secrets. VM reset/qualification evidence precedes archive
transfer. Network access is limited to prerequisite/package retrieval; mock peers
bind only to `127.0.0.1`.

## 11. Packaging and documentation

The npm package contains the scenario inventory, runner, evidence schema/template,
and novice troubleshooting/runbook. It contains no generated evidence, keys,
profile paths, usernames, or old real state. The distribution closed-set validator
must account for every new runtime asset and reject undeclared additions.

## 12. Review and rollback

Implementation proceeds in `feat/novice-acceptance-simulation`. Each component is
TDD-committed and reviewed for requirement coverage before quality. Repository
rollback reverts only these isolated commits. Test cleanup removes only its unique
temporary root and owned processes after verifying resolved paths; uncertain
cleanup stops and reports the exact owned identity. No production rollback is part
of this design.

## 13. Schedule impact

Estimated repository work is 2-4 engineering days: contract/kernel 0.5-1 day,
product probes and lifecycle journeys 1-1.5 days, faults/property/stability 0.5-1
day, packaging/docs/CI 0.5 day. A clean resettable Windows execution adds 0.5-1
day when an eligible environment is available. Any product defect found by these
scenarios extends the estimate and remains a delivery blocker until repaired and
the full thirty-run report is fresh.
