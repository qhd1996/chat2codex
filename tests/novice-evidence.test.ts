import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateNoviceEvidence } from "../scripts/verify-novice-evidence.mjs";

const templatePath = path.resolve(import.meta.dir, "..", "quality", "evidence", "novice-acceptance-template.json");
const scenarioPath = path.resolve(import.meta.dir, "..", "quality", "scenarios", "novice-daily-use.json");
const scenarioIds = (JSON.parse(await readFile(scenarioPath, "utf8")) as Array<{ id: string }>).map((item) => item.id).sort();

describe("novice acceptance evidence", () => {
  test("keeps the checked-in template unproven", async () => {
    const value = JSON.parse(await readFile(templatePath, "utf8"));
    expect(validateNoviceEvidence(value, { scenarioIds })).toEqual({ qualifying: false, repetitions: 0, scenarios: scenarioIds.length, verdict: "unproven" });
  });

  test("accepts thirty complete isolated-package repetitions", () => {
    expect(validateNoviceEvidence(validComplete(), { scenarioIds })).toEqual({ qualifying: true, repetitions: 30, scenarios: scenarioIds.length, verdict: "pass" });
  });

  test("retains a thirty-run repository pass without promoting acceptance", () => {
    const value = validComplete();
    value.evidenceLevel = "repository";
    value.verdict = "repository_pass";
    value.environment.kind = "repository_worktree";
    value.environment.repositoryAbsent = false;
    value.environment.priorPackageAbsent = false;
    expect(validateNoviceEvidence(value, { scenarioIds })).toEqual({ qualifying: false, repetitions: 30, scenarios: scenarioIds.length, verdict: "repository_pass" });
  });

  for (const [name, mutate, pattern] of [
    ["repository-only promotion", (v: any) => { v.evidenceLevel = "repository"; }, /isolated.package|qualifying/i],
    ["only 29 repetitions", (v: any) => { v.repetitions.pop(); }, /30|repetition/i],
    ["missing scenario", (v: any) => { v.repetitions[0].scenarioIds.pop(); }, /scenario/i],
    ["duplicate scenario", (v: any) => { v.repetitions[0].scenarioIds.push(v.repetitions[0].scenarioIds[0]); }, /duplicate|scenario/i],
    ["skip", (v: any) => { v.repetitions[0].counts.skip = 1; }, /zero|skip/i],
    ["timeout", (v: any) => { v.repetitions[0].counts.timeout = 1; }, /zero|timeout/i],
    ["failure", (v: any) => { v.repetitions[0].counts.fail = 1; }, /zero|fail/i],
    ["residual", (v: any) => { v.repetitions[0].counts.residualProcesses = 1; }, /zero|residual/i],
    ["archive hash", (v: any) => { v.archive.sha256 = "bad"; }, /archive.*hash/i],
    ["missing seed", (v: any) => { delete v.repetitions[0].seed; }, /missing.*seed|field/i],
    ["missing command", (v: any) => { v.repetitions[0].commands = []; }, /command/i],
    ["missing state hash", (v: any) => { v.repetitions[0].stateHashes = []; }, /state.*hash/i],
    ["unclean profile", (v: any) => { v.environment.freshProfile = false; }, /fresh.*profile|environment/i],
    ["real home touched", (v: any) => { v.environment.realUserCodexHomeUntouched = false; }, /codex.*home|environment/i],
    ["secret output", (v: any) => { v.failureHistory.push({ repetition: 1, code: "Bearer abcdefghijklmnopqrstuvwxyz", fixedByCommit: null }); }, /sensitive|redact/i],
  ] as const) test("rejects " + name, () => { const value = validComplete(); mutate(value); expect(() => validateNoviceEvidence(value, { scenarioIds })).toThrow(pattern); });
});

function validComplete() {
  const repetitions = Array.from({ length: 30 }, (_, offset) => ({
    index: offset + 1, seed: 2026080200 + offset + 1,
    startedAt: "2026-08-03T01:00:00.000Z", completedAt: "2026-08-03T01:01:00.000Z", verdict: "pass",
    counts: { pass: 78, fail: 0, skip: 0, timeout: 0, residualProcesses: 0 },
    scenarioIds: [...scenarioIds], stateHashes: ["a".repeat(64), "b".repeat(64)],
    commands: ["chat2codex novice acceptance --archive <candidate> --profile <owned-temp>"],
  }));
  return {
    schemaVersion: 1, authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97", repositoryCommit: "a".repeat(40),
    generatedAt: "2026-08-03T01:02:00.000Z", evidenceLevel: "isolated_package", verdict: "pass",
    environment: { kind: "clean_windows_vm", os: "win32", arch: "x64", freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true, realUserCodexHomeUntouched: true, productionUntouched: true },
    archive: { version: "0.8.0-novice.1", size: 1234, sha256: "c".repeat(64) },
    versions: { windows: "11.0.26100", node: "24.14.0", npm: "11.0.0", bun: "1.3.14", package: "0.8.0-novice.1", codexCli: "0.146.0" },
    scenarioIds: [...scenarioIds], repetitions, failureHistory: [],
  };
}
