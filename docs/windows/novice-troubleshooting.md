# Novice troubleshooting

Every user-visible error has three fields: **What happened**, **Safe state**, and **Next action**. Messages do not expose a token, prompt, identity, personal path, credential, or private message content.

| Condition | What happened | Safe state | Next action |
| --- | --- | --- | --- |
| Archive hash mismatch | The package differs from the reviewed SHA-256 | Nothing was installed | Download the reviewed archive again |
| Config error | A required setting is missing or invalid | Existing state is unchanged | Correct the named setting and rerun `doctor` |
| Network/Gateway offline | The peer is unavailable | Pending outbox entries remain queued | Restore the network/Gateway and retry the same task |
| Wrong token | Authentication failed | The request was rejected before mutation | Select the correct generated key file; never paste token bytes |
| Expired generation | Ownership changed or expired | No second writer was granted | Reconcile the root and take over with the current generation |
| Disk full or permission denied | An atomic write could not complete | Prior bytes or a hash-verified backup remain | Free only owned space or restore the exact ACL, then retry |
| Kill/restart | A process stopped after a durable boundary | State and outbox reload through the normal store | Restart and verify one writer plus pending delivery order |
| Unbound/child export | The thread is not the bound concrete root | No content was exported | Bind the intended root; child Agents remain non-exportable |
| Uninstall | Owned service files are removed | User state/config/logs remain | Reinstall the same reviewed archive if needed |
| Purge requested | Destructive cleanup was requested | User data remains | Require explicit confirmation of the exact purge scope or cancel |

Do not bypass trust, extend timeouts to hide a failure, delete production, or use a mock to replace authentication, ownership, schema, outbox, or ACL boundaries.
