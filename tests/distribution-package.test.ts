import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateDistributionTree } from "../scripts/verify-distribution-package.mjs";

const repositoryRoot = path.resolve(import.meta.dir, "..");

describe("distribution package contract", () => {
  test("validates the repository package inputs and portable release manifest", async () => {
    await expect(validateDistributionTree(repositoryRoot)).resolves.toMatchObject({
      packageVersion: "0.8.0-novice.6", hookCount: 3, forbiddenHits: 0,
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

test("packages every novice acceptance runtime asset and declares Node 20.19 minimum", async () => {
  const packageJson = JSON.parse(await Bun.file(path.join(repositoryRoot, "package.json")).text());
  expect(packageJson.engines.node).toBe(">=20.19.0");
  for (const asset of [
    "quality/scenarios/novice-daily-use.json", "quality/evidence/novice-acceptance-template.json",
    "scripts/verify-novice-evidence.mjs", "scripts/run-novice-acceptance.mjs", "scripts/novice-windows-worker.mjs",
    "scripts/novice-native-lifecycle-probe.mjs", "scripts/process-identity.mjs", "scripts/verify-distribution-package.mjs",
    "scripts/novice-restart-probe.mjs",
    "scripts/novice-service-probe.mjs", "scripts/novice-clean-windows-attestation.mjs", "scripts/novice-real-upgrade-probe.mjs", "scripts/novice-state-runtime-probe.mjs", "scripts/novice-another-user-acl.ps1",
    "docs/quality/novice-acceptance-runbook.md", "docs/windows/novice-troubleshooting.md",
  ]) expect(packageJson.files).toContain(asset);
  expect(packageJson.scripts["test:novice"]).toContain("tests/novice-package-matrix.test.ts");
});

test("normalizes tracked text bytes for reproducible Windows package archives", async () => {
  const attributes = await Bun.file(path.join(repositoryRoot, ".gitattributes")).text();
  expect(attributes).toContain("* text=auto eol=lf");
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-dist-package-"));
  await mkdir(path.join(root, "distribution"), { recursive: true });
  await mkdir(path.join(root, "scripts", "codex-hooks"), { recursive: true });
  await mkdir(path.join(root, "docs", "windows"), { recursive: true });
  await mkdir(path.join(root, "docs", "quality"), { recursive: true });
  for (const file of ["lifecycle.md", "compatibility.md", "troubleshooting.md"]) await writeFile(path.join(root, "docs", "windows", file), "portable\n");
  await writeFile(path.join(root, "docs", "windows", "novice-troubleshooting.md"), "portable\n");
  await writeFile(path.join(root, "docs", "quality", "clean-windows-e2e-runbook.md"), "unproven\n");
  await writeFile(path.join(root, "docs", "quality", "novice-acceptance-runbook.md"), "unproven\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "chat2codex", version: "0.8.0-test.1" }));
  for (const file of ["hook-client.mjs", "stop-wake.mjs", "user-prompt-submit.mjs"]) await writeFile(path.join(root, "scripts", "codex-hooks", file), file);
  const { createHash } = await import("node:crypto");
  const hashes = Object.fromEntries(["hook-client.mjs", "stop-wake.mjs", "user-prompt-submit.mjs"].map((file) => ["scripts/codex-hooks/" + file, createHash("sha256").update(file).digest("hex")]));
  await writeFile(path.join(root, "LICENSE"), "MIT"); await writeFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "notices");
  await writeFile(path.join(root, "distribution", "release-manifest.json"), JSON.stringify({ schemaVersion: 1, packageVersion: "0.8.0-test.1", windows: { supported: ["win32-x64"], unverified: ["win32-arm64"] }, node: ">=20.19.0", codexCli: "0.146.0", desktop: "Task 12 required", packageRoots: [".env.example","LICENSE","README.md","README.zh-CN.md","THIRD_PARTY_NOTICES.md","dist","distribution","docs","package.json","quality","scripts"], provenance: ["LICENSE","THIRD_PARTY_NOTICES.md","package.json"], stateSchemas: { read: [4,5,6], write: 6 }, hooks: hashes, requiredDocs: ["docs/windows/lifecycle.md","docs/windows/compatibility.md","docs/windows/troubleshooting.md","docs/quality/clean-windows-e2e-runbook.md","docs/quality/novice-acceptance-runbook.md","docs/windows/novice-troubleshooting.md"] }));
  return root;
}
