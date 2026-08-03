import { describe, expect, test } from "bun:test";

import { diagnoseWindowsDistribution, type DistributionDoctorSnapshot } from "../src/setup/distribution-doctor.js";

const good: DistributionDoctorSnapshot = {
  platform: "win32", arch: "x64", windowsVersion: "10.0.26100", packageVersion: "0.8.0-desktop.2",
  dependencies: {
    powershell: { available: true, version: "5.1.26100.1", compatible: true },
    node: { available: true, version: "24.14.0", compatible: true },
    npm: { available: true, version: "11.9.0", compatible: true },
    codexCli: { available: true, version: "0.146.0", compatible: true },
  },
  manifest: { packageVersion: "0.8.0-desktop.2", schemaVersion: 1, taskName: "Chat2Codex", launcherPath: "C:\\Users\\Example\\.chat2codex\\.service\\windows\\launcher.ps1" },
  task: { exists: true, taskName: "Chat2Codex", launcherPath: "C:\\Users\\Example\\.chat2codex\\.service\\windows\\launcher.ps1" },
  process: { writers: 1, lockHealthy: true }, stateSchemaVersion: 6, loopbackHost: "127.0.0.1",
  keys: ["prompt_hook", "stop_hook", "desktop_mcp"].map((role, index) => ({ role, path: `C:\\Users\\Example\\.chat2codex\\.secrets\\${index}.key`, formatValid: true, aclValid: true, fingerprint: `fp-${index}` })),
  hooks: { expectedHashesMatch: true, installedHashesMatch: true, mcpConfigured: true }, desktop: { available: true, version: "26.801" },
  weixin: { configured: true, credentialReadable: true, privateChatBoundary: true }, rollbackReceipt: { pending: false },
};

describe("Windows distribution doctor", () => {
  test("accepts a coherent installed snapshot without exposing key identity", () => {
    const checks = diagnoseWindowsDistribution(good);
    expect(checks.every((check) => check.status !== "error")).toBe(true);
    const codes = checks.map((check) => check.code);
    for (const code of ["DIST_PLATFORM_OK", "DIST_POWERSHELL_OK", "DIST_NODE_OK", "DIST_NPM_OK", "DIST_CODEX_OK", "DIST_TASK_OK", "DIST_KEYS_OK", "DIST_WRITER_OK", "DIST_LOOPBACK_OK", "DIST_WEIXIN_OK", "DIST_ROLLBACK_CLEAR"]) expect(codes).toContain(code);
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
    ["PowerShell missing", (value: DistributionDoctorSnapshot) => { value.dependencies!.powershell.available = false; }, "DIST_POWERSHELL_MISSING"],
    ["Node incompatible", (value: DistributionDoctorSnapshot) => { value.dependencies!.node.compatible = false; }, "DIST_NODE_UNSUPPORTED"],
    ["npm missing", (value: DistributionDoctorSnapshot) => { value.dependencies!.npm.available = false; }, "DIST_NPM_MISSING"],
    ["Codex incompatible", (value: DistributionDoctorSnapshot) => { value.dependencies!.codexCli.compatible = false; }, "DIST_CODEX_UNSUPPORTED"],
    ["installed Hook drift", (value: DistributionDoctorSnapshot) => { value.hooks!.installedHashesMatch = false; }, "DIST_INSTALLED_HOOK_DRIFT"],
    ["MCP absent", (value: DistributionDoctorSnapshot) => { value.hooks!.mcpConfigured = false; }, "DIST_MCP_UNCONFIGURED"],
    ["Weixin not configured", (value: DistributionDoctorSnapshot) => { value.weixin!.configured = false; }, "DIST_WEIXIN_NOT_CONFIGURED"],
    ["Weixin private boundary absent", (value: DistributionDoctorSnapshot) => { value.weixin!.privateChatBoundary = false; }, "DIST_WEIXIN_BOUNDARY_INVALID"],
    ["pending rollback receipt", (value: DistributionDoctorSnapshot) => { value.rollbackReceipt = { pending: true, status: "rollback_failed" }; }, "DIST_ROLLBACK_PENDING"],
  ] as const) {
    test(`fails closed for ${name}`, () => {
      const value = structuredClone(good); mutate(value);
      const check = diagnoseWindowsDistribution(value).find((item) => item.code === code);
      expect(check).toEqual(expect.objectContaining({ status: "error", code, what_happened: expect.any(String), safe_state: expect.any(String), next_action: expect.any(String) }));
      expect(check?.detail).toBe(check?.what_happened);
      expect(check?.recovery).toBe(check?.next_action);
      const rendered = JSON.stringify(check);
      expect(rendered).not.toMatch(/C:\\Users|S-1-|token-value|prompt body|weixin-account|secret/i);
    });
  }

  test("uses actionable redacted error fields instead of raw paths identities or prompts", () => {
    const value = structuredClone(good);
    value.manifest!.packageVersion = "C:\\Users\\Alice\\token-value prompt body";
    value.task!.launcherPath = "C:\\Users\\Alice\\secret.ps1";
    value.keys![0]!.path = "C:\\Users\\Alice\\identity.key";
    const errors = diagnoseWindowsDistribution(value).filter((item) => item.status === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const check of errors) {
      expect(Object.keys(check).sort()).toEqual(["code", "detail", "label", "next_action", "recovery", "safe_state", "status", "what_happened"]);
      expect(JSON.stringify(check)).not.toMatch(/C:\\Users|Alice|token-value|prompt body|weixin-account|S-1-/i);
    }
  });

  test("reports an absent installation as a warning for foreground/source use", () => {
    const checks = diagnoseWindowsDistribution({ platform: "win32", arch: "x64", windowsVersion: "10.0", packageVersion: "0.8.0", manifest: null });
    expect(checks).toContainEqual(expect.objectContaining({ status: "warn", code: "DIST_NOT_INSTALLED" }));
    expect(checks).not.toContainEqual(expect.objectContaining({ code: "DIST_TASK_DRIFT" }));
  });
});
