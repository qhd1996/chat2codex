import { expect, test } from "bun:test";

import { validateRealUpgradeEvidence } from "../scripts/novice-real-upgrade-probe.mjs";

test("requires a hash-bound real old-package upgrade, rollback, uninstall, and reinstall chain", () => {
  const value = validUpgrade();
  value.oldRepositoryCommit = "47c2272faf764904a5c8cba903b05b679b20a0cb";
  expect(validateRealUpgradeEvidence(value, {
    oldArchiveSha256: "a".repeat(64), candidateArchiveSha256: "b".repeat(64),
    oldVersion: "0.8.0-orchestrator.4", candidateVersion: "0.8.0-novice.19",
    ownedEnvironmentHash: "c".repeat(64), runIdentityHash: "d".repeat(64),
  })).toEqual(value);
  expect(() => validateRealUpgradeEvidence({ ...value, unexpected: true }, {
    oldArchiveSha256: "a".repeat(64), candidateArchiveSha256: "b".repeat(64),
    oldVersion: "0.8.0-orchestrator.4", candidateVersion: "0.8.0-novice.19",
    ownedEnvironmentHash: "c".repeat(64), runIdentityHash: "d".repeat(64),
  })).toThrow(/unknown|field/i);
  for (const mutate of [
    (v: any) => { v.oldArchiveSha256 = "e".repeat(64); },
    (v: any) => { v.upgradeAttempts = 1; },
    (v: any) => { v.rollbackAttempts = 1; },
    (v: any) => { v.uninstallAttempts = 1; },
    (v: any) => { v.reinstallAttempts = 1; },
    (v: any) => { v.sourceStateSha256 = "e".repeat(64); },
    (v: any) => { v.finalPendingIds = []; },
    (v: any) => { v.residualProcesses = 1; },
  ]) { const candidate = validUpgrade(); mutate(candidate); expect(() => validateRealUpgradeEvidence(candidate, { oldArchiveSha256: "a".repeat(64), candidateArchiveSha256: "b".repeat(64), oldVersion: "0.8.0-orchestrator.4", candidateVersion: "0.8.0-novice.19", ownedEnvironmentHash: "c".repeat(64), runIdentityHash: "d".repeat(64) })).toThrow(/upgrade|rollback|uninstall|reinstall|hash|pending|residual/i); }
});

function validUpgrade() {
  return {
    oldArchiveSha256: "a".repeat(64), candidateArchiveSha256: "b".repeat(64), oldVersion: "0.8.0-orchestrator.4", candidateVersion: "0.8.0-novice.19",
    ownedEnvironmentHash: "c".repeat(64), runIdentityHash: "d".repeat(64), installAttempts: 2, upgradeAttempts: 2, rollbackAttempts: 2, uninstallAttempts: 2, reinstallAttempts: 2,
    configSha256: "9".repeat(64), finalConfigSha256: "9".repeat(64),
    sourceSchema: 5, migratedSchema: 6, rollbackSchema: 5, finalSchema: 6, sourceStateSha256: "1".repeat(64), backupStateSha256: "1".repeat(64), rollbackStateSha256: "1".repeat(64),
    taskIds: ["task-existing"], deliveredIds: ["out-delivered"], pendingIds: ["out-pending"], finalTaskIds: ["task-existing"], finalDeliveredIds: ["out-delivered"], finalPendingIds: ["out-pending"],
    finalPackageVersion: "0.8.0-novice.19", userDataPreserved: true, commands: ["npm install <old-archive>", "npm install <candidate-archive>", "npm uninstall chat2codex"], residualProcesses: 0,
  };
}
