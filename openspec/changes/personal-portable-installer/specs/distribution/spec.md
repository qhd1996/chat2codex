<!-- chat2codex-authority {"changeName":"personal-portable-installer","artifact":"specs","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["DIST-002","DIST-003","DIST-HARDEN-001"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

## MODIFIED Requirements

### Requirement: Personal portable lifecycle is P0

The package SHALL provide a path-neutral one-command lifecycle for the current
Windows user and SHALL generate machine-local current-user owner-only Gateway
keys without disclosing secrets.

#### Scenario: Clean personal installation

- WHEN the reviewed archive is installed on a clean personal Windows profile
- THEN install, doctor, service, Desktop/Weixin E2E, upgrade, rollback, uninstall,
  and reinstall use only machine-derived paths and preserve user data by default

### Requirement: Hosted ACL diagnostics do not replace clean evidence

Hosted runner ACL results SHALL remain bounded diagnostics and SHALL NOT promote
or block DIST-003 when they do not represent the clean personal Windows boundary.

#### Scenario: Hosted owner semantics differ

- WHEN a hosted run fails owner-verified ACL inspection but cleanup is complete
- THEN the failure remains indexed, DIST-003 remains unproven, and the clean
  personal Windows gate remains blocking

## ADDED Requirements

### Requirement: Same-machine multi-user hardening is separate

DIST-HARDEN-001 SHALL retain direct second-interactive-identity attack evidence as
a P1 hardening row without weakening current-user owner-only ACL validation.

#### Scenario: Personal release proceeds with retained hardening evidence

- WHEN all accepted personal P0 rows have direct evidence and the historical
  DIST-HARDEN-001 evidence remains indexed
- THEN the personal release may proceed without rerunning enterprise-style hosted
  ACL attacks, and no enterprise multi-user claim is made
