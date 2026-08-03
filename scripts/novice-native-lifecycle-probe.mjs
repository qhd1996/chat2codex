import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runFreshWindowsLifecycleJourney, validateFreshWindowsLifecycleResult } from "../src/quality/novice-product-driver.ts";
import { nativeLifecycleFailure } from "../src/quality/novice-native-diagnostics.ts";

if (process.platform !== "win32") throw new Error("Native novice lifecycle probe requires Windows.");
const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-native-"));
const statePath = path.join(root, "profile", ".chat2codex", ".data", "state.json");
const userData = "synthetic novice state\n";
let stage = "setup";
let failure;
let cleanup = { attempted: false, succeeded: false };
try {
  stage = "journey";
  const result = validateFreshWindowsLifecycleResult(await runFreshWindowsLifecycleJourney({ root, seedState: userData, stopAfterDoubleUninstall: true }));
  stage = "state-check";
  if (await readFile(statePath, "utf8") !== userData) throw new Error("Native novice lifecycle changed user data bytes.");
  if (JSON.stringify(result).match(/[A-Za-z0-9_-]{43}/u)) throw new Error("Native novice lifecycle exposed key material.");
  process.stdout.write("NATIVE_LIFECYCLE_PASS " + JSON.stringify({
    installAttempts: result.installAttempts, uninstallAttempts: result.uninstallAttempts,
    uninstallNoopCount: result.uninstallNoopCount, createdKeyCount: result.createdKeyCount,
    preservedKeyCount: result.preservedKeyCount, distinctKeyFingerprints: result.distinctKeyFingerprints,
    taskCreateCount: result.taskCreateCount, taskDeleteCount: result.taskDeleteCount,
    userDataPreserved: result.userDataPreserved, residualOwnedFiles: result.residualOwnedFiles.length,
  }) + "\n1 pass\n0 fail\n");
} catch (error) {
  failure = nativeLifecycleFailure(stage, error);
} finally {
  cleanup.attempted = true;
  try { await rm(root, { recursive: true, force: true }); cleanup.succeeded = true; }
  catch (error) { failure ??= nativeLifecycleFailure("cleanup", error); }
}
if (failure) {
  process.stderr.write("NATIVE_LIFECYCLE_FAIL " + JSON.stringify({ failure, cleanup }) + "\n");
  process.exitCode = 1;
}
