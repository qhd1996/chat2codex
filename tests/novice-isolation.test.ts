import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { buildQualifyingNoviceEvidence, planNoviceIsolation, planNpmInvocation, readNoviceAttestation, runNoviceArchiveAcceptance, validateNoviceWorkerEvidence } from "../scripts/run-novice-acceptance.mjs";

describe("novice archive isolation", () => {
  test("plans a private profile, Codex Home, Chat2Codex Home, and npm prefix", async () => {
    await withArchive(async ({ root, archive, sha256 }) => {
      const owned = path.join(root, "owned");
      const plan = await planNoviceIsolation({ archive, expectedSha256: sha256, ownedRoot: owned, repositoryRoot: process.cwd(), realUserProfile: os.homedir(), realCodexHome: path.join(os.homedir(), ".codex"), productionRoot: "F:/Chat2Codex", environmentKind: "isolated_profile_projection" });
      expect(plan.archive).toBe(await realpath(archive));
      for (const value of Object.values(plan.environment)) expect(path.relative(owned, value)).not.toStartWith("..");
      expect(plan.installedPackageRoot).toStartWith(plan.environment.npmPrefix);
      expect(plan.qualifyingEnvironment).toBe(false);
    });
  });

  test("rejects wrong hash, repository entrypoint, real profile/Home, and production overlap", async () => {
    await withArchive(async ({ root, archive, sha256 }) => {
      const base = { archive, expectedSha256: sha256, ownedRoot: path.join(root, "owned"), repositoryRoot: process.cwd(), realUserProfile: os.homedir(), realCodexHome: path.join(os.homedir(), ".codex"), productionRoot: "F:/Chat2Codex", environmentKind: "isolated_profile_projection" as const };
      await expect(planNoviceIsolation({ ...base, expectedSha256: "0".repeat(64) })).rejects.toThrow(/archive.*hash/i);
      await expect(planNoviceIsolation({ ...base, ownedRoot: process.cwd() })).rejects.toThrow(/repository|owned root/i);
      await expect(planNoviceIsolation({ ...base, ownedRoot: os.homedir() })).rejects.toThrow(/profile|owned root/i);
      await expect(planNoviceIsolation({ ...base, ownedRoot: path.join(os.homedir(), ".codex") })).rejects.toThrow(/codex home|owned root/i);
      await expect(planNoviceIsolation({ ...base, ownedRoot: "F:/Chat2Codex/test" })).rejects.toThrow(/production|owned root/i);
    });
  });

  test("never promotes a current-host profile projection to a clean Windows pass", async () => {
    await withArchive(async ({ root, archive, sha256 }) => {
      await expect(runNoviceArchiveAcceptance({ archive, expectedSha256: sha256, ownedRoot: path.join(root, "owned"), repositoryRoot: process.cwd(), realUserProfile: os.homedir(), realCodexHome: path.join(os.homedir(), ".codex"), productionRoot: "F:/Chat2Codex", environmentKind: "isolated_profile_projection", dryRun: true })).resolves.toMatchObject({ qualifying: false, verdict: "package_smoke" });
    });
  });

  test("the archive CLI main path discovers versions before a dry run", async () => {
    await withArchive(async ({ root, archive, sha256 }) => {
      const result = spawnSync(process.execPath, [path.resolve(import.meta.dir, "..", "scripts", "run-novice-acceptance.mjs"), "--archive", archive, "--sha256", sha256, "--owned-root", path.join(root, "owned"), "--production-root", path.join(root, "excluded-production"), "--dry-run"], { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8", windowsHide: true });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ qualifying: false, verdict: "package_smoke", archiveSha256: sha256 });
    });
  });

  test("ships no developer or production drive path in the archive runner", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "..", "scripts", "run-novice-acceptance.mjs")).text();
    expect(source).not.toMatch(/[A-Za-z]:[\\/](?:Users|workspace|Chat2Codex|codex)/iu);
  });

  test("runs the standard Windows npm CLI through the current Node executable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-npm-"));
    const cli = path.join(root, "node_modules", "npm", "bin", "npm-cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "// synthetic npm cli\n");
    try {
      await expect(planNpmInvocation({ command: "npm", args: ["--version"], platform: "win32", pathValue: root, nodeCommand: process.execPath }))
        .resolves.toEqual({ command: process.execPath, args: [cli, "--version"] });
      await expect(planNpmInvocation({ command: "npm", args: [], platform: "win32", pathValue: path.join(root, "missing"), nodeCommand: process.execPath }))
        .rejects.toThrow(/install node.*npm|npm cli/i);
      await expect(planNpmInvocation({ command: "npmXcmd", args: ["--version"], platform: "win32", pathValue: root, nodeCommand: process.execPath }))
        .resolves.toEqual({ command: "npmXcmd", args: ["--version"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires complete package-only worker evidence", () => {
    const installedRoot = path.resolve("C:/owned/npm-prefix/node_modules/chat2codex");
    const value = { ...completeWorkerEvidence(), packageRoot: installedRoot, repetitions: completeWorkerEvidence().repetitions.slice(0, 1) };
    const expected = { installedRoot, packageVersion: "0.8.0-novice.1", archiveSha256: "b".repeat(64), expectedRepetitions: 1, expectedScenarioIds: value.scenarioIds };
    expect(validateNoviceWorkerEvidence(value, expected)).toEqual(value);
    for (const change of [{ repositoryImported: true }, { archiveSha256: "f".repeat(64) }, { outboxCount: 2 }, { gatewayFailClosed: false }, { migrationBackupExact: false }, { nativeLifecycle: { ...value.nativeLifecycle, residualOwnedFiles: 1 } }]) expect(() => validateNoviceWorkerEvidence({ ...value, ...change }, expected)).toThrow(/worker|archive|package|evidence|lifecycle/i);
  });

  test("builds qualifying evidence only from thirty complete installed-package repetitions", () => {
    const worker = completeWorkerEvidence();
    const input = {
      authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97", repositoryCommit: "a".repeat(40),
      environmentKind: "clean_windows_vm", archive: { version: "0.8.0-novice.1", size: 1234, sha256: "b".repeat(64) },
      versions: { windows: "11.0.26100", node: "24.14.0", npm: "11.0.0", bun: "1.3.9", package: "0.8.0-novice.1", codexCli: "0.146.0" }, expectedScenarioIds: worker.scenarioIds,
      expectedScenarioDefinitions: worker.scenarioExecutions.map((item: any) => ({ id: item.scenarioId, preconditions: item.preconditions, actions: item.actions, expectedPromptCodes: item.promptCodes, invariants: item.invariants, faults: item.faults, recovery: item.recovery, requiredProbes: item.probes })),
      attestation: qualifyingAttestation(), realUpgrade: { ...qualifyingRealUpgrade(), configSha256: "9".repeat(64), finalConfigSha256: "9".repeat(64), oldRepositoryCommit: "47c2272faf764904a5c8cba903b05b679b20a0cb" },
    };
    const value = buildQualifyingNoviceEvidence({ ...input, worker });
    expect(value).toMatchObject({ evidenceLevel: "isolated_package", verdict: "pass" });
    expect(value.repetitions).toHaveLength(30);
    expect(value.failureHistory).toContainEqual({
      repetition: 6, code: "preinstall_restart_probe_shell_polling", fixedByCommit: "7b0d1e0f213572eaebb98d7688ea5aeced8f5195",
    });
    for (const change of [
      { probes: { ...worker.probes, doctor: false } },
      { scenarioIds: worker.scenarioIds.slice(1) },
      { repetitions: worker.repetitions.slice(1) },
    ]) expect(() => buildQualifyingNoviceEvidence({ ...input, worker: { ...worker, ...change } })).toThrow(/probe|scenario|30|repetition/i);
    expect(() => buildQualifyingNoviceEvidence({ ...input, attestation: qualifyingAttestation({ archiveSha256: "f".repeat(64) }), worker })).toThrow(/archive|attestation|binding/i);
    expect(() => buildQualifyingNoviceEvidence({ ...input, attestation: qualifyingAttestation({ repositoryCommit: "f".repeat(40) }), worker })).toThrow(/commit|attestation|binding/i);
  });

  test("rejects qualifying attestation package hashes that do not match the runner package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-attestation-hash-"));
    const file = path.join(root, "attestation.json");
    await writeFile(file, JSON.stringify({ environmentKind: "clean_windows_vm", installedFiles: [{ path: "package/package.json", sha256: "0".repeat(64) }] }));
    try {
      await expect(readNoviceAttestation(file, "clean_windows_vm", path.resolve(import.meta.dir, ".."))).rejects.toThrow(/hash.*differs/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

function completeWorkerEvidence() {
  const definitions = requireScenarioDefinitions();
  const scenarioIds = definitions.map((item: any) => item.id).sort();
  const scenarioExecutions = definitions.map((item: any) => ({ scenarioId: item.id, verdict: "pass", preconditions: item.preconditions, actions: item.actions, promptCodes: item.expectedPromptCodes, invariants: item.invariants, faults: item.faults, recovery: item.recovery, probes: item.requiredProbes, productProofs: proofSources(item.id).map((source) => ({ source, sha256: "7".repeat(64) })) })).sort((left: any, right: any) => left.scenarioId.localeCompare(right.scenarioId));
  return {
    packageRoot: path.resolve("C:/owned/npm-prefix/node_modules/chat2codex"), packageVersion: "0.8.0-novice.1", archiveSha256: "b".repeat(64), runIdentityHash: "5".repeat(64), ownedEnvironmentHash: "6".repeat(64),
    repositoryImported: false, cliVersion: "0.8.0-novice.1", manifestHash: "c".repeat(64), stateHash: "d".repeat(64),
    taskCount: 2, outboxCount: 3, networkRecovered: true, gatewayFailClosed: true, migrationBackupExact: true,
    nativeLifecycle: { installAttempts: 2, uninstallAttempts: 2, keyCount: 3, userDataPreserved: true, residualOwnedFiles: 0 },
    probes: { setupQrMock: true, doctor: true, lifecycle: true, dailyUse: true, upgradeRollback: true, networkRecovery: true, gatewayFailClosed: true, restartRecovery: true, storagePermissionRecovery: true, purgeUnavailableWithoutConfirmation: true, configRecovery: true, gatewayOffline: true },
    scenarioIds, scenarioExecutions,
    repetitions: Array.from({ length: 30 }, (_, offset) => ({ index: offset + 1, seed: 2026080201 + offset, startedAt: "2026-08-03T00:00:00.000Z", completedAt: "2026-08-03T00:00:01.000Z", verdict: "pass", counts: { pass: 19, fail: 0, skip: 0, timeout: 0, residualProcesses: 0 }, scenarioIds, scenarioExecutions, stateHashes: ["e".repeat(64)], commands: ["<installed-package>/scripts/novice-windows-worker.mjs"], processProof: { pid: 300 + offset, createdAt: "2026-08-03T00:00:00.500Z", stopped: true, residualProcesses: 0 } })),
  };
}
function requireScenarioDefinitions(): any[] { return JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "quality", "scenarios", "novice-daily-use.json"), "utf8")); }
function proofSources(id: string): string[] { const values: Record<string,string[]> = { "fresh.download-and-prerequisites":["archive_identity"],"fresh.setup-and-doctor":["setup_doctor"],"fresh.service-lifecycle":["native_lifecycle"],"fresh.task-control":["daily_use"],"fresh.media-roundtrip":["daily_use"],"fresh.multi-task-workspace-plan":["daily_use"],"fresh.approval-permission-structured":["daily_use"],"fresh.uninstall-and-reinstall":["native_lifecycle"],"fresh.purge-confirmation":["purge_surface"],"upgrade.idempotent-install-upgrade":["native_lifecycle","upgrade_rollback"],"upgrade.schema-migration":["upgrade_rollback"],"upgrade.rollback-and-resume":["upgrade_rollback"],"recovery.configuration-and-schema":["setup_doctor","schema_failure"],"recovery.network-and-gateway-offline":["network_recovery","gateway_recovery","gateway_offline"],"recovery.duplicate-and-reordered-message":["daily_use","network_recovery"],"recovery.process-and-interruption":["restart_recovery"],"recovery.disk-and-permission":["storage_permission"],"recovery.gateway-token-generation":["gateway_recovery"],"recovery.unbound-and-child-exclusion":["gateway_recovery"] }; return values[id] ?? []; }

function qualifyingAttestation(change: Record<string, unknown> = {}) {
  const installedFiles = ["package/package.json", "package/dist/index.js", "package/scripts/novice-service-probe.mjs", "owned/.env", "owned/.service/windows/launcher.ps1", "owned/.service/windows/task.xml", "owned/.service/windows/installation.json", "owned/.data/state.json"].map((filePath, index) => ({ path: filePath, sha256: String(index + 1).repeat(64) }));
  const value = { environmentKind: "equivalent_isolated_windows", githubActions: true, runnerEnvironment: "github-hosted", freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true, realUserCodexHomeUntouched: true, productionUntouched: true, archiveSha256: "b".repeat(64), repositoryCommit: "a".repeat(40), runIdentityHash: "5".repeat(64), ownedEnvironmentHash: "6".repeat(64), taskNameHash: "1".repeat(64), installAttempts: 3, startAttempts: 2, stopAttempts: 2, uninstallAttempts: 3, doctorExitCode: 0, doctorDeferredCodes: [], singleWriter: true, lockHealthy: true, userDataPreserved: true, firstProcess: { pid: 101, createdAt: "2026-08-03T00:00:00.000Z", commandHash: "2".repeat(64), stateSha256: "3".repeat(64) }, secondProcess: { pid: 102, createdAt: "2026-08-03T00:01:00.000Z", commandHash: "4".repeat(64), stateSha256: "3".repeat(64) }, taskRemoved: true, newKeysAfterReinstall: true, anotherInteractiveUserDenied: true, zeroResidualProcesses: true, ownedRootRemoved: true, installedFiles, commands: Array.from({ length: 8 }, (_, index) => "command-" + index), ...change };
  value.oldArchiveSha256 = "f".repeat(64);
  value.oldRepositoryCommit = "47c2272faf764904a5c8cba903b05b679b20a0cb";
  return { ...value, attestationHash: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
function qualifyingRealUpgrade() { return { oldArchiveSha256: "f".repeat(64), candidateArchiveSha256: "b".repeat(64), oldVersion: "0.8.0-orchestrator.4", candidateVersion: "0.8.0-novice.1", ownedEnvironmentHash: "6".repeat(64), runIdentityHash: "5".repeat(64), installAttempts: 2, upgradeAttempts: 2, rollbackAttempts: 2, uninstallAttempts: 2, reinstallAttempts: 2, sourceSchema: 5, migratedSchema: 6, rollbackSchema: 5, finalSchema: 6, sourceStateSha256: "1".repeat(64), backupStateSha256: "1".repeat(64), rollbackStateSha256: "1".repeat(64), taskIds: ["task-existing"], deliveredIds: ["out-delivered"], pendingIds: ["out-pending"], finalTaskIds: ["task-existing"], finalDeliveredIds: ["out-delivered"], finalPendingIds: ["out-pending"], finalPackageVersion: "0.8.0-novice.1", userDataPreserved: true, commands: ["install old","install candidate","uninstall"], residualProcesses: 0 }; }

async function withArchive(run: (value: { root: string; archive: string; sha256: string }) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-isolation-"));
  const archive = path.join(root, "chat2codex-test.tgz");
  const bytes = Buffer.from("synthetic archive bytes");
  await writeFile(archive, bytes);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  try { await run({ root, archive, sha256 }); } finally { await rm(root, { recursive: true, force: true }); }
}
