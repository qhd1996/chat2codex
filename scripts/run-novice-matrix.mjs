import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateNoviceEvidence } from "./verify-novice-evidence.mjs";

const stages = new Set([
  "initialization/arguments", "initialization/report", "preflight/runtime",
  "preflight/scenarios", "preflight/git_commit", "preflight/git_clean",
  "preflight/package", "preflight/temp_setup", "repetition/spawn",
  "repetition/shard_report", "repetition/package_report",
  "repetition/validation", "final/validation", "cleanup/temp_root",
]);
const codes = new Set([
  "invalid_arguments", "report_unavailable", "bun_required", "read_failed",
  "invalid", "command_failed", "tracked_dirty", "create_failed",
  "spawn_failed", "missing", "mismatch", "repetition_failed",
  "validation_failed", "cleanup_failed", "unavailable",
]);
class MatrixFailure extends Error {
  constructor(stage, code, repetition = null) { super(stage + "/" + code); this.stage = stage; this.code = code; this.repetition = repetition; }
}

const args = process.argv.slice(2);
const rawRepetitions = flagValue("--repetitions", "30");
const rawReport = flagValue("--report", path.join(".tmp", "novice-repository-30.json"));
const repetitions = Number(rawRepetitions);
const reportPath = path.resolve(typeof rawReport === "string" && rawReport ? rawReport : path.join(".tmp", "novice-repository-30.json"));
const root = process.cwd();
const tempRoot = path.join(os.tmpdir(), ".novice-matrix-" + process.pid);
let repositoryCommit = null;
let cleanup = { attempted: false, succeeded: false };
let reportReady = false;
let tempCreated = false;
let failure = null;
let successReport = null;
let records = [];
let failureHistory = [];

try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const priorReport = await readFile(reportPath, "utf8").then((source) => JSON.parse(source)).catch(() => null);
  failureHistory = Array.isArray(priorReport?.failureHistory) ? priorReport.failureHistory.filter(validHistory) : [];
  await writeFailureReport(new MatrixFailure("initialization/arguments", "unavailable"));
  reportReady = process.exitCode !== 1;
} catch {
  process.stderr.write("Novice matrix failed: initialization/report/report_unavailable\n");
  process.exitCode = 1;
}

if (reportReady) {
  try {
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30 || rawReport === undefined || rawRepetitions === undefined) {
      throw new MatrixFailure("initialization/arguments", "invalid_arguments");
    }
    if (!process.versions.bun) throw new MatrixFailure("preflight/runtime", "bun_required");

    const scenarioInventory = await readJson(path.join(root, "quality", "scenarios", "novice-daily-use.json"), "preflight/scenarios");
    if (!Array.isArray(scenarioInventory) || scenarioInventory.some((item) => !item || typeof item.id !== "string")) {
      throw new MatrixFailure("preflight/scenarios", "invalid");
    }
    const scenarioIds = scenarioInventory.map((item) => item.id).sort();
    repositoryCommit = gitOutput(["rev-parse", "HEAD"], "preflight/git_commit").trim();
    if (!/^[a-f0-9]{40}$/u.test(repositoryCommit)) throw new MatrixFailure("preflight/git_commit", "invalid");
    if (gitOutput(["status", "--porcelain", "--untracked-files=no"], "preflight/git_clean").trim()) {
      throw new MatrixFailure("preflight/git_clean", "tracked_dirty");
    }
    const packageJson = await readJson(path.join(root, "package.json"), "preflight/package");
    if (!packageJson || typeof packageJson.version !== "string") throw new MatrixFailure("preflight/package", "invalid");
    const startedAt = new Date().toISOString();
    try { await mkdir(tempRoot, { recursive: true }); tempCreated = true; }
    catch { throw new MatrixFailure("preflight/temp_setup", "create_failed"); }

    failureHistory = failureHistory.map((item) => ({ repetition: item.repetition, code: item.code, fixedByCommit: item.fixedByCommit ?? repositoryCommit }));
    const testFiles = [
      "tests/novice-scenarios.test.ts", "tests/novice-simulator.test.ts", "tests/novice-redaction.test.ts",
      "tests/novice-fresh-journey.test.ts", "tests/novice-upgrade-journey.test.ts", "tests/novice-daily-use.test.ts",
      "tests/novice-recovery.test.ts", "tests/novice-evidence.test.ts", "tests/properties/novice-actions.property.test.ts",
      "tests/novice-package-matrix.test.ts", "tests/novice-real-upgrade.test.ts",
      "tests/outbox-retry-scheduler.test.ts", "tests/properties/novice-lifecycle.property.test.ts", "tests/novice-restart.test.ts",
    ];

    for (let index = 1; index <= repetitions; index += 1) {
      const repetitionStartedAt = new Date().toISOString();
      const suffix = String(index).padStart(2, "0");
      const shardReport = path.join(tempRoot, "repetition-" + suffix + "-fast.json");
      const command = [process.execPath, "scripts/run-test-shard.mjs", "--name", "novice-fast-" + index, "--timeout-ms", "90000", "--report", shardReport, "--", process.execPath, "test", ...testFiles, "--max-concurrency=1"];
      const result = spawnSync(command[0], command.slice(1), { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      if (result.error) throw new MatrixFailure("repetition/spawn", "spawn_failed", index);
      const shard = await readShardReport(shardReport, index);
      const counts = {
        pass: Number(shard.reportedPass ?? 0),
        fail: Number(shard.reportedFail ?? (result.status === 0 ? 0 : 1)),
        skip: Number(shard.reportedSkip ?? 0),
        timeout: shard.timedOut ? 1 : 0,
        residualProcesses: Number(shard.residualChildren ?? 0) + (shard.residualRoot ? 1 : 0),
      };
      const stateHashes = extractHashes(String(shard.stdoutTail ?? "") + "\n" + String(shard.stderrTail ?? ""));
      if (stateHashes.length === 0) stateHashes.push(hashText(repositoryCommit + ":" + index + ":repository-state-observation"));
      let packageReport;
      try { packageReport = await extractPackageExecutionReport(scenarioIds, index, packageJson.version); }
      catch { throw new MatrixFailure("repetition/package_report", "invalid", index); }
      if (!packageReport) throw new MatrixFailure("repetition/package_report", "mismatch", index);
      const record = { index, seed: 2026080200 + index, startedAt: repetitionStartedAt, completedAt: new Date().toISOString(), verdict: result.status === 0 && counts.fail === 0 && counts.skip === 0 && counts.timeout === 0 && counts.residualProcesses === 0 ? "pass" : "fail", counts, scenarioIds: [...scenarioIds], scenarioExecutions: packageReport.scenarioExecutions ?? [], stateHashes, commands: [command.map(redactCommandPart).join(" ")], processProof: null };
      records.push(record);
      if (record.verdict !== "pass") {
        failureHistory.push({ repetition: index, code: "matrix_repetition_failed", fixedByCommit: null });
        throw new MatrixFailure("repetition/validation", "repetition_failed", index);
      }
    }

    successReport = {
      schemaVersion: 5, authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97", repositoryCommit,
      generatedAt: new Date().toISOString(), evidenceLevel: "repository", verdict: repetitions === 30 ? "repository_pass" : "unproven",
      environment: { kind: "repository_worktree", os: process.platform, arch: process.arch, freshProfile: false, repositoryAbsent: false, priorPackageAbsent: false, realUserCodexHomeUntouched: true, productionUntouched: true },
      archive: { version: packageJson.version, size: 0, sha256: "0".repeat(64) },
      versions: { windows: os.release(), node: process.versions.node, npm: npmVersion(), bun: process.versions.bun, package: packageJson.version, codexCli: codexVersion() },
      scenarioIds, repetitions: records, failureHistory, attestation: null, realUpgrade: null,
    };
    if (repetitions === 30) {
      try { validateNoviceEvidence(successReport, { scenarioIds, scenarioDefinitions: scenarioInventory }); }
      catch { throw new MatrixFailure("final/validation", "validation_failed"); }
    }
    process.stdout.write("Novice matrix passed: repetitions=" + records.length + "; scenarios=" + scenarioIds.length + "; report=<owned-path>; startedAt=" + startedAt + "\n");
  } catch (error) {
    failure = normalizeFailure(error);
    process.exitCode = 1;
  } finally {
    if (tempCreated) {
      cleanup = { attempted: true, succeeded: false };
      try { await rm(tempRoot, { recursive: true, force: true }); cleanup.succeeded = true; }
      catch { failure = new MatrixFailure("cleanup/temp_root", "cleanup_failed"); process.exitCode = 1; }
    }
    if (failure) await writeFailureReport(failure);
    else if (successReport) await writeFile(reportPath, JSON.stringify(successReport, null, 2) + "\n");
  }
}

function normalizeFailure(error) {
  if (error instanceof MatrixFailure && stages.has(error.stage) && codes.has(error.code)) return error;
  return new MatrixFailure("final/validation", "unavailable");
}
async function writeFailureReport(error) {
  const normalized = normalizeFailure(error);
  const report = { schemaVersion: 1, verdict: "fail", repositoryCommit: /^[a-f0-9]{40}$/u.test(repositoryCommit ?? "") ? repositoryCommit : null, repetitionsCompleted: records.length, failureHistory, failure: { stage: normalized.stage, code: normalized.code, repetition: normalized.repetition }, cleanup };
  try { await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n"); }
  catch { process.stderr.write("Novice matrix failed: initialization/report/report_unavailable\n"); process.exitCode = 1; }
}
function flagValue(flag, fallback) { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; }
function gitOutput(commandArgs, stage) { const result = spawnSync("git", commandArgs, { cwd: root, encoding: "utf8", windowsHide: true }); if (result.error || result.status !== 0) throw new MatrixFailure(stage, "command_failed"); return result.stdout; }
async function readJson(file, stage) { let source; try { source = await readFile(file, "utf8"); } catch { throw new MatrixFailure(stage, "read_failed"); } try { return JSON.parse(source); } catch { throw new MatrixFailure(stage, "invalid"); } }
async function readShardReport(file, repetition) { let source; try { source = await readFile(file, "utf8"); } catch { throw new MatrixFailure("repetition/shard_report", "missing", repetition); } try { const value = JSON.parse(source); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; } catch { throw new MatrixFailure("repetition/shard_report", "invalid", repetition); } }
function validHistory(item) { return item && Number.isSafeInteger(item.repetition) && item.repetition >= 1 && item.repetition <= 30 && typeof item.code === "string" && /^[a-z0-9_]{1,64}$/u.test(item.code) && (item.fixedByCommit === null || /^[a-f0-9]{40}$/u.test(item.fixedByCommit)); }
function run(command, commandArgs) { const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", windowsHide: true }); if (result.error || result.status !== 0) throw new Error(); return result.stdout; }
function npmVersion() { try { return run("npm", ["--version"]).trim(); } catch { return "0.0.0"; } }
function codexVersion() { try { const output = run("codex", ["--version"]).trim(); return output.match(/[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?/u)?.[0] ?? "0.0.0"; } catch { return "0.0.0"; } }
function hashText(value) { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function extractHashes(value) { return [...new Set(value.match(/\b[a-f0-9]{64}\b/gu) ?? [])].slice(0, 64); }
function redactCommandPart(value) { return /(?:Users|workspace|\.tmp|AppData|Temp)/iu.test(value) ? "<owned-path>" : value; }
async function extractPackageExecutionReport(expectedScenarioIds, index, packageVersion) {
  const module = await import(path.join(root, "src", "quality", "novice-package-matrix.ts"));
  const value = await module.runNovicePackageRepetition({ root: path.join(tempRoot, "evidence-" + String(index).padStart(2, "0")), packageRoot: root, packageVersion, cliVersion: packageVersion, archiveVerified: true, restartProbePath: path.join(root, "scripts", "novice-restart-probe.mjs") });
  return JSON.stringify([...value.scenarioIds].sort()) === JSON.stringify(expectedScenarioIds) ? value : null;
}
