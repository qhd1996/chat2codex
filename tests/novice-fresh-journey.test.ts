import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { runFreshWindowsLifecycleJourney, validateFreshWindowsLifecycleResult, type FreshWindowsLifecycleResult } from "../src/quality/novice-product-driver.js";

const valid: FreshWindowsLifecycleResult = {
  evidenceLevel: "repository", taskRegistration: "simulated", installAttempts: 2, uninstallAttempts: 2,
  uninstallNoopCount: 1, createdKeyCount: 3, preservedKeyCount: 3, distinctKeyFingerprints: 3,
  taskCreateCount: 2, taskDeleteCount: 1, userDataPreserved: true, residualOwnedFiles: [],
};

describe("fresh novice native lifecycle result contract", () => {
  test.skipIf(process.platform !== "win32")("accepts a temporary root whose lexical path is a runner alias", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-native-root-"));
    try {
      await expect(runFreshWindowsLifecycleJourney({ root, seedState: "synthetic novice state\n", stopAfterDoubleUninstall: true })).resolves.toMatchObject({
        createdKeyCount: 3, preservedKeyCount: 3, userDataPreserved: true, residualOwnedFiles: [],
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("requires double-idempotent lifecycle, three distinct keys, preserved data, and no residual", () => {
    expect(validateFreshWindowsLifecycleResult(valid)).toEqual(valid);
  });

  for (const [name, change] of [
    ["one install", { installAttempts: 1 }], ["one uninstall", { uninstallAttempts: 1 }],
    ["missing noop", { uninstallNoopCount: 0 }], ["missing key", { createdKeyCount: 2 }],
    ["key drift", { preservedKeyCount: 2 }], ["duplicate key", { distinctKeyFingerprints: 2 }],
    ["task drift", { taskCreateCount: 1 }], ["extra delete", { taskDeleteCount: 2 }],
    ["data loss", { userDataPreserved: false }], ["residual", { residualOwnedFiles: ["owned"] }],
  ] as const) test("rejects " + name, () => {
    expect(() => validateFreshWindowsLifecycleResult({ ...valid, ...change })).toThrow(/lifecycle|key|task|data|residual/i);
  });
});
