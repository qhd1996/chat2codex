import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { JsonStateStore } from "../state/store.js";
import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceInstallInput, type WindowsServiceIo } from "../setup/windows-service.js";
import { applyOwnerOnlyWindowsAcl, ensureWindowsGatewayKeys } from "../setup/windows-private-files.js";

export interface FreshWindowsLifecycleResult {
  evidenceLevel: "repository";
  taskRegistration: "simulated";
  installAttempts: number;
  uninstallAttempts: number;
  uninstallNoopCount: number;
  createdKeyCount: number;
  preservedKeyCount: number;
  distinctKeyFingerprints: number;
  taskCreateCount: number;
  taskDeleteCount: number;
  userDataPreserved: boolean;
  residualOwnedFiles: string[];
}

export async function runFreshWindowsLifecycleJourney(options: {
  root: string; seedState: string; stopAfterDoubleUninstall?: boolean;
}): Promise<FreshWindowsLifecycleResult> {
  const root = path.resolve(options.root);
  const home = path.join(root, "profile", ".chat2codex");
  const statePath = path.join(home, ".data", "state.json");
  const serviceRoot = path.join(home, ".service", "windows");
  const input: WindowsServiceInstallInput = {
    home, envFile: path.join(home, ".env"), launcherPath: path.join(serviceRoot, "launcher.ps1"),
    taskXmlPath: path.join(serviceRoot, "task.xml"), manifestPath: path.join(serviceRoot, "installation.json"),
    nodeBin: process.execPath, entrypoint: path.join(root, "package", "dist", "index.js"),
    logFile: path.join(home, ".data", "logs", "service.log"), pathEnv: path.dirname(process.execPath),
    taskName: "NoviceAcceptance", statePath,
  };
  await mkdir(path.dirname(statePath), { recursive: true });
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(statePath, options.seedState, { flag: "wx" });
  await writeFile(input.envFile, "NOVICE_SETTING=preserved\r\n", { flag: "wx" });
  const fixture = windowsLifecycleIo(input, home);
  let installAttempts = 0;
  let uninstallAttempts = 0;
  let uninstallNoopCount = 0;
  let createdKeyCount = 0;
  let preservedKeyCount = 0;
  const install = async () => {
    installAttempts += 1;
    const result = await installWindowsUserTask(input, fixture.io);
    createdKeyCount += result.createdKeys;
    preservedKeyCount += 3 - result.createdKeys;
  };
  const uninstall = async () => {
    uninstallAttempts += 1;
    const result = await uninstallWindowsUserTask(input.manifestPath, fixture.io);
    if (!result.removed) uninstallNoopCount += 1;
  };
  await install();
  await install();
  await uninstall();
  await uninstall();
  if (!options.stopAfterDoubleUninstall) {
    await install();
    await install();
    await uninstall();
  }
  const keyFiles = Object.values(fixture.keyPaths);
  const existingKeys = [];
  for (const file of keyFiles) {
    const source = await readFile(file, "utf8").catch(() => null);
    if (source) existingKeys.push(createHash("sha256").update(source.trim()).digest("hex"));
  }
  const manifest = await readFile(input.manifestPath, "utf8").catch(() => null);
  const residualOwnedFiles = manifest === null ? [] : ["installation.json"];
  const userDataPreserved = await readFile(statePath, "utf8").then((value) => value === options.seedState).catch(() => false);
  return {
    evidenceLevel: "repository", taskRegistration: "simulated", installAttempts, uninstallAttempts, uninstallNoopCount,
    createdKeyCount, preservedKeyCount, distinctKeyFingerprints: new Set(existingKeys).size || fixture.distinctFingerprints.size,
    taskCreateCount: fixture.taskCreateCount(), taskDeleteCount: fixture.taskDeleteCount(), userDataPreserved, residualOwnedFiles,
  };
}

function windowsLifecycleIo(input: WindowsServiceInstallInput, home: string) {
  const keyRoot = path.join(home, ".secrets", "desktop-gateway");
  const keyPaths = {
    "prompt-hook": path.join(keyRoot, "prompt-hook.key"),
    "stop-hook": path.join(keyRoot, "stop-hook.key"),
    "desktop-mcp": path.join(keyRoot, "desktop-mcp.key"),
  } as const;
  const distinctFingerprints = new Set<string>();
  const taskXml = new Map<string, string>();
  let creates = 0;
  let deletes = 0;
  const io: WindowsServiceIo = {
    async currentUserSid() {
      const report = await currentUserAclReport(input.envFile);
      return report.currentUserSid;
    },
    now: () => new Date("2026-08-02T14:00:00.000Z"),
    packageVersion: async () => "0.8.0-windows.1",
    readText: async (file) => await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
    writeTextAtomic: async (file, content) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); },
    removeFile: async (file) => { await rm(file, { force: true }); },
    ensureGatewayKeys: async () => {
      const result = await ensureWindowsGatewayKeys({
        root: keyRoot, applyAcl: applyOwnerOnlyWindowsAcl,
        inspectAcl: async (file) => { const report = await inspectWindowsTokenAcl(file); requireOwnerOnlyWindowsTokenAcl(report); return report; },
      });
      for (const file of Object.values(result.paths)) {
        const source = await readFile(file, "utf8");
        distinctFingerprints.add(createHash("sha256").update(source.trim()).digest("hex"));
      }
      return result;
    },
    runFile: async (_command, args) => {
      const operation = args[0];
      const name = args[2] ?? "";
      if (operation === "/Create") { creates += 1; taskXml.set(name, await readFile(input.taskXmlPath, "utf8")); return "created"; }
      if (operation === "/Query") return taskXml.get(name) ?? "";
      if (operation === "/Delete") { deletes += 1; taskXml.delete(name); return "deleted"; }
      throw new Error("Unexpected simulated task operation.");
    },
  };
  return { io, keyPaths, distinctFingerprints, taskCreateCount: () => creates, taskDeleteCount: () => deletes };
}

async function currentUserAclReport(file: string) {
  if (process.platform !== "win32") throw new Error("Novice Windows lifecycle requires Windows.");
  await stat(file);
  return await inspectWindowsTokenAcl(file);
}

export interface UpgradeRollbackResult {
  sourceSchema: number; migratedSchema: number; sourceHash: string; backupHash: string; rollbackHash: string;
  taskIdsBefore: string[]; taskIdsAfter: string[]; rollbackTaskIds: string[];
  outboxBefore: Array<{ id: string; status: string; sequence: number }>;
  outboxAfter: Array<{ id: string; status: string; sequence: number }>;
  rollbackOutbox: Array<{ id: string; status: string; sequence: number }>;
  pendingOutboxIds: string[]; deliveredOutboxIds: string[]; desktopGatewayAddedEmpty: boolean;
  rollbackLoadSucceeded: boolean; migratedStatePath: string;
}

export async function runV5UpgradeRollbackJourney(options: { root: string }): Promise<UpgradeRollbackResult> {
  const root = path.resolve(options.root);
  const statePath = path.join(root, "state.json");
  await mkdir(root, { recursive: true });
  const source = syntheticV5(root);
  const sourceBytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");
  await writeFile(statePath, sourceBytes, { flag: "wx" });
  const sourceHash = sha256(sourceBytes);
  const before = summary(source.adapters["weixin:novice"]);
  const store = new JsonStateStore(statePath, { adapterId: "weixin:novice", chat2codexHome: root });
  const loaded = await store.load();
  await store.save(loaded);
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  const backupBytes = await readFile(statePath + ".v5.bak");
  const after = summary(persisted.adapters["weixin:novice"]);
  const migratedStatePath = statePath + ".migrated";
  await writeFile(migratedStatePath, JSON.stringify(persisted, null, 2) + "\n", { flag: "wx" });
  await writeFile(statePath, backupBytes);
  const rollbackStore = new JsonStateStore(statePath, { adapterId: "weixin:novice", chat2codexHome: root });
  const rollbackLoaded = await rollbackStore.load();
  const rollback = summary(rollbackLoaded);
  return {
    sourceSchema: source.schemaVersion, migratedSchema: persisted.schemaVersion, sourceHash, backupHash: sha256(backupBytes),
    rollbackHash: sha256(await readFile(statePath)), taskIdsBefore: before.taskIds, taskIdsAfter: after.taskIds,
    rollbackTaskIds: rollback.taskIds, outboxBefore: before.outbox, outboxAfter: after.outbox, rollbackOutbox: rollback.outbox,
    pendingOutboxIds: after.outbox.filter((item) => item.status === "pending").map((item) => item.id),
    deliveredOutboxIds: after.outbox.filter((item) => item.status === "delivered").map((item) => item.id),
    desktopGatewayAddedEmpty: JSON.stringify(persisted.adapters["weixin:novice"].desktopGateway) === JSON.stringify({ bindings: {}, wakes: {} }),
    rollbackLoadSucceeded: rollback.taskIds.length === before.taskIds.length, migratedStatePath,
  };
}

function syntheticV5(root: string) {
  const at = "2026-08-02T00:00:00.000Z";
  const state = {
    tasks: {
      "task-existing": { taskId: "task-existing", conversationId: "novice-chat", chatType: "direct", senderKey: "synthetic-sender", title: "Synthetic existing task", aliases: [], workspaceKind: "explicit", workspaceRoot: root, executionCwd: root, isolationMode: "canonical_fifo", sessionEpoch: "synthetic-session", threadId: "synthetic-root", status: "completed", objectiveSummary: "synthetic upgrade fixture", recentRequests: [], createdAt: at, updatedAt: at, lastActiveAt: at },
    },
    conversations: { "novice-chat": { taskIds: ["task-existing"], lastTaskId: "task-existing" } }, chats: {},
    jobs: {
      "job-delivered": { id: "job-delivered", kind: "codex_run", messageId: "msg-delivered", chatId: "novice-chat", chatType: "direct", cwd: root, prompt: "synthetic", threadId: "synthetic-root", status: "completed", createdAt: at, updatedAt: at, completedAt: at, deliveryIds: ["out-delivered"], taskId: "task-existing" },
      "job-pending": { id: "job-pending", kind: "codex_run", messageId: "msg-pending", chatId: "novice-chat", chatType: "direct", cwd: root, prompt: "synthetic", threadId: "synthetic-root", status: "completed", createdAt: at, updatedAt: at, completedAt: at, deliveryIds: ["out-pending"], taskId: "task-existing" },
    },
    outbox: {
      "out-delivered": { id: "out-delivered", jobId: "job-delivered", taskId: "task-existing", chatId: "novice-chat", kind: "text", text: "synthetic delivered", sequence: 0, status: "delivered", idempotencyKey: "synthetic-delivered", attempts: 1, createdAt: at, updatedAt: at, deliveredAt: at },
      "out-pending": { id: "out-pending", jobId: "job-pending", taskId: "task-existing", chatId: "novice-chat", kind: "text", text: "synthetic pending", sequence: 0, status: "pending", idempotencyKey: "synthetic-pending", attempts: 0, createdAt: at, updatedAt: at },
    },
    pendingMessages: {}, processedMessageIds: ["msg-delivered", "msg-pending"], diagnostics: {}, imageDrafts: {}, clarifications: {}, usageAdvisor: { aggregates: {}, proposals: {} },
  };
  return { schemaVersion: 5 as const, adapters: { "weixin:novice": state } };
}
function summary(state: { tasks: Record<string, unknown>; outbox: Record<string, { id: string; status: string; sequence: number }> }) {
  return { taskIds: Object.keys(state.tasks).sort(), outbox: Object.values(state.outbox).map((item) => ({ id: item.id, status: item.status, sequence: item.sequence })).sort((a, b) => a.id.localeCompare(b.id)) };
}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
