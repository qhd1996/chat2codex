import { describe, expect, test } from "bun:test";

import { runNoviceScenario, type NoviceDriver, type NoviceSnapshot } from "../src/quality/novice-simulator.js";
import type { NoviceAction, NoviceScenario } from "../src/quality/novice-scenarios.js";

const scenario: NoviceScenario = {
  id: "fresh.sample-action", requirement: "NOVICE-001", environment: "fresh_user",
  preconditions: ["package_installed"], actions: ["run_doctor"], expectedPromptCodes: ["DOCTOR_OK"],
  invariants: ["no_secret_output", "state_loadable", "no_residual_process"], faults: [],
  recovery: ["rerun_doctor"], requiredProbes: ["doctor_diagnostics"],
};

describe("novice simulation kernel", () => {
  test("passes only after actions, prompts, invariants, recovery, and cleanup pass", async () => {
    const driver = fixtureDriver();
    const result = await runNoviceScenario(scenario, driver, { deadlineMs: 100 });
    expect(result.verdict).toBe("pass");
    expect(result.promptCodes).toEqual(["DOCTOR_OK"]);
    expect(result.events.map((event) => event.kind)).toEqual(["action", "recovery"]);
    expect(result.cleanup).toEqual({ uncertain: false, ownedResiduals: [] });
  });

  test("fails and preserves evidence for an unimplemented action or driver exception", async () => {
    for (const error of [new Error("unimplemented action"), new Error("driver exploded")]) {
      const driver = fixtureDriver({ actionError: error });
      const result = await runNoviceScenario(scenario, driver, { deadlineMs: 100 });
      expect(result.verdict).toBe("fail");
      expect(result.failure?.message).toContain(error.message);
      expect(result.cleanup).toEqual({ uncertain: false, ownedResiduals: [] });
    }
  });

  test("fails on missing prompts or a false or absent invariant", async () => {
    const missingPrompt = await runNoviceScenario(scenario, fixtureDriver({ promptCode: "SERVICE_READY" }), { deadlineMs: 100 });
    expect(missingPrompt).toMatchObject({ verdict: "fail", failure: { code: "missing_prompt" } });
    const falseInvariant = await runNoviceScenario(scenario, fixtureDriver({ snapshot: snapshot({ state_loadable: false }) }), { deadlineMs: 100 });
    expect(falseInvariant).toMatchObject({ verdict: "fail", failure: { code: "invariant_failed" } });
    const absentInvariant = await runNoviceScenario(scenario, fixtureDriver({ snapshot: snapshot({}, ["state_loadable"]) }), { deadlineMs: 100 });
    expect(absentInvariant).toMatchObject({ verdict: "fail", failure: { code: "invariant_missing" } });
  });

  test("fails a bounded deadline without extending it", async () => {
    const result = await runNoviceScenario(scenario, fixtureDriver({ neverResolveAction: true }), { deadlineMs: 10 });
    expect(result).toMatchObject({ verdict: "fail", failure: { code: "deadline_exceeded" } });
  });

  test("cleanup uncertainty or any owned residual overrides an otherwise passing run", async () => {
    const uncertain = await runNoviceScenario(scenario, fixtureDriver({ cleanup: { uncertain: true, ownedResiduals: [] } }), { deadlineMs: 100 });
    expect(uncertain).toMatchObject({ verdict: "fail", failure: { code: "cleanup_uncertain" } });
    const residual = await runNoviceScenario(scenario, fixtureDriver({ cleanup: { uncertain: false, ownedResiduals: ["pid:123"] } }), { deadlineMs: 100 });
    expect(residual).toMatchObject({ verdict: "fail", failure: { code: "owned_residual" } });
  });

  test("sensitive output fails even when the driver reports success", async () => {
    const result = await runNoviceScenario(scenario, fixtureDriver({ detail: "Bearer abcdefghijklmnopqrstuvwxyz012345" }), { deadlineMs: 100 });
    expect(result).toMatchObject({ verdict: "fail", failure: { code: "sensitive_output" } });
  });
});

function fixtureDriver(options: {
  actionError?: Error; promptCode?: string; snapshot?: NoviceSnapshot; neverResolveAction?: boolean;
  cleanup?: { uncertain: boolean; ownedResiduals: string[] }; detail?: string;
} = {}): NoviceDriver {
  const current = options.snapshot ?? snapshot();
  return {
    async act(_action: NoviceAction) {
      if (options.neverResolveAction) return await new Promise(() => undefined);
      if (options.actionError) throw options.actionError;
      return observation(options.promptCode ?? "DOCTOR_OK", options.detail);
    },
    async inject() {},
    async recover() { return observation(undefined); },
    async snapshot() { return current; },
    async cleanup() { return options.cleanup ?? { uncertain: false, ownedResiduals: [] }; },
  };
}
function observation(promptCode?: string, detail?: string) {
  return {
    prompt: promptCode ? { code: promptCode, what_happened: "The check completed.", safe_state: "State is safe.", next_action: "Continue." } : undefined,
    detail: detail ?? "redacted",
  };
}
function snapshot(overrides: Record<string, boolean> = {}, omit: string[] = []): NoviceSnapshot {
  const invariants: Record<string, boolean> = { no_secret_output: true, state_loadable: true, no_residual_process: true, ...overrides };
  for (const key of omit) delete invariants[key];
  return { hash: "a".repeat(64), invariants };
}
