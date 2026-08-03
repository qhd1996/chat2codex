# Personal portable candidate 0.8.0-novice.18

Status: frozen repository candidate; corrected Windows CI and clean-Windows
DIST-003 are still pending.

## Source and toolchain

- Candidate source identity: `89c8e261e2250040fb4624af6e97633639e1b24b`.
- Final version/hash binding: `ff2f0d987e3fd368717fbacec8030308eee49cb7`.
- Node: `v24.14.0`.
- Bun: `1.3.9` (`cf6cdbbb`). The cached executable was byte-identical to the
  official `bun-v1.3.9` Windows x64 release executable, SHA-256
  `2d901f3dea0a14c7acc4434622bf43b20250f1c787b3795dae0635c2e139a067`.
  The official 40,809,955-byte release zip matched GitHub published SHA-256
  `f4c1cf3549f6af986dc6535c40b4785ff1a7e7805e59637ec450fc11adb0c874`.
- Dependency installation used `bun install --frozen-lockfile`. No global tool
  was installed or changed.

## Reproducible archive

Two independent detached clean worktrees at the source identity and a third
detached clean worktree at the final binding identity each ran frozen install,
build, pack, extraction, and the packaged distribution verifier.

| Build | Source | Files / tar entries | Size | SHA-256 | Verifier |
| --- | --- | ---: | ---: | --- | --- |
| A | `89c8e261e2250040fb4624af6e97633639e1b24b` | 138 / 138 | 437,577 | `87d115436e521131fdfba59e65f1b1ed71533d694511301bcdbb2ad57f8157a7` | pass |
| B | `89c8e261e2250040fb4624af6e97633639e1b24b` | 138 / 138 | 437,577 | `87d115436e521131fdfba59e65f1b1ed71533d694511301bcdbb2ad57f8157a7` | pass |
| Final | `ff2f0d987e3fd368717fbacec8030308eee49cb7` | 138 / 138 | 437,577 | `87d115436e521131fdfba59e65f1b1ed71533d694511301bcdbb2ad57f8157a7` | pass |

The final workflow binds branch `candidate/novice-0.8.0-novice.18`, version
`0.8.0-novice.18`, and the exact SHA-256 above. Before binding, the new `.18`
archive differed from the retained `.17` expected hash and therefore would have
failed at `candidate_archive_hash_mismatch`; no unbound candidate was pushed.
A fourth detached clean reproduction at `85e2dae` produced the same 138-file,
437,577-byte archive and SHA-256 after the CI classification fix.

## Windows CI stop-loss evidence

Initial full run [30854454515](https://github.com/qhd1996/chat2codex/actions/runs/30854454515)
on `61ee173` passed checkout, tool setup, frozen install, build, novice fast,
restart, and standalone native diagnostics. The native diagnostic retained the
known P1 hosted-owner failure `journey/file_acl_owner_read` / `exit_86` with zero
task, user, process, profile, or root residuals. The following 30-repetition step
failed in about six seconds because `run-novice-matrix.mjs` invoked that same P1
native probe again inside every P0 repository repetition.

Commit `85e2dae` removes only the duplicate P1 invocation. The standalone native
diagnostic and its public annotation remain unchanged. Exact Bun 1.3.9 local
RED-to-GREEN evidence is 30 repetitions x 19 scenarios, 1,950 P0 test passes,
zero fail/skip/timeout/residual, report SHA-256
`b260538b422d54fabc79756b8e1751def7a84aca12d35ba233f7defddae94863`.
The latest full stable gate is 1,023 pass, 8 documented platform skips, 0 fail.

## Current acceptance boundary

The archive is a frozen repository candidate only. It does not by itself satisfy
Windows CI, DIST-003, production deployment, installed Hook/MCP trust, Desktop
seven primitives, or real-Weixin E2E. The Goal remains active. No timeout was
extended, no test was skipped, and no security boundary was weakened to freeze
this candidate.
