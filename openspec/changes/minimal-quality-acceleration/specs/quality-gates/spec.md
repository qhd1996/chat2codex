<!-- chat2codex-authority {"changeName":"minimal-quality-acceleration","artifact":"specs","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"01e827bbdc6584136627d9f1f137e8051f0a8c97","requirementIds":["OPS-001","OPS-003","OPS-004"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

## ADDED Requirements

### Requirement: Ledger-bound implementation changes

The repository SHALL validate every OpenSpec change against a non-authoritative lock derived from the requirements ledger and SHALL reject authority inflation or unauthorized external action.

#### Scenario: Valid authorized quality change
- **WHEN** all change artifacts cite the locked ledger commit and known requirement IDs
- **THEN** both the custom authority validator and strict OpenSpec validation succeed

#### Scenario: Authority or action inflation
- **WHEN** an artifact claims product authority, production authority, real external-action authority, an unknown requirement, or the prohibited damaged task
- **THEN** validation fails before implementation proceeds

### Requirement: Closed evidence levels

The repository SHALL distinguish static, automated, installed behavior, and real E2E evidence and SHALL prevent a weaker evidence level from passing a stronger target.

#### Scenario: Automated proof for a real E2E row
- **WHEN** an automated record attempts to pass a target requiring real E2E
- **THEN** manifest validation fails and the target remains unproven

#### Scenario: Failed or incomplete run
- **WHEN** evidence records a failure, timeout, residual process, dirty release run, missing artifact, or hash mismatch
- **THEN** the evidence cannot be accepted as a passing record

### Requirement: Auditable Windows verification

The repository SHALL run its quality and repository checks on Windows with exact tool versions, bounded execution, process-identity evidence, and read-only private-file ACL inspection.

#### Scenario: Windows reporting workflow
- **WHEN** the Windows workflow runs on a repository commit
- **THEN** it records exact versions, complete test/shard outcomes, timeouts, and residual identities in bounded JSON artifacts

#### Scenario: Broad-readable private file
- **WHEN** a disposable test file grants read access to a broad Windows principal
- **THEN** the read-only ACL policy rejects it without mutating the ACL
