import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { personalPortableNativeInternals } from "../src/setup/personal-portable-native.js";

test("native lifecycle runner contains PowerShell cache inside its disposable root", async () => {
  const source = await readFile(path.resolve(import.meta.dir, "..", "scripts", "run-personal-portable-native-lifecycle.mjs"), "utf8");
  expect(source).toContain('PSModuleAnalysisCachePath: path.join(root, "powershell", "ModuleAnalysisCache")');
  expect(source).toContain('mkdir(path.join(profile, "AppData", "Local"), { recursive: true })');
  expect(source).toContain('invoke("Uninstall", null, true, false)');
});

describe("personal portable native filesystem boundary", () => {
  test("restores a named backup in a fresh process context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-native-"));
    const home = path.join(root, "home"); const prefix = path.join(home, "npm"); const envFile = path.join(home, ".env"); const stateFile = path.join(home, ".data", "state.json");
    try {
      await mkdir(prefix, { recursive: true }); await mkdir(path.dirname(stateFile), { recursive: true });
      await writeFile(path.join(prefix, "package.txt"), "old"); await writeFile(envFile, "old-env"); await writeFile(stateFile, "old-state");
      const context = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      const backup = await personalPortableNativeInternals.backupPrior(context);
      await writeFile(path.join(prefix, "package.txt"), "candidate"); await writeFile(envFile, "candidate-env"); await writeFile(stateFile, "candidate-state");
      const resumed = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      personalPortableNativeInternals.selectBackup(resumed, backup.backupId, backup);
      await personalPortableNativeInternals.restorePart(resumed, "package"); await personalPortableNativeInternals.restorePart(resumed, "config"); await personalPortableNativeInternals.restorePart(resumed, "state");
      expect(await readFile(path.join(prefix, "package.txt"), "utf8")).toBe("old"); expect(await readFile(envFile, "utf8")).toBe("old-env"); expect(await readFile(stateFile, "utf8")).toBe("old-state");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("keeps an online writer stopped after a successful snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-online-backup-"));
    const home = path.join(root, "home"); const prefix = path.join(home, "npm");
    try {
      await mkdir(prefix, { recursive: true });
      const context = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      let writers = 1; let starts = 0;
      context.serviceIo.countWriters = async () => writers;
      context.serviceIo.stopWriters = async () => { const stopped = writers; writers = 0; return stopped; };
      context.serviceIo.startAndVerifyTask = async () => { starts += 1; writers = 1; };
      const backup = await personalPortableNativeInternals.backupPrior(context);
      expect(backup.wasOnline).toBeTrue();
      expect(writers).toBe(0);
      expect(starts).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects negative writer enumeration before creating a backup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-writer-count-"));
    try {
      const home = path.join(root, "home"); const context = personalPortableNativeInternals.testContext({ home, npmPrefix: path.join(home, "npm"), receiptRoot: path.join(home, "receipts") });
      context.serviceIo.countWriters = async () => -1;
      await expect(personalPortableNativeInternals.backupPrior(context)).rejects.toThrow(/writer/i);
      expect(await personalPortableNativeInternals.treeHash(path.join(home, "backups"))).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects a tampered backup before deleting the current target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-tampered-backup-"));
    const home = path.join(root, "home"); const prefix = path.join(home, "npm");
    try {
      await mkdir(prefix, { recursive: true }); await writeFile(path.join(prefix, "package.txt"), "old");
      const context = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      const backup = await personalPortableNativeInternals.backupPrior(context);
      await writeFile(path.join(home, "backups", backup.backupId, "package", "package.txt"), "tampered");
      await writeFile(path.join(prefix, "package.txt"), "candidate");
      const resumed = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      personalPortableNativeInternals.selectBackup(resumed, backup.backupId, backup);
      await expect(personalPortableNativeInternals.restorePart(resumed, "package")).rejects.toThrow(/backup|hash|integrity/i);
      expect(await readFile(path.join(prefix, "package.txt"), "utf8")).toBe("candidate");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("normalizes an empty owned tree to an absent hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-empty-tree-"));
    try { expect(await personalPortableNativeInternals.treeHash(root)).toBeNull(); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects active obligations and malformed state before mutation", async () => {
    for (const value of [{ bad: true }, { schemaVersion: 6, adapters: { test: { pendingMessages: { p: {} }, outbox: {}, jobs: {}, tasks: {}, desktopGateway: { bindings: {} } } } }]) {
      await expect(personalPortableNativeInternals.assertQuiescentValue(value)).rejects.toThrow(/uncertain|pending|obligation/i);
    }
    await expect(personalPortableNativeInternals.assertQuiescentValue({ schemaVersion: 6, adapters: { test: { pendingMessages: {}, outbox: {}, jobs: {}, tasks: {}, desktopGateway: { bindings: {} } } } })).resolves.toBeUndefined();
  });

  test("rejects unknown private-prefix files before install or upgrade", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-prefix-")); const home = path.join(root, "home"); const prefix = path.join(home, "npm");
    try {
      await mkdir(prefix, { recursive: true }); await writeFile(path.join(prefix, "unknown.keep"), "user");
      const context = personalPortableNativeInternals.testContext({ home, npmPrefix: prefix, receiptRoot: path.join(home, "receipts") });
      await expect(personalPortableNativeInternals.assertPackagePrefixOwned(context)).rejects.toThrow(/unknown|ownership|manifest/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("retains only old key fingerprints for reinstall after uninstall", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-keys-")); const home = path.join(root, "home");
    try {
      const keyRoot = path.join(home, ".secrets", "desktop-gateway"); await mkdir(keyRoot, { recursive: true });
      for (const [name, value] of [["prompt-hook.key", "a"], ["stop-hook.key", "b"], ["desktop-mcp.key", "c"]]) await writeFile(path.join(keyRoot, name), value.repeat(43) + "\n");
      const fingerprints = await personalPortableNativeInternals.keyFingerprints(home); await personalPortableNativeInternals.writeLastKeyFingerprints(home, fingerprints); await rm(keyRoot, { recursive: true, force: true });
      expect(await personalPortableNativeInternals.keyFingerprintsOrLast(home)).toEqual(fingerprints);
      expect(JSON.stringify(await personalPortableNativeInternals.readLastKeyFingerprints(home))).not.toMatch(/a{43}|b{43}|c{43}/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
