import { expect, test } from "bun:test";
import fc from "fast-check";

import { assertNoviceOutputSafe } from "../../src/quality/novice-redaction.js";
import { noviceActions, parseNoviceScenarioInventory } from "../../src/quality/novice-scenarios.js";
import { NoviceMockTransport } from "../../src/quality/novice-mock-transport.js";

const seed = 2026080201;
const base = {
  id: "fresh.property-action", requirement: "NOVICE-001", environment: "fresh_user",
  preconditions: ["package_installed"], actions: ["run_doctor"], expectedPromptCodes: ["DOCTOR_OK"],
  invariants: ["state_loadable"], faults: [], recovery: ["rerun_doctor"], requiredProbes: ["doctor_diagnostics"],
};

test("property: unknown or duplicated novice actions fail before execution", () => {
  fc.assert(fc.property(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 40 }).filter((value) => !(noviceActions as readonly string[]).includes(value)),
      fc.constantFrom(...noviceActions),
    ),
    fc.boolean(),
    (value, duplicate) => {
      const actions = duplicate && (noviceActions as readonly string[]).includes(value) ? [value, value] : [value];
      if ((noviceActions as readonly string[]).includes(value) && !duplicate && value !== "request_data_purge") {
        expect(parseNoviceScenarioInventory([{ ...base, actions }])[0]!.actions).toEqual(actions);
      } else if (value === "request_data_purge" && !duplicate) {
        expect(parseNoviceScenarioInventory([{
          ...base, actions, expectedPromptCodes: ["PURGE_CONFIRMATION_REQUIRED"],
          invariants: ["user_data_preserved"], recovery: ["cancel_purge"], requiredProbes: ["user_data_retention"],
        }])[0]!.actions).toEqual(actions);
      } else {
        expect(() => parseNoviceScenarioInventory([{ ...base, actions }])).toThrow(/action|duplicate/i);
      }
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: repeated mock delivery keeps one stable idempotency identity", async () => {
  await fc.assert(fc.asyncProperty(
    fc.uint8Array({ minLength: 1, maxLength: 128 }),
    fc.uuid(),
    async (content, idempotencyKey) => {
      const transport = new NoviceMockTransport();
      const contentHash = new Bun.CryptoHasher("sha256").update(content).digest("hex");
      const first = await transport.deliver({ idempotencyKey, kind: "text", contentHash });
      const second = await transport.deliver({ idempotencyKey, kind: "text", contentHash });
      expect(first).toEqual({ idempotencyKey, duplicate: false });
      expect(second).toEqual({ idempotencyKey, duplicate: true });
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: Windows user-profile paths never enter novice output", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,20}$/u),
    fc.constantFrom("\\", "\\\\", "/", "//"),
    (identity, separator) => {
      const value = "C:" + separator + "Users" + separator + identity + separator + ".codex" + separator + "config.toml";
      expect(() => assertNoviceOutputSafe({ detail: value })).toThrow(/path|redact/i);
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});
