import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");

describe("novice acceptance documentation and Windows CI", () => {
  test("documents every environment, action, fault, evidence, and external boundary", async () => {
    const runbook = await readFile(path.join(root, "docs", "quality", "novice-acceptance-runbook.md"), "utf8");
    const troubleshooting = await readFile(path.join(root, "docs", "windows", "novice-troubleshooting.md"), "utf8");
    for (const value of ["fresh_user", "upgrade_user", "recovery_user", "setup weixin", "doctor", "text → image → file", "Plan mode", "wrong token", "expired generation", "disk full", "permission", "kill/restart", "30", "SHA-256", "zero residual", "package_smoke", "clean_windows_vm", "unproven"]) expect(runbook).toContain(value);
    for (const field of ["What happened", "Safe state", "Next action", "do not expose", "token", "prompt", "identity", "path", "purge", "explicit confirmation"]) expect(troubleshooting).toContain(field);
    for (const boundary of ["production", "real ~/.codex", "Hook", "Desktop restart", "Computer Use", "real Weixin"]) expect(runbook).toContain(boundary);
  });

  test("runs the novice fast, native, 30-run, pack, extraction, and residual gates on Windows", async () => {
    const workflow = await readFile(path.join(root, ".github", "workflows", "windows-quality.yml"), "utf8");
    for (const value of ["windows-latest", "actions/checkout@v7", "actions/setup-node@v7", 'node-version: "24"', "oven-sh/setup-bun@v2", "bun-version: 1.3.9", "bun install --frozen-lockfile", "bun run test:novice", "bun run test:novice:30", "novice-native-lifecycle-probe.mjs", "bun audit", "bun pm pack", "verify-distribution-package.mjs", "residual"]) expect(workflow).toContain(value);
    expect(workflow).not.toContain("Select-Object -Single");
    expect(workflow).toContain("Select-Object -First 1");
    expect(workflow).not.toMatch(/(?:npm|bun)\s+(?:install|add)\s+-g|openspec\s+(?:init|update|archive)/iu);
    const cleanJob = workflow.slice(workflow.indexOf("  clean-package-acceptance:"));
    for (const value of ["needs: novice-acceptance", "actions/download-artifact@v4", "@openai/codex@0.146.0", "npm install --ignore-scripts --no-audit --no-fund --prefix $installedPrefix $archive.FullName", "node_modules/chat2codex", "novice-clean-windows-attestation.mjs", "C2C_RUNNER_ENVIRONMENT", "--attestation", "--environment-kind equivalent_isolated_windows", "--fresh-profile", "--repository-absent", "--prior-package-absent", "--repository-commit", "--report", "--cleanup", "verify-novice-evidence.mjs", "OwnedRootExists", "MatchingProcesses"]) expect(cleanJob).toContain(value);
    expect(cleanJob).not.toContain("actions/checkout");
    expect(cleanJob).not.toMatch(/Add-Member.*(?:environmentKind|freshProfile|repositoryAbsent|priorPackageAbsent)/iu);
  });
});
