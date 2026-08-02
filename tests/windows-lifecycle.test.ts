import { describe, expect, test } from "bun:test";

import {
  parseWindowsInstallationManifest,
  planWindowsInstall,
  planWindowsUninstall,
  replaceManagedEnvBlock,
} from "../src/setup/windows-lifecycle.js";

const home = "C:\\Users\\Example\\.chat2codex";
const manifest = {
  schemaVersion: 1 as const, packageVersion: "0.8.0-desktop.2", taskName: "Chat2Codex",
  userSid: "S-1-5-21-1-2-3-1001", launcherPath: `${home}\\.service\\windows\\launcher.ps1`,
  envFile: `${home}\\.env`, keyFiles: ["prompt-hook.key", "stop-hook.key", "desktop-mcp.key"].map((name) => `${home}\\.secrets\\desktop-gateway\\${name}`),
  ownedFiles: [`${home}\\.service\\windows\\launcher.ps1`, `${home}\\.service\\windows\\task.xml`],
  hashes: { "launcher.ps1": "a".repeat(64) }, installedAt: "2026-08-02T14:00:00.000Z",
};

describe("managed Windows env block", () => {
  test("replaces only one marked block and preserves user lines byte-for-byte", () => {
    const source = "# user\r\nCUSTOM=value\r\n# BEGIN CHAT2CODEX WINDOWS MANAGED\r\nOLD=x\r\n# END CHAT2CODEX WINDOWS MANAGED\r\nTAIL=y\r\n";
    const output = replaceManagedEnvBlock(source, { CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE: `${home}\\prompt.key`, CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: "true" });
    expect(output).toStartWith("# user\r\nCUSTOM=value\r\n");
    expect(output).toEndWith("TAIL=y\r\n");
    expect(output.match(/BEGIN CHAT2CODEX WINDOWS MANAGED/gu)).toHaveLength(1);
    expect(output).toContain("CHAT2CODEX_DESKTOP_GATEWAY_ENABLED=true");
    expect(output.indexOf("CHAT2CODEX_DESKTOP_GATEWAY_ENABLED")).toBeLessThan(output.indexOf("CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE"));
    expect(() => replaceManagedEnvBlock(source + "# BEGIN CHAT2CODEX WINDOWS MANAGED\r\n", {})).toThrow(/managed block/i);
  });
});

describe("Windows installation manifest", () => {
  test("accepts the closed v1 shape and rejects unknown fields or escaping paths", () => {
    expect(parseWindowsInstallationManifest(manifest, home)).toEqual(manifest);
    expect(() => parseWindowsInstallationManifest({ ...manifest, extra: true }, home)).toThrow(/unknown/i);
    expect(() => parseWindowsInstallationManifest({ ...manifest, ownedFiles: ["C:\\outside.txt"] }, home)).toThrow(/outside|owned/i);
    expect(() => parseWindowsInstallationManifest({ ...manifest, hashes: { file: "bad" } }, home)).toThrow(/hash/i);
  });
});

describe("Windows lifecycle ordering", () => {
  test("writes and verifies owned files before registering the task", () => {
    const plan = planWindowsInstall({ home, manifest, hadPriorManifest: true });
    expect(plan.at(-1)).toEqual({ kind: "register_task", taskName: "Chat2Codex" });
    expect(plan.map((item) => item.kind)).toEqual([
      "backup_prior", "ensure_keys", "write_env", "write_launcher", "write_task_xml", "write_manifest", "verify_owned", "register_task",
    ]);
  });

  test("unregisters first and removes only owned service files and keys", () => {
    const plan = planWindowsUninstall(manifest, home);
    expect(plan[0]).toEqual({ kind: "unregister_task", taskName: "Chat2Codex" });
    const removed = plan.filter((item) => item.kind === "remove_owned").map((item) => item.path);
    expect(removed).toEqual([...manifest.ownedFiles, ...manifest.keyFiles]);
    expect(removed).not.toContain(manifest.envFile);
    expect(removed.some((item) => /state|logs/iu.test(item))).toBe(false);
    expect(plan.at(-1)).toEqual({ kind: "remove_managed_env", path: manifest.envFile });
  });
});
