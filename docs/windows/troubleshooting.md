# Windows troubleshooting

Run `chat2codex doctor` first. It is read-only and prints stable recovery codes.

| Code | Meaning | Bounded action |
| --- | --- | --- |
| `DIST_NOT_INSTALLED` | no lifecycle manifest | use foreground mode or review/install the Windows task |
| `DIST_PACKAGE_DRIFT` | package and manifest differ | restore a matched package/manifest pair |
| `DIST_TASK_DRIFT` | task action differs | do not start it; reinstall after approval |
| `DIST_WRITER_CONFLICT` | writer/lock is not exactly healthy | stop and reconcile exact process identities |
| `DIST_SCHEMA_UNSUPPORTED` | state is absent/malformed/incompatible | restore or migrate from a hash-verified backup |
| `DIST_KEYS_INVALID` | key format, distinctness, role, or ACL failed | do not rotate silently; inspect/restore through installer |
| `DIST_LOOPBACK_INVALID` | Gateway is not IPv4 loopback | disable it and restore `127.0.0.1` |
| `DIST_HOOK_HASH_DRIFT` | packaged Hook bytes differ | do not install/trust; reinstall reviewed archive |
| `DIST_INSPECTION_FAILED` | native read-only query failed | preserve output, verify permissions/path, rerun doctor |

Never delete a state lock until the exact process identities prove no writer. Do
not expose keys or credentials in logs. `~/.codex`, Hook trust, Desktop restart,
Computer Use, production and real Weixin actions retain separate approval.
