import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  parseNoviceScenarioInventory, requiredNoviceCoverage, validateNoviceCoverage,
} from "../src/quality/novice-scenarios.js";

const inventoryPath = path.resolve(import.meta.dir, "..", "quality", "scenarios", "novice-daily-use.json");

describe("novice scenario inventory", () => {
  test("covers every accepted fresh, upgrade, and recovery obligation", async () => {
    const items = parseNoviceScenarioInventory(JSON.parse(await readFile(inventoryPath, "utf8")));
    expect(items.length).toBeGreaterThanOrEqual(18);
    expect(new Set(items.map((item) => item.requirement))).toEqual(new Set(["NOVICE-001", "NOVICE-002", "NOVICE-003"]));
    expect(new Set(items.map((item) => item.environment))).toEqual(new Set(["fresh_user", "upgrade_user", "recovery_user"]));
    expect(validateNoviceCoverage(items)).toEqual({
      requirements: 3, scenarios: items.length, coverageTokens: requiredNoviceCoverage.length, missing: [],
    });
  });

  test("uses exact closed fields and rejects unknown or external actions", async () => {
    const value = JSON.parse(await readFile(inventoryPath, "utf8"));
    expect(() => parseNoviceScenarioInventory([{ ...value[0], extra: true }])).toThrow(/unknown.*field/i);
    expect(() => parseNoviceScenarioInventory([{ ...value[0], actions: ["send_real_weixin"] }])).toThrow(/action/i);
    expect(() => parseNoviceScenarioInventory([{ ...value[0], environment: "production" }])).toThrow(/environment/i);
  });

  test("rejects duplicate IDs and incomplete recovery or invariants", async () => {
    const value = JSON.parse(await readFile(inventoryPath, "utf8"));
    expect(() => parseNoviceScenarioInventory([value[0], value[0]])).toThrow(/duplicate.*id/i);
    expect(() => parseNoviceScenarioInventory([{ ...value[0], recovery: [] }])).toThrow(/recovery/i);
    expect(() => parseNoviceScenarioInventory([{ ...value[0], invariants: [] }])).toThrow(/invariant/i);
  });

  test("requires explicit confirmation semantics for every purge request", async () => {
    const value = JSON.parse(await readFile(inventoryPath, "utf8"));
    const purge = value.find((item: { actions: string[] }) => item.actions.includes("request_data_purge"));
    expect(purge).toBeDefined();
    expect(purge.expectedPromptCodes).toContain("PURGE_CONFIRMATION_REQUIRED");
    expect(purge.invariants).toContain("user_data_preserved");
    expect(purge.recovery).toContain("cancel_purge");
    expect(() => parseNoviceScenarioInventory([{ ...purge, expectedPromptCodes: ["SERVICE_READY"] }])).toThrow(/purge.*confirmation/i);
  });

  test("fails coverage when one named action, fault, or security probe disappears", async () => {
    const items = parseNoviceScenarioInventory(JSON.parse(await readFile(inventoryPath, "utf8")));
    for (const token of ["setup_weixin", "disk_full", "unbound_child_exclusion"]) {
      const changed = items.map((item) => ({
        ...item,
        actions: item.actions.filter((value) => value !== token),
        faults: item.faults.filter((value) => value !== token),
        requiredProbes: item.requiredProbes.filter((value) => value !== token),
      }));
      expect(() => validateNoviceCoverage(changed)).toThrow(new RegExp(token, "i"));
    }
  });
});
