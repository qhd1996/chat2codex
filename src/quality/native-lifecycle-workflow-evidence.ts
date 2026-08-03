import { readFile } from "node:fs/promises";

export interface PublicNativeLifecycleEvidence {
  schemaVersion: 1;
  verdict: "pass" | "fail";
  failure: null | { stage: string; code: string };
  cleanup: { attempted: boolean; succeeded: boolean; residualTasks?: number; residualUsers?: number; residualProcesses?: number; profileExists?: boolean; ownedRootExists?: boolean };
}

const safeStage = /^[a-z0-9_]+(?:\/[a-z0-9_]+){0,3}$/u;
const safeCode = /^(?:unavailable|exit_-?\d+|win32_\d+|hresult_-?\d+|[A-Z][A-Z0-9_]{0,63})$/u;

function fallback(stage: "workflow_publication/report_missing" | "workflow_publication/report_invalid" | "workflow_enforcement/report_missing" | "workflow_enforcement/report_invalid"): PublicNativeLifecycleEvidence {
  return { schemaVersion: 1, verdict: "fail", failure: { stage, code: "unavailable" }, cleanup: { attempted: false, succeeded: false } };
}

function boundedCount(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : undefined;
}

export function publicNativeLifecycleEvidence(value: unknown, invalidStage: Parameters<typeof fallback>[0]): PublicNativeLifecycleEvidence {
  if (!value || typeof value !== "object") return fallback(invalidStage);
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || (source.verdict !== "pass" && source.verdict !== "fail")) return fallback(invalidStage);
  const rawFailure = source.failure && typeof source.failure === "object" ? source.failure as Record<string, unknown> : null;
  const stage = rawFailure && typeof rawFailure.stage === "string" && rawFailure.stage.length <= 128 && safeStage.test(rawFailure.stage) ? rawFailure.stage : null;
  const code = rawFailure && typeof rawFailure.code === "string" && safeCode.test(rawFailure.code) ? rawFailure.code : "unavailable";
  if (source.verdict === "fail" && !stage) return fallback(invalidStage);
  const rawCleanup = source.cleanup && typeof source.cleanup === "object" ? source.cleanup as Record<string, unknown> : {};
  const cleanup: PublicNativeLifecycleEvidence["cleanup"] = { attempted: rawCleanup.attempted === true, succeeded: rawCleanup.succeeded === true };
  const residualTasks = boundedCount(rawCleanup.residualTasks);
  const residualUsers = boundedCount(rawCleanup.residualUsers);
  const residualProcesses = boundedCount(rawCleanup.residualProcesses);
  if (residualTasks !== undefined) cleanup.residualTasks = residualTasks;
  if (residualUsers !== undefined) cleanup.residualUsers = residualUsers;
  if (residualProcesses !== undefined) cleanup.residualProcesses = residualProcesses;
  if (typeof rawCleanup.profileExists === "boolean") cleanup.profileExists = rawCleanup.profileExists;
  if (typeof rawCleanup.ownedRootExists === "boolean") cleanup.ownedRootExists = rawCleanup.ownedRootExists;
  if (source.verdict === "pass") {
    const summary = source.summary && typeof source.summary === "object" ? source.summary as Record<string, unknown> : null;
    const qualifying = summary
      && summary.installAttempts === 2
      && summary.uninstallAttempts === 2
      && summary.uninstallNoopCount === 1
      && summary.createdKeyCount === 3
      && summary.preservedKeyCount === 3
      && summary.distinctKeyFingerprints === 3
      && summary.taskCreateCount === 2
      && summary.taskDeleteCount === 1
      && summary.userDataPreserved === true
      && summary.residualOwnedFiles === 0
      && source.failure === null
      && cleanup.attempted === true
      && cleanup.succeeded === true
      && rawCleanup.failure === null
      && cleanup.residualTasks === 0
      && cleanup.residualUsers === 0
      && cleanup.residualProcesses === 0
      && cleanup.profileExists === false
      && cleanup.ownedRootExists === false;
    if (!qualifying) return fallback(invalidStage);
  }
  return { schemaVersion: 1, verdict: source.verdict, failure: source.verdict === "fail" ? { stage: stage!, code } : null, cleanup };
}

export async function readPublicNativeLifecycleEvidence(reportPath: string, mode: "publication" | "enforcement"): Promise<PublicNativeLifecycleEvidence> {
  const missing = mode === "publication" ? "workflow_publication/report_missing" : "workflow_enforcement/report_missing";
  const invalid = mode === "publication" ? "workflow_publication/report_invalid" : "workflow_enforcement/report_invalid";
  let source: string;
  try { source = await readFile(reportPath, "utf8"); } catch { return fallback(missing); }
  try { return publicNativeLifecycleEvidence(JSON.parse(source), invalid); } catch { return fallback(invalid); }
}
