import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runFreshWindowsLifecycleJourney, validateFreshWindowsLifecycleResult } from "../src/quality/novice-product-driver.ts";

if (process.platform !== "win32") throw new Error("Native novice lifecycle probe requires Windows.");
const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-native-"));
const statePath = path.join(root, "profile", ".chat2codex", ".data", "state.json");
const userData = "synthetic novice state\n";
try {
  const result = validateFreshWindowsLifecycleResult(await runFreshWindowsLifecycleJourney({ root, seedState: userData, stopAfterDoubleUninstall: true }));
  if (await readFile(statePath, "utf8") !== userData) throw new Error("Native novice lifecycle changed user data bytes.");
  if (JSON.stringify(result).match(/[A-Za-z0-9_-]{43}/u)) throw new Error("Native novice lifecycle exposed key material.");
  process.stdout.write("NATIVE_LIFECYCLE_PASS " + JSON.stringify({
    installAttempts: result.installAttempts, uninstallAttempts: result.uninstallAttempts,
    uninstallNoopCount: result.uninstallNoopCount, createdKeyCount: result.createdKeyCount,
    preservedKeyCount: result.preservedKeyCount, distinctKeyFingerprints: result.distinctKeyFingerprints,
    taskCreateCount: result.taskCreateCount, taskDeleteCount: result.taskDeleteCount,
    userDataPreserved: result.userDataPreserved, residualOwnedFiles: result.residualOwnedFiles.length,
  }) + "\n1 pass\n0 fail\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
