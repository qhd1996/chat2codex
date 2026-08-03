import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");
const script = path.join(root, "scripts", "chat2codex-personal.ps1");

describe("personal portable PowerShell bootstrap", () => {
  test("exposes path-neutral reviewed lifecycle actions", async () => {
    const source = await readFile(script, "utf8");
    for (const value of ["Install", "Upgrade", "Rollback", "Uninstall", "Reinstall", "Doctor", "ReceiptId", "--receipt", "LOCALAPPDATA", "USERPROFILE", "Get-FileHash", "PORTABLE_ARCHIVE_HASH_MISMATCH", "PORTABLE_NODE_MISSING", "PORTABLE_NPM_MISSING", "PORTABLE_CODEX_MISSING", "PORTABLE_DESKTOP_MISSING", "--dry-run", "--json"]) expect(source).toContain(value);
    expect(source).not.toContain("PORTABLE_EXECUTOR_NOT_READY");
    expect(source).toContain("$env:CODEX_BIN = $CodexBin");
    expect(source).toContain("$env:CHAT2CODEX_NPM_CLI = $npmCli");
    for (const value of ["GetTempPath", "controller-", "--ignore-scripts", "--no-audit", "--no-fund", "node_modules\\chat2codex\\dist\\index.js", "finally", "Remove-Item -LiteralPath $controllerRoot -Recurse -Force"]) expect(source).toContain(value);
    expect(source).not.toContain("(Split-Path $PSScriptRoot -Parent) 'dist\\index.js'");
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

  test("allows a second archive-free uninstall only when every managed installation artifact is absent", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-personal-uninstall-"));
    const home = path.join(temporary, "home"); const prefix = path.join(home, "npm");
    const args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", "Uninstall", "-InstallHome", home, "-NpmPrefix", prefix, "-NodeBin", process.execPath, "-CodexBin", process.execPath, "-Json"];
    try {
      const absent = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
      expect(absent.exitCode).toBe(0);
      expect(JSON.parse(absent.stdout.toString().trim())).toEqual({ action: "uninstall", status: "already_uninstalled", removed: false });
      await writeFile(path.join(temporary, "sentinel"), "preserved");
      await (await import("node:fs/promises")).mkdir(prefix, { recursive: true });
      const residual = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
      expect(residual.exitCode).toBe(1);
      expect(residual.stdout.toString()).toContain("PORTABLE_ARCHIVE_REQUIRED");
      expect(await readFile(path.join(temporary, "sentinel"), "utf8")).toBe("preserved");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
