import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { runFreshWindowsLifecycleJourney } from "../src/quality/novice-product-driver.js";

describe("fresh novice Windows lifecycle journey", () => {
  test("installs and uninstalls twice without changing user data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-fresh-"));
    try {
      const statePath = path.join(root, "profile", ".chat2codex", ".data", "state.json");
      const userData = "synthetic novice state\n";
      const result = await runFreshWindowsLifecycleJourney({ root, seedState: userData, stopAfterDoubleUninstall: true });
      expect(result.evidenceLevel).toBe("repository");
      expect(result.taskRegistration).toBe("simulated");
      expect(result.installAttempts).toBe(2);
      expect(result.uninstallAttempts).toBe(2);
      expect(result.createdKeyCount).toBe(3);
      expect(result.preservedKeyCount).toBe(3);
      expect(result.distinctKeyFingerprints).toBe(3);
      expect(result.taskCreateCount).toBe(2);
      expect(result.taskDeleteCount).toBe(1);
      expect(result.userDataPreserved).toBe(true);
      expect(await readFile(statePath, "utf8")).toBe(userData);
      expect(result.residualOwnedFiles).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reinstalls twice from preserved user data without changing it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-reinstall-"));
    try {
      const result = await runFreshWindowsLifecycleJourney({ root, seedState: "preserved after uninstall\n", stopAfterDoubleUninstall: true });
      expect(result.installAttempts).toBe(2);
      expect(result.uninstallAttempts).toBe(2);
      expect(result.createdKeyCount).toBe(3);
      expect(result.preservedKeyCount).toBe(3);
      expect(result.userDataPreserved).toBe(true);
      expect(result.residualOwnedFiles).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("second uninstall is an exact no-op and never guesses an unknown task", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-uninstall-"));
    try {
      const result = await runFreshWindowsLifecycleJourney({ root, seedState: "durable\n", stopAfterDoubleUninstall: true });
      expect(result.uninstallAttempts).toBe(2);
      expect(result.taskDeleteCount).toBe(1);
      expect(result.uninstallNoopCount).toBe(1);
      expect(result.userDataPreserved).toBe(true);
      expect(result.residualOwnedFiles).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
