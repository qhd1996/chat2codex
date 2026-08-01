import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type BridgeState,
  type BridgeStateEnvelopeV5,
  type DurableCodexJob,
  type DurableOutboxMessage,
  type ImageDraft,
  type PendingClarification,
  type RegisteredTask,
  bridgeStateSchemaVersion,
  createSessionEpoch,
  emptyState,
} from "./types.js";

const maxProcessedMessageIds = 500;
const maxRecentFailures = 5;
const saveQueues = new Map<string, Promise<void>>();

export interface JsonStateStoreOptions {
  adapterId?: string;
  jobRetentionCount?: number;
  outboxRetentionCount?: number;
  chat2codexHome?: string;
}

export const defaultAdapterId = "feishu:default";

export class JsonStateStore {
  readonly adapterId: string;
  private readonly jobRetentionCount: number;
  private readonly outboxRetentionCount: number;
  private readonly chat2codexHome: string;
  private readonly pendingStagingCleanup = new Set<string>();

  constructor(
    private readonly filePath: string,
    options: JsonStateStoreOptions = {},
  ) {
    this.adapterId = normalizeAdapterId(options.adapterId ?? defaultAdapterId);
    this.jobRetentionCount = retentionCount(
      options.jobRetentionCount,
      "jobRetentionCount",
    );
    this.outboxRetentionCount = retentionCount(
      options.outboxRetentionCount,
      "outboxRetentionCount",
    );
    this.chat2codexHome = path.resolve(options.chat2codexHome ?? path.dirname(this.filePath));
  }

  async load(): Promise<BridgeState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const persisted = JSON.parse(raw) as unknown;
      assertSupportedSchema(persisted);
      const state = isBridgeStateEnvelope(persisted) || isBridgeStateEnvelopeV4(persisted) || isBridgeStateEnvelopeV3(persisted) || isBridgeStateEnvelopeV2(persisted)
        ? coerceBridgeState(persisted.adapters[this.adapterId])
        : coerceBridgeState(persisted);
      normalizeChatSessionEpochs(state);
      importLegacyChatTasks(state, this.adapterId);
      normalizeTaskReferences(state);
      await validateMediaOutbox(state, this.chat2codexHome, true);
      const stagingBeforeRetention = mediaStagingDirectories(state);
      enforceDurableRetention(
        state,
        this.jobRetentionCount,
        this.outboxRetentionCount,
      );
      for (const directory of stagingBeforeRetention) {
        if (!mediaStagingDirectories(state).has(directory)) this.pendingStagingCleanup.add(directory);
      }
      return state;
    } catch (error) {
      if (isNotFound(error)) {
        return emptyState();
      }
      throw error;
    }
  }

  async save(state: BridgeState): Promise<void> {
    state.tasks ??= {};
    state.conversations ??= {};
    normalizeChatSessionEpochs(state);
    importLegacyChatTasks(state, this.adapterId);
    normalizeTaskReferences(state);
    await validateMediaOutbox(state, this.chat2codexHome, false);
    const stagingBeforeRetention = new Set([...this.pendingStagingCleanup, ...mediaStagingDirectories(state)]);
    for (const directory of stagingBeforeRetention) this.pendingStagingCleanup.add(directory);
    enforceDurableRetention(
      state,
      this.jobRetentionCount,
      this.outboxRetentionCount,
    );
    state.processedMessageIds = state.processedMessageIds.slice(-maxProcessedMessageIds);
    if (state.diagnostics.recentFailures) {
      state.diagnostics.recentFailures = state.diagnostics.recentFailures.slice(-maxRecentFailures);
    }
    for (const diagnostics of Object.values(state.diagnostics.byChat ?? {})) {
      if (diagnostics.recentFailures) {
        diagnostics.recentFailures = diagnostics.recentFailures.slice(-maxRecentFailures);
      }
    }
    const queueKey = path.resolve(this.filePath);
    const previousSave = saveQueues.get(queueKey) ?? Promise.resolve();
    const currentSave = previousSave.catch(() => undefined).then(async () => {
      const directory = path.dirname(this.filePath);
      const createdDirectory = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (createdDirectory) {
        await fs.chmod(directory, 0o700);
      }

      const currentPersisted = await readPersistedState(this.filePath);
      assertSupportedSchema(currentPersisted);
      const migratedLegacy = currentPersisted !== null && !isBridgeStateEnvelope(currentPersisted) && !isBridgeStateEnvelopeV4(currentPersisted) && !isBridgeStateEnvelopeV3(currentPersisted) && !isBridgeStateEnvelopeV2(currentPersisted);
      const migratedV4 = isBridgeStateEnvelopeV4(currentPersisted);
      const migratedV3 = isBridgeStateEnvelopeV3(currentPersisted);
      const migratedV2 = isBridgeStateEnvelopeV2(currentPersisted);
      const envelope: BridgeStateEnvelopeV5 = isBridgeStateEnvelope(currentPersisted)
        ? currentPersisted
        : migratedV4
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: currentPersisted.adapters }
        : migratedV3
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: currentPersisted.adapters }
        : migratedV2
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: currentPersisted.adapters }
        : {
            schemaVersion: bridgeStateSchemaVersion,
            adapters: currentPersisted === null
              ? {}
              : { [this.adapterId]: coerceBridgeState(currentPersisted) },
          };
      envelope.adapters[this.adapterId] = state;
      const referencedStagingDirectories = mediaStagingDirectoriesAcrossAdapters(envelope.adapters);
      const serializedState = `${JSON.stringify(envelope, null, 2)}\n`;

      if (migratedLegacy) {
        await preserveLegacyBackup(this.filePath);
      }
      if (migratedV3) {
        await preserveVersionedBackup(this.filePath, "v3");
      }
      if (migratedV4) {
        await preserveVersionedBackup(this.filePath, "v4");
      }
      if (migratedV2) {
        await preserveVersionedBackup(this.filePath, "v2");
      }

      const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tempPath, serializedState, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await fs.rename(tempPath, this.filePath);
        await fs.chmod(this.filePath, 0o600);
        try {
          await cleanupRemovedStagingDirectories(stagingBeforeRetention, referencedStagingDirectories, this.chat2codexHome);
          for (const directory of stagingBeforeRetention) this.pendingStagingCleanup.delete(directory);
        } catch {
          // State is committed; keep candidates for a later safe cleanup retry.
        }
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });

    saveQueues.set(queueKey, currentSave);
    try {
      await currentSave;
    } finally {
      if (saveQueues.get(queueKey) === currentSave) {
        saveQueues.delete(queueKey);
      }
    }
  }
}

function normalizeAdapterId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f]/.test(normalized)) {
    throw new RangeError("adapterId must be a non-empty bounded string without control characters.");
  }
  return normalized;
}

function coerceBridgeState(value: unknown): BridgeState {
  const parsed = isRecord(value) ? value as Partial<BridgeState> : {};
  return {
    tasks: isRecord(parsed.tasks) ? parsed.tasks as Record<string, RegisteredTask> : {},
    conversations: isRecord(parsed.conversations) ? parsed.conversations : {},
    chats: parsed.chats ?? {},
    jobs: parsed.jobs ?? {},
    outbox: parsed.outbox ?? {},
    pendingMessages: parsed.pendingMessages ?? {},
    processedMessageIds: parsed.processedMessageIds ?? [],
    diagnostics: parsed.diagnostics ?? {},
    imageDrafts: coerceImageDrafts(parsed.imageDrafts),
    clarifications: coerceClarifications(parsed.clarifications),
  };
}

function isBridgeStateEnvelope(value: unknown): value is BridgeStateEnvelopeV5 {
  return Boolean(
    isRecord(value) &&
      value.schemaVersion === bridgeStateSchemaVersion &&
      isRecord(value.adapters),
  );
}

function isBridgeStateEnvelopeV4(value: unknown): value is { schemaVersion: 4; adapters: Record<string, BridgeState> } {
  return Boolean(isRecord(value) && value.schemaVersion === 4 && isRecord(value.adapters));
}

function isBridgeStateEnvelopeV3(value: unknown): value is { schemaVersion: 3; adapters: Record<string, BridgeState> } {
  return Boolean(isRecord(value) && value.schemaVersion === 3 && isRecord(value.adapters));
}

function isBridgeStateEnvelopeV2(value: unknown): value is { schemaVersion: 2; adapters: Record<string, BridgeState> } {
  return Boolean(isRecord(value) && value.schemaVersion === 2 && isRecord(value.adapters));
}

function assertSupportedSchema(value: unknown): void {
  if (
    isRecord(value) &&
    Object.prototype.hasOwnProperty.call(value, "schemaVersion") &&
    !isBridgeStateEnvelope(value) && !isBridgeStateEnvelopeV4(value) && !isBridgeStateEnvelopeV3(value) && !isBridgeStateEnvelopeV2(value)
  ) {
    throw new Error(`Unsupported bridge state schema version: ${String(value.schemaVersion)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPersistedState(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function preserveLegacyBackup(filePath: string): Promise<void> {
  const backupPath = `${filePath}.v0.6.bak`;
  try {
    await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    await fs.chmod(backupPath, 0o600);
  } catch (error) {
    if (isAlreadyExists(error)) {
      return;
    }
    throw error;
  }
}

async function preserveVersionedBackup(filePath: string, version: string): Promise<void> {
  const backupPath = `${filePath}.${version}.bak`;
  try {
    await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    await fs.chmod(backupPath, 0o600);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

function coerceImageDrafts(value: unknown): BridgeState["imageDrafts"] {
  if (!isRecord(value)) return {};
  const drafts: Record<string, ImageDraft> = {};
  for (const [key, draft] of Object.entries(value)) {
    if (isImageDraft(draft)) drafts[key] = draft;
  }
  return drafts;
}

function isImageDraft(value: unknown): value is ImageDraft {
  if (!isRecord(value) || !Array.isArray(value.images) || value.images.length > 32) return false;
  if (![value.chatId, value.senderKey, value.createdAt, value.updatedAt, value.expiresAt].every((item) => typeof item === "string" && item.length > 0 && item.length <= 4096)) return false;
  if (!Number.isSafeInteger(value.totalBytes) || Number(value.totalBytes) < 0) return false;
  return value.images.every((image) => isRecord(image) && typeof image.sourceMessageId === "string" && typeof image.path === "string" && image.path.length <= 4096 && typeof image.sha256 === "string" && /^[a-f0-9]{64}$/iu.test(image.sha256) && typeof image.mediaType === "string" && Number.isSafeInteger(image.bytes) && Number(image.bytes) > 0);
}

function coerceClarifications(value: unknown): BridgeState["clarifications"] {
  if (!isRecord(value)) return {};
  const clarifications: Record<string, PendingClarification> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPendingClarification(item)) clarifications[key] = {
      chatId: item.chatId, senderKey: item.senderKey, question: item.question, originalText: item.originalText,
      draftKey: item.draftKey, candidateTaskIds: item.candidateTaskIds?.slice(0, 12), choices: [...item.choices],
      createdAt: item.createdAt, expiresAt: item.expiresAt,
    };
  }
  return clarifications;
}

function isPendingClarification(value: unknown): value is PendingClarification {
  return Boolean(isRecord(value) && typeof value.chatId === "string" && typeof value.senderKey === "string" && typeof value.question === "string" && (value.originalText === undefined || typeof value.originalText === "string") && (value.draftKey === undefined || typeof value.draftKey === "string") && (value.candidateTaskIds === undefined || (Array.isArray(value.candidateTaskIds) && value.candidateTaskIds.length <= 12 && value.candidateTaskIds.every((taskId) => typeof taskId === "string"))) && Array.isArray(value.choices) && value.choices.every((choice) => typeof choice === "string") && typeof value.createdAt === "string" && typeof value.expiresAt === "string");
}

function normalizeChatSessionEpochs(state: BridgeState): void {
  for (const session of Object.values(state.chats)) {
    if (
      typeof session.sessionEpoch !== "string" ||
      session.sessionEpoch.trim().length === 0
    ) {
      session.sessionEpoch = createSessionEpoch();
    }
  }
}

function importLegacyChatTasks(state: BridgeState, adapterId: string): void {
  for (const [conversationId, session] of Object.entries(state.chats)) {
    const taskId = legacyTaskId(adapterId, conversationId, session.sessionEpoch);
    if (!state.tasks[taskId]) {
      const at = session.updatedAt || new Date(0).toISOString();
      const selected = session.lastThreads?.find((item) => item.threadId === session.threadId);
      state.tasks[taskId] = { taskId, conversationId, chatType: session.chatType ?? "direct", senderKey: "legacy:" + conversationId, title: selected?.title?.trim() || "Imported chat task", aliases: [], workspaceKind: "explicit", workspaceRoot: path.resolve(session.cwd), executionCwd: path.resolve(session.cwd), isolationMode: "canonical_fifo", sessionEpoch: session.sessionEpoch, threadId: session.threadId, status: "completed", objectiveSummary: selected?.preview?.slice(0, 500) ?? "", recentRequests: [], createdAt: at, updatedAt: at, lastActiveAt: at, lastRun: session.lastRun };
    }
    const conversation = state.conversations[conversationId] ?? { taskIds: [] };
    conversation.taskIds = [...new Set([...conversation.taskIds, taskId])];
    conversation.lastTaskId ??= taskId;
    conversation.lastProjects ??= session.lastProjects; conversation.lastThreads ??= session.lastThreads; conversation.lastArchivedThreads ??= session.lastArchivedThreads; conversation.lastTurns ??= session.lastTurns;
    state.conversations[conversationId] = conversation;
  }
}

function normalizeTaskReferences(state: BridgeState): void {
  const threadOwners = new Map<string, string>();
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.taskId !== taskId || !task.conversationId) {
      delete state.tasks[taskId];
      continue;
    }
    if (task.threadId) {
      const owner = threadOwners.get(task.threadId);
      if (owner && owner !== taskId) {
        const existing = state.tasks[owner];
        if (task.senderKey.startsWith("legacy:")) {
          task.threadId = undefined;
          continue;
        }
        if (existing?.senderKey.startsWith("legacy:")) {
          existing.threadId = undefined;
        } else {
          throw new Error(`Codex thread is bound to multiple tasks: ${task.threadId}`);
        }
      }
      threadOwners.set(task.threadId, taskId);
    }
  }

  for (const [conversationId, conversation] of Object.entries(state.conversations)) {
    const listed = conversation.taskIds.filter((taskId) =>
      state.tasks[taskId]?.conversationId === conversationId
    );
    const missing = Object.values(state.tasks)
      .filter((task) => task.conversationId === conversationId && !listed.includes(task.taskId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.taskId.localeCompare(right.taskId))
      .map((task) => task.taskId);
    conversation.taskIds = [...new Set([...listed, ...missing])];
    if (!conversation.lastTaskId || !conversation.taskIds.includes(conversation.lastTaskId)) {
      conversation.lastTaskId = conversation.taskIds.at(-1);
    }
  }
  for (const task of Object.values(state.tasks)) {
    state.conversations[task.conversationId] ??= { taskIds: [] };
    const conversation = state.conversations[task.conversationId]!;
    if (!conversation.taskIds.includes(task.taskId)) conversation.taskIds.push(task.taskId);
    conversation.lastTaskId ??= task.taskId;
  }

  for (const clarification of Object.values(state.clarifications ?? {})) {
    if (clarification.candidateTaskIds && Object.keys(state.tasks).length > 0) {
      clarification.candidateTaskIds = [...new Set(clarification.candidateTaskIds)]
        .filter((taskId) => state.tasks[taskId]?.conversationId === clarification.chatId)
        .slice(0, 12);
      const candidates = new Set(clarification.candidateTaskIds);
      clarification.choices = clarification.choices.filter((choice) => candidates.has(choice));
    }
  }

  for (const job of Object.values(state.jobs)) {
    if (!job.taskId) continue;
    const task = state.tasks[job.taskId];
    if (task && task.conversationId !== job.chatId) {
      job.taskId = undefined;
      job.workspaceRoot = undefined;
      job.executionCwd = undefined;
      job.isolationMode = undefined;
    }
  }
  for (const delivery of Object.values(state.outbox)) {
    if (delivery.kind === "text" || delivery.kind === "markdown") {
      delivery.taskId = state.jobs[delivery.jobId]?.taskId;
    }
  }
}

function legacyTaskId(adapterId: string, conversationId: string, sessionEpoch: string): string {
  return "tsk_" + createHash("sha256").update(adapterId).update("\0").update(conversationId).update("\0").update(sessionEpoch).digest("hex").slice(0, 24);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function missingOnly(error: unknown): undefined {
  if (isNotFound(error)) return undefined;
  throw error;
}

function retentionCount(value: number | undefined, name: string): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function enforceDurableRetention(
  state: BridgeState,
  jobRetentionCount: number,
  outboxRetentionCount: number,
): void {
  normalizeDeliveryReferences(state);
  pruneDeliveredOutbox(state, outboxRetentionCount);
  pruneTerminalJobs(state, jobRetentionCount);
  normalizeDeliveryReferences(state);
}

async function validateMediaOutbox(state: BridgeState, chat2codexHome: string, verifyDigest: boolean): Promise<void> {
  const outboundRoot = path.resolve(chat2codexHome, "outbound");
  const sequences = new Set<string>();
  for (const message of Object.values(state.outbox)) {
    if (!["text", "markdown", "image", "file"].includes(message.kind)) throw new Error("Invalid outbox delivery kind.");
    const sequenceKey = message.jobId + "\0" + message.sequence;
    if (sequences.has(sequenceKey)) throw new Error("Duplicate outbox sequence for job " + message.jobId + ".");
    sequences.add(sequenceKey);
    if (message.kind !== "image" && message.kind !== "file") continue;
    const job = state.jobs[message.jobId];
    if (!job) throw new Error("Orphaned media job reference: " + message.jobId);
    if (!message.taskId || !state.tasks[message.taskId]) throw new Error("Orphaned media task reference: " + String(message.taskId));
    if (!message.id || !message.jobId || !message.chatId) throw new Error("Media delivery identity is incomplete.");
    if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) throw new Error("Invalid media delivery sequence.");
    if (message.status !== "pending" && message.status !== "sending" && message.status !== "delivered") throw new Error("Invalid media delivery status.");
    if (job.taskId !== message.taskId) throw new Error("Media task owner does not match its durable job.");
    if (job.chatId !== message.chatId || state.tasks[message.taskId]!.conversationId !== message.chatId) throw new Error("Media conversation owner does not match its task.");
    if (!message.stagedPath || !path.isAbsolute(message.stagedPath) || path.resolve(message.stagedPath) !== message.stagedPath) throw new Error("Media staged path must be absolute and canonical.");
    if (!inside(outboundRoot, message.stagedPath)) throw new Error("Media staged path is outside the private outbound root.");
    if (!message.fileName || message.fileName.length > 160 || path.basename(message.fileName) !== message.fileName || !/^\d{2}-/u.test(path.basename(message.stagedPath)) || !path.basename(message.stagedPath).endsWith("-" + message.fileName)) throw new Error("Media filename does not match its staged path.");
    const expectedJobDirectory = path.join(outboundRoot, message.taskId, safeIdentifierComponent(message.jobId));
    if (!samePath(path.dirname(message.stagedPath), expectedJobDirectory)) throw new Error("Media staged path does not belong to its job staging directory.");
    if (!message.mediaType || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(message.mediaType)) throw new Error("Invalid media type.");
    if (!Number.isSafeInteger(message.size) || message.size! <= 0) throw new Error("Invalid media size.");
    if (!message.sha256 || !/^[a-f0-9]{64}$/u.test(message.sha256)) throw new Error("Invalid media SHA-256 hash.");
    if (!Number.isSafeInteger(message.attempts) || message.attempts < 0) throw new Error("Invalid media delivery attempts.");
    if (!message.idempotencyKey || message.idempotencyKey.length > 512) throw new Error("Invalid media idempotency key.");
    const info = await fs.lstat(message.stagedPath).catch(missingOnly);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("Media staged path must reference a regular non-symlink file.");
    const canonical = await fs.realpath(message.stagedPath);
    if (!samePath(canonical, message.stagedPath)) throw new Error("Media staged path must be canonical.");
    if (info.size !== message.size) throw new Error("Media staged size does not match durable metadata.");
    if (verifyDigest) {
      const digest = createHash("sha256").update(await fs.readFile(message.stagedPath)).digest("hex");
      if (digest !== message.sha256) throw new Error("Media staged hash does not match durable metadata.");
    }
  }
}

function mediaStagingDirectories(state: BridgeState): Set<string> {
  const result = new Set<string>();
  for (const item of Object.values(state.outbox)) {
    if ((item.kind === "image" || item.kind === "file") && item.stagedPath) result.add(path.dirname(item.stagedPath));
  }
  return result;
}

function mediaStagingDirectoriesAcrossAdapters(adapters: Record<string, BridgeState>): Set<string> {
  const result = new Set<string>();
  for (const state of Object.values(adapters)) {
    for (const directory of mediaStagingDirectories(state)) result.add(directory);
  }
  return result;
}

async function cleanupRemovedStagingDirectories(before: Set<string>, referenced: Set<string>, chat2codexHome: string): Promise<void> {
  const outboundRoot = path.resolve(chat2codexHome, "outbound");
  for (const directory of before) {
    if (referenced.has(directory) || !inside(outboundRoot, directory)) continue;
    const info = await fs.lstat(directory).catch(missingOnly);
    if (!info) continue;
    if (info.isSymbolicLink()) { await fs.unlink(directory); continue; }
    if (!info.isDirectory()) throw new Error("Outbound staging cleanup target is not a directory.");
    const canonical = await fs.realpath(directory);
    if (!samePath(canonical, directory) || !inside(outboundRoot, canonical)) throw new Error("Refusing to clean a staging directory outside the outbound root.");
    await fs.rm(directory, { recursive: true, force: false });
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right;
}

function safeIdentifierComponent(value: string): string {
  if (/^[A-Za-z0-9._-]{1,128}$/u.test(value) && value !== "." && value !== "..") return value;
  return "job-" + createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function pruneDeliveredOutbox(state: BridgeState, retentionCount: number): void {
  let outboxCount = Object.keys(state.outbox).length;
  if (outboxCount <= retentionCount) return;
  const groups = completeTerminalDeliveryGroups(state);
  for (const group of groups) {
    if (outboxCount <= retentionCount) break;
    for (const message of group) {
      delete state.outbox[message.id];
      outboxCount -= 1;
    }
  }
}

function completeTerminalDeliveryGroups(state: BridgeState): DurableOutboxMessage[][] {
  const byJob = new Map<string, DurableOutboxMessage[]>();
  for (const message of Object.values(state.outbox)) {
    const group = byJob.get(message.jobId) ?? [];
    group.push(message); byJob.set(message.jobId, group);
  }
  return [...byJob.entries()]
    .filter(([jobId, messages]) => {
      const job = state.jobs[jobId];
      return Boolean(job && isTerminalJob(job) && !isActiveTaskObligation(job.taskId ? state.tasks[job.taskId]?.status : undefined) && messages.length > 0 && messages.every((message) => message.status === "delivered"));
    })
    .map(([, messages]) => messages.sort(compareDeliverySequence))
    .sort((left, right) => compareOutboxAge(left[0]!, right[0]!));
}

function pruneTerminalJobs(state: BridgeState, retentionCount: number): void {
  let jobCount = Object.keys(state.jobs).length;
  if (jobCount <= retentionCount) {
    return;
  }

  const jobsWithActiveOutbox = new Set(
    Object.values(state.outbox)
      .filter((message) => message.status !== "delivered")
      .map((message) => message.jobId),
  );
  const jobsWithActiveTaskObligations = new Set(
    Object.values(state.jobs)
      .filter((job) => job.taskId && isActiveTaskObligation(state.tasks[job.taskId]?.status))
      .map((job) => job.id),
  );
  const candidates = Object.values(state.jobs)
    .filter(
      (job) =>
        isTerminalJob(job) &&
        job.capacityNoticeActive !== true &&
        !jobsWithActiveOutbox.has(job.id) &&
        !jobsWithActiveTaskObligations.has(job.id),
    )
    .sort(compareJobAge);

  for (const job of candidates) {
    if (jobCount <= retentionCount) {
      break;
    }
    for (const message of Object.values(state.outbox)) {
      if (message.jobId === job.id && message.status === "delivered") {
        delete state.outbox[message.id];
      }
    }
    delete state.jobs[job.id];
    jobCount -= 1;
  }
}

function isActiveTaskObligation(status: RegisteredTask["status"] | undefined): boolean {
  return status !== undefined && !["completed", "failed", "interrupted", "archived"].includes(status);
}

function normalizeDeliveryReferences(state: BridgeState): void {
  const deliveriesByJob = new Map<string, DurableOutboxMessage[]>();
  for (const message of Object.values(state.outbox)) {
    if (!state.jobs[message.jobId]) {
      continue;
    }
    const deliveries = deliveriesByJob.get(message.jobId) ?? [];
    deliveries.push(message);
    deliveriesByJob.set(message.jobId, deliveries);
  }

  for (const job of Object.values(state.jobs)) {
    job.deliveryIds = (deliveriesByJob.get(job.id) ?? [])
      .sort(compareDeliverySequence)
      .map((message) => message.id);
  }
}

function isTerminalJob(job: DurableCodexJob): boolean {
  return (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled" ||
    job.status === "interrupted"
  );
}

function compareJobAge(left: DurableCodexJob, right: DurableCodexJob): number {
  return compareAge(
    left.completedAt ?? left.updatedAt ?? left.createdAt,
    left.id,
    right.completedAt ?? right.updatedAt ?? right.createdAt,
    right.id,
  );
}

function compareOutboxAge(
  left: DurableOutboxMessage,
  right: DurableOutboxMessage,
): number {
  return compareAge(
    left.deliveredAt ?? left.updatedAt ?? left.createdAt,
    left.id,
    right.deliveredAt ?? right.updatedAt ?? right.createdAt,
    right.id,
  );
}

function compareDeliverySequence(
  left: DurableOutboxMessage,
  right: DurableOutboxMessage,
): number {
  return (
    left.sequence - right.sequence ||
    compareAge(left.createdAt, left.id, right.createdAt, right.id)
  );
}

function compareAge(
  leftAt: string,
  leftId: string,
  rightAt: string,
  rightId: string,
): number {
  const leftTime = parsedTime(leftAt);
  const rightTime = parsedTime(rightAt);
  return leftTime - rightTime || leftId.localeCompare(rightId);
}

function parsedTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
