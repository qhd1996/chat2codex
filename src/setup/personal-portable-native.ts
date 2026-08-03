import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { JsonStateStore } from "../state/store.js";
import { inspectWindowsDirectoryAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { updateEnvFile } from "./env-file.js";
import {
  composePersonalPortableInstallIo, executePersonalPortableInstall, executePersonalPortableReinstall,
  executePersonalPortableRollback, executePersonalPortableUninstall, type PersonalPortablePlan,
  PersonalPortableTransactionError, type PortablePreservedDataHashes,
} from "./personal-portable.js";
import { parsePortableReceipt, type PortableBackupReference, type PortableOwnedHashes, type PortableReceiptV1, type PortableUninstallManifestV1 } from "./portable-receipt.js";
import { createWindowsServiceIo } from "./service.js";
import { assertCanonicalWindowsOwnedPath, installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceInstallInput } from "./windows-service.js";
import { windowsTaskPath } from "./windows-task.js";
import { applyOwnerOnlyWindowsDirectoryAcl } from "./windows-private-files.js";
import { inspectInstalledWindowsDistribution } from "./windows-distribution-inspector.js";
import { diagnoseWindowsDistribution } from "./distribution-doctor.js";

const execFileAsync = promisify(execFile);
const manifestName = "portable-installation.json";

export interface PersonalPortableNativeOptions { nodeBin?: string; codexBin?: string; npmCommand?: string; taskName?: string; pathEnv?: string; }
export interface PersonalPortableNativeResult { action: string; status: string; receiptId?: string; removed?: boolean; rotatedKeyCount?: number; checks?: Array<{ code: string; status: string }> }

export async function runPersonalPortableNativeAction(plan: PersonalPortablePlan, options: PersonalPortableNativeOptions = {}): Promise<PersonalPortableNativeResult> {
  if (plan.action === "doctor") {
    const snapshot = await inspectInstalledWindowsDistribution(plan.home);
    const checks = snapshot ? diagnoseWindowsDistribution(snapshot) : [];
    return { action: plan.action, status: checks.some((item) => item.status === "error") ? "error" : "ok", checks: checks.map(({ code, status }) => ({ code, status })) };
  }
  try { await assertCanonicalWindowsOwnedPath(plan.home, plan.npmPrefix); await assertCanonicalWindowsOwnedPath(plan.home, plan.receiptRoot); } catch (cause) { throw new PersonalPortableTransactionError("PORTABLE_NATIVE_PREFLIGHT_FAILED", "Portable native preflight failed.", { cause, stage: "preflight" }); }
  let context: NativeContext; try { context = await createContext(plan, options); } catch (cause) { throw new PersonalPortableTransactionError("PORTABLE_NATIVE_CONTEXT_FAILED", "Portable native context failed.", { cause, stage: "native_context" }); }
  if (plan.action === "rollback") {
    const receipt = await executePersonalPortableRollback(plan.receiptId!, rollbackIo(context));
    return { action: plan.action, status: receipt.status, receiptId: receipt.receiptId };
  }
  if (plan.action === "uninstall") {
    const result = await nativeUninstall(context);
    return { action: plan.action, status: result.removed ? "uninstalled" : "already_uninstalled", removed: result.removed };
  }
  if (plan.action === "reinstall") {
    const result = await executePersonalPortableReinstall({ keyFingerprints: () => keyFingerprintsOrLast(plan.home), uninstall: async () => nativeUninstall(context), install: async () => { await executePersonalPortableInstall(plan, installIo(context)); } });
    return { action: plan.action, status: "reinstalled", rotatedKeyCount: result.rotatedKeyCount };
  }
  const receipt = await executePersonalPortableInstall(plan, installIo(context));
  return { action: plan.action, status: receipt.status, receiptId: receipt.receiptId };
}

interface NativeContext { plan: PersonalPortablePlan; options: Required<PersonalPortableNativeOptions>; serviceInput: WindowsServiceInstallInput; serviceIo: ReturnType<typeof createWindowsServiceIo>; currentBackup?: string; expectedBackup?: PortableBackupReference; restoreWasOnline?: boolean; }
async function createContext(plan: PersonalPortablePlan, options: PersonalPortableNativeOptions): Promise<NativeContext> {
  const nodeBin = path.resolve(options.nodeBin ?? process.execPath); const codexBin = path.resolve(options.codexBin ?? process.env.CODEX_BIN ?? "codex");
  const installedRoot = path.join(plan.npmPrefix, "node_modules", "chat2codex"); const serviceRoot = path.join(plan.home, ".service", "windows");
  const normalized: Required<PersonalPortableNativeOptions> = { nodeBin, codexBin, npmCommand: options.npmCommand ?? process.env.CHAT2CODEX_NPM_CLI ?? (process.platform === "win32" ? "npm.cmd" : "npm"), taskName: options.taskName ?? process.env.CHAT2CODEX_PORTABLE_TASK_NAME ?? "Chat2Codex", pathEnv: options.pathEnv ?? process.env.PATH ?? path.dirname(nodeBin) };
  const serviceInput: WindowsServiceInstallInput = { home: plan.home, envFile: path.join(plan.home, ".env"), launcherPath: path.join(serviceRoot, "launcher.ps1"), taskXmlPath: path.join(serviceRoot, "task.xml"), manifestPath: path.join(serviceRoot, "installation.json"), nodeBin, entrypoint: path.join(installedRoot, "dist", "index.js"), logFile: path.join(plan.home, ".data", "logs", "chat2codex.log"), pathEnv: normalized.pathEnv, taskName: normalized.taskName, statePath: path.join(plan.home, ".data", "state.json") };
  const nativeServiceIo = createWindowsServiceIo(plan.home);
  const serviceIo = { ...nativeServiceIo, packageVersion: async () => { const value = await readJsonOrNull(path.join(installedRoot, "package.json")); if (!value || typeof value.version !== "string") throw new Error("Installed package version is unavailable."); return value.version; } };
  return { plan, options: normalized, serviceInput, serviceIo };
}

function installIo(context: NativeContext) {
  const { plan, serviceInput, serviceIo } = context;
  const base = {
    now: () => new Date(), receiptId: () => `receipt-${Date.now()}-${randomUUID().slice(0, 8)}`, archiveSha256: sha256File,
    prerequisiteSnapshot: () => prerequisites(context), assertQuiescent: async () => { await assertQuiescent(serviceInput.statePath); await assertNoPendingReceipts(plan.receiptRoot); await assertPackagePrefixOwned(context); },
    writeReceipt: (receipt: PortableReceiptV1) => writeReceipt(plan.receiptRoot, receipt), backupPrior: () => backupPrior(context),
    installPackage: () => npmInstall(context), configure: () => configure(context), restoreState: () => restorePart(context, "state"), restoreConfiguration: () => restorePart(context, "config"), restorePackage: () => restorePart(context, "package"), restoreWindowsUserTask: () => restoreTask(context), ownedHashes: () => ownedHashes(context),
  };
  return composePersonalPortableInstallIo({ ...base, serviceInput, serviceIo, statePath: serviceInput.statePath, adapterId: "weixin:portable", priorWriterWasOnline: () => context.restoreWasOnline === true }, { installWindowsUserTask, uninstallWindowsUserTask, createStateStore: (file, options) => new JsonStateStore(file, options), migrateState: migrateAllStatePartitions, inspectInstalledWindowsDistribution, diagnoseWindowsDistribution });
}

function rollbackIo(context: NativeContext) {
  return { readReceipt: async (id: string) => { const receipt = parsePortableReceipt(JSON.parse(await fs.readFile(path.join(context.plan.receiptRoot, id + ".json"), "utf8"))); if (receipt.backup) { context.currentBackup = receipt.backup.backupId; context.expectedBackup = receipt.backup; context.restoreWasOnline = receipt.backup.wasOnline; } return receipt; }, assertQuiescent: () => assertQuiescent(context.serviceInput.statePath), ownedHashes: () => ownedHashes(context), writeReceipt: (receipt: PortableReceiptV1) => writeReceipt(context.plan.receiptRoot, receipt), stopCurrentWriter: async () => { await context.serviceIo.stopWriters(context.serviceInput.entrypoint); }, restoreState: () => restorePart(context, "state"), restoreConfiguration: () => restorePart(context, "config"), restorePackage: () => restorePart(context, "package"), restoreWindowsUserTask: () => restoreTask(context), uninstallWindowsUserTask: async () => { await uninstallWindowsUserTask(context.serviceInput.manifestPath, context.serviceIo); }, oldDoctor: async () => { const installedRoot = path.dirname(path.dirname(context.serviceInput.entrypoint)); const snapshot = await inspectInstalledWindowsDistribution(context.plan.home, installedRoot); return Boolean(snapshot && diagnoseWindowsDistribution(snapshot).every((item) => item.status !== "error" || ["DIST_WEIXIN_NOT_CONFIGURED", "DIST_WEIXIN_BOUNDARY_INVALID", "DIST_MCP_UNCONFIGURED", "DIST_INSTALLED_HOOK_DRIFT", "DIST_ROLLBACK_PENDING"].includes(item.code) || context.restoreWasOnline === false && item.code === "DIST_WRITER_CONFLICT")); } };
}

function uninstallIo(context: NativeContext) {
  const manifestPath = path.join(context.plan.home, manifestName);
  return { expectedHome: context.plan.home, expectedNpmPrefix: context.plan.npmPrefix, readUninstallManifest: async () => readJsonOrNull(manifestPath), assertQuiescent: () => assertQuiescent(context.serviceInput.statePath), uninstallWindowsUserTask: () => uninstallWindowsUserTask(context.serviceInput.manifestPath, context.serviceIo), removeOwnedFiles: async (files: readonly string[]) => { for (const file of files) { const info = await fs.lstat(file).catch(notFound); if (info === null) continue; if (!info.isFile() || info.isSymbolicLink()) throw new Error("Manifest-owned package entry is not a regular file."); await fs.rm(file); } for (const file of files) if (await exists(file)) throw new Error("Manifest-owned package file remained."); await removeEmptyDirectories(context.plan.npmPrefix); await fs.rm(manifestPath, { force: true }); return files.length; }, preservedDataHashes: () => preservedHashes(context.plan.home) };
}
async function nativeUninstall(context: NativeContext) {
  const manifest = await readJsonOrNull(path.join(context.plan.home, manifestName));
  if (manifest) { const fingerprints = await keyFingerprints(context.plan.home); await writeLastKeyFingerprints(context.plan.home, fingerprints); }
  return executePersonalPortableUninstall(uninstallIo(context));
}

async function prerequisites(context: NativeContext) { const [nodeVersion, npmVersion, codexVersion] = await Promise.all([commandVersion(context.options.nodeBin, ["--version"]), npmVersionFor(context), commandVersion(context.options.codexBin, ["--version"])]); const powershellVersion = process.platform === "win32" ? await commandVersion("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]) : "unavailable"; if (compareVersions(nodeVersion, "20.19.0") < 0 || process.platform === "win32" && compareVersions(powershellVersion, "5.1.0") < 0) throw new Error("Portable prerequisite version is unsupported."); return { windowsVersion: os.release(), architecture: process.arch === "arm64" ? "arm64" as const : "x64" as const, powershellVersion, nodeVersion, npmVersion, codexCliVersion: codexVersion, desktopVersion: null }; }
function compareVersions(left: string, right: string): number { const a = left.split(".").slice(0, 3).map(Number); const b = right.split(".").slice(0, 3).map(Number); for (let i = 0; i < 3; i += 1) { const diff = (a[i] ?? 0) - (b[i] ?? 0); if (diff) return diff; } return 0; }
async function commandVersion(command: string, args: string[]): Promise<string> { const { stdout } = await execFileAsync(command, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true }); const match = stdout.match(/[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?/u); if (!match) throw new Error("Required prerequisite version is unavailable."); return match[0]; }
async function npmVersionFor(context: NativeContext): Promise<string> { return context.options.npmCommand.toLocaleLowerCase().endsWith(".js") ? commandVersion(context.options.nodeBin, [context.options.npmCommand, "--version"]) : commandVersion(context.options.npmCommand, ["--version"]); }
async function npmInstall(context: NativeContext): Promise<void> { const archive = context.plan.archivePath!; const args = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", context.plan.npmPrefix, archive]; if (!context.options.npmCommand.toLocaleLowerCase().endsWith(".js")) throw new Error("Portable npm must be the canonical npm CLI JavaScript file."); await run(context.options.nodeBin, [context.options.npmCommand, ...args]); await writeUninstallManifest(context); }
async function run(command: string, args: string[]): Promise<void> { await execFileAsync(command, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }); }
async function configure(context: NativeContext): Promise<void> { const workspace = path.join(context.plan.home, "workspace"); await fs.mkdir(workspace, { recursive: true }); const envFile = context.serviceInput.envFile; if (!(await exists(envFile))) { const template = await fs.readFile(path.join(context.plan.npmPrefix, "node_modules", "chat2codex", ".env.example"), "utf8"); await fs.mkdir(path.dirname(envFile), { recursive: true }); await fs.writeFile(envFile, template, { flag: "wx" }); } await updateEnvFile(envFile, { CHAT2CODEX_ADAPTER: "weixin", CHAT2CODEX_HOME: context.plan.home, WEIXIN_CREDENTIALS_PATH: path.join(context.plan.home, "weixin", "credentials.json"), CODEX_BIN: context.options.codexBin, CODEX_WORKDIR: workspace, BRIDGE_STATE_PATH: context.serviceInput.statePath, ATTACHMENT_DOWNLOAD_DIR: path.join(context.plan.home, ".data", "attachments"), ALLOW_DIRECT_MESSAGES: "true", ALLOW_GROUPS: "false" }); }
async function assertQuiescent(statePath: string): Promise<void> { const raw = await readJsonOrNull(statePath); if (raw === null) return; await assertQuiescentValue(raw); }
async function assertNoPendingReceipts(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: any) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLocaleLowerCase().endsWith(".json")) continue;
    let receipt: PortableReceiptV1; try { receipt = parsePortableReceipt(JSON.parse(await fs.readFile(path.join(root, entry.name), "utf8"))); } catch { throw new Error("Portable receipt inventory is invalid."); }
    if (!["committed", "awaiting_setup", "rolled_back", "aborted"].includes(receipt.status)) throw new Error("A pending portable receipt blocks a new lifecycle action.");
  }
}
async function migrateAllStatePartitions(statePath: string, home: string): Promise<void> {
  const raw = await readJsonOrNull(statePath);
  if (raw === null) { await atomicJson(statePath, { schemaVersion: 6, adapters: {} }); return; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![2, 3, 4, 5, 6].includes((raw as any).schemaVersion) || !(raw as any).adapters || typeof (raw as any).adapters !== "object") throw new Error("State migration source is unsupported or ambiguous.");
  const adapterIds = Object.keys((raw as any).adapters);
  if (adapterIds.length === 0) { if ((raw as any).schemaVersion !== 6) { await fs.copyFile(statePath, `${statePath}.v${String((raw as any).schemaVersion)}.bak`, fs.constants.COPYFILE_EXCL).catch((error: any) => { if (error?.code !== "EEXIST") throw error; }); await atomicJson(statePath, { schemaVersion: 6, adapters: {} }); } return; }
  for (const adapterId of adapterIds) { const store = new JsonStateStore(statePath, { adapterId, chat2codexHome: home }); const state = await store.load(); await store.save(state); }
}
async function backupPrior(context: NativeContext): Promise<PortableBackupReference> {
  const observed = await context.serviceIo.countWriters(context.serviceInput.entrypoint);
  if (observed > 1) throw new Error("Portable snapshot writer state is ambiguous.");
  const stopped = observed === 1 ? await context.serviceIo.stopWriters(context.serviceInput.entrypoint) : 0;
  if (stopped !== observed) throw new Error("Portable snapshot writer state changed during quiesce.");
  const wasOnline = stopped === 1;
  context.restoreWasOnline = wasOnline;
  const backupId = `backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
  context.currentBackup = backupId;
  const root = path.join(context.plan.home, "backups", backupId);
  let complete = false;
  try {
    await fs.mkdir(root, { recursive: true });
    if (process.platform === "win32") await applyOwnerOnlyWindowsDirectoryAcl(root);
    if (await exists(context.plan.npmPrefix)) await listFiles(context.plan.npmPrefix);
    await copyIfExists(context.plan.npmPrefix, path.join(root, "package"));
    await copyIfExists(context.serviceInput.envFile, path.join(root, "config"));
    await copyIfExists(context.serviceInput.statePath, path.join(root, "state"));
    await copyIfExists(path.join(context.plan.home, ".service", "windows"), path.join(root, "service"));
    await copyIfExists(path.join(context.plan.home, manifestName), path.join(root, manifestName));
    const hashes = await ownedHashes(context);
    const materialHashes = await backupMaterialHashes(root);
    await atomicJson(path.join(root, "backup.json"), { schemaVersion: 1, backupId, hashes, materialHashes, wasOnline });
    const reference = { backupId, hashes, wasOnline };
    context.expectedBackup = reference;
    complete = true;
    return reference;
  } finally {
    if (!complete) {
      context.currentBackup = undefined; context.expectedBackup = undefined; context.restoreWasOnline = undefined;
      await fs.rm(root, { recursive: true, force: true });
      if (wasOnline) await context.serviceIo.startAndVerifyTask(windowsTaskPath(context.options.taskName), context.serviceInput.entrypoint, context.serviceInput.statePath);
    }
  }
}
async function restorePart(context: NativeContext, part: "package" | "config" | "state") {
  const root = await backupRoot(context);
  const target = part === "package" ? context.plan.npmPrefix : part === "config" ? context.serviceInput.envFile : context.serviceInput.statePath;
  await fs.rm(target, { recursive: true, force: true });
  await copyIfExists(path.join(root, part), target);
  if (part === "package") {
    await fs.rm(path.join(context.plan.home, manifestName), { force: true });
    await copyIfExists(path.join(root, manifestName), path.join(context.plan.home, manifestName));
  }
}
async function restoreTask(context: NativeContext) { const root = await backupRoot(context); const taskPath = windowsTaskPath(context.options.taskName); await context.serviceIo.stopWriters(context.serviceInput.entrypoint); await execFileAsync("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"], { windowsHide: true }).catch(() => undefined); const target = path.join(context.plan.home, ".service", "windows"); await fs.rm(target, { recursive: true, force: true }); await copyIfExists(path.join(root, "service"), target); if (await exists(context.serviceInput.taskXmlPath)) { await run("schtasks.exe", ["/Create", "/TN", taskPath, "/XML", context.serviceInput.taskXmlPath, "/F"]); if (context.restoreWasOnline) await context.serviceIo.startAndVerifyTask(taskPath, context.serviceInput.entrypoint, context.serviceInput.statePath); } }
async function backupRoot(context: NativeContext): Promise<string> {
  if (!context.currentBackup || !context.expectedBackup || context.expectedBackup.backupId !== context.currentBackup) throw new Error("Rollback backup reference is unavailable.");
  const backups = path.join(context.plan.home, "backups");
  const root = path.join(backups, context.currentBackup);
  await assertCanonicalWindowsOwnedPath(backups, root);
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Rollback backup root is invalid.");
  if (process.platform === "win32") requireOwnerOnlyWindowsTokenAcl(await inspectWindowsDirectoryAcl(root));
  const metadata = await readJsonOrNull(path.join(root, "backup.json"));
  if (!metadata || metadata.schemaVersion !== 1 || metadata.backupId !== context.currentBackup || metadata.wasOnline !== context.expectedBackup.wasOnline || !sameHashesValue(metadata.hashes, context.expectedBackup.hashes)) throw new Error("Rollback backup metadata differs from the receipt.");
  const actualMaterial = await backupMaterialHashes(root);
  if (!sameMaterialHashes(metadata.materialHashes, actualMaterial)) throw new Error("Rollback backup material hash is invalid.");
  return root;
}
async function backupMaterialHashes(root: string): Promise<Record<"package" | "config" | "state" | "service" | "manifest", string | null>> {
  return { package: await treeHash(path.join(root, "package")), config: await fileHash(path.join(root, "config")), state: await fileHash(path.join(root, "state")), service: await treeHash(path.join(root, "service")), manifest: await fileHash(path.join(root, manifestName)) };
}
function sameHashesValue(left: unknown, right: PortableOwnedHashes): boolean {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  return (["package", "config", "state", "task"] as const).every((name) => (left as Record<string, unknown>)[name] === right[name]);
}
function sameMaterialHashes(left: unknown, right: Record<string, string | null>): boolean {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const names = ["package", "config", "state", "service", "manifest"] as const;
  return Object.keys(left).length === names.length && names.every((name) => (left as Record<string, unknown>)[name] === right[name]);
}
async function ownedHashes(context: NativeContext): Promise<PortableOwnedHashes> { const manifest = await readJsonOrNull(path.join(context.plan.home, manifestName)) as PortableUninstallManifestV1 | null; return { package: manifest ? await filesHash(context.plan.npmPrefix, manifest.ownedPackageFiles) : null, config: await fileHash(context.serviceInput.envFile), state: await fileHash(context.serviceInput.statePath), task: await treeHash(path.join(context.plan.home, ".service", "windows")) }; }
async function writeReceipt(root: string, receipt: PortableReceiptV1): Promise<void> { parsePortableReceipt(receipt); await atomicJson(path.join(root, receipt.receiptId + ".json"), receipt); }
async function writeUninstallManifest(context: NativeContext): Promise<void> { const files = await listFiles(context.plan.npmPrefix); const manifest: PortableUninstallManifestV1 = { schemaVersion: 1, home: context.plan.home, npmPrefix: context.plan.npmPrefix, ownedPackageFiles: files }; await atomicJson(path.join(context.plan.home, manifestName), manifest); }
async function assertPackagePrefixOwned(context: NativeContext): Promise<void> {
  if (!(await exists(context.plan.npmPrefix))) return;
  const actual = await listFiles(context.plan.npmPrefix); if (actual.length === 0) return;
  const raw = await readJsonOrNull(path.join(context.plan.home, manifestName));
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.ownedPackageFiles)) throw new Error("Non-empty private npm prefix lacks an ownership manifest.");
  const expected = [...raw.ownedPackageFiles].map((item) => path.normalize(String(item))).sort();
  if (JSON.stringify(actual.map(path.normalize).sort()) !== JSON.stringify(expected)) throw new Error("Private npm prefix contains unknown files.");
}
async function preservedHashes(home: string): Promise<PortablePreservedDataHashes> { return { state: await fileHash(path.join(home, ".data", "state.json")), credentials: await treeHash(path.join(home, "weixin")), deliverables: await treeHash(path.join(home, "deliverables")), backups: await treeHash(path.join(home, "backups")) }; }
async function keyFingerprints(home: string): Promise<string[]> { const root = path.join(home, ".secrets", "desktop-gateway"); return Promise.all(["prompt-hook.key", "stop-hook.key", "desktop-mcp.key"].map(async (name) => createHash("sha256").update((await fs.readFile(path.join(root, name), "utf8")).trim()).digest("hex"))); }
async function keyFingerprintsOrLast(home: string): Promise<string[]> { try { return await keyFingerprints(home); } catch (error: any) { if (error?.code !== "ENOENT") throw error; return readLastKeyFingerprints(home); } }
async function writeLastKeyFingerprints(home: string, fingerprints: string[]): Promise<void> { await atomicJson(path.join(home, "backups", "last-uninstall-keys.json"), { schemaVersion: 1, fingerprints }); }
async function readLastKeyFingerprints(home: string): Promise<string[]> { const value = await readJsonOrNull(path.join(home, "backups", "last-uninstall-keys.json")); if (!value || value.schemaVersion !== 1 || !Array.isArray(value.fingerprints)) throw new Error("Prior key fingerprints are unavailable for reinstall."); return value.fingerprints; }
async function atomicJson(file: string, value: unknown): Promise<void> { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = file + "." + randomUUID() + ".tmp"; await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); await fs.rename(temp, file); }
async function copyIfExists(source: string, target: string): Promise<void> { if (await exists(source)) await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true }); }
async function fileHash(file: string): Promise<string | null> { try { return createHash("sha256").update(await fs.readFile(file)).digest("hex"); } catch (error: any) { if (error?.code === "ENOENT") return null; throw error; } }
async function filesHash(root: string, files: readonly string[]): Promise<string> { const records: string[] = []; for (const file of [...files].sort()) { const relative = path.relative(root, file); if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Portable package hash path escaped its prefix."); const digest = await fileHash(file); if (!digest) throw new Error("Portable package hash file is missing."); records.push(relative.replaceAll("\\", "/") + "\0" + digest); } return createHash("sha256").update(records.join("\n")).digest("hex"); }
async function treeHash(root: string): Promise<string | null> { if (!(await exists(root))) return null; const files = await listFiles(root); if (files.length === 0) return null; const records: string[] = []; for (const file of files) records.push(path.relative(root, file).replaceAll("\\", "/") + "\0" + await fileHash(file)); return createHash("sha256").update(records.join("\n")).digest("hex"); }
async function listFiles(root: string): Promise<string[]> { const result: string[] = []; async function visit(current: string) { for (const entry of await fs.readdir(current, { withFileTypes: true })) { const target = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error("Portable owned tree contains a symbolic link."); if (entry.isDirectory()) await visit(target); else if (entry.isFile()) result.push(target); else throw new Error("Portable owned tree contains an unsupported entry."); } } await visit(root); return result.sort(); }
async function removeEmptyDirectories(root: string): Promise<void> { const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []); for (const entry of entries) if (entry.isDirectory()) await removeEmptyDirectories(path.join(root, entry.name)); await fs.rmdir(root).catch(() => undefined); }
async function readJsonOrNull(file: string): Promise<any | null> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error: any) { if (error?.code === "ENOENT") return null; throw error; } }
async function sha256File(file: string): Promise<string> { const info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink() || path.resolve(await fs.realpath(file)).toLocaleLowerCase() !== path.resolve(file).toLocaleLowerCase()) throw new Error("Reviewed archive must be a canonical regular file."); return createHash("sha256").update(await fs.readFile(file)).digest("hex"); }
async function exists(file: string): Promise<boolean> { return Boolean(await fs.lstat(file).catch(notFound)); }
function notFound(error: any): null { if (error?.code === "ENOENT") return null; throw error; }

async function assertQuiescentValue(value: unknown): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![4, 5, 6].includes((value as any).schemaVersion) || !(value as any).adapters || typeof (value as any).adapters !== "object") throw new Error("State obligations are uncertain.");
  const file = path.join(os.tmpdir(), "c2c-quiescent-unused-" + randomUUID());
  await assertQuiescentFromValue(value, file);
}
async function assertQuiescentFromValue(raw: unknown, _file: string): Promise<void> {
  const envelope = raw as any;
  for (const state of Object.values(envelope.adapters) as any[]) {
    if (!state || typeof state !== "object" || !state.pendingMessages || !state.outbox || !state.jobs || !state.tasks) throw new Error("State obligations are uncertain.");
    if (Object.keys(state.pendingMessages).length) throw new Error("Pending messages block lifecycle mutation.");
    if (Object.values(state.outbox).some((item: any) => item?.status !== "delivered")) throw new Error("Pending outbox blocks lifecycle mutation.");
    if (Object.values(state.jobs).some((item: any) => !["completed", "failed", "cancelled", "interrupted"].includes(item?.status))) throw new Error("Active jobs block lifecycle mutation.");
    if (Object.values(state.tasks).some((item: any) => !["completed", "failed", "interrupted", "archived"].includes(item?.status))) throw new Error("Active tasks block lifecycle mutation.");
    for (const binding of Object.values(state.desktopGateway?.bindings ?? {}) as any[]) if (binding?.owner !== "disabled" || binding?.activeStartFence || binding?.releaseRequested || binding?.pendingWakeIds?.length) throw new Error("Desktop obligations block lifecycle mutation.");
  }
}
function testContext(input: { home: string; npmPrefix: string; receiptRoot: string }): NativeContext {
  const plan: PersonalPortablePlan = { action: "upgrade", archivePath: path.join(input.home, "candidate.tgz"), archiveSha256: "a".repeat(64), receiptId: undefined, home: input.home, npmPrefix: input.npmPrefix, receiptRoot: input.receiptRoot, preserveUserData: true, dryRun: false };
  const serviceInput = { home: input.home, envFile: path.join(input.home, ".env"), launcherPath: path.join(input.home, ".service", "windows", "launcher.ps1"), taskXmlPath: path.join(input.home, ".service", "windows", "task.xml"), manifestPath: path.join(input.home, ".service", "windows", "installation.json"), nodeBin: process.execPath, entrypoint: path.join(input.npmPrefix, "node_modules", "chat2codex", "dist", "index.js"), logFile: path.join(input.home, "log"), pathEnv: process.env.PATH ?? "", taskName: "Chat2Codex-Test", statePath: path.join(input.home, ".data", "state.json") };
  return { plan, options: { nodeBin: process.execPath, codexBin: process.execPath, npmCommand: process.execPath, taskName: "Chat2Codex-Test", pathEnv: process.env.PATH ?? "" }, serviceInput, serviceIo: { countWriters: async () => 0, stopWriters: async () => 0, startAndVerifyTask: async () => undefined } as any };
}
function selectBackup(context: NativeContext, backupId: string, reference?: PortableBackupReference): void { context.currentBackup = backupId; context.expectedBackup = reference; }
export const personalPortableNativeInternals = { testContext, backupPrior, selectBackup, restorePart, treeHash, assertQuiescentValue, assertPackagePrefixOwned, keyFingerprints, keyFingerprintsOrLast, writeLastKeyFingerprints, readLastKeyFingerprints };
