import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");
const script = path.join(root, "scripts", "chat2codex-personal.ps1");

describe("personal portable PowerShell bootstrap", () => {
  test("exposes path-neutral reviewed lifecycle actions", async () => {
    const source = await readFile(script, "utf8");
    for (const value of ["Install", "Upgrade", "Rollback", "Uninstall", "Reinstall", "Doctor", "LOCALAPPDATA", "USERPROFILE", "Get-FileHash", "PORTABLE_ARCHIVE_HASH_MISMATCH", "PORTABLE_NODE_MISSING", "PORTABLE_NPM_MISSING", "PORTABLE_CODEX_MISSING", "PORTABLE_DESKTOP_MISSING", "PORTABLE_EXECUTOR_NOT_READY", "--dry-run", "--json"]) expect(source).toContain(value);
    expect(source).not.toMatch(/F:[\\/](?:workspace|Chat2Codex)|C:[\\/]Users[\\/]dada|Invoke-Expression|\biex\b/iu);
    expect(source).not.toMatch(/\[string\]\$Home\b/iu);
    expect(source.indexOf("Get-FileHash")).toBeLessThan(source.indexOf("npm-cli.js"));
    expect(source).not.toMatch(/(?:token|password|secret)\s*=/iu);
  });

  test("returns stable redacted prerequisite and archive failures", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-personal-bootstrap-"));
    try {
      const archive = path.join(temporary, "candidate.tgz");
      await writeFile(archive, "candidate");
      const missingNode = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", "Install", "-ArchivePath", archive, "-ArchiveSha256", "0".repeat(64), "-NodeBin", path.join(temporary, "missing-node.exe"), "-DryRun"], { stdout: "pipe", stderr: "pipe" });
      expect(missingNode.exitCode).toBe(1);
      expect(missingNode.stdout.toString()).toContain("PORTABLE_ARCHIVE_HASH_MISMATCH");
      expect(missingNode.stdout.toString()).not.toContain(temporary);
      const actualHash = new Bun.CryptoHasher("sha256").update("candidate").digest("hex");
      const missingNodeAfterHash = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", "Install", "-ArchivePath", archive, "-ArchiveSha256", actualHash, "-NodeBin", path.join(temporary, "missing-node.exe"), "-DryRun"], { stdout: "pipe", stderr: "pipe" });
      expect(missingNodeAfterHash.exitCode).toBe(1);
      expect(missingNodeAfterHash.stdout.toString()).toContain("PORTABLE_NODE_MISSING");
      expect(missingNodeAfterHash.stdout.toString()).not.toContain(temporary);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
