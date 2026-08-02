<!-- chat2codex-authority {"changeName":"reusable-windows-distribution","artifact":"specs","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"21a5800c4d725375af256a1e1c827bab75c3f034","requirementIds":["DIST-001","DIST-002","DIST-003"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

## ADDED Requirements

### Requirement: Portable versioned archive

The package SHALL contain a versioned, path-neutral Windows distribution contract
and SHALL reject missing runtime assets, embedded credentials, and developer paths.

#### Scenario: Archive verification
- **WHEN** the exact npm archive is extracted in a disposable directory
- **THEN** every declared asset and Hook hash matches and forbidden paths or secrets are absent

### Requirement: Reversible Windows lifecycle

The package SHALL create a current-user Scheduled Task, three distinct owner-only
Gateway keys, and an exact manifest through a rollback-safe transaction.

#### Scenario: Install failure
- **WHEN** any ACL, file, or task verification fails
- **THEN** the transaction removes newly owned artifacts, restores the prior manifest, and starts no unverified task

#### Scenario: Default uninstall
- **WHEN** uninstall is explicitly invoked
- **THEN** only exact installer-owned task/files/managed settings are removed and durable user data remains

### Requirement: Clean-Windows evidence stays direct

The repository SHALL provide a complete evidence protocol but SHALL keep clean
Windows, installed Desktop, and real Weixin rows unproven until directly executed.

#### Scenario: Automated test attempts promotion
- **WHEN** a repository or simulated run claims clean-Windows E2E success
- **THEN** evidence validation fails and `DIST-003` remains unproven
