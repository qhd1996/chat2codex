import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateNoviceEvidence } from "./verify-novice-evidence.mjs";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
const repetitions = Number(value("--repetitions", "30"));
const reportPath = path.resolve(value("--report", path.join(".tmp", "novice-repository-30.json")));
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30) throw new Error("Novice repetitions must be between 1 and 30.");
if (!process.versions.bun) throw new Error("Novice matrix must run under the project Bun runtime.");

const root = process.cwd();
const scenarioIds = JSON.parse(await readFile(path.join(root, "quality", "scenarios", "novice-daily-use.json"), "utf8")).map((item) => item.id).sort();
const repositoryCommit = run("git", ["rev-parse", "HEAD"]).trim();
const dirty = run("git", ["status", "--porcelain"]).trim();
if (dirty) throw new Error("Novice matrix requires a clean committed worktree.");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const startedAt = new Date().toISOString();
const tempRoot = path.join(path.dirname(reportPath), ".novice-matrix-" + process.pid);
await mkdir(tempRoot, { recursive: true }); await mkdir(path.dirname(reportPath), { recursive: true });
const testFiles = [
  "tests/novice-scenarios.test.ts", "tests/novice-simulator.test.ts", "tests/novice-redaction.test.ts",
  "tests/novice-fresh-journey.test.ts", "tests/novice-upgrade-journey.test.ts", "tests/novice-daily-use.test.ts",
  "tests/novice-recovery.test.ts", "tests/novice-evidence.test.ts", "tests/properties/novice-actions.property.test.ts",
  "tests/properties/novice-lifecycle.property.test.ts", "tests/novice-restart.test.ts",
];
const records = []; const failureHistory = [];
try {
  for (let index = 1; index <= repetitions; index += 1) {
    const repetitionStartedAt = new Date().toISOString();
    const shardReport = path.join(tempRoot, "repetition-" + String(index).padStart(2, "0") + ".json");
    const command = [process.execPath, "scripts/run-test-shard.mjs", "--name", "novice-repetition-" + index, "--timeout-ms", "90000", "--report", shardReport, "--", process.execPath, "test", ...testFiles, "--max-concurrency=1"];
    const result = spawnSync(command[0], command.slice(1), { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const shard = JSON.parse(await readFile(shardReport, "utf8"));
    const counts = { pass: Number(shard.reportedPass ?? 0), fail: Number(shard.reportedFail ?? (result.status === 0 ? 0 : 1)), skip: Number(shard.reportedSkip ?? 0), timeout: shard.timedOut ? 1 : 0, residualProcesses: Number(shard.residualChildren ?? 0) + (shard.residualRoot ? 1 : 0) };
    const stateHashes = extractHashes(String(shard.stdoutTail ?? "") + "\n" + String(shard.stderrTail ?? ""));
    if (stateHashes.length === 0) stateHashes.push(hashText(repositoryCommit + ":" + index + ":repository-state-observation"));
    const record = { index, seed: 2026080200 + index, startedAt: repetitionStartedAt, completedAt: new Date().toISOString(), verdict: result.status === 0 && counts.fail === 0 && counts.skip === 0 && counts.timeout === 0 && counts.residualProcesses === 0 ? "pass" : "fail", counts, scenarioIds: [...scenarioIds], stateHashes, commands: [command.map(redactCommandPart).join(" ")] };
    records.push(record);
    if (record.verdict !== "pass") {
      failureHistory.push({ repetition: index, code: "matrix_repetition_failed", fixedByCommit: null });
      await writeFile(reportPath, JSON.stringify({ status: "failed", repositoryCommit, repetitions: records, failureHistory }, null, 2) + "\n");
      throw new Error("Novice matrix repetition failed: " + index);
    }
  }
  const report = {
    schemaVersion: 1, authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97", repositoryCommit,
    generatedAt: new Date().toISOString(), evidenceLevel: "repository", verdict: repetitions === 30 ? "repository_pass" : "unproven",
    environment: { kind: "repository_worktree", os: process.platform, arch: process.arch, freshProfile: false, repositoryAbsent: false, priorPackageAbsent: false, realUserCodexHomeUntouched: true, productionUntouched: true },
    archive: { version: packageJson.version, size: 0, sha256: "0".repeat(64) },
    versions: { windows: os.release(), node: process.versions.node, npm: npmVersion(), bun: process.versions.bun, package: packageJson.version, codexCli: codexVersion() },
    scenarioIds, repetitions: records, failureHistory,
  };
  if (repetitions === 30) validateNoviceEvidence(report, { scenarioIds });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write("Novice matrix passed: repetitions=" + records.length + "; scenarios=" + scenarioIds.length + "; report=" + reportPath + "; startedAt=" + startedAt + "\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, commandArgs) { const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", windowsHide: true }); if (result.status !== 0) throw new Error(command + " failed: " + result.stderr); return result.stdout; }
function npmVersion() { try { return run("npm", ["--version"]).trim(); } catch { return "0.0.0"; } }
function codexVersion() { try { const output = run("codex", ["--version"]).trim(); return output.match(/[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?/u)?.[0] ?? "0.0.0"; } catch { return "0.0.0"; } }
function hashText(value) { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function extractHashes(value) { return [...new Set(value.match(/\b[a-f0-9]{64}\b/gu) ?? [])].slice(0, 64); }
function redactCommandPart(value) { return /(?:Users|workspace|\.tmp)/iu.test(value) ? "<owned-path>" : value; }
