import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { packageRoot, readPackageVersion } from "../package-info.js";
import { loadWeixinCredentials } from "../adapters/weixin/store.js";
import { parsePortableReceipt } from "./portable-receipt.js";
import { parseWindowsInstallationManifest } from "./windows-lifecycle.js";
import type { DistributionDoctorSnapshot } from "./distribution-doctor.js";
import { windowsTaskPath } from "./windows-task.js";

const execFileAsync = promisify(execFile);

export interface PersonalWindowsInspectionIo {
  platform(): NodeJS.Platform; architecture(): string; windowsVersion(): string; packageVersion(): Promise<string>;
  commandVersion(name: "powershell" | "node" | "npm" | "codex"): Promise<{ available: boolean; version?: string }>;
  expectedNodeRange(): string; expectedCodexVersion(): string; installation(home: string): Promise<DistributionDoctorSnapshot | null>;
  weixin(home: string): Promise<NonNullable<DistributionDoctorSnapshot["weixin"]>>; hooks(home: string): Promise<NonNullable<DistributionDoctorSnapshot["hooks"]>>;
  rollbackReceipt(home: string): Promise<NonNullable<DistributionDoctorSnapshot["rollbackReceipt"]>>;
}

export async function inspectPersonalWindowsEnvironment(home: string, io: PersonalWindowsInspectionIo): Promise<DistributionDoctorSnapshot> {
  const [powershell, node, npm, codexCli, installation, weixin, hooks, rollbackReceipt, packageVersion] = await Promise.all([
    io.commandVersion("powershell"), io.commandVersion("node"), io.commandVersion("npm"), io.commandVersion("codex"),
    io.installation(home), io.weixin(home), io.hooks(home), io.rollbackReceipt(home), io.packageVersion(),
  ]);
  const dependencies = {
    powershell: dependency(powershell, "5.1.0"), node: dependency(node, minimumVersion(io.expectedNodeRange())),
    npm: dependency(npm, "1.0.0"), codexCli: dependency(codexCli, "0.1.0"),
  };
  return {
    platform: io.platform(), arch: io.architecture(), windowsVersion: bounded(io.windowsVersion()), packageVersion: bounded(packageVersion),
    manifest: installation?.manifest ?? null, ...(installation ? installation : {}), dependencies, weixin, hooks, rollbackReceipt,
  };
}
function dependency(value: { available: boolean; version?: string }, minimum: string) { const version = safeVersion(value.version); return { available: value.available, ...(version ? { version } : {}), compatible: value.available && Boolean(version) && compareVersions(version!, minimum) >= 0 }; }
function minimumVersion(range: string): string { return safeVersion(range.match(/[0-9]+\.[0-9]+\.[0-9]+/u)?.[0]) ?? "999999.0.0"; }
function safeVersion(value: string | undefined): string | undefined { const match = value?.match(/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/u); return match ? match[0] : undefined; }
function compareVersions(left: string, right: string): number { const a = left.split(/[.+-]/u).slice(0, 3).map(Number); const b = right.split(/[.+-]/u).slice(0, 3).map(Number); for (let index = 0; index < 3; index += 1) { const result = (a[index] ?? 0) - (b[index] ?? 0); if (result) return result; } return 0; }
function bounded(value: string): string { return value.replace(/[\u0000-\u001f]/gu, "").slice(0, 100); }

export async function inspectInstalledWindowsDistribution(home: string): Promise<DistributionDoctorSnapshot | null> {
  return inspectPersonalWindowsEnvironment(home, defaultPersonalWindowsInspectionIo);
}

async function inspectInstalledWindowsCore(home: string): Promise<DistributionDoctorSnapshot | null> {
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
    task: { exists: true, taskName: manifest.taskName, launcherPath: observedLauncher },
    process: { writers, lockHealthy }, stateSchemaVersion, loopbackHost: "127.0.0.1", keys, hooks, desktop,
  };
}

const defaultPersonalWindowsInspectionIo: PersonalWindowsInspectionIo = {
  platform: () => process.platform, architecture: () => process.arch, windowsVersion: () => os.release(), packageVersion: readPackageVersion,
  commandVersion: inspectCommandVersion, expectedNodeRange: () => ">=20.19.0", expectedCodexVersion: () => "0.146.0",
  installation: inspectInstalledWindowsCore,
  weixin: inspectWeixinReadiness, hooks: inspectInstalledHookReadiness, rollbackReceipt: inspectPendingReceipt,
};

async function inspectCommandVersion(name: "powershell" | "node" | "npm" | "codex"): Promise<{ available: boolean; version?: string }> {
  try {
    if (name === "node") return { available: true, version: process.versions.node };
    if (name === "powershell") {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
      return versionResult(stdout);
    }
    const command = name === "npm" && process.platform === "win32" ? "npm.cmd" : name === "codex" ? process.env.CODEX_BIN?.trim() || "codex" : name;
    const { stdout } = await execFileAsync(command, ["--version"], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
    return versionResult(stdout);
  } catch { return { available: false }; }
}
function versionResult(source: string): { available: boolean; version?: string } { const match = source.match(/[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?/u); return match ? { available: true, version: match[0] } : { available: true }; }

async function inspectWeixinReadiness(home: string): Promise<NonNullable<DistributionDoctorSnapshot["weixin"]>> {
  const credentialsPath = path.resolve(process.env.WEIXIN_CREDENTIALS_PATH?.trim() || path.join(home, "weixin", "credentials.json"));
  let credentialReadable = false;
  try { await loadWeixinCredentials(credentialsPath); credentialReadable = true; } catch { credentialReadable = false; }
  const configured = (process.env.CHAT2CODEX_ADAPTER ?? "feishu").toLocaleLowerCase() === "weixin" && credentialReadable;
  const allowed = csv(process.env.ALLOWED_USER_IDS).length + csv(process.env.ALLOWED_CHAT_IDS).length > 0;
  const privateChatBoundary = booleanValue(process.env.ALLOW_DIRECT_MESSAGES, true) && !booleanValue(process.env.ALLOW_GROUPS, false) && allowed;
  return { configured, credentialReadable, privateChatBoundary };
}

async function inspectInstalledHookReadiness(): Promise<NonNullable<DistributionDoctorSnapshot["hooks"]>> {
  const packaged = await inspectHookHashes();
  const codexHome = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"));
  const source = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
  const references = inspectCodexConfigReferences(source, packageRoot());
  const installedHashesMatch = packaged.expectedHashesMatch && references.installedHashesMatch;
  const mcpConfigured = references.mcpConfigured;
  return { expectedHashesMatch: packaged.expectedHashesMatch, installedHashesMatch, mcpConfigured };
}
export function inspectCodexConfigReferences(source: string, reviewedPackageRoot: string): { installedHashesMatch: boolean; mcpConfigured: boolean } {
  const root = path.win32.normalize(reviewedPackageRoot).replaceAll("\\", "/").replace(/\/$/u, "");
  const has = (relative: string) => source.includes(root + "/" + relative);
  return { installedHashesMatch: source.includes("hooks.UserPromptSubmit") && source.includes("hooks.Stop") && has("scripts/codex-hooks/user-prompt-submit.mjs") && has("scripts/codex-hooks/stop-wake.mjs"), mcpConfigured: source.includes("mcp_servers.chat2codex_desktop_gateway") && has("dist/desktop-gateway/mcp.js") };
}

async function inspectPendingReceipt(home: string): Promise<NonNullable<DistributionDoctorSnapshot["rollbackReceipt"]>> {
  const root = path.join(home, "receipts");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  let status: string | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLocaleLowerCase().endsWith(".json")) continue;
    try { const receipt = parsePortableReceipt(JSON.parse(await fs.readFile(path.join(root, entry.name), "utf8"))); if (!["committed", "rolled_back", "aborted"].includes(receipt.status)) { status = receipt.status; break; } }
    catch { status = "invalid"; break; }
  }
  return status ? { pending: true, status } : { pending: false };
}
function csv(value: string | undefined): string[] { return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean); }
function booleanValue(value: string | undefined, fallback: boolean): boolean { if (value === undefined) return fallback; return value.trim().toLocaleLowerCase() === "true"; }

async function queryTaskXml(taskName: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("schtasks.exe", ["/Query", "/TN", windowsTaskPath(taskName), "/XML"], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (!stdout.trim()) throw new Error("empty task XML");
    return stdout;
  } catch (error) { throw new Error(`Windows task query failed: ${message(error)}`); }
}

function launcherFromTaskXml(source: string): string {
  const decoded = source.replace(/&apos;/gu, "'").replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const quoted = decoded.match(/-File\s+"([^"]+)"/u);
  if (quoted) return quoted[1];
  const legacy = decoded.match(/-File\s+'([^'](?:[^']|'')*)'/u);
  if (!legacy) throw new Error("Windows task XML does not contain the expected launcher action.");
  return legacy[1].replace(/''/gu, "'");
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
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const parsed = JSON.parse(stdout || "[]") as WindowsProcessCommand | WindowsProcessCommand[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return countWindowsChat2CodexWriters(rows, entrypoint, process.pid);
  } catch { return -1; }
}

export interface WindowsProcessCommand { ProcessId?: number; CommandLine?: string }

export function countWindowsChat2CodexWriters(rows: readonly WindowsProcessCommand[], entrypoint: string, currentPid: number): number {
  return rows.filter((row) => isWindowsChat2CodexWriter(row, entrypoint, currentPid)).length;
}

export function isWindowsChat2CodexWriter(row: WindowsProcessCommand, entrypoint: string, currentPid: number): boolean {
  if (!Number.isSafeInteger(row.ProcessId) || Number(row.ProcessId) <= 0 || row.ProcessId === currentPid || typeof row.CommandLine !== "string") return false;
  const tokens = tokenizeWindowsCommandLine(row.CommandLine);
  if (!tokens) return false;
  const expected = path.win32.normalize(entrypoint).toLocaleLowerCase();
  const index = tokens.findIndex((token) => path.win32.normalize(token).toLocaleLowerCase() === expected);
  return index >= 0 && tokens[index + 1]?.toLocaleLowerCase() === "start";
}

function tokenizeWindowsCommandLine(source: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  let started = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') { quoted = !quoted; started = true; continue; }
    if (!quoted && /\s/u.test(character)) {
      if (started) { tokens.push(token); token = ""; started = false; }
      continue;
    }
    token += character; started = true;
  }
  if (quoted) return null;
  if (started) tokens.push(token);
  return tokens;
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
