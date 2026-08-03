import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { publicNativeLifecycleEvidence } from "../src/quality/native-lifecycle-workflow-evidence.js";

const root = path.resolve(import.meta.dir, "..");

async function runScript(name: string, reportPath: string, summaryPath: string) {
  return Bun.$`${process.execPath} ${path.join(root, "scripts", name)} ${reportPath}`
    .env({ ...process.env, GITHUB_STEP_SUMMARY: summaryPath })
    .quiet()
    .nothrow();
}

describe("native lifecycle workflow evidence", () => {
  test("fails closed when a pass report lacks qualifying summary or cleanup", () => {
    const invalid = "workflow_enforcement/report_invalid" as const;
    const qualifyingSummary = { installAttempts: 2, uninstallAttempts: 2, uninstallNoopCount: 1, createdKeyCount: 3, preservedKeyCount: 3, distinctKeyFingerprints: 3, taskCreateCount: 2, taskDeleteCount: 1, userDataPreserved: true, residualOwnedFiles: 0 };
    const cleanup = { attempted: true, succeeded: true, failure: null, residualUsers: 0, residualProcesses: 0, profileExists: false, ownedRootExists: false };
    const publicCleanup = { attempted: true, succeeded: true, residualUsers: 0, residualProcesses: 0, profileExists: false, ownedRootExists: false };
    expect(publicNativeLifecycleEvidence({ schemaVersion: 1, verdict: "pass", summary: null, failure: null, cleanup }, invalid).verdict).toBe("fail");
    expect(publicNativeLifecycleEvidence({ schemaVersion: 1, verdict: "pass", summary: qualifyingSummary, failure: null, cleanup: { ...cleanup, residualUsers: 1 } }, invalid).verdict).toBe("fail");
    expect(publicNativeLifecycleEvidence({ schemaVersion: 1, verdict: "pass", summary: qualifyingSummary, failure: { stage: "journey", code: "EACCES" }, cleanup }, invalid).verdict).toBe("fail");
    expect(publicNativeLifecycleEvidence({ schemaVersion: 1, verdict: "pass", summary: qualifyingSummary, failure: null, cleanup: { ...cleanup, failure: "profile_cleanup" } }, invalid).verdict).toBe("fail");
    expect(publicNativeLifecycleEvidence({ schemaVersion: 1, verdict: "pass", summary: qualifyingSummary, failure: null, cleanup }, invalid)).toEqual({ schemaVersion: 1, verdict: "pass", failure: null, cleanup: publicCleanup });
  });

  test("publishes only bounded stage and code and never fails the diagnostic chain", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-native-publish-"));
    try {
      const report = path.join(temporary, "report.json");
      const summary = path.join(temporary, "summary.md");
      await writeFile(report, JSON.stringify({ schemaVersion: 1, verdict: "fail", summary: null, failure: { stage: "standard_user_wrapper/root_create", code: "exit_5", secret: "token C:\\Users\\runneradmin" }, cleanup: { attempted: true, succeeded: true, residualUsers: 0, residualProcesses: 0, profileExists: false, ownedRootExists: false } }));
      const result = await runScript("publish-native-lifecycle-evidence.mjs", report, summary);
      expect(result.exitCode).toBe(0);
      const output = result.stdout.toString();
      expect(output).toContain("standard_user_wrapper/root_create");
      expect(output).toContain("exit_5");
      expect(output).not.toContain("runneradmin");
      expect(output).not.toContain("token");
      expect(JSON.parse(await readFile(summary, "utf8"))).toEqual({
        schemaVersion: 1, verdict: "fail", failure: { stage: "standard_user_wrapper/root_create", code: "exit_5" },
        cleanup: { attempted: true, succeeded: true, residualUsers: 0, residualProcesses: 0, profileExists: false, ownedRootExists: false },
      });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  test("publishes fixed missing and invalid fallbacks with exit zero", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-native-fallback-"));
    try {
      for (const [name, body, stage] of [["missing.json", undefined, "workflow_publication/report_missing"], ["invalid.json", "{secret", "workflow_publication/report_invalid"]] as const) {
        const report = path.join(temporary, name);
        const summary = path.join(temporary, name + ".md");
        if (body !== undefined) await writeFile(report, body);
        const result = await runScript("publish-native-lifecycle-evidence.mjs", report, summary);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain(stage);
        expect(result.stdout.toString()).not.toContain("secret");
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  test("publishes a fixed fallback and exits zero when summary writing fails", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-native-summary-"));
    try {
      const report = path.join(temporary, "report.json");
      await writeFile(report, JSON.stringify({ schemaVersion: 1, verdict: "fail", failure: { stage: "journey/file_acl_owner_read", code: "exit_86" }, cleanup: { attempted: true, succeeded: true } }));
      const result = await runScript("publish-native-lifecycle-evidence.mjs", report, temporary);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("workflow_publication/summary_write");
      expect(result.stdout.toString()).toContain('\"code\":\"unavailable\"');
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  test("enforcement prints bounded evidence before failing", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-native-enforce-"));
    try {
      const report = path.join(temporary, "report.json");
      await writeFile(report, JSON.stringify({ schemaVersion: 1, verdict: "fail", failure: { stage: "journey/file_acl_owner_read", code: "exit_86", secret: "prompt" }, cleanup: { attempted: true, succeeded: true } }));
      const result = await runScript("enforce-native-lifecycle-evidence.mjs", report, path.join(temporary, "unused.md"));
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain("NATIVE_LIFECYCLE_ENFORCE");
      expect(result.stdout.toString()).toContain("journey/file_acl_owner_read");
      expect(result.stdout.toString()).toContain("exit_86");
      expect(result.stdout.toString()).not.toContain("prompt");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
