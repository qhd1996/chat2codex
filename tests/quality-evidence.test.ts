import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateEvidenceManifest } from "../scripts/verify-quality-evidence.mjs";

const commit = "a".repeat(40);
const authorityCommit = "9942bb5fbef593305480802a170d6bcb3e0a1a6a";
const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-evidence-"));
  const artifactPath = path.join(root, "artifacts", "report.json");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "{\"ok\":true}\n");
  return { root, artifactPath };
}

function validManifest(artifactHash: string) {
  return {
    schemaVersion: 1, manifestId: "phase3-preinstall", authorityCommit, repositoryCommit: commit, generatedAt: "2026-08-02T12:00:00.000Z",
    targets: [
      { id: "QUALITY-AUTHORITY-001", requiredLevel: "automated", verdict: "pass", evidenceIds: ["authority-test"] },
      { id: "DESKTOP-001", requiredLevel: "installed_behavior", verdict: "unproven", evidenceIds: [] },
      { id: "WX-REAL-E2E", requiredLevel: "real_e2e", verdict: "unproven", evidenceIds: [] },
    ],
    evidence: [{
      id: "authority-test", targetId: "QUALITY-AUTHORITY-001", level: "automated", outcome: "pass",
      observedAt: "2026-08-02T12:00:00.000Z", repositoryCommit: commit, dirty: false,
      platform: { os: "win32", arch: "x64" }, versions: { node: "24.14.0", bun: "1.3.9", package: "0.8.0-media.1" },
      procedure: { kind: "command", value: "bun test tests/openspec-authority.test.ts" },
      counts: { pass: 13, fail: 0, skip: 0, timeout: 0, residualRoot: 0, residualChildren: 0 },
      artifact: { path: "artifacts/report.json", sha256: artifactHash }, note: "Bounded automated authority verification.",
    }],
  };
}

async function withFixture(run: (root: string, manifest: ReturnType<typeof validManifest>) => Promise<void>) {
  const value = await fixture();
  try {
    await run(value.root, validManifest(sha256("{\"ok\":true}\n")));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}

describe("quality evidence manifest", () => {
  test("accepts one exact automated artifact while stronger rows remain unproven", async () => {
    await withFixture(async (root, manifest) => {
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).resolves.toEqual({ manifestId: "phase3-preinstall", targets: 3, evidence: 1, passedTargets: 1 });
    });
  });

  for (const [name, mutate, pattern] of [
    ["unknown top-level field", (m: any) => { m.extra = true; }, /unknown.*manifest/i],
    ["future schema", (m: any) => { m.schemaVersion = 2; }, /schema version/i],
    ["wrong authority commit", (m: any) => { m.authorityCommit = "b".repeat(40); }, /approved authority commit/i],
    ["duplicate targets", (m: any) => { m.targets.push({ ...m.targets[0] }); }, /duplicate.*target/i],
    ["duplicate evidence", (m: any) => { m.evidence.push({ ...m.evidence[0] }); }, /duplicate.*evidence/i],
    ["dangling evidence reference", (m: any) => { m.targets[0].evidenceIds = ["missing"]; }, /missing evidence/i],
    ["unknown evidence level", (m: any) => { m.evidence[0].level = "unit"; }, /evidence level/i],
    ["unknown verdict", (m: any) => { m.targets[0].verdict = "partial"; }, /verdict/i],
    ["passing run with a failure", (m: any) => { m.evidence[0].counts.fail = 1; }, /passing evidence.*zero/i],
    ["passing run with a timeout", (m: any) => { m.evidence[0].counts.timeout = 1; }, /passing evidence.*zero/i],
    ["passing run with residual process", (m: any) => { m.evidence[0].counts.residualChildren = 1; }, /passing evidence.*zero/i],
    ["dirty passing run", (m: any) => { m.evidence[0].dirty = true; }, /dirty.*pass/i],
    ["wrong artifact hash", (m: any) => { m.evidence[0].artifact.sha256 = "b".repeat(64); }, /hash mismatch/i],
    ["secret-shaped note", (m: any) => { m.evidence[0].note = "Bearer abcdefghijklmnopqrstuvwxyz"; }, /forbidden.*note/i],
    ["private path note", (m: any) => { m.evidence[0].note = "C:\\Users\\dada\\secret.txt"; }, /forbidden.*note/i],
  ] as const) {
    test(`rejects ${name}`, async () => {
      await withFixture(async (root, manifest) => {
        mutate(manifest);
        await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(pattern);
      });
    });
  }

  test("rejects weaker evidence promotion", async () => {
    await withFixture(async (root, manifest) => {
      manifest.targets[0].verdict = "unproven";
      manifest.targets[0].evidenceIds = [];
      manifest.targets[1].verdict = "pass";
      manifest.targets[1].evidenceIds = ["authority-test"];
      manifest.evidence[0].targetId = "DESKTOP-001";
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/evidence level.*installed_behavior/i);
    });
  });

  test("retains weaker evidence on an unproven stronger target without promotion", async () => {
    await withFixture(async (root, manifest) => {
      manifest.targets[0].verdict = "unproven";
      manifest.targets[0].evidenceIds = [];
      manifest.targets[1].evidenceIds = ["authority-test"];
      manifest.evidence[0].targetId = "DESKTOP-001";
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).resolves.toMatchObject({ passedTargets: 0 });
    });
  });

  test("requires direct evidence for contradicted targets and rejects orphan records", async () => {
    await withFixture(async (root, manifest) => {
      manifest.targets[1].verdict = "contradicted";
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/contradicted.*evidence/i);
      manifest.targets[1].verdict = "unproven";
      manifest.targets[0].verdict = "unproven";
      manifest.targets[0].evidenceIds = [];
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/orphan.*evidence/i);
    });
  });

  test("rejects outside-root, missing, and symlink artifacts", async () => {
    await withFixture(async (root, manifest) => {
      manifest.evidence[0].artifact.path = "../outside.json";
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/outside.*repository/i);
      manifest.evidence[0].artifact.path = "artifacts/missing.json";
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/regular.*artifact|missing.*artifact/i);
      const link = path.join(root, "artifacts", "link.json");
      try {
        await symlink(path.join(root, "artifacts", "report.json"), link, "file");
        manifest.evidence[0].artifact.path = "artifacts/link.json";
        await expect(validateEvidenceManifest(manifest, { repositoryRoot: root })).rejects.toThrow(/symlink/i);
      } catch (error: any) {
        if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      }
    });
  });

  test("rejects malformed commits, timestamps, versions, counts, and nested unknown fields", async () => {
    await withFixture(async (root, manifest) => {
      for (const [mutate, pattern] of [
        [(m: any) => { m.repositoryCommit = "bad"; }, /repository commit/i],
        [(m: any) => { m.generatedAt = "yesterday"; }, /generatedAt/i],
        [(m: any) => { m.evidence[0].versions.node = "latest"; }, /node version/i],
        [(m: any) => { m.evidence[0].counts.pass = -1; }, /count/i],
        [(m: any) => { m.evidence[0].artifact.extra = true; }, /unknown.*artifact/i],
      ] as const) {
        const copy = structuredClone(manifest); mutate(copy);
        await expect(validateEvidenceManifest(copy, { repositoryRoot: root })).rejects.toThrow(pattern);
      }
    });
  });

  test("allows the locked external authority commit but rejects an unavailable repository commit", async () => {
    await withFixture(async (root, manifest) => {
      const repositoryExists = async (value: string) => value === commit;
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root, commitExists: repositoryExists })).resolves.toMatchObject({ passedTargets: 1 });
      const noCommitExists = async () => false;
      await expect(validateEvidenceManifest(manifest, { repositoryRoot: root, commitExists: noCommitExists })).rejects.toThrow(/repository commit.*not available/i);
    });
  });
});

describe("real Weixin and Desktop evidence runbook", () => {
  test("separates evidence levels and every external approval stop", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const source = await readFile(path.join(root, "docs", "quality", "weixin-e2e-runbook.md"), "utf8");
    for (const required of [
      "repository automation", "production read-only health", "production write or restart",
      "~/.codex, Hook, or MCP", "Desktop restart or Computer Use", "each real Weixin outbound action",
      "fresh handle", "UTC timestamp", "Asia/Shanghai", "redacted screenshot", "redacted transcript",
      "state SHA-256", "PID + CreationDate", "ordering", "deduplication", "rollback hash",
      "CI does not prove real E2E", "static inspection does not prove real E2E", "schema presence does not prove real E2E",
    ]) expect(source).toContain(required);
    expect((source.match(/APPROVAL STOP/gu) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("contains evidence templates and no pre-authorized production mutation", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const source = await readFile(path.join(root, "docs", "quality", "weixin-e2e-runbook.md"), "utf8");
    for (const field of ["Requirement ID", "Evidence level", "Observed at", "Repository commit", "Artifact SHA-256", "Abort condition", "Outcome"]) expect(source).toContain(field);
    expect(source).not.toMatch(/(?:schtasks|Start-ScheduledTask|Stop-Process|taskkill|Set-Acl|icacls|npm install -g|openspec init)\b/iu);
    expect(source).not.toContain("productionAuthorized: true");
    expect(source).not.toContain("realExternalActionsAuthorized: true");
  });
});
