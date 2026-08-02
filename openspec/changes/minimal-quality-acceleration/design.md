<!-- chat2codex-authority {"changeName":"minimal-quality-acceleration","artifact":"design","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"9942bb5fbef593305480802a170d6bcb3e0a1a6a","requirementIds":["OPS-001","OPS-003","OPS-004"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Design

The approved design is `docs/superpowers/specs/2026-08-02-minimal-quality-acceleration-design.md` at commit `cc50609`. Package A is an interface-free repository quality layer: local OpenSpec plus a custom ledger validator, a closed evidence verifier, read-only Windows ACL inspection, and a Windows reporting workflow reusing the existing PID-plus-creation-time wrapper.

The requirements ledger remains the only product authority. Superpowers remains the execution workflow. Project scripts forbid mutating OpenSpec commands and disable telemetry/update checks. No Package A component imports product runtime composition or gains deployment, Desktop, configuration, or messaging capability.

Package B property tests are deliberately deferred until the reviewed Phase 3 implementation modules exist on integration.
