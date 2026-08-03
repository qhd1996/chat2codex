<!-- chat2codex-authority {"changeName":"personal-portable-installer","artifact":"proposal","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["DIST-002","DIST-003","DIST-HARDEN-001"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Personal portable installer

## Why

The release is for one personal Windows user and must move to another clean
personal Windows computer. Existing lifecycle components are robust but lack one
user-facing bootstrap and the current CI overweights hosted multi-user ACLs.

## What changes

- Add a one-command personal install/upgrade/uninstall/rollback/doctor entrypoint.
- Reuse transactional service, key, manifest, state, rollback, and doctor modules.
- Keep current-user ACL/authentication/security boundaries P0.
- Treat same-machine other-user attacks as retained P1 hardening.
- Make clean personal Windows installation-to-real-E2E the direct P0 gate.

## Non-goals

This overlay does not authorize production mutation, real Codex Home changes,
Hook trust, Desktop restart, Computer Use, or real Weixin sends.
