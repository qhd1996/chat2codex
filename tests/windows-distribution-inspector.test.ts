import { describe, expect, test } from "bun:test";

import { inspectCodexConfigReferences, inspectPersonalWindowsEnvironment, type PersonalWindowsInspectionIo } from "../src/setup/windows-distribution-inspector.js";

describe("personal Windows environment inspector", () => {
  test("builds a redacted dependency Weixin Hook MCP and pending-receipt snapshot", async () => {
    const io: PersonalWindowsInspectionIo = {
      platform: () => "win32", architecture: () => "x64", windowsVersion: () => "10.0.26100", packageVersion: async () => "0.8.0-test.1",
      commandVersion: async (name) => ({ available: true, version: ({ powershell: "5.1.26100.1", node: "24.14.0", npm: "11.9.0", codex: "0.146.0" } as Record<string, string>)[name] }),
      expectedNodeRange: () => ">=20.19.0", expectedCodexVersion: () => "0.146.0",
      installation: async () => null, weixin: async () => ({ configured: true, credentialReadable: true, privateChatBoundary: true }),
      hooks: async () => ({ expectedHashesMatch: true, installedHashesMatch: false, mcpConfigured: false }),
      rollbackReceipt: async () => ({ pending: true, status: "rollback_failed" }),
    };
    const result = await inspectPersonalWindowsEnvironment("C:\\profile\\Chat2Codex", io);
    expect(result.dependencies).toEqual({
      powershell: { available: true, version: "5.1.26100.1", compatible: true }, node: { available: true, version: "24.14.0", compatible: true },
      npm: { available: true, version: "11.9.0", compatible: true }, codexCli: { available: true, version: "0.146.0", compatible: true },
    });
    expect(result.weixin).toEqual({ configured: true, credentialReadable: true, privateChatBoundary: true });
    expect(result.hooks).toEqual({ expectedHashesMatch: true, installedHashesMatch: false, mcpConfigured: false });
    expect(result.rollbackReceipt).toEqual({ pending: true, status: "rollback_failed" });
    expect(JSON.stringify(result)).not.toMatch(/token|credential-value|prompt body|S-1-|account-id/i);
  });

  test("fails dependency compatibility closed on missing or malformed versions", async () => {
    const io: PersonalWindowsInspectionIo = {
      platform: () => "win32", architecture: () => "x64", windowsVersion: () => "10", packageVersion: async () => "0.8.0",
      commandVersion: async (name) => name === "node" ? { available: true, version: "not-a-version" } : { available: false }, expectedNodeRange: () => ">=20.19.0", expectedCodexVersion: () => "0.146.0", installation: async () => null, weixin: async () => ({ configured: false, credentialReadable: false, privateChatBoundary: false }), hooks: async () => ({ expectedHashesMatch: false, installedHashesMatch: false, mcpConfigured: false }), rollbackReceipt: async () => ({ pending: false }),
    };
    const result = await inspectPersonalWindowsEnvironment("C:\\profile\\Chat2Codex", io);
    expect(result.dependencies?.node).toEqual({ available: true, compatible: false });
    expect(JSON.stringify(result)).not.toContain("not-a-version");
    expect(result.dependencies?.npm).toEqual({ available: false, compatible: false });
    expect(result.dependencies?.codexCli).toEqual({ available: false, compatible: false });
  });

  test("accepts only exact reviewed package Hook and MCP references", () => {
    const root = "C:\\portable\\npm\\node_modules\\chat2codex";
    const config = [
      "[[hooks.UserPromptSubmit]]", root.replaceAll("\\", "/") + "/scripts/codex-hooks/user-prompt-submit.mjs",
      "[[hooks.Stop]]", root.replaceAll("\\", "/") + "/scripts/codex-hooks/stop-wake.mjs",
      "[mcp_servers.chat2codex_desktop_gateway]", root.replaceAll("\\", "/") + "/dist/desktop-gateway/mcp.js",
    ].join("\n");
    expect(inspectCodexConfigReferences(config, root)).toEqual({ installedHashesMatch: true, mcpConfigured: true });
    expect(inspectCodexConfigReferences(config.replaceAll(root.replaceAll("\\", "/"), "C:/attacker/chat2codex"), root)).toEqual({ installedHashesMatch: false, mcpConfigured: false });
  });
});
