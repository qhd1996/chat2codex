# Windows compatibility

| Component | Supported/reviewed | Gate |
| --- | --- | --- |
| Windows | Windows 10/11 x64 | doctor plus clean-machine run |
| Windows arm64 | Unverified | direct CI/clean-machine evidence required |
| Node.js | `package.json#engines` (`>=20.12.0`) | absolute executable and version |
| Codex CLI | Bundled protocol manifest version | doctor plus app-server smokes |
| Codex Desktop | Package availability only before Task 12 | installed seven-primitives evidence |
| State | read/migrate v4/v5/v6; write v6 | backup, migration, obligation-safe rollback |

Paths derive from the current profile or explicit inputs. No developer username,
drive, repository, or production directory is part of the supported contract.
`win32-arm64`, a different Codex protocol version, or an older state package may be
usable only after their named validation gate passes.
