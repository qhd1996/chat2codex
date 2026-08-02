import { describe, expect, test } from "bun:test";

import { runNoviceGatewayRecoveryJourney, runNoviceNetworkRecoveryJourney } from "../src/quality/novice-product-driver.js";

describe("novice recovery product journey", () => {
  test("keeps Gateway authentication, replay, token, freshness, owner, and generation fail closed", async () => {
    const result = await runNoviceGatewayRecoveryJourney();
    expect(result.authenticatedRole).toBe("prompt_hook");
    expect(result.nonceReplayCode).toBe("nonce_reused");
    expect(result.wrongTokenCode).toBe("invalid_signature");
    expect(result.staleRequestCode).toBe("stale_request");
    expect(result.generations).toEqual([1, 2, 3]);
    expect(result.staleTakeoverBlocked).toBe(true);
    expect(result.expiredOwner).toBe("uncertain");
  });

  test("does not export unbound roots or concrete child Agent threads", async () => {
    const result = await runNoviceGatewayRecoveryJourney();
    expect(result.unboundDecision).toBe("not_found");
    expect(result.childDecision).toBe("not_found");
    expect(result.childReconciliation).toBe("uncertain");
    expect(result.exportedCount).toBe(0);
  });

  test("recovers an offline and duplicated delivery without reordering or rerunning Codex", async () => {
    const result = await runNoviceNetworkRecoveryJourney();
    expect(result.offlineErrorCode).toBe("transport_offline");
    expect(result.pendingWhileOffline).toEqual(result.deliveryIds);
    expect(result.deliveryOrder).toEqual(result.deliveryIds);
    expect(result.duplicateAcknowledgements).toBe(result.deliveryIds.length);
    expect(result.codexRuns).toBe(1);
    expect(result.allDelivered).toBe(true);
  });
});
