# Phase 3 Gateway Interface Freeze

## Baseline

- Integration parent: `702d181` (Phase 2 + UsageAdvisor).
- Design parent: `fd96093` (approved and hardened Gateway design).
- Design merge: `983da90`, with exactly those two parents.
- No Gateway runtime, state schema, Hook, MCP, or reconciler implementation is included in this freeze.

## Frozen boundary

`src/desktop-gateway/contracts.ts` is the only interface shared by the four planned fan-out lines. It imports only Zod and owns no I/O. The closed request kinds are:

1. `status`
2. `desktop_heartbeat`
3. `takeover_desktop`
4. `release_bridge`
5. `user_prompt_submit`
6. `stop_wake`

Prompt submission requires the actual Hook `turnId` and a 64-hex keyed commitment. Stop accepts identifiers and time only. All request objects are strict and bounded; response decisions are a closed enum. `DesktopGatewayController` exposes only six typed decision methods and no generic state mutation, HTTP, adapter, or BridgeRunner object.

## TDD evidence

RED was observed before implementation:

```text
Cannot find module ../src/desktop-gateway/contracts.js
ENOENT src/desktop-gateway/contracts.ts
4 pass, 2 fail, 1 error
```

After the minimal contracts implementation:

```text
11 pass, 0 fail
32 assertions
typecheck: pass
contract typecheck: pass
git diff --check: pass
```

The interface is now frozen. Any later interface change must occur on the integration line, be TDD-verified, and be propagated to every not-yet-merged fan-out line before further implementation.
