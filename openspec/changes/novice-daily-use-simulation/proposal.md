<!-- chat2codex-authority {"changeName":"novice-daily-use-simulation","artifact":"proposal","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["NOVICE-001","NOVICE-002","NOVICE-003"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Novice daily-use simulation

## Why

Component tests and a reproducible archive do not prove that a novice can install,
use, upgrade, recover, uninstall, and reinstall Chat2Codex safely.

## What changes

- Add a closed table-driven inventory for fresh, upgrade, and recovery users.
- Exercise product lifecycle, state, Gateway, ownership, reconciliation, and outbox
  boundaries while simulating only prohibited external peers.
- Add property/fuzz, event-boundary restart, thirty-run stability, and strict
  evidence validation.
- Run the reviewed archive in a clean isolated Windows profile.

## Non-goals

This change does not authorize production, the real user Codex Home, Hook trust,
Desktop restart, Computer Use, real Weixin login, or real Weixin outbound.
