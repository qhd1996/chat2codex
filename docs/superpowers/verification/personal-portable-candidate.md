# Personal portable candidate 0.8.0-novice.18

Status: frozen repository candidate; Windows CI and clean-Windows DIST-003 are
still pending.

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

## Current acceptance boundary

The archive is a frozen repository candidate only. It does not by itself satisfy
Windows CI, DIST-003, production deployment, installed Hook/MCP trust, Desktop
seven primitives, or real-Weixin E2E. The Goal remains active. No timeout was
extended, no test was skipped, and no security boundary was weakened to freeze
this candidate.
