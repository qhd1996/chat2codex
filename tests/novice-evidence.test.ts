import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveNoviceEvidenceInput, validateNoviceEvidence } from "../scripts/verify-novice-evidence.mjs";

const templatePath = path.resolve(import.meta.dir, "..", "quality", "evidence", "novice-acceptance-template.json");
const scenarioPath = path.resolve(import.meta.dir, "..", "quality", "scenarios", "novice-daily-use.json");
const scenarioIds = (JSON.parse(await readFile(scenarioPath, "utf8")) as Array<{ id: string }>).map((item) => item.id).sort();
const scenarioDefinitions = JSON.parse(await readFile(scenarioPath, "utf8"));
const validationOptions = { scenarioIds, scenarioDefinitions };

describe("novice acceptance evidence", () => {
  test("keeps the checked-in template unproven", async () => {
    const value = JSON.parse(await readFile(templatePath, "utf8"));
    expect(validateNoviceEvidence(value, validationOptions)).toEqual({ qualifying: false, repetitions: 0, scenarios: scenarioIds.length, verdict: "unproven" });
  });

  test("accepts thirty complete isolated-package repetitions", () => {
    expect(validateNoviceEvidence(validComplete(), validationOptions)).toEqual({ qualifying: true, repetitions: 30, scenarios: scenarioIds.length, verdict: "pass" });
  });

  test("rejects hollow, duplicate, or drifted per-scenario execution evidence", () => {
    for (const mutate of [
      (v: any) => { v.repetitions[0].scenarioExecutions.pop(); },
      (v: any) => { v.repetitions[0].scenarioExecutions[1] = v.repetitions[0].scenarioExecutions[0]; },
      (v: any) => { v.repetitions[0].scenarioExecutions[0].actions = []; },
      (v: any) => { v.repetitions[0].scenarioExecutions[0].promptCodes = ["FAKE_PROMPT"]; },
      (v: any) => { v.repetitions[0].scenarioExecutions[0].probes = ["fake_probe"]; },
    ]) {
      const value = validComplete(); mutate(value);
      expect(() => validateNoviceEvidence(value, validationOptions)).toThrow(/scenario.*execution|action|prompt|probe|duplicate/i);
    }
  });

  test("rejects a qualifying claim without independent Windows lifecycle and per-round process proof", () => {
    const missingAttestation = validComplete();
    missingAttestation.attestation = null;
    expect(() => validateNoviceEvidence(missingAttestation, validationOptions)).toThrow(/attestation|lifecycle/i);
    const missingProcess = validComplete();
    missingProcess.repetitions[0].processProof = null;
    expect(() => validateNoviceEvidence(missingProcess, validationOptions)).toThrow(/process.*proof|residual/i);
    const missingHash = validComplete();
    missingHash.attestation.installedFiles = [];
    expect(() => validateNoviceEvidence(missingHash, validationOptions)).toThrow(/installed.*hash|attestation/i);
  });

  test("resolves an explicit external evidence file without treating it as repository input", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const external = path.join(path.dirname(root), "novice-external-evidence-test.json");
    await writeFile(external, JSON.stringify(validComplete()));
    try {
      await expect(resolveNoviceEvidenceInput(root, ["--external", external])).resolves.toBe(external);
      await expect(resolveNoviceEvidenceInput(root, [external])).rejects.toThrow(/external|relative/i);
    } finally { await rm(external, { force: true }); }
  });

  test("retains a thirty-run repository pass without promoting acceptance", () => {
    const value = validComplete();
    value.evidenceLevel = "repository";
    value.verdict = "repository_pass";
    value.environment.kind = "repository_worktree";
    value.environment.repositoryAbsent = false;
    value.environment.priorPackageAbsent = false;
    value.attestation = null;
    for (const repetition of value.repetitions) repetition.processProof = null;
    expect(validateNoviceEvidence(value, validationOptions)).toEqual({ qualifying: false, repetitions: 30, scenarios: scenarioIds.length, verdict: "repository_pass" });
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
    ["secret output", (v: any) => { v.failureHistory.push({ repetition: 1, code: "Bearer abcdefghijklmnopqrstuvwxyz", fixedByCommit: "b".repeat(40) }); }, /sensitive|redact/i],
  ] as const) test("rejects " + name, () => { const value = validComplete(); mutate(value); expect(() => validateNoviceEvidence(value, validationOptions)).toThrow(pattern); });
});

function validComplete() {
  const scenarioExecutions = scenarioDefinitions.map((scenario: any) => ({ scenarioId: scenario.id, verdict: "pass", preconditions: scenario.preconditions, actions: scenario.actions, promptCodes: scenario.expectedPromptCodes, invariants: scenario.invariants, faults: scenario.faults, recovery: scenario.recovery, probes: scenario.requiredProbes })).sort((a: any, b: any) => a.scenarioId.localeCompare(b.scenarioId));
  const repetitions = Array.from({ length: 30 }, (_, offset) => ({
    index: offset + 1, seed: 2026080200 + offset + 1,
    startedAt: "2026-08-03T01:00:00.000Z", completedAt: "2026-08-03T01:01:00.000Z", verdict: "pass",
    counts: { pass: 78, fail: 0, skip: 0, timeout: 0, residualProcesses: 0 },
    scenarioIds: [...scenarioIds], scenarioExecutions, stateHashes: ["a".repeat(64), "b".repeat(64)],
    commands: ["chat2codex novice acceptance --archive <candidate> --profile <owned-temp>"],
    processProof: { pid: 200 + offset, createdAt: "2026-08-03T01:00:30.000Z", stopped: true, residualProcesses: 0 },
  }));
  return {
    schemaVersion: 3, authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97", repositoryCommit: "a".repeat(40),
    generatedAt: "2026-08-03T01:02:00.000Z", evidenceLevel: "isolated_package", verdict: "pass",
    environment: { kind: "clean_windows_vm", os: "win32", arch: "x64", freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true, realUserCodexHomeUntouched: true, productionUntouched: true },
    archive: { version: "0.8.0-novice.1", size: 1234, sha256: "c".repeat(64) },
    versions: { windows: "11.0.26100", node: "24.14.0", npm: "11.0.0", bun: "1.3.14", package: "0.8.0-novice.1", codexCli: "0.146.0" },
    scenarioIds: [...scenarioIds], repetitions, failureHistory: [{ repetition: 1, code: "historical_failure", fixedByCommit: "a".repeat(40) }],
    attestation: validAttestation(),
  };
}

function validAttestation() {
  const value = {
    environmentKind: "equivalent_isolated_windows", githubActions: true, runnerEnvironment: "github-hosted",
    freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true, realUserCodexHomeUntouched: true, productionUntouched: true,
    archiveSha256: "c".repeat(64), repositoryCommit: "a".repeat(40), runIdentityHash: "5".repeat(64), ownedEnvironmentHash: "6".repeat(64),
    taskNameHash: "1".repeat(64), installAttempts: 3, startAttempts: 2, stopAttempts: 2, uninstallAttempts: 3,
    doctorExitCode: 0, singleWriter: true, lockHealthy: true, userDataPreserved: true,
    firstProcess: { pid: 101, createdAt: "2026-08-03T00:00:00.000Z", commandHash: "2".repeat(64), stateSha256: "3".repeat(64) },
    secondProcess: { pid: 102, createdAt: "2026-08-03T00:01:00.000Z", commandHash: "4".repeat(64), stateSha256: "3".repeat(64) },
    taskRemoved: true, newKeysAfterReinstall: true, anotherInteractiveUserDenied: true, zeroResidualProcesses: true, ownedRootRemoved: true,
    installedFiles: installedFileFixture(),
    commands: Array.from({ length: 8 }, (_, index) => "attestation-command-" + index),
  };
  return { ...value, attestationHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex") };
}

function installedFileFixture() {
  return ["package/package.json", "package/dist/index.js", "package/scripts/novice-service-probe.mjs", "owned/.env", "owned/.service/windows/launcher.ps1", "owned/.service/windows/task.xml", "owned/.service/windows/installation.json", "owned/.data/state.json"].map((path, index) => ({ path, sha256: String(index + 1).repeat(64) }));
}
