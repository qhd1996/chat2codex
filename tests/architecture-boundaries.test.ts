import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const workspaceRoot = path.resolve(import.meta.dir, "..");

describe("architecture boundaries", () => {
  test("core never imports platform adapters or Lark SDK modules", async () => {
    const files = await typescriptFiles(path.join(workspaceRoot, "src/core"));
    const violations: string[] = [];
    const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]?.toLowerCase() ?? "";
        if (
          specifier.includes("/adapters/") ||
          specifier.includes("lark") ||
          specifier.includes("feishu") ||
          specifier.includes("@larksuite")
        ) {
          violations.push(`${path.relative(workspaceRoot, file)} -> ${match[1]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("the core router receives a CodexClient instead of constructing CodexRunner", async () => {
    const routerSource = await readFile(
      path.join(workspaceRoot, "src/core/message-router.ts"),
      "utf8",
    );
    const runnerSource = await readFile(
      path.join(workspaceRoot, "src/core/bridge-runner.ts"),
      "utf8",
    );
    expect(`${routerSource}\n${runnerSource}`).not.toMatch(/new\s+CodexRunner\b/);
  });

  test("platform adapters do not own the core composition root", async () => {
    const files = await typescriptFiles(
      path.join(workspaceRoot, "src/adapters"),
    );
    const source = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(source).not.toMatch(
      /new\s+(?:CodexRunner|MessageRouter|JsonStateStore|AdapterSupervisor)\b/u,
    );

    const composition = await readFile(
      path.join(workspaceRoot, "src/runtime/bridge-runtime.ts"),
      "utf8",
    );
    expect(composition).toMatch(/new\s+CodexRunner\b/u);
    expect(composition).toMatch(/new\s+MessageRouter\b/u);
    expect(composition).toMatch(/new\s+JsonStateStore\b/u);
    expect(composition).toMatch(/new\s+AdapterSupervisor\b/u);
  });

  test("UsageAdvisor core has no self-modification, deployment, permission, or external-action capability", async () => {
    const source = await readFile(path.join(workspaceRoot, "src/core/usage-advisor.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports).toEqual(["../state/types.js"]);
    expect(source).not.toMatch(/\b(?:fetch|spawn|spawnSync|exec|execFile|writeFile|appendFile|chmod|unlink|rm|rmdir)\s*\(/u);
    expect(source).not.toMatch(/(?:process\.env|\bdeploy\s*\(|\bgrantPermission\s*\(|\bsetConfig\s*\()/u);
    expect(source).not.toContain("apply");
    expect(source).toContain('export type UsageAdvisorReviewDecision = "approve_for_planning" | "reject"');
  });

  test("Desktop Gateway contracts stay platform-neutral and side-effect free", async () => {
    const source = await readFile(path.join(workspaceRoot, "src/desktop-gateway/contracts.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports).toEqual(["zod"]);
    expect(source).not.toMatch(/(?:node:http|state\/store|adapters|bridge-runner|fetch\s*\(|writeFile\s*\(|process\.env)/u);
  });

  test("quality tooling has no product mutation or external-action capability", async () => {
    const qualityFiles = [
      "scripts/run-local-openspec.mjs",
      "scripts/verify-openspec-authority.mjs",
      "scripts/verify-quality-evidence.mjs",
      "scripts/assert-private-windows-file.mjs",
    ];
    const source = (await Promise.all(qualityFiles.map((file) => readFile(path.join(workspaceRoot, file), "utf8")))).join("\n");
    expect(source).not.toMatch(/(?:src[\\/]core|src[\\/]adapters|message-router|bridge-runtime|F:[\\/]Chat2Codex|hooks?\W*(?:install|trust)|Computer Use|send.*Weixin|微信.*发送)/iu);
    expect(source).not.toMatch(/(?:npm|bun)\s+(?:install|add)\s+-g|openspec(?:\.js)?["'`]?\s*,?\s*["'`](?:init|update|archive)/iu);
    expect(source).not.toMatch(/\b(?:Set-Acl|icacls|schtasks|Start-ScheduledTask|Stop-Process)\b/iu);
  });

  test("Phase 3 repository assets are inert, loopback-only, and do not depend on plugin discovery", async () => {
    const files = [
      "docs/phase3/codex-hooks.example.json",
      "docs/phase3/codex-mcp.example.toml",
      "docs/phase3/installation-runbook.md",
      "docs/phase3/rollback-runbook.md",
      "scripts/stage-phase3-codex-home.mjs",
      "scripts/generate-phase3-temp-codex-home.mjs",
      "scripts/verify-phase3-temp-codex-home.mjs",
    ];
    const sources = await Promise.all(files.map((file) => readFile(path.join(workspaceRoot, file), "utf8")));
    const combined = sources.join("\n");
    expect(combined).not.toMatch(/(?:^|[^a-z])0\.0\.0\.0(?:[^a-z]|$)/u);
    for (const line of combined.split(/\r?\n/u).filter((entry) => entry.includes("plugin/list"))) {
      expect(line.toLowerCase()).toMatch(/(?:not depend|without|prohibit|do not|never calls)/u);
    }
    expect(combined).not.toMatch(/(?:TOKEN|SECRET|KEY)[A-Z0-9_]*\s*=\s*["']?[A-Za-z0-9_-]{43}(?:["']|\s|$)/u);
    expect(combined).toContain("127.0.0.1");
    expect(combined).toContain("INERT");
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return typescriptFiles(target);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}
