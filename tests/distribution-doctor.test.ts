import { describe, expect, test } from "bun:test";

import { diagnoseWindowsDistribution, type DistributionDoctorSnapshot } from "../src/setup/distribution-doctor.js";

const good: DistributionDoctorSnapshot = {
  platform: "win32", arch: "x64", windowsVersion: "10.0.26100", packageVersion: "0.8.0-desktop.2",
  manifest: { packageVersion: "0.8.0-desktop.2", schemaVersion: 1, taskName: "Chat2Codex", launcherPath: "C:\\Users\\Example\\.chat2codex\\.service\\windows\\launcher.ps1" },
  task: { exists: true, taskName: "Chat2Codex", launcherPath: "C:\\Users\\Example\\.chat2codex\\.service\\windows\\launcher.ps1", lastResult: 0 },
  process: { writers: 1, lockHealthy: true }, stateSchemaVersion: 6, loopbackHost: "127.0.0.1",
  keys: ["prompt_hook", "stop_hook", "desktop_mcp"].map((role, index) => ({ role, path: `C:\\Users\\Example\\.chat2codex\\.secrets\\${index}.key`, formatValid: true, aclValid: true, fingerprint: `fp-${index}` })),
  hooks: { expectedHashesMatch: true }, desktop: { available: true, version: "26.801" },
};

describe("Windows distribution doctor", () => {
  test("accepts a coherent installed snapshot without exposing key identity", () => {
    const checks = diagnoseWindowsDistribution(good);
    expect(checks.every((check) => check.status !== "error")).toBe(true);
    const codes = checks.map((check) => check.code);
    for (const code of ["DIST_PLATFORM_OK", "DIST_TASK_OK", "DIST_KEYS_OK", "DIST_WRITER_OK", "DIST_LOOPBACK_OK"]) expect(codes).toContain(code);
    const rendered = JSON.stringify(checks);
    expect(rendered).not.toContain("fp-0");
    expect(rendered).not.toContain("secret");
  });

  for (const [name, mutate, code] of [
    ["unsupported architecture", (value: DistributionDoctorSnapshot) => { value.arch = "ia32"; }, "DIST_PLATFORM_UNSUPPORTED"],
    ["package drift", (value: DistributionDoctorSnapshot) => { value.manifest!.packageVersion = "0.7.0"; }, "DIST_PACKAGE_DRIFT"],
    ["task action drift", (value: DistributionDoctorSnapshot) => { value.task!.launcherPath = "C:\\wrong.ps1"; }, "DIST_TASK_DRIFT"],
    ["multiple writers", (value: DistributionDoctorSnapshot) => { value.process!.writers = 2; }, "DIST_WRITER_CONFLICT"],
    ["bad state schema", (value: DistributionDoctorSnapshot) => { value.stateSchemaVersion = 99; }, "DIST_SCHEMA_UNSUPPORTED"],
    ["broad key ACL", (value: DistributionDoctorSnapshot) => { value.keys![0]!.aclValid = false; }, "DIST_KEYS_INVALID"],
    ["duplicate key", (value: DistributionDoctorSnapshot) => { value.keys![1]!.fingerprint = value.keys![0]!.fingerprint; }, "DIST_KEYS_INVALID"],
    ["non-loopback host", (value: DistributionDoctorSnapshot) => { value.loopbackHost = "0.0.0.0"; }, "DIST_LOOPBACK_INVALID"],
    ["hook hash drift", (value: DistributionDoctorSnapshot) => { value.hooks!.expectedHashesMatch = false; }, "DIST_HOOK_HASH_DRIFT"],
  ] as const) {
    test(`fails closed for ${name}`, () => {
      const value = structuredClone(good); mutate(value);
      expect(diagnoseWindowsDistribution(value)).toContainEqual(expect.objectContaining({ status: "error", code }));
    });
  }

  test("reports an absent installation as a warning for foreground/source use", () => {
    const checks = diagnoseWindowsDistribution({ platform: "win32", arch: "x64", windowsVersion: "10.0", packageVersion: "0.8.0", manifest: null });
    expect(checks).toEqual([expect.objectContaining({ status: "warn", code: "DIST_NOT_INSTALLED" })]);
  });
});
