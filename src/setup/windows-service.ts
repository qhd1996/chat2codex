import { createHash } from "node:crypto";
import path from "node:path";

import {
  parseWindowsInstallationManifest, removeManagedEnvBlock, replaceManagedEnvBlock,
  type WindowsInstallationManifestV1,
} from "./windows-lifecycle.js";
import { renderWindowsLauncher, renderWindowsTaskXml, windowsTaskPath } from "./windows-task.js";
import type { GatewayKeyRole } from "./windows-private-files.js";

export interface WindowsServiceInstallInput {
  home: string; envFile: string; launcherPath: string; taskXmlPath: string; manifestPath: string;
  nodeBin: string; entrypoint: string; logFile: string; pathEnv: string; taskName: string;
  statePath: string;
}

export interface WindowsServiceIo {
  currentUserSid(): Promise<string>;
  now(): Date;
  packageVersion(): Promise<string>;
  readText(filePath: string): Promise<string | null>;
  writeTextAtomic(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  ensureGatewayKeys(): Promise<{ created: string[]; preserved: string[]; paths: Record<GatewayKeyRole, string> }>;
  runFile(command: string, args: string[]): Promise<string>;
}

export async function installWindowsUserTask(input: WindowsServiceInstallInput, io: WindowsServiceIo): Promise<{
  taskPath: string; manifest: WindowsInstallationManifestV1; createdKeys: number;
}> {
  const home = absolute(input.home, "home");
  const owned = [input.envFile, input.launcherPath, input.taskXmlPath, input.manifestPath];
  const snapshots = new Map<string, string | null>();
  for (const filePath of owned) snapshots.set(filePath, await io.readText(filePath));
  const sid = await io.currentUserSid();
  const taskPath = windowsTaskPath(input.taskName);
  const priorManifest = parsePriorManifest(snapshots.get(input.manifestPath), home);
  let createdKeys: string[] = [];
  let registered = false;
  try {
    const keys = await io.ensureGatewayKeys();
    createdKeys = [...keys.created];
    const launcher = renderWindowsLauncher({ nodeBin: input.nodeBin, entrypoint: input.entrypoint, envFile: input.envFile, logFile: input.logFile, pathEnv: input.pathEnv, workingDirectory: home });
    const taskXml = renderWindowsTaskXml({ taskName: input.taskName, userSid: sid, launcherPath: input.launcherPath });
    const priorEnv = snapshots.get(input.envFile) ?? "";
    const userEnv = removeManagedEnvBlock(priorEnv);
    const priorStatePath = readEnvPath(userEnv, "BRIDGE_STATE_PATH");
    const priorAttachments = readEnvPath(userEnv, "ATTACHMENT_DOWNLOAD_DIR");
    const priorHome = readEnvPath(userEnv, "CHAT2CODEX_HOME");
    if (priorHome && priorHome.toLocaleLowerCase() !== home.toLocaleLowerCase()) throw new Error("CHAT2CODEX_HOME in the env file differs from the selected installation home.");
    const statePath = priorStatePath ?? input.statePath;
    const managed: Record<string, string> = {
      CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: "true",
      CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE: keys.paths["desktop-mcp"],
      CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE: keys.paths["prompt-hook"],
      CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE: keys.paths["stop-hook"],
    };
    if (!priorHome) managed.CHAT2CODEX_HOME = home;
    if (!priorStatePath) managed.BRIDGE_STATE_PATH = statePath;
    if (!priorAttachments) managed.ATTACHMENT_DOWNLOAD_DIR = path.win32.join(home, ".data", "attachments");
    const env = replaceManagedEnvBlock(priorEnv, managed);
    const manifest: WindowsInstallationManifestV1 = {
      schemaVersion: 1, packageVersion: await io.packageVersion(), taskName: input.taskName, userSid: sid,
      launcherPath: input.launcherPath, nodeBin: input.nodeBin, entrypoint: input.entrypoint, statePath,
      envFile: input.envFile, keyFiles: Object.values(keys.paths),
      ownedKeyFiles: [...new Set([...(priorManifest?.ownedKeyFiles ?? []), ...keys.created])],
      ownedFiles: [input.launcherPath, input.taskXmlPath, input.manifestPath],
      hashes: { "launcher.ps1": sha256(launcher), "task.xml": sha256(taskXml) }, installedAt: io.now().toISOString(),
    };
    parseWindowsInstallationManifest(manifest, home);
    if (snapshots.get(input.manifestPath) !== null) await writeRollbackSnapshot(input, snapshots, statePath, io);
    await io.writeTextAtomic(input.envFile, env);
    await io.writeTextAtomic(input.launcherPath, launcher);
    await io.writeTextAtomic(input.taskXmlPath, taskXml);
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    await io.writeTextAtomic(input.manifestPath, manifestText);
    for (const [filePath, expected] of [[input.envFile, env], [input.launcherPath, launcher], [input.taskXmlPath, taskXml], [input.manifestPath, manifestText]] as const) {
      const observed = await io.readText(filePath);
      if (observed !== expected) throw new Error(`Windows lifecycle write verification failed: ${path.win32.basename(filePath)}`);
    }
    await io.runFile("schtasks.exe", ["/Create", "/TN", taskPath, "/XML", input.taskXmlPath, "/F"]);
    registered = true;
    const queried = await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]);
    if (!queried.trim()) throw new Error("Windows task query returned no definition.");
    const queriedLauncher = taskLauncherPath(queried);
    if (queriedLauncher.toLocaleLowerCase() !== input.launcherPath.toLocaleLowerCase()) throw new Error("Windows task query launcher differs from the installation manifest.");
    return { taskPath, manifest, createdKeys: createdKeys.length };
  } catch (error) {
    if (registered) await io.runFile("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"]).catch(() => undefined);
    for (const [filePath, prior] of [...snapshots].reverse()) {
      if (prior === null) await io.removeFile(filePath).catch(() => undefined);
      else await io.writeTextAtomic(filePath, prior).catch(() => undefined);
    }
    await Promise.all(createdKeys.map((filePath) => io.removeFile(filePath).catch(() => undefined)));
    throw error;
  }
}

export async function uninstallWindowsUserTask(manifestPath: string, io: WindowsServiceIo): Promise<void> {
  const source = await io.readText(manifestPath);
  if (source === null) throw new Error("Windows installation manifest is missing.");
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("Windows installation manifest is malformed."); }
  const home = path.win32.dirname(path.win32.dirname(path.win32.dirname(manifestPath)));
  const manifest = parseWindowsInstallationManifest(value, home);
  const taskPath = windowsTaskPath(manifest.taskName);
  await io.runFile("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"]);
  for (const filePath of [...manifest.ownedFiles, ...manifest.ownedKeyFiles]) await io.removeFile(filePath);
  const env = await io.readText(manifest.envFile);
  if (env !== null) await io.writeTextAtomic(manifest.envFile, removeManagedEnvBlock(env));
}

function absolute(value: string, label: string): string {
  if (!path.win32.isAbsolute(value)) throw new Error(`Windows ${label} must be absolute.`);
  return path.win32.normalize(value);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function parsePriorManifest(source: string | null | undefined, home: string): WindowsInstallationManifestV1 | undefined {
  if (!source) return undefined;
  try { return parseWindowsInstallationManifest(JSON.parse(source), home); }
  catch (error) { throw new Error(`Prior Windows installation manifest is invalid: ${error instanceof Error ? error.message : String(error)}`); }
}
function taskLauncherPath(source: string): string {
  const decoded = source.replace(/&apos;/gu, "'").replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const match = decoded.match(/-File\s+'([^'](?:[^']|'')*)'/u);
  if (!match) throw new Error("Windows task query omitted the package-owned launcher.");
  return path.win32.normalize(match[1].replace(/''/gu, "'"));
}

function readEnvPath(source: string, key: string): string | undefined {
  const line = source.split(/\r?\n/u).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return undefined;
  const raw = line.slice(key.length + 1).trim();
  let value = raw;
  if (raw.startsWith('"')) {
    try { value = JSON.parse(raw) as string; } catch { throw new Error(`${key} in the env file is malformed.`); }
  }
  if (typeof value !== "string" || !path.win32.isAbsolute(value)) throw new Error(`${key} in the env file must be absolute for the Windows service.`);
  return path.win32.normalize(value);
}

async function writeRollbackSnapshot(input: WindowsServiceInstallInput, snapshots: Map<string, string | null>, statePath: string, io: WindowsServiceIo): Promise<void> {
  const stamp = io.now().toISOString().replace(/[:.]/gu, "-");
  const root = path.win32.join(input.home, ".service", "windows", "rollback", stamp);
  const sources = [input.envFile, input.launcherPath, input.taskXmlPath, input.manifestPath, statePath];
  const records: Array<{ source: string; backup: string; sha256: string }> = [];
  for (const source of sources) {
    const content = snapshots.has(source) ? snapshots.get(source) : await io.readText(source);
    if (content === null || content === undefined) continue;
    const backup = path.win32.join(root, `${records.length.toString().padStart(2, "0")}-${path.win32.basename(source)}`);
    await io.writeTextAtomic(backup, content);
    records.push({ source, backup, sha256: sha256(content) });
  }
  await io.writeTextAtomic(path.win32.join(root, "backup.json"), JSON.stringify({ schemaVersion: 1, createdAt: io.now().toISOString(), records }, null, 2) + "\n");
}
