import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthoritativeCodexThread } from "../agent/codex-runner.js";
import { NonceReplayCache, authenticateGatewayRequest, signGatewayRequest, type GatewayCapability, type GatewayAuthErrorCode } from "../desktop-gateway/auth.js";
import { DesktopOwnershipCoordinator } from "../core/desktop-ownership.js";
import { DesktopReconciler } from "../core/desktop-reconciler.js";
import { textInteractionPolicy } from "../core/interaction-policy.js";
import { MediaOutbox } from "../core/media-outbox.js";
import { Phase3GatewayController } from "../core/phase3-gateway-controller.js";
import { TaskRegistry } from "../core/task-registry.js";
import { WorkspaceRouter } from "../core/workspace-router.js";
import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { JsonStateStore } from "../state/store.js";
import { emptyState, type BridgeState, type DurableOutboxMessage } from "../state/types.js";
import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceInstallInput, type WindowsServiceIo } from "../setup/windows-service.js";
import { applyOwnerOnlyWindowsAcl, ensureWindowsGatewayKeys } from "../setup/windows-private-files.js";
import { NoviceMockTransport } from "./novice-mock-transport.js";

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

export function validateFreshWindowsLifecycleResult(value: FreshWindowsLifecycleResult): FreshWindowsLifecycleResult {
  if (value.evidenceLevel !== "repository" || value.taskRegistration !== "simulated") throw new Error("Fresh novice lifecycle evidence level is invalid.");
  if (value.installAttempts !== 2 || value.uninstallAttempts !== 2 || value.uninstallNoopCount !== 1) throw new Error("Fresh novice lifecycle is not double-idempotent.");
  if (value.createdKeyCount !== 3 || value.preservedKeyCount !== 3 || value.distinctKeyFingerprints !== 3) throw new Error("Fresh novice lifecycle key evidence is invalid.");
  if (value.taskCreateCount !== 2 || value.taskDeleteCount !== 1) throw new Error("Fresh novice lifecycle task evidence is invalid.");
  if (!value.userDataPreserved) throw new Error("Fresh novice lifecycle user data was not preserved.");
  if (value.residualOwnedFiles.length !== 0) throw new Error("Fresh novice lifecycle left an owned residual.");
  return value;
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
  return validateFreshWindowsLifecycleResult({
    evidenceLevel: "repository", taskRegistration: "simulated", installAttempts, uninstallAttempts, uninstallNoopCount,
    createdKeyCount, preservedKeyCount, distinctKeyFingerprints: new Set(existingKeys).size || fixture.distinctFingerprints.size,
    taskCreateCount: fixture.taskCreateCount(), taskDeleteCount: fixture.taskDeleteCount(), userDataPreserved, residualOwnedFiles,
  });
}

export async function runNoviceStoragePermissionRecoveryJourney(rootInput: string): Promise<boolean> {
  const root = path.resolve(rootInput);
  for (const code of ["ENOSPC", "EACCES"] as const) {
    const caseRoot = path.join(root, code.toLocaleLowerCase());
    const home = path.join(caseRoot, "profile", ".chat2codex");
    const statePath = path.join(home, ".data", "state.json");
    const serviceRoot = path.join(home, ".service", "windows");
    const input: WindowsServiceInstallInput = {
      home, envFile: path.join(home, ".env"), launcherPath: path.join(serviceRoot, "launcher.ps1"),
      taskXmlPath: path.join(serviceRoot, "task.xml"), manifestPath: path.join(serviceRoot, "installation.json"),
      nodeBin: process.execPath, entrypoint: path.join(caseRoot, "package", "dist", "index.js"),
      logFile: path.join(home, ".data", "logs", "service.log"), pathEnv: path.dirname(process.execPath),
      taskName: "NoviceFault" + code, statePath,
    };
    await mkdir(path.dirname(statePath), { recursive: true });
    await mkdir(serviceRoot, { recursive: true });
    await writeFile(statePath, "preserved state\n", { flag: "wx" });
    await writeFile(input.envFile, "USER_SETTING=preserved\r\n", { flag: "wx" });
    const fixture = windowsLifecycleIo(input, home);
    fixture.io.currentUserSid = async () => "S-1-5-21-1000-1000-1000-1001";
    fixture.io.ensureGatewayKeys = async () => ({
      created: [], preserved: [],
      paths: {
        "prompt-hook": path.join(home, ".secrets", "desktop-gateway", "prompt-hook.key"),
        "stop-hook": path.join(home, ".secrets", "desktop-gateway", "stop-hook.key"),
        "desktop-mcp": path.join(home, ".secrets", "desktop-gateway", "desktop-mcp.key"),
      },
    });
    const write = fixture.io.writeTextAtomic;
    let injected = false;
    fixture.io.writeTextAtomic = async (file, content) => {
      if (!injected && file === input.launcherPath) {
        injected = true;
        throw Object.assign(new Error("synthetic durable write failure"), { code });
      }
      await write(file, content);
    };
    let rejected = false;
    try { await installWindowsUserTask(input, fixture.io); } catch { rejected = true; }
    const manifestExists = await stat(input.manifestPath).then(() => true).catch(() => false);
    if (!rejected || !injected || manifestExists ||
        await readFile(input.envFile, "utf8") !== "USER_SETTING=preserved\r\n" ||
        await readFile(statePath, "utf8") !== "preserved state\n") return false;
  }
  return true;
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
    assertOwnedPath: async () => undefined, protectPrivateFile: async () => undefined, stopWriters: async () => 0,
    taskExists: async (taskPath) => taskXml.has(taskPath),
    ensureGatewayKeys: async () => {
      const existing = await Promise.all(Object.values(keyPaths).map(async (file) => await stat(file).then(() => true).catch(() => false)));
      const freshReports = existing.every(Boolean)
        ? new Map(await Promise.all(Object.values(keyPaths).map(async (file) => {
            const report = await inspectWindowsTokenAcl(file);
            requireOwnerOnlyWindowsTokenAcl(report);
            return [file, report] as const;
          })))
        : new Map<string, Awaited<ReturnType<typeof inspectWindowsTokenAcl>>>();
      const result = await ensureWindowsGatewayKeys({
        root: keyRoot, applyAcl: applyOwnerOnlyWindowsAcl,
        inspectAcl: async (file) => {
          const fresh = freshReports.get(file);
          if (fresh) return fresh;
          const report = await inspectWindowsTokenAcl(file);
          requireOwnerOnlyWindowsTokenAcl(report);
          return report;
        },
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

export async function runNoviceDailyUseJourney(options: { root: string }) {
  const root = path.resolve(options.root);
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const routeKinds = ["work", "travel", "personal", "finance", "ai_lab", "learning"] as const;
  const routes: Record<string, string> = {};
  for (const kind of routeKinds) {
    const directory = path.join(root, kind);
    await mkdir(directory, { recursive: true });
    routes[kind] = directory;
  }
  const workspaceRouter = await WorkspaceRouter.create(routes, [root]);
  const state = emptyState();
  const registry = new TaskRegistry({ now: () => Date.parse("2026-08-02T00:00:00.000Z") });
  const tasks = ["first", "second"].map((name, index) => registry.create(state, {
    conversationId: "novice-chat", chatType: "direct", senderKey: "synthetic-sender",
    title: "Synthetic " + name, aliases: [name], workspaceKind: index === 0 ? "work" : "travel",
    workspaceRoot: workspaceRouter.resolveKind(index === 0 ? "work" : "travel").root, objective: "synthetic daily-use task",
  }));
  for (const [index, task] of tasks.entries()) {
    registry.bindThread(state, task.taskId, "synthetic-thread-" + index);
    registry.transition(state, task.taskId, "queued"); registry.transition(state, task.taskId, "running");
    registry.appendRequest(state, task.taskId, "continue the exact task");
    registry.transition(state, task.taskId, "stopping"); registry.transition(state, task.taskId, "interrupted");
    registry.transition(state, task.taskId, "queued"); registry.transition(state, task.taskId, "running");
    registry.appendRequest(state, task.taskId, "retry the exact task");
  }
  const task = tasks[0]!; const at = "2026-08-02T00:00:00.000Z";
  const job = { id: "novice-daily-job", kind: "codex_run" as const, messageId: "novice-message", chatId: task.conversationId, chatType: "direct" as const, cwd: task.workspaceRoot, prompt: "synthetic prompt", collaborationMode: "plan" as const, threadId: task.threadId, status: "completed" as const, createdAt: at, updatedAt: at, completedAt: at, deliveryIds: [], taskId: task.taskId };
  state.jobs[job.id] = job;
  const outbox = new MediaOutbox().appendResult(state, job, {
    text: "synthetic result", textKind: "markdown", createdAt: at,
    stagedFiles: [
      { sourcePath: path.join(root, "source.png"), stagedPath: path.join(root, "staged.png"), fileName: "result.png", kind: "image", mediaType: "image/png", size: 1, sha256: "a".repeat(64) },
      { sourcePath: path.join(root, "source.txt"), stagedPath: path.join(root, "staged.txt"), fileName: "result.txt", kind: "file", mediaType: "text/plain", size: 1, sha256: "b".repeat(64) },
    ],
  });
  const transport = new NoviceMockTransport(); const deliveredIds: string[] = [];
  for (const delivery of outbox) { await deliverThroughProductState(delivery, transport); deliveredIds.push(delivery.id); }
  let duplicateAcknowledgements = 0;
  for (const delivery of outbox) if ((await transport.deliver(deliveryEnvelope(delivery))).duplicate) duplicateAcknowledgements += 1;
  const approvalAllowed = textInteractionPolicy.isApprovalDecisionAllowed({ id: "approval", kind: "command", decisions: ["accept", "decline"] }, 0);
  const permissionAllowed = textInteractionPolicy.isPermissionDecisionAllowed({ id: "permission", cwd: task.workspaceRoot, permissions: { fileSystem: { write: [task.workspaceRoot] } } }, "grantTurn");
  const structuredValue = textInteractionPolicy.getMcpOptionValue({
    status: "pending", updatedAt: at, request: { id: "structured", serverName: "synthetic", threadId: task.threadId!, turnId: "turn", message: "Select mode", mode: "form", fields: [{ name: "mode", title: "Mode", description: null, required: true, type: "enum", default: null, options: [{ value: "conservative", title: "Conservative" }] }] },
  }, "mode", 0);
  return { taskIds: tasks.map((item) => item.taskId), taskStatuses: tasks.map((item) => item.status), recentRequests: tasks.flatMap((item) => item.recentRequests), workspaceKinds: workspaceRouter.list().map((item) => item.kind), workspaceContained: workspaceRouter.list().every((item) => !path.relative(canonicalRoot, item.root).startsWith("..")), planMode: job.collaborationMode, approvalAllowed, permissionAllowed, structuredValue, outboxKinds: outbox.map((item) => item.kind), outboxSequences: outbox.map((item) => item.sequence), deliveredIds, duplicateAcknowledgements, codexRuns: 1 };
}

export async function runNoviceNetworkRecoveryJourney() {
  const state = dailyOutboxFixture(); const transport = new NoviceMockTransport();
  const deliveries = Object.values(state.outbox).sort((a, b) => a.sequence - b.sequence);
  transport.setOnline(false); let offlineErrorCode = "";
  try { await deliverThroughProductState(deliveries[0]!, transport); } catch (error) { offlineErrorCode = errorCode(error); }
  const pendingWhileOffline = deliveries.filter((item) => item.status === "pending").map((item) => item.id);
  transport.setOnline(true); const deliveryOrder: string[] = [];
  for (const delivery of deliveries) { await deliverThroughProductState(delivery, transport); deliveryOrder.push(delivery.id); }
  let duplicateAcknowledgements = 0;
  for (const delivery of deliveries) if ((await transport.deliver(deliveryEnvelope(delivery))).duplicate) duplicateAcknowledgements += 1;
  return { offlineErrorCode, pendingWhileOffline, deliveryIds: deliveries.map((item) => item.id), deliveryOrder, duplicateAcknowledgements, codexRuns: 1, allDelivered: deliveries.every((item) => item.status === "delivered") };
}

function deliveryEnvelope(delivery: DurableOutboxMessage) { return { idempotencyKey: delivery.idempotencyKey, kind: delivery.kind, contentHash: delivery.kind === "image" || delivery.kind === "file" ? delivery.sha256 : createHash("sha256").update(delivery.text).digest("hex") }; }
async function deliverThroughProductState(delivery: DurableOutboxMessage, transport: NoviceMockTransport): Promise<void> { if (delivery.status === "delivered") return; delivery.status = "sending"; delivery.attempts += 1; try { await transport.deliver(deliveryEnvelope(delivery)); delivery.status = "delivered"; delivery.deliveredAt = "2026-08-02T00:00:01.000Z"; delivery.updatedAt = delivery.deliveredAt; } catch (error) { delivery.status = "pending"; delivery.lastError = "Mock transport unavailable."; throw error; } }
function dailyOutboxFixture(): BridgeState { const state = emptyState(); const at = "2026-08-02T00:00:00.000Z"; state.tasks.task = { taskId: "task", conversationId: "conversation", chatType: "direct", senderKey: "synthetic", title: "task", aliases: [], workspaceKind: "explicit", workspaceRoot: "C:/synthetic", executionCwd: "C:/synthetic", isolationMode: "canonical_fifo", sessionEpoch: "epoch", threadId: "root", status: "completed", objectiveSummary: "", recentRequests: [], createdAt: at, updatedAt: at, lastActiveAt: at }; state.conversations.conversation = { taskIds: ["task"], lastTaskId: "task" }; const job = { id: "job", kind: "codex_run" as const, messageId: "message", chatId: "conversation", chatType: "direct" as const, cwd: "C:/synthetic", prompt: "synthetic", threadId: "root", status: "completed" as const, createdAt: at, updatedAt: at, completedAt: at, deliveryIds: [], taskId: "task" }; state.jobs.job = job; new MediaOutbox().appendResult(state, job, { textEntries: [{ kind: "text", text: "one" }, { kind: "text", text: "two" }], createdAt: at }); return state; }

export async function runNoviceGatewayRecoveryJourney() {
  const at = (second: number) => "2026-08-02T00:00:" + String(second).padStart(2, "0") + ".000Z";
  const uuid = (n: number) => "019fc160-7e0d-7990-9317-" + String(n).padStart(12, "0");
  const capability: GatewayCapability = { keyId: "prompt", role: "prompt_hook", endpoints: ["user_prompt_submit"], secret: new Uint8Array(32).fill(7) };
  const body = Buffer.from("{}"); const now = new Date(at(1)); const nonce = "AQEBAQEBAQEBAQEBAQEBAQ";
  const signed = signGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", requestId: uuid(1), timestamp: now.toISOString(), nonce, body, capability });
  const cache = new NonceReplayCache({ now: () => now.getTime() });
  const authenticated = await authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability], nonceCache: cache, now: () => now.getTime() });
  const nonceReplayCode = await rejectedGatewayCode(() => authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability], nonceCache: cache, now: () => now.getTime() }));
  const wrongCapability = { ...capability, secret: new Uint8Array(32).fill(8) };
  const wrongTokenCode = await rejectedGatewayCode(() => authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [wrongCapability], nonceCache: new NonceReplayCache(), now: () => now.getTime() }));
  const staleRequestCode = await rejectedGatewayCode(() => authenticateGatewayRequest({ method: "POST", path: "/v1/user-prompt-submit", headers: signed.headers, body, capabilities: [capability], nonceCache: new NonceReplayCache(), now: () => now.getTime() + 30_001 }));
  const state = gatewayState(at(0)); const ownership = new DesktopOwnershipCoordinator({ leaseDurationMs: 30_000 });
  const binding = ownership.bind(state, { mutationId: "bind", bindingId: "binding", rootThreadId: "root-thread", taskId: "task", conversationId: "conversation", adapterId: "weixin:novice", bindingAnchorTurnId: "anchor", bindingAnchorTurnIndex: 0, bindingAnchorDigest: "e".repeat(64), observedAt: at(0) });
  const generations = [binding.generation];
  const desktop = ownership.takeover(state, { mutationId: "takeover", bindingId: "binding", expectedGeneration: 1, ownerInstanceId: "desktop", observedAt: at(1) }); generations.push(desktop.generation);
  let staleTakeoverBlocked = false;
  try { ownership.takeover(state, { mutationId: "stale", bindingId: "binding", expectedGeneration: 1, ownerInstanceId: "other", observedAt: at(2) }); } catch { staleTakeoverBlocked = true; }
  try { ownership.heartbeat(state, { mutationId: "late", bindingId: "binding", expectedGeneration: 2, ownerInstanceId: "desktop", observedAt: at(32) }); } catch {}
  generations.push(binding.generation);
  const controller = new Phase3GatewayController({ ownership, readState: async (read) => read(state), mutateState: async (mutation) => mutation(state) });
  const unboundDecision = (await controller.status({ kind: "status", requestId: uuid(2), rootThreadId: "unbound-root" })).decision;
  const childDecision = (await controller.status({ kind: "status", requestId: uuid(3), rootThreadId: "child-thread" })).decision;
  const rootThread: AuthoritativeCodexThread = { id: "root-thread", sessionId: "root-thread", cwd: "C:/synthetic", turns: [{ id: "anchor", status: "completed", items: [] }] };
  const child: AuthoritativeCodexThread = { id: "child-thread", sessionId: "root-thread", cwd: "C:/synthetic", turns: rootThread.turns };
  const childReconciliation = new DesktopReconciler().reconcile({ binding: { ...binding, owner: "desktop", activeStartFence: undefined }, thread: child }).kind;
  return { authenticatedRole: authenticated.role, nonceReplayCode, wrongTokenCode, staleRequestCode, generations, staleTakeoverBlocked, expiredOwner: binding.owner, unboundDecision, childDecision, childReconciliation, exportedCount: 0 };
}

async function rejectedGatewayCode(run: () => Promise<unknown>): Promise<GatewayAuthErrorCode | string> { try { await run(); return "unexpected_pass"; } catch (error) { return errorCode(error); } }
function errorCode(error: unknown): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown"; }
function gatewayState(at: string): BridgeState { const state = emptyState(); state.tasks.task = { taskId: "task", conversationId: "conversation", chatType: "direct", senderKey: "synthetic", title: "task", aliases: [], workspaceKind: "explicit", workspaceRoot: "C:/synthetic", executionCwd: "C:/synthetic", isolationMode: "canonical_fifo", sessionEpoch: "epoch", threadId: "root-thread", status: "completed", objectiveSummary: "", recentRequests: [], createdAt: at, updatedAt: at, lastActiveAt: at }; state.conversations.conversation = { taskIds: ["task"], lastTaskId: "task" }; return state; }
