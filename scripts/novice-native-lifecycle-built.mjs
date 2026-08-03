import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFreshWindowsLifecycleJourney, validateFreshWindowsLifecycleResult } from "../dist/quality/novice-product-driver.js";
import { nativeLifecycleFailure } from "../dist/quality/novice-native-diagnostics.js";

if (process.platform !== "win32") throw new Error("Native novice lifecycle requires Windows.");
const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-native-"));
const statePath = path.join(root, "profile", ".chat2codex", ".data", "state.json");
const userData = "synthetic novice state\n";
let stage = "setup";
let failure;
let cleanup = { attempted: false, succeeded: false };
let summary;
try {
  stage = "journey";
  const value = validateFreshWindowsLifecycleResult(await runFreshWindowsLifecycleJourney({ root, seedState: userData, stopAfterDoubleUninstall: true }));
  stage = "state-check";
  if (await readFile(statePath, "utf8") !== userData) throw new Error("Native novice lifecycle changed user data bytes.");
  summary = { installAttempts: value.installAttempts, uninstallAttempts: value.uninstallAttempts, uninstallNoopCount: value.uninstallNoopCount, createdKeyCount: value.createdKeyCount, preservedKeyCount: value.preservedKeyCount, distinctKeyFingerprints: value.distinctKeyFingerprints, taskCreateCount: value.taskCreateCount, taskDeleteCount: value.taskDeleteCount, userDataPreserved: value.userDataPreserved, residualOwnedFiles: value.residualOwnedFiles.length };
  process.stdout.write("NATIVE_LIFECYCLE_PASS " + JSON.stringify(summary) + "\n1 pass\n0 fail\n");
} catch (error) { failure = nativeLifecycleFailure(stage, error); }
finally { cleanup.attempted = true; try { await rm(root, { recursive: true, force: true }); cleanup.succeeded = true; } catch (error) { failure ??= nativeLifecycleFailure("cleanup", error); } }
const reportPath = process.env.C2C_NATIVE_LIFECYCLE_REPORT;
if (reportPath) {
  const report = { schemaVersion: 1, verdict: failure ? "fail" : "pass", summary: summary ?? null, failure: failure ?? null, cleanup };
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  const temporary = path.resolve(reportPath) + ".tmp-" + process.pid;
  await writeFile(temporary, JSON.stringify(report) + "\n", { flag: "wx" });
  await rename(temporary, path.resolve(reportPath));
}
if (failure) { process.stderr.write("NATIVE_LIFECYCLE_FAIL " + JSON.stringify({ failure, cleanup }) + "\n"); process.exitCode = 1; }
