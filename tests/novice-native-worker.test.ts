import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");

describe("native lifecycle limited-token worker diagnostics", () => {
  test("writes a bounded report when Node is unavailable", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-native-worker-"));
    try {
      const report = path.join(temporary, "result.json");
      const identity = path.join(temporary, "identity.json");
      const result = Bun.spawnSync([
        "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts", "novice-native-lifecycle-worker.ps1"),
        "-NodeBin", path.join(temporary, "missing-node.exe"),
        "-LifecycleScript", path.join(root, "scripts", "novice-native-lifecycle-built.mjs"),
        "-OwnedRoot", path.join(temporary, "owned"), "-ProfilePath", path.join(temporary, "profile"),
        "-ReportPath", report, "-IdentityReportPath", identity,
      ], { stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
      const value = JSON.parse(await readFile(report, "utf8"));
      expect(value).toEqual({ schemaVersion: 1, verdict: "fail", summary: null, failure: { stage: "worker/node_check", exceptionType: "ProcessFailure", code: "NODE_MISSING", errno: null, hResult: null }, cleanup: { attempted: false, succeeded: false } });
      expect(JSON.stringify(value)).not.toContain(temporary);
      const identityValue = JSON.parse(await readFile(identity, "utf8"));
      expect(identityValue).toEqual({ schemaVersion: 1, sidHash: expect.stringMatching(/^[a-f0-9]{64}$/u), administrator: expect.any(Boolean) });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
