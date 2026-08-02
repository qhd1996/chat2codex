import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { packageRoot, readPackageVersion } from "../package-info.js";
import { parseWindowsInstallationManifest } from "./windows-lifecycle.js";
import type { DistributionDoctorSnapshot } from "./distribution-doctor.js";
import { windowsTaskPath } from "./windows-task.js";

const execFileAsync = promisify(execFile);

export async function inspectInstalledWindowsDistribution(home: string): Promise<DistributionDoctorSnapshot | null> {
  const manifestPath = path.join(home, ".service", "windows", "installation.json");
  const source = await fs.readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (source === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new Error("Windows installation manifest is malformed."); }
  const manifest = parseWindowsInstallationManifest(raw, home);
  const taskXml = await queryTaskXml(manifest.taskName);
  const observedLauncher = launcherFromTaskXml(taskXml);
  const [stateSchemaVersion, keys, writers, lockHealthy, hooks, desktop] = await Promise.all([
    readStateSchema(manifest.statePath), inspectKeys(manifest.keyFiles), countWriters(manifest.entrypoint),
    inspectLock(manifest.statePath), inspectHookHashes(), inspectDesktop(),
  ]);
  return {
    platform: process.platform, arch: process.arch, windowsVersion: os.release(), packageVersion: await readPackageVersion(),
    manifest: { packageVersion: manifest.packageVersion, schemaVersion: manifest.schemaVersion, taskName: manifest.taskName, launcherPath: manifest.launcherPath },
    task: { exists: true, taskName: manifest.taskName, launcherPath: observedLauncher, lastResult: 0 },
    process: { writers, lockHealthy }, stateSchemaVersion, loopbackHost: "127.0.0.1", keys, hooks, desktop,
  };
}

async function queryTaskXml(taskName: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("schtasks.exe", ["/Query", "/TN", windowsTaskPath(taskName), "/XML"], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (!stdout.trim()) throw new Error("empty task XML");
    return stdout;
  } catch (error) { throw new Error(`Windows task query failed: ${message(error)}`); }
}

function launcherFromTaskXml(source: string): string {
  const decoded = source.replace(/&apos;/gu, "'").replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const match = decoded.match(/-File\s+'([^'](?:[^']|'')*)'/u);
  if (!match) throw new Error("Windows task XML does not contain the expected launcher action.");
  return match[1].replace(/''/gu, "'");
}

async function readStateSchema(statePath: string): Promise<number | undefined> {
  const source = await fs.readFile(statePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (source === null) return undefined;
  try { const value = JSON.parse(source) as { schemaVersion?: unknown }; return Number.isSafeInteger(value.schemaVersion) ? Number(value.schemaVersion) : undefined; }
  catch { return undefined; }
}

async function inspectKeys(files: string[]): Promise<NonNullable<DistributionDoctorSnapshot["keys"]>> {
  const result = [];
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8").catch(() => "");
    const encoded = source.trim();
    const formatValid = /^[A-Za-z0-9_-]{43}$/u.test(encoded) && Buffer.from(encoded, "base64url").byteLength === 32;
    let aclValid = false;
    try { requireOwnerOnlyWindowsTokenAcl(await inspectWindowsTokenAcl(filePath)); aclValid = true; } catch { aclValid = false; }
    result.push({ role: roleFor(filePath), path: filePath, formatValid, aclValid, fingerprint: createHash("sha256").update(encoded).digest("hex") });
  }
  return result;
}
function roleFor(filePath: string): string { const name = path.basename(filePath).toLocaleLowerCase(); return name.includes("prompt") ? "prompt_hook" : name.includes("stop") ? "stop_hook" : name.includes("mcp") ? "desktop_mcp" : "unknown"; }

async function countWriters(entrypoint: string): Promise<number> {
  const script = "Get-CimInstance Win32_Process | Select-Object CommandLine | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const parsed = JSON.parse(stdout || "[]") as { CommandLine?: string } | Array<{ CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter((row) => row.CommandLine?.toLocaleLowerCase().includes(entrypoint.toLocaleLowerCase())).length;
  } catch { return -1; }
}
async function inspectLock(statePath: string): Promise<boolean> {
  const info = await fs.stat(statePath + ".lock").catch(() => null);
  return Boolean(info && Date.now() - info.mtimeMs <= 60_000);
}
async function inspectHookHashes(): Promise<{ expectedHashesMatch: boolean }> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot(), "docs", "phase3", "hook-sha256.json"), "utf8")) as { files?: Record<string, string> };
    for (const [relative, expected] of Object.entries(manifest.files ?? {})) {
      const actual = createHash("sha256").update(await fs.readFile(path.join(packageRoot(), relative))).digest("hex");
      if (actual !== expected) return { expectedHashesMatch: false };
    }
    return { expectedHashesMatch: Object.keys(manifest.files ?? {}).length === 3 };
  } catch { return { expectedHashesMatch: false }; }
}
async function inspectDesktop(): Promise<{ available: boolean; version?: string }> {
  try {
    const script = "$p=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Version; if($p){$p}";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
    const version = stdout.trim(); return version ? { available: true, version } : { available: false };
  } catch { return { available: false }; }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
