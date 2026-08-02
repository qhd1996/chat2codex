import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stagePhase3CodexHome } from "../scripts/stage-phase3-codex-home.mjs";

const root = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))); });

describe("Phase 3 pre-install assets", () => {
  test("ships Hook clients, inert Codex configuration, runbooks, and a verified SHA-256 manifest", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.files).toContain("scripts/codex-hooks");
    expect(packageJson.files).toContain("scripts/stage-phase3-codex-home.mjs");
    expect(packageJson.files).toContain("scripts/generate-phase3-temp-codex-home.mjs");
    expect(packageJson.files).toContain("scripts/verify-phase3-temp-codex-home.mjs");
    expect(packageJson.files).toContain("docs/phase3");

    const manifest = JSON.parse(await readFile(path.join(root, "docs/phase3/hook-sha256.json"), "utf8"));
    expect(manifest.algorithm).toBe("SHA-256");
    expect(manifest.installation_status).toBe("UNTRUSTED_UNTIL_TASK_12_APPROVAL");
    expect(Object.keys(manifest.files).sort()).toEqual([
      "scripts/codex-hooks/hook-client.mjs",
      "scripts/codex-hooks/stop-wake.mjs",
      "scripts/codex-hooks/user-prompt-submit.mjs",
    ]);
    for (const [relativePath, expected] of Object.entries<string>(manifest.files)) {
      const bytes = await readFile(path.join(root, relativePath));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }

    const hooks = JSON.parse(await readFile(path.join(root, "docs/phase3/codex-hooks.example.json"), "utf8"));
    expect(hooks.installation_status).toBe("INERT_EXAMPLE_ONLY");
    expect(hooks.hooks.SubagentStop).toBeUndefined();
    expect(Object.keys(hooks.hooks).sort()).toEqual(["Stop", "UserPromptSubmit"]);
    for (const groups of Object.values<any[]>(hooks.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks[0]).toMatchObject({ type: "command", async: false, timeoutSec: 3 });
      expect(groups[0].hooks[0].commandWindows).toContain("<ABSOLUTE_PACKAGE_PATH>");
      expect(groups[0].hooks[0].commandWindows).toContain("<ABSOLUTE_OWNER_ONLY_");
      expect(groups[0].hooks[0].commandWindows).toContain("<LOOPBACK_PORT>");
      expect(groups[0].hooks[0].commandWindows).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    }
    const mcp = await readFile(path.join(root, "docs/phase3/codex-mcp.example.toml"), "utf8");
    expect(mcp).toContain("enabled = false");
    expect(mcp).toContain('CHAT2CODEX_DESKTOP_GATEWAY_HOST = "127.0.0.1"');
    expect(mcp).toContain("<ABSOLUTE_OWNER_ONLY_TOKEN_FILE>");
  });

  test("stages only inert files into an explicit temporary Codex Home and refuses the real home", async () => {
    const container = await mkdtemp(path.join(os.tmpdir(), "chat2codex-phase3-home-")); temporaryRoots.push(container);
    const codexHome = path.join(container, "codex-home");
    const staged = await stagePhase3CodexHome({ packageRoot: root, codexHome, realCodexHome: path.join(container, "real-home") });

    expect(staged.codexHome).toBe(path.resolve(codexHome));
    expect(staged.enabled).toBe(false);
    expect(staged.created.sort()).toEqual([
      "phase3-staging/README.txt",
      "phase3-staging/config.phase3.toml",
      "phase3-staging/hook-sha256.json",
      "phase3-staging/hooks.phase3.json",
    ]);
    expect(await readFile(path.join(codexHome, "phase3-staging/README.txt"), "utf8")).toContain("NOT INSTALLED OR TRUSTED");
    expect(await readFile(path.join(codexHome, "phase3-staging/config.phase3.toml"), "utf8")).toContain("enabled = false");
    await expect(stagePhase3CodexHome({ packageRoot: root, codexHome, realCodexHome: path.join(container, "real-home") })).rejects.toThrow("staging target already exists");

    await expect(stagePhase3CodexHome({ packageRoot: root, codexHome: path.join(container, "real-home"), realCodexHome: path.join(container, "real-home") })).rejects.toThrow("refuses the real Codex Home");
    await expect(stagePhase3CodexHome({ packageRoot: root, codexHome: path.resolve(root, ".forbidden-home"), realCodexHome: path.join(container, "real-home") })).rejects.toThrow("operating-system temporary directory");
  });
});
