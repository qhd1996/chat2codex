import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
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
  assertOwnedPath(filePath: string): Promise<void>;
  protectPrivateFile(filePath: string): Promise<void>;
  stopWriters(entrypoint: string): Promise<number>;
  countWriters(entrypoint: string): Promise<number>;
  startAndVerifyTask(taskPath: string, entrypoint: string, statePath: string): Promise<void>;
  taskExists(taskPath: string): Promise<boolean>;
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
  if (priorManifest && priorManifest.taskName.toLocaleLowerCase() !== input.taskName.toLocaleLowerCase()) {
    throw new Error("Prior Windows task name differs from the requested task name; uninstall the prior service before changing task identity.");
  }
  if (priorManifest && [input.launcherPath, input.taskXmlPath].some((filePath) => snapshots.get(filePath) === null)) {
    throw new Error("Prior Windows task rollback material is missing. Repair or uninstall the prior service before upgrading.");
  }
  if (priorManifest) verifyPriorOwnedHashes(priorManifest, snapshots, input);
  const priorTaskExisted = await io.taskExists(taskPath);
  if (!priorManifest && priorTaskExisted) throw new Error("An unmanaged same-name Windows task exists; refusing to overwrite task ownership.");
  if (priorManifest && priorTaskExisted) {
    const priorTask = await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]);
    if (!priorTask.trim() || taskLauncherPath(priorTask).toLocaleLowerCase() !== priorManifest.launcherPath.toLocaleLowerCase()) {
      throw new Error("Prior Windows task launcher differs from the installation manifest; ownership is uncertain.");
    }
  }
  const priorWriterCount = priorManifest ? await io.countWriters(priorManifest.entrypoint) : 0;
  if (priorWriterCount > 1) throw new Error("Prior Windows writer state is ambiguous.");
  if (priorManifest && priorWriterCount === 1 && !priorTaskExisted) throw new Error("An orphaned prior Windows writer exists without a managed task for recovery.");
  if (priorManifest && priorWriterCount === 1) await io.stopWriters(priorManifest.entrypoint);
  let createdKeys: string[] = [];
  let registrationAttempted = false;
  let replacementStartAttempted = false;
  try {
    for (const filePath of [...owned, input.statePath]) await io.assertOwnedPath(filePath);
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
      hashes: { "launcher.ps1": sha256(launcher), "task.xml": sha256(taskXml) }, installedAt: priorManifest?.installedAt ?? io.now().toISOString(),
    };
    parseWindowsInstallationManifest(manifest, home);
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    if (priorManifest && priorTaskExisted && priorWriterCount === 0 &&
        snapshots.get(input.envFile) === env && snapshots.get(input.launcherPath) === launcher &&
        snapshots.get(input.taskXmlPath) === taskXml && snapshots.get(input.manifestPath) === manifestText) {
      return { taskPath, manifest, createdKeys: 0 };
    }
    if (snapshots.get(input.manifestPath) !== null) await writeRollbackSnapshot(input, snapshots, statePath, io);
    await io.writeTextAtomic(input.envFile, env);
    await io.writeTextAtomic(input.launcherPath, launcher);
    await io.writeTextAtomic(input.taskXmlPath, taskXml);
    await io.writeTextAtomic(input.manifestPath, manifestText);
    for (const [filePath, expected] of [[input.envFile, env], [input.launcherPath, launcher], [input.taskXmlPath, taskXml], [input.manifestPath, manifestText]] as const) {
      const observed = await io.readText(filePath);
      if (observed !== expected) throw new Error(`Windows lifecycle write verification failed: ${path.win32.basename(filePath)}`);
    }
    registrationAttempted = true;
    await io.runFile("schtasks.exe", ["/Create", "/TN", taskPath, "/XML", input.taskXmlPath, "/F"]);
    const queried = await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]);
    if (!queried.trim()) throw new Error("Windows task query returned no definition.");
    const queriedLauncher = taskLauncherPath(queried);
    if (queriedLauncher.toLocaleLowerCase() !== input.launcherPath.toLocaleLowerCase()) throw new Error("Windows task query launcher differs from the installation manifest.");
    if (priorWriterCount === 1) {
      replacementStartAttempted = true;
      await io.startAndVerifyTask(taskPath, input.entrypoint, statePath);
    }
    return { taskPath, manifest, createdKeys: createdKeys.length };
  } catch (error) {
    const rollbackFailures: string[] = [];
    if (replacementStartAttempted) {
      await io.stopWriters(input.entrypoint).catch((failure) => rollbackFailures.push(`Windows replacement writer stop failed: ${message(failure)}`));
    }
    if (registrationAttempted) {
      let deleteFailure: unknown;
      await io.runFile("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"]).catch((failure) => { deleteFailure = failure; });
      try {
        if (await io.taskExists(taskPath)) rollbackFailures.push(deleteFailure ? message(deleteFailure) : "Windows task remained after rollback deletion.");
      } catch (verificationFailure) {
        if (deleteFailure) rollbackFailures.push(message(deleteFailure));
        rollbackFailures.push(`Windows task rollback verification failed: ${message(verificationFailure)}`);
      }
    }
    for (const [filePath, prior] of [...snapshots].reverse()) {
      if (prior === null) await io.removeFile(filePath).catch((failure) => rollbackFailures.push(message(failure)));
      else await io.writeTextAtomic(filePath, prior).catch((failure) => rollbackFailures.push(message(failure)));
    }
    for (const filePath of createdKeys) await io.removeFile(filePath).catch((failure) => rollbackFailures.push(message(failure)));
    if (registrationAttempted && priorManifest && priorTaskExisted && snapshots.get(input.taskXmlPath)) {
      await io.runFile("schtasks.exe", ["/Create", "/TN", taskPath, "/XML", input.taskXmlPath, "/F"]).catch((failure) => rollbackFailures.push(message(failure)));
      if (rollbackFailures.length === 0) {
        await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]).then((source) => {
          if (!source.trim() || taskLauncherPath(source).toLocaleLowerCase() !== priorManifest.launcherPath.toLocaleLowerCase()) throw new Error("restored task verification failed");
        }).catch((failure) => rollbackFailures.push(message(failure)));
      }
    }
    if (priorManifest && priorWriterCount === 1 && priorTaskExisted && rollbackFailures.length === 0) {
      await io.startAndVerifyTask(taskPath, priorManifest.entrypoint, priorManifest.statePath).catch((failure) => rollbackFailures.push(`Windows prior writer restart failed: ${message(failure)}`));
    }
    if (rollbackFailures.length > 0) throw new Error(`Windows installation failed and rollback is incomplete: ${rollbackFailures.join("; ")}`, { cause: error });
    throw error;
  }
}

export async function uninstallWindowsUserTask(manifestPath: string, io: WindowsServiceIo): Promise<{ removed: boolean }> {
  await io.assertOwnedPath(manifestPath);
  const source = await io.readText(manifestPath);
  if (source === null) return { removed: false };
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("Windows installation manifest is malformed."); }
  const home = path.win32.dirname(path.win32.dirname(path.win32.dirname(manifestPath)));
  const manifest = parseWindowsInstallationManifest(value, home);
  const taskPath = windowsTaskPath(manifest.taskName);
  for (const filePath of [...manifest.ownedFiles, ...manifest.ownedKeyFiles, manifest.envFile]) await io.assertOwnedPath(filePath);
  if (await io.taskExists(taskPath)) {
    const taskXml = await io.runFile("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"]);
    if (!taskXml.trim() || taskLauncherPath(taskXml).toLocaleLowerCase() !== manifest.launcherPath.toLocaleLowerCase()) throw new Error("Windows task launcher differs from the installation manifest; refusing uninstall.");
  }
  await io.stopWriters(manifest.entrypoint);
  if (await io.taskExists(taskPath)) await io.runFile("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"]);
  if (await io.taskExists(taskPath)) throw new Error("Windows task remained after deletion.");
  const manifestKey = path.win32.normalize(manifestPath).toLocaleLowerCase();
  for (const filePath of [...manifest.ownedFiles, ...manifest.ownedKeyFiles]) {
    if (path.win32.normalize(filePath).toLocaleLowerCase() !== manifestKey) await io.removeFile(filePath);
  }
  const env = await io.readText(manifest.envFile);
  if (env !== null) await io.writeTextAtomic(manifest.envFile, removeManagedEnvBlock(env));
  await io.removeFile(manifestPath);
  return { removed: true };
}

function absolute(value: string, label: string): string {
  if (!path.win32.isAbsolute(value)) throw new Error(`Windows ${label} must be absolute.`);
  return path.win32.normalize(value);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function verifyPriorOwnedHashes(manifest: WindowsInstallationManifestV1, snapshots: Map<string, string | null>, input: WindowsServiceInstallInput): void {
  const expected = { "launcher.ps1": snapshots.get(input.launcherPath), "task.xml": snapshots.get(input.taskXmlPath) };
  for (const [name, source] of Object.entries(expected)) {
    const recorded = manifest.hashes[name];
    if (!recorded || source === null || source === undefined || sha256(source) !== recorded) throw new Error(`Prior Windows rollback material hash differs: ${name}`);
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function parsePriorManifest(source: string | null | undefined, home: string): WindowsInstallationManifestV1 | undefined {
  if (!source) return undefined;
  try { return parseWindowsInstallationManifest(JSON.parse(source), home); }
  catch (error) { throw new Error(`Prior Windows installation manifest is invalid: ${error instanceof Error ? error.message : String(error)}`); }
}
function taskLauncherPath(source: string): string {
  const decoded = source.replace(/&apos;/gu, "'").replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const quoted = decoded.match(/-File\s+"([^"]+)"/u);
  if (quoted) return path.win32.normalize(quoted[1]);
  const legacy = decoded.match(/-File\s+'([^'](?:[^']|'')*)'/u);
  if (!legacy) throw new Error("Windows task query omitted the package-owned launcher.");
  return path.win32.normalize(legacy[1].replace(/''/gu, "'"));
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
    await io.assertOwnedPath(backup);
    await io.writeTextAtomic(backup, content);
    await io.protectPrivateFile(backup);
    records.push({ source, backup, sha256: sha256(content) });
  }
  const recordPath = path.win32.join(root, "backup.json");
  await io.assertOwnedPath(recordPath);
  await io.writeTextAtomic(recordPath, JSON.stringify({ schemaVersion: 1, createdAt: io.now().toISOString(), records }, null, 2) + "\n");
  await io.protectPrivateFile(recordPath);
}

export async function assertCanonicalWindowsOwnedPath(homeInput: string, candidateInput: string): Promise<void> {
  const home = path.resolve(homeInput);
  const candidate = path.resolve(candidateInput);
  const relative = path.relative(home, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Windows owned path is outside the installation home.");
  const root = path.parse(home).root;
  const homeRelative = path.relative(root, home);
  const components = [...(homeRelative ? homeRelative.split(path.sep) : []), ...(relative ? relative.split(path.sep) : [])];
  let current = root;
  for (const component of components) {
    if (component) current = path.join(current, component);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error("Windows owned path traverses a reparse point.");
    const canonical = await realpath(current);
    if (canonical.toLocaleLowerCase() !== path.resolve(current).toLocaleLowerCase()) throw new Error("Windows owned path is not canonical.");
  }
}
