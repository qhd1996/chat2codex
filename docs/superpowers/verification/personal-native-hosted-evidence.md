# Personal portable hosted native evidence

Status: retained diagnostic; not a personal P0 release verdict

Authority: requirements-ledger commit
`564d6519c08cc3ecd477a7cefd4bfd8c1afca72c`, accepted CR-0010 and ADR-0006

## Direct evidence

- Current-host Task 12 directly passed the same-machine second-interactive-user
  read, delete, and replacement denials for all three Gateway keys with exact key
  hashes and zero temporary user, profile, task, root, or process residuals. This
  is the retained `DIST-HARDEN-001` P1 result.
- GitHub Actions run
  [30836801914](https://github.com/qhd1996/chat2codex/actions/runs/30836801914)
  reached the limited-token native worker and failed at bounded stage
  `journey/file_acl_owner_read` with code `exit_86`. Cleanup reported zero task,
  user, process, profile, and owned-root residuals. This remains negative hosted
  environment evidence.
- Local personal lifecycle evidence passed two install and two uninstall attempts,
  three distinct keys, current-user ACL inspection, state preservation, and zero
  residuals. It is not a qualifying clean-Windows `DIST-003` run.

## CI classification

The Windows workflow still executes the native lifecycle probe, emits bounded
annotation/summary evidence, and always uploads its report. Its verdict is not
enforced as a personal P0 gate because hosted owner semantics do not define the
personal single-user threat boundary.

Blocking gates remain repository tests, property/stability repetitions, audit,
package/version/hash verification, package-only clean Windows, zero residuals,
and the later direct clean-personal-Windows/Desktop/Weixin evidence. No timeout is
increased and no native probe is skipped.

## Evidence boundary

This classification does not pass `DIST-002` or `DIST-003`, install or trust a
Hook/MCP, mutate production, or claim real Desktop/Weixin behavior. Historical
failure artifacts and the full debugging retrospective remain preserved.

## Rollback

If a later accepted CR restores enterprise same-machine multi-user behavior to
P0, re-add the native enforcement step after its always-publish step and require a
direct suitable-host PASS before release. Reverting this CI classification changes
no installed bytes or user data.
