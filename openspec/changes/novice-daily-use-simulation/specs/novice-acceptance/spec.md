<!-- chat2codex-authority {"changeName":"novice-daily-use-simulation","artifact":"specs","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"01e827bbdc6584136627d9f1f137e8051f0a8c97","requirementIds":["NOVICE-001","NOVICE-002","NOVICE-003"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

## ADDED Requirements

### Requirement: Closed novice scenario coverage

The repository SHALL reject a scenario inventory that omits any accepted fresh,
upgrade, daily-use, lifecycle, recovery, redaction, or isolation obligation.

#### Scenario: A named novice action is absent
- **WHEN** inventory validation finds no scenario and product probe for an obligation
- **THEN** the novice acceptance gate fails before execution

### Requirement: Product boundaries remain real

The simulation SHALL execute package, lifecycle, migration, authentication,
ownership, generation, reconciliation, and outbox boundaries without mocking them
away.

#### Scenario: A prohibited external peer is simulated
- **WHEN** mock Weixin, Codex, or Desktop transport participates in a scenario
- **THEN** it can respond only through the normal authenticated/idempotent product interface

### Requirement: Failure remains blocking evidence

Thirty complete archive-based repetitions SHALL have no skip, timeout, leak, state
corruption, duplicate delivery, or residual owned process.

#### Scenario: One repetition fails
- **WHEN** any required scenario, invariant, cleanup, or evidence check fails
- **THEN** the report preserves the failure and all `NOVICE-*` acceptance remains incomplete

### Requirement: External acceptance remains separate

Automated novice evidence SHALL NOT promote real Weixin, installed Desktop,
production, or clean-Windows rows that require distinct direct behavior.

#### Scenario: Repository automation attempts a real-E2E claim
- **WHEN** an automated report claims a higher evidence level than its environment proves
- **THEN** evidence validation fails closed
