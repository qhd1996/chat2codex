<!-- chat2codex-authority {"changeName":"reusable-windows-distribution","artifact":"design","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["DIST-001","DIST-002","DIST-003"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Design

The approved implementation design is
`docs/superpowers/specs/2026-08-02-reusable-windows-distribution-design.md` at
commit `2a1c740`. Pure renderers and planners define the task, launcher, manifest,
keys, doctor decisions, and evidence. Native mutation remains behind explicit
service install/uninstall commands and injected tests.
