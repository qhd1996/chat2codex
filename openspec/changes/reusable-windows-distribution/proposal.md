<!-- chat2codex-authority {"changeName":"reusable-windows-distribution","artifact":"proposal","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["DIST-001","DIST-002","DIST-003"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Reusable Windows distribution

## Why

The existing npm candidate proves repository behavior on one computer but does not
provide a portable Windows lifecycle or clean-machine repeatability evidence.

## What changes

- Add a current-user Windows Scheduled Task lifecycle.
- Generate distinct machine-local Gateway keys and verify owner-only ACLs.
- Expand doctor, package portability validation, and operational documentation.
- Define a fail-closed clean-Windows evidence template and runbook.

## Non-goals

No production mutation, real user Codex configuration, Hook trust, Desktop restart,
Computer Use, or real Weixin action is authorized by this change.
