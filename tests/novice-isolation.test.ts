import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { planNoviceIsolation, planNpmInvocation, runNoviceArchiveAcceptance, validateNoviceWorkerEvidence } from "../scripts/run-novice-acceptance.mjs";

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
    const value = { packageRoot: installedRoot, packageVersion: "0.8.0-novice.1", repositoryImported: false, cliVersion: "0.8.0-novice.1", manifestHash: "a".repeat(64), stateHash: "b".repeat(64), taskCount: 2, outboxCount: 3, networkRecovered: true, gatewayFailClosed: true, migrationBackupExact: true, nativeLifecycle: { installAttempts: 2, uninstallAttempts: 2, keyCount: 3, userDataPreserved: true, residualOwnedFiles: 0 } };
    expect(validateNoviceWorkerEvidence(value, { installedRoot, packageVersion: "0.8.0-novice.1" })).toEqual(value);
    for (const change of [{ repositoryImported: true }, { outboxCount: 2 }, { gatewayFailClosed: false }, { migrationBackupExact: false }, { nativeLifecycle: { ...value.nativeLifecycle, residualOwnedFiles: 1 } }]) expect(() => validateNoviceWorkerEvidence({ ...value, ...change }, { installedRoot, packageVersion: "0.8.0-novice.1" })).toThrow(/worker|package|evidence|lifecycle/i);
  });
});

async function withArchive(run: (value: { root: string; archive: string; sha256: string }) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-isolation-"));
  const archive = path.join(root, "chat2codex-test.tgz");
  const bytes = Buffer.from("synthetic archive bytes");
  await writeFile(archive, bytes);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  try { await run({ root, archive, sha256 }); } finally { await rm(root, { recursive: true, force: true }); }
}
