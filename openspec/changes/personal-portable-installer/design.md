<!-- chat2codex-authority {"changeName":"personal-portable-installer","artifact":"design","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["DIST-002","DIST-003","DIST-HARDEN-001"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Design

The approved design is
docs/superpowers/specs/2026-08-04-personal-portable-installer-design.md at commit
2a334bf. A thin PowerShell bootstrap performs prerequisite/path/archive checks and
invokes a TypeScript portable controller. Existing service/key/state/doctor
transactions remain authoritative. Clean personal Windows direct evidence gates
P0; DIST-HARDEN-001 remains separate P1 evidence.
