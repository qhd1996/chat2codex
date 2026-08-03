import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateNoviceEvidence } from "./verify-novice-evidence.mjs";

const reportPath = process.argv[2] ?? ".tmp/novice-repository-30.json";
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowedStages = new Set([
  "initialization/arguments", "initialization/report", "preflight/runtime",
  "preflight/scenarios", "preflight/git_commit", "preflight/git_clean",
  "preflight/package", "preflight/temp_setup", "repetition/spawn",
  "repetition/shard_report", "repetition/package_report",
  "repetition/validation", "final/validation", "cleanup/temp_root",
  "workflow_publication/report_missing", "workflow_publication/report_invalid",
  "workflow_publication/summary_write", "workflow_publication/process_failure",
  ...packageFailureStages().map((stage) => "repetition/package_report/" + stage),
]);
const allowedCodes = new Set([
  "invalid_arguments", "report_unavailable", "bun_required", "read_failed",
  "invalid", "command_failed", "tracked_dirty", "create_failed",
  "spawn_failed", "missing", "mismatch", "repetition_failed",
  "validation_failed", "cleanup_failed", "unavailable",
  "exit_86",
]);

let published = await readPublicEvidence(reportPath);
if (process.env.GITHUB_STEP_SUMMARY) {
  try { await appendFile(process.env.GITHUB_STEP_SUMMARY, JSON.stringify(published) + "\n"); }
  catch { published = fallback("workflow_publication/summary_write"); }
}
const escaped = JSON.stringify(published).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
process.stdout.write(`::${published.verdict === "pass" ? "notice" : "error"} title=Novice matrix evidence::${escaped}\n`);
process.exitCode = 0;

async function readPublicEvidence(file) {
  let value;
  try { value = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { return fallback(error instanceof SyntaxError ? "workflow_publication/report_invalid" : "workflow_publication/report_missing"); }
  if (value?.schemaVersion === 5 && value.verdict === "repository_pass") {
    try {
      const definitions = JSON.parse(await readFile(path.join(repositoryRoot, "quality", "scenarios", "novice-daily-use.json"), "utf8"));
      validateNoviceEvidence(value, { scenarioIds: definitions.map((item) => item.id), scenarioDefinitions: definitions });
      return { schemaVersion: 1, verdict: "pass", repositoryCommit: value.repositoryCommit, repetitionsCompleted: 30, failure: null, cleanup: { attempted: true, succeeded: true } };
    } catch { return fallback("workflow_publication/report_invalid"); }
  }
  const stage = value?.failure?.stage;
  const code = value?.failure?.code;
  const repetition = value?.failure?.repetition;
  if (value?.schemaVersion !== 1 || value.verdict !== "fail" || !allowedStages.has(stage) || !allowedCodes.has(code) || !(repetition === null || Number.isSafeInteger(repetition) && repetition >= 1 && repetition <= 30)) return fallback("workflow_publication/report_invalid");
  return { schemaVersion: 1, verdict: "fail", repositoryCommit: /^[a-f0-9]{40}$/u.test(value.repositoryCommit) ? value.repositoryCommit : null, repetitionsCompleted: Number.isSafeInteger(value.repetitionsCompleted) && value.repetitionsCompleted >= 0 && value.repetitionsCompleted <= 30 ? value.repetitionsCompleted : 0, failure: { stage, code, repetition }, cleanup: { attempted: value.cleanup?.attempted === true, succeeded: value.cleanup?.succeeded === true } };
}
function fallback(stage) { return { schemaVersion: 1, verdict: "fail", repositoryCommit: null, repetitionsCompleted: 0, failure: { stage, code: "unavailable", repetition: null }, cleanup: { attempted: false, succeeded: false } }; }
function packageFailureStages() { return ["file_acl_owner_read", "file_acl_dacl_apply", "directory_acl_owner_read", "directory_acl_dacl_apply"]; }
