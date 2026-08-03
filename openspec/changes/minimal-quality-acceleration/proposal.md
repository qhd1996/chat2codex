<!-- chat2codex-authority {"changeName":"minimal-quality-acceleration","artifact":"proposal","authorityRepo":"F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/","authorityCommit":"564d6519c08cc3ecd477a7cefd4bfd8c1afca72c","requirementIds":["OPS-001","OPS-003","OPS-004"],"acceptedBy":"Haoda","productionAuthorized":false,"realExternalActionsAuthorized":false} -->

# Minimal quality acceleration

## Why

The repository has substantial automated coverage and a Windows-safe process wrapper, but no Windows CI job, no machine-checked evidence-level separation, and no project-local change overlay bound to the requirements ledger. These gaps slow trustworthy delivery and make evidence inflation easier.

## What Changes

- Add a thin project-local OpenSpec overlay bound to the requirements ledger.
- Add fail-closed evidence manifests that cannot promote automated proof to installed or real E2E proof.
- Add a Windows reporting workflow that reuses the existing process-identity wrapper and adds read-only ACL checks.
- Document the separately approved real-Weixin/Desktop evidence procedure.

## Non-goals

- No product runtime, state schema, deployment, or production process change.
- No global OpenSpec install, user-home configuration, Hook/MCP trust, Desktop operation, Computer Use, or Weixin send.
- No Phase 3 property tests until Tasks 1–4 are reviewed and merged.
