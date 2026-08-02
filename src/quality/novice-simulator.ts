import { assertNoviceOutputSafe, type NoviceGuidance } from "./novice-redaction.js";
import type { NoviceAction, NoviceFault, NoviceInvariant, NoviceRecovery, NoviceScenario } from "./novice-scenarios.js";

export interface NoviceObservation {
  prompt?: NoviceGuidance | { code: string; what_happened: string; safe_state: string; next_action: string };
  detail?: unknown;
}
export interface NoviceSnapshot {
  hash: string;
  invariants: Record<string, boolean>;
}
export interface NoviceCleanup {
  uncertain: boolean;
  ownedResiduals: string[];
}
export interface NoviceContext {
  scenarioId: string;
  requirement: string;
  environment: string;
}
export interface NoviceDriver {
  act(action: NoviceAction, context: NoviceContext): Promise<NoviceObservation>;
  inject(fault: NoviceFault, context: NoviceContext): Promise<void>;
  recover(step: NoviceRecovery, context: NoviceContext): Promise<NoviceObservation>;
  snapshot(): Promise<NoviceSnapshot>;
  cleanup(): Promise<NoviceCleanup>;
}
export interface NoviceRunOptions { deadlineMs: number; }
export interface NoviceEvent { kind: "action" | "fault" | "recovery"; name: string; beforeHash: string; afterHash: string; }
export interface NoviceFailure { code: string; message: string; }
export interface NoviceScenarioResult {
  scenarioId: string; verdict: "pass" | "fail"; promptCodes: string[]; events: NoviceEvent[];
  cleanup: NoviceCleanup; failure?: NoviceFailure;
}

class NoviceRunFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function runNoviceScenario(
  scenario: NoviceScenario, driver: NoviceDriver, options: NoviceRunOptions,
): Promise<NoviceScenarioResult> {
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 120_000) {
    throw new Error("Novice scenario deadline is invalid.");
  }
  const context: NoviceContext = { scenarioId: scenario.id, requirement: scenario.requirement, environment: scenario.environment };
  const events: NoviceEvent[] = [];
  const promptCodes: string[] = [];
  let failure: NoviceFailure | undefined;
  let cleanup: NoviceCleanup = { uncertain: true, ownedResiduals: [] };
  try {
    for (const fault of scenario.faults) {
      const before = await bounded(driver.snapshot(), options.deadlineMs);
      await bounded(driver.inject(fault, context), options.deadlineMs);
      const after = await bounded(driver.snapshot(), options.deadlineMs);
      events.push({ kind: "fault", name: fault, beforeHash: before.hash, afterHash: after.hash });
    }
    for (const action of scenario.actions) {
      const before = await bounded(driver.snapshot(), options.deadlineMs);
      const observation = await bounded(driver.act(action, context), options.deadlineMs);
      validateObservation(observation, promptCodes);
      const after = await bounded(driver.snapshot(), options.deadlineMs);
      assertInvariants(after, scenario.invariants);
      events.push({ kind: "action", name: action, beforeHash: before.hash, afterHash: after.hash });
    }
    for (const expected of scenario.expectedPromptCodes) {
      if (!promptCodes.includes(expected)) throw new NoviceRunFailure("missing_prompt", `Missing expected novice prompt: ${expected}`);
    }
    for (const step of scenario.recovery) {
      const before = await bounded(driver.snapshot(), options.deadlineMs);
      const observation = await bounded(driver.recover(step, context), options.deadlineMs);
      validateObservation(observation, promptCodes);
      const after = await bounded(driver.snapshot(), options.deadlineMs);
      assertInvariants(after, scenario.invariants);
      events.push({ kind: "recovery", name: step, beforeHash: before.hash, afterHash: after.hash });
    }
  } catch (error) {
    failure = normalizeFailure(error);
  } finally {
    try {
      cleanup = await bounded(driver.cleanup(), options.deadlineMs);
      assertNoviceOutputSafe(cleanup);
      if (!failure && cleanup.uncertain) failure = { code: "cleanup_uncertain", message: "Novice cleanup ownership is uncertain." };
      if (!failure && cleanup.ownedResiduals.length > 0) failure = { code: "owned_residual", message: "Novice cleanup left an owned residual." };
    } catch (error) {
      failure ??= normalizeFailure(error, "cleanup_failed");
    }
  }
  return { scenarioId: scenario.id, verdict: failure ? "fail" : "pass", promptCodes, events, cleanup, ...(failure ? { failure } : {}) };
}

function validateObservation(observation: NoviceObservation, promptCodes: string[]): void {
  try { assertNoviceOutputSafe(observation); } catch (error) {
    throw new NoviceRunFailure("sensitive_output", safeErrorMessage(error));
  }
  if (observation.prompt) promptCodes.push(observation.prompt.code);
}
function assertInvariants(snapshot: NoviceSnapshot, required: NoviceInvariant[]): void {
  if (!/^[a-f0-9]{64}$/u.test(snapshot.hash)) throw new NoviceRunFailure("snapshot_invalid", "Novice snapshot hash is invalid.");
  for (const invariant of required) {
    if (!Object.hasOwn(snapshot.invariants, invariant)) throw new NoviceRunFailure("invariant_missing", `Novice invariant is missing: ${invariant}`);
    if (snapshot.invariants[invariant] !== true) throw new NoviceRunFailure("invariant_failed", `Novice invariant failed: ${invariant}`);
  }
}
function normalizeFailure(error: unknown, fallback = "driver_error"): NoviceFailure {
  if (error instanceof NoviceRunFailure) return { code: error.code, message: error.message };
  return { code: fallback, message: safeErrorMessage(error) };
}
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try { assertNoviceOutputSafe(message); return message; } catch { return "Sensitive failure detail was redacted."; }
}
async function bounded<T>(promise: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new NoviceRunFailure("deadline_exceeded", "Novice event deadline exceeded.")), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
