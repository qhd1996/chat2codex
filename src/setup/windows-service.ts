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
  let createdKeys: string[] = [];
  let registered = false;
  try {
    const keys = await io.ensureGatewayKeys();
    createdKeys = [...keys.created];
    const launcher = renderWindowsLauncher({ nodeBin: input.nodeBin, entrypoint: input.entrypoint, envFile: input.envFile, logFile: input.logFile, pathEnv: input.pathEnv });
    const taskXml = renderWindowsTaskXml({ taskName: input.taskName, userSid: sid, launcherPath: input.launcherPath });
    const managed = {
      CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: "true",
      CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE: keys.paths["desktop-mcp"],
      CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE: keys.paths["prompt-hook"],
      CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE: keys.paths["stop-hook"],
    };
    const env = replaceManagedEnvBlock(snapshots.get(input.envFile) ?? "", managed);
    const manifest: WindowsInstallationManifestV1 = {
      schemaVersion: 1, packageVersion: await io.packageVersion(), taskName: input.taskName, userSid: sid,
      launcherPath: input.launcherPath, envFile: input.envFile, keyFiles: Object.values(keys.paths),
      ownedFiles: [input.launcherPath, input.taskXmlPath, input.manifestPath],
      hashes: { "launcher.ps1": sha256(launcher), "task.xml": sha256(taskXml) }, installedAt: io.now().toISOString(),
    };
    parseWindowsInstallationManifest(manifest, home);
    await io.writeTextAtomic(input.envFile, env);
    await io.writeTextAtomic(input.launcherPath, launcher);
    await io.writeTextAtomic(input.taskXmlPath, taskXml);
    await io.writeTextAtomic(input.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await io.runFile("schtasks.exe", ["/Create", "/TN", taskPath, "/XML", input.taskXmlPath, "/F"]);
    registered = true;
    const queried = await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]);
    if (!queried.trim()) throw new Error("Windows task query returned no definition.");
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
  for (const filePath of [...manifest.ownedFiles, ...manifest.keyFiles]) await io.removeFile(filePath);
  const env = await io.readText(manifest.envFile);
  if (env !== null) await io.writeTextAtomic(manifest.envFile, removeManagedEnvBlock(env));
}

function absolute(value: string, label: string): string {
  if (!path.win32.isAbsolute(value)) throw new Error(`Windows ${label} must be absolute.`);
  return path.win32.normalize(value);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
