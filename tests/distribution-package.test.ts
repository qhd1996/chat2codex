import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateDistributionTree } from "../scripts/verify-distribution-package.mjs";

const repositoryRoot = path.resolve(import.meta.dir, "..");

describe("distribution package contract", () => {
  test("validates the repository package inputs and portable release manifest", async () => {
    await expect(validateDistributionTree(repositoryRoot)).resolves.toMatchObject({
      packageVersion: "0.8.0-windows.1", hookCount: 3, forbiddenHits: 0,
    });
  });

  test("rejects machine paths, secrets, missing docs, and Hook hash drift", async () => {
    const root = await fixture();
    try {
      await writeFile(path.join(root, "README.md"), "Install at F:/Chat2Codex and use sk-abcdefghijklmnopqrstuvwx\n");
      await expect(validateDistributionTree(root)).rejects.toThrow(/forbidden|secret|path/i);
      await writeFile(path.join(root, "README.md"), "portable\n");
      await rm(path.join(root, "docs", "windows", "lifecycle.md"));
      await expect(validateDistributionTree(root)).rejects.toThrow(/missing.*docs/i);
      await writeFile(path.join(root, "docs", "windows", "lifecycle.md"), "portable\n");
      await writeFile(path.join(root, "scripts", "codex-hooks", "hook-client.mjs"), "changed");
      await expect(validateDistributionTree(root)).rejects.toThrow(/Hook hash/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("does not mistake task-target text or its own rules for secrets while retaining boundary detection", async () => {
    const root = await fixture();
    try {
      await writeFile(path.join(root, "README.md"), "task-target-clarification\n");
      await expect(validateDistributionTree(root)).resolves.toMatchObject({ forbiddenHits: 0 });
      await writeFile(path.join(root, "README.md"), "token sk-abcdefghijklmnopqrstuvwx\n");
      await expect(validateDistributionTree(root)).rejects.toThrow(/secret/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-dist-package-"));
  await mkdir(path.join(root, "distribution"), { recursive: true });
  await mkdir(path.join(root, "scripts", "codex-hooks"), { recursive: true });
  await mkdir(path.join(root, "docs", "windows"), { recursive: true });
  await mkdir(path.join(root, "docs", "quality"), { recursive: true });
  for (const file of ["lifecycle.md", "compatibility.md", "troubleshooting.md"]) await writeFile(path.join(root, "docs", "windows", file), "portable\n");
  await writeFile(path.join(root, "docs", "quality", "clean-windows-e2e-runbook.md"), "unproven\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "chat2codex", version: "0.8.0-test.1" }));
  for (const file of ["hook-client.mjs", "stop-wake.mjs", "user-prompt-submit.mjs"]) await writeFile(path.join(root, "scripts", "codex-hooks", file), file);
  const { createHash } = await import("node:crypto");
  const hashes = Object.fromEntries(["hook-client.mjs", "stop-wake.mjs", "user-prompt-submit.mjs"].map((file) => ["scripts/codex-hooks/" + file, createHash("sha256").update(file).digest("hex")]));
  await writeFile(path.join(root, "LICENSE"), "MIT"); await writeFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "notices");
  await writeFile(path.join(root, "distribution", "release-manifest.json"), JSON.stringify({ schemaVersion: 1, packageVersion: "0.8.0-test.1", windows: { supported: ["win32-x64"], unverified: ["win32-arm64"] }, node: ">=20.12.0", codexCli: "0.146.0", desktop: "Task 12 required", packageRoots: [".env.example","LICENSE","README.md","README.zh-CN.md","THIRD_PARTY_NOTICES.md","dist","distribution","docs","package.json","quality","scripts"], provenance: ["LICENSE","THIRD_PARTY_NOTICES.md","package.json"], stateSchemas: { read: [4,5,6], write: 6 }, hooks: hashes, requiredDocs: ["docs/windows/lifecycle.md","docs/windows/compatibility.md","docs/windows/troubleshooting.md","docs/quality/clean-windows-e2e-runbook.md"] }));
  return root;
}
