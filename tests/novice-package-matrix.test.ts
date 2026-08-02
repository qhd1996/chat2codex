import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { runNovicePackageRepetition } from "../src/quality/novice-package-matrix.js";

test("executes every packaged novice scenario through its required product probes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-package-matrix-"));
  try {
    const result = await runNovicePackageRepetition({
      root,
      packageRoot: path.resolve(import.meta.dir, ".."),
      packageVersion: "0.8.0-novice.1",
      cliVersion: "0.8.0-novice.1",
      archiveVerified: true,
      restartProbePath: path.resolve(import.meta.dir, "..", "scripts", "novice-restart-probe.mjs"),
      restartRunner: async () => ({ recovered: true, codexRuns: 1, stateHash: "f".repeat(64), processProof: { pid: 321, createdAt: "2026-08-03T00:00:00.000Z", stopped: true, residualProcesses: 0 } }),
      lifecycleRunner: async () => ({ evidenceLevel: "repository", taskRegistration: "simulated", installAttempts: 2, uninstallAttempts: 2, uninstallNoopCount: 1, createdKeyCount: 3, preservedKeyCount: 3, distinctKeyFingerprints: 3, taskCreateCount: 2, taskDeleteCount: 1, userDataPreserved: true, residualOwnedFiles: [] }),
    });
    expect(result.scenarioIds).toHaveLength(19);
    expect(result.counts).toEqual({ pass: 19, fail: 0, skip: 0, timeout: 0, residualProcesses: 0 });
    expect(result.probes).toMatchObject({
      setupQrMock: true,
      doctor: true,
      lifecycle: true,
      dailyUse: true,
      upgradeRollback: true,
      networkRecovery: true,
      gatewayFailClosed: true,
      restartRecovery: true,
      storagePermissionRecovery: true,
      purgeUnavailableWithoutConfirmation: true,
      configRecovery: true,
      gatewayOffline: true,
    });
    expect(result.stateHashes.length).toBeGreaterThanOrEqual(3);
    expect(result.product).toMatchObject({
      taskCount: 2,
      outboxCount: 3,
      networkRecovered: true,
      gatewayFailClosed: true,
      migrationBackupExact: true,
      nativeLifecycle: { installAttempts: 2, uninstallAttempts: 2, keyCount: 3, userDataPreserved: true, residualOwnedFiles: 0 },
    });
    expect(result.processProof).toEqual({ pid: 321, createdAt: "2026-08-03T00:00:00.000Z", stopped: true, residualProcesses: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
