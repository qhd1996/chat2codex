import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  USAGE_ADVISOR_LIMITS,
  USAGE_ADVISOR_SIGNAL_CODES,
  UsageAdvisor,
} from "../core/usage-advisor.js";
import {
  type BridgeState,
  type BridgeStateEnvelopeV6,
  type DesktopBinding,
  type DesktopGatewayState,
  type DurableCodexJob,
  type DurableOutboxMessage,
  type ImageDraft,
  type PendingClarification,
  type RegisteredTask,
  type UsageAdvisorAggregate,
  type UsageAdvisorProposal,
  type UsageAdvisorProposalStatus,
  type UsageAdvisorSignalCode,
  type UsageAdvisorState,
  bridgeStateSchemaVersion,
  createSessionEpoch,
  emptyState,
  emptyDesktopGatewayState,
  emptyUsageAdvisorState,
} from "./types.js";

const maxProcessedMessageIds = 500;
const maxRecentFailures = 5;
const saveQueues = new Map<string, Promise<void>>();

export interface JsonStateStoreOptions {
  adapterId?: string;
  jobRetentionCount?: number;
  outboxRetentionCount?: number;
  outboundMediaRetentionHours?: number;
  chat2codexHome?: string;
}

export const defaultAdapterId = "feishu:default";

export class JsonStateStore {
  readonly adapterId: string;
  private readonly jobRetentionCount: number;
  private readonly outboxRetentionCount: number;
  private readonly outboundMediaRetentionMs: number;
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
    this.outboundMediaRetentionMs = retentionHoursMs(options.outboundMediaRetentionHours);
    this.chat2codexHome = path.resolve(options.chat2codexHome ?? path.dirname(this.filePath));
  }

  async load(): Promise<BridgeState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const persisted = JSON.parse(raw) as unknown;
      assertSupportedSchema(persisted);
      if (isBridgeStateEnvelope(persisted)) validateDesktopGatewaysAcrossAdapters(persisted.adapters);
      const state = isBridgeStateEnvelope(persisted) || isBridgeStateEnvelopeV5(persisted) || isBridgeStateEnvelopeV4(persisted) || isBridgeStateEnvelopeV3(persisted) || isBridgeStateEnvelopeV2(persisted)
        ? coerceBridgeState(persisted.adapters[this.adapterId])
        : coerceBridgeState(persisted);
      normalizeChatSessionEpochs(state);
      importLegacyChatTasks(state, this.adapterId);
      normalizeTaskReferences(state);
      validateDesktopGatewayState(state, this.adapterId);
      await validateMediaOutbox(state, this.chat2codexHome, true);
      const stagingBeforeRetention = mediaStagingDirectories(state);
      enforceDurableRetention(
        state,
        this.jobRetentionCount,
        this.outboxRetentionCount,
        this.outboundMediaRetentionMs,
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
    state.usageAdvisor = coerceUsageAdvisorState(state.usageAdvisor);
    state.desktopGateway ??= emptyDesktopGatewayState();
    normalizeChatSessionEpochs(state);
    importLegacyChatTasks(state, this.adapterId);
    normalizeTaskReferences(state);
    validateDesktopGatewayState(state, this.adapterId);
    await validateMediaOutbox(state, this.chat2codexHome, false);
    const stagingBeforeRetention = new Set([...this.pendingStagingCleanup, ...mediaStagingDirectories(state)]);
    for (const directory of stagingBeforeRetention) this.pendingStagingCleanup.add(directory);
    enforceDurableRetention(
      state,
      this.jobRetentionCount,
      this.outboxRetentionCount,
      this.outboundMediaRetentionMs,
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
      const migratedLegacy = currentPersisted !== null && !isBridgeStateEnvelope(currentPersisted) && !isBridgeStateEnvelopeV5(currentPersisted) && !isBridgeStateEnvelopeV4(currentPersisted) && !isBridgeStateEnvelopeV3(currentPersisted) && !isBridgeStateEnvelopeV2(currentPersisted);
      const migratedV5 = isBridgeStateEnvelopeV5(currentPersisted);
      const migratedV4 = isBridgeStateEnvelopeV4(currentPersisted);
      const migratedV3 = isBridgeStateEnvelopeV3(currentPersisted);
      const migratedV2 = isBridgeStateEnvelopeV2(currentPersisted);
      const envelope: BridgeStateEnvelopeV6 = isBridgeStateEnvelope(currentPersisted)
        ? currentPersisted
        : migratedV5
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: addDesktopGatewayToAdapters(currentPersisted.adapters) }
        : migratedV4
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: addDesktopGatewayToAdapters(currentPersisted.adapters) }
        : migratedV3
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: addDesktopGatewayToAdapters(currentPersisted.adapters) }
        : migratedV2
          ? { schemaVersion: bridgeStateSchemaVersion, adapters: addDesktopGatewayToAdapters(currentPersisted.adapters) }
        : {
            schemaVersion: bridgeStateSchemaVersion,
            adapters: currentPersisted === null
              ? {}
              : { [this.adapterId]: coerceBridgeState(currentPersisted) },
          };
      envelope.adapters[this.adapterId] = state;
      validateDesktopGatewaysAcrossAdapters(envelope.adapters);
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
      if (migratedV5) {
        await preserveVersionedBackup(this.filePath, "v5");
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
    usageAdvisor: coerceUsageAdvisorState(parsed.usageAdvisor),
    desktopGateway: coerceDesktopGatewayState(parsed.desktopGateway),
  };
}

function addDesktopGatewayToAdapters(adapters: Record<string, BridgeState>): Record<string, BridgeState> {
  return Object.fromEntries(Object.entries(adapters).map(([adapterId, state]) => [
    adapterId,
    { ...state, desktopGateway: state.desktopGateway ?? emptyDesktopGatewayState() },
  ]));
}

function coerceDesktopGatewayState(value: unknown): DesktopGatewayState {
  if (!isRecord(value)) return emptyDesktopGatewayState();
  return {
    bindings: isRecord(value.bindings) ? value.bindings as Record<string, DesktopBinding> : {},
    wakes: isRecord(value.wakes) ? value.wakes as DesktopGatewayState["wakes"] : {},
  };
}

const desktopGatewayKeys = ["bindings", "wakes"] as const;
const desktopBindingKeys = [
  "activeStartFence", "adapterId", "bindingAnchorTurnId", "bindingId", "conversationId",
  "createdAt", "excludedControlTurns", "generation", "lastAuthoritativeDigest",
  "lastMirroredTurnId", "lastReconciledTurnId", "leaseExpiresAt", "owner",
  "ownerInstanceId", "pendingWakeIds", "processedMutationIds", "releaseRequested",
  "rootThreadId", "taskId", "updatedAt",
] as const;
const desktopFenceKeys = ["issuedAt", "originGeneration", "promptCommitment", "requestId", "turnId"] as const;
const desktopControlKeys = ["kind", "originGeneration", "promptCommitment", "recordedAt"] as const;
const desktopWakeKeys = ["bindingId", "eventId", "observedAt", "turnId"] as const;

function validateDesktopGatewaysAcrossAdapters(adapters: Record<string, BridgeState>): void {
  const rootOwners = new Map<string, string>();
  for (const [adapterId, state] of Object.entries(adapters)) {
    validateDesktopGatewayState(state, adapterId);
    for (const binding of Object.values(state.desktopGateway?.bindings ?? {})) {
      const previous = rootOwners.get(binding.rootThreadId);
      if (previous) throw new Error(`Duplicate Desktop root binding across adapters: ${binding.rootThreadId}`);
      rootOwners.set(binding.rootThreadId, `${adapterId}:${binding.bindingId}`);
    }
  }
}

function validateDesktopGatewayState(state: BridgeState, adapterId: string): void {
  const gateway = state.desktopGateway;
  if (!isRecord(gateway)) throw new Error("Schema v6 Desktop Gateway state is missing.");
  assertExactObjectKeys(gateway, desktopGatewayKeys, "Desktop Gateway");
  if (!isRecord(gateway.bindings) || !isRecord(gateway.wakes)) throw new Error("Desktop Gateway bindings and wakes must be records.");
  const roots = new Set<string>();
  const tasks = new Set<string>();
  for (const [bindingId, rawBinding] of Object.entries(gateway.bindings)) {
    if (!isRecord(rawBinding)) throw new Error(`Desktop binding is malformed: ${bindingId}`);
    assertExactObjectKeys(rawBinding, desktopBindingKeys, "Desktop binding");
    validateOpaqueStateId(bindingId, "binding key");
    if (rawBinding.bindingId !== bindingId) throw new Error(`Desktop binding key does not match bindingId: ${bindingId}`);
    for (const [name, value] of [["rootThreadId", rawBinding.rootThreadId], ["taskId", rawBinding.taskId], ["conversationId", rawBinding.conversationId], ["adapterId", rawBinding.adapterId], ["bindingAnchorTurnId", rawBinding.bindingAnchorTurnId]] as const) validateOpaqueStateId(value, name);
    if (rawBinding.adapterId !== adapterId) throw new Error(`Desktop binding adapter does not match its partition: ${bindingId}`);
    if (roots.has(rawBinding.rootThreadId as string)) throw new Error(`Duplicate Desktop root binding: ${String(rawBinding.rootThreadId)}`);
    if (tasks.has(rawBinding.taskId as string)) throw new Error(`Duplicate Desktop task binding: ${String(rawBinding.taskId)}`);
    roots.add(rawBinding.rootThreadId as string); tasks.add(rawBinding.taskId as string);
    const task = state.tasks[rawBinding.taskId as string];
    if (!task) throw new Error(`Orphan Desktop binding task: ${String(rawBinding.taskId)}`);
    if (task.threadId !== rawBinding.rootThreadId) throw new Error(`Desktop root thread does not match its task: ${bindingId}`);
    if (task.conversationId !== rawBinding.conversationId) throw new Error(`Desktop binding conversation does not match its task: ${bindingId}`);
    if (rawBinding.owner !== "bridge" && rawBinding.owner !== "desktop" && rawBinding.owner !== "uncertain" && rawBinding.owner !== "disabled") throw new Error(`Desktop binding owner is invalid: ${bindingId}`);
    if (!Number.isSafeInteger(rawBinding.generation) || Number(rawBinding.generation) < 1) throw new Error(`Desktop binding generation is invalid: ${bindingId}`);
    validateCanonicalStateTimestamp(rawBinding.createdAt, "binding createdAt");
    validateCanonicalStateTimestamp(rawBinding.updatedAt, "binding updatedAt");
    if (rawBinding.owner === "desktop") {
      validateOpaqueStateId(rawBinding.ownerInstanceId, "Desktop owner instance");
      validateCanonicalStateTimestamp(rawBinding.leaseExpiresAt, "Desktop lease expiry");
    } else if (rawBinding.ownerInstanceId !== undefined || rawBinding.leaseExpiresAt !== undefined) {
      throw new Error(`Non-Desktop owner cannot retain a Desktop lease: ${bindingId}`);
    }
    if (rawBinding.releaseRequested !== undefined && typeof rawBinding.releaseRequested !== "boolean") throw new Error(`Desktop releaseRequested is invalid: ${bindingId}`);
    if (rawBinding.releaseRequested === true && rawBinding.owner !== "desktop" && rawBinding.owner !== "uncertain") throw new Error(`Desktop release request has an invalid owner: ${bindingId}`);
    validateDesktopFence(rawBinding.activeStartFence, rawBinding as unknown as DesktopBinding);
    validateDesktopControlTurns(rawBinding.excludedControlTurns, Number(rawBinding.generation));
    validateProcessedMutations(rawBinding.processedMutationIds);
    if (!Array.isArray(rawBinding.pendingWakeIds) || rawBinding.pendingWakeIds.length > 128 || !rawBinding.pendingWakeIds.every((value) => typeof value === "string")) throw new Error(`Desktop pending wake IDs are invalid: ${bindingId}`);
    if (new Set(rawBinding.pendingWakeIds).size !== rawBinding.pendingWakeIds.length) throw new Error(`Duplicate Desktop pending wake ID: ${bindingId}`);
    for (const wakeId of rawBinding.pendingWakeIds) validateOpaqueStateId(wakeId, "pending wake ID");
    for (const optionalId of [rawBinding.lastReconciledTurnId, rawBinding.lastMirroredTurnId]) if (optionalId !== undefined) validateOpaqueStateId(optionalId, "Desktop high-water turn ID");
    if (rawBinding.lastAuthoritativeDigest !== undefined && (typeof rawBinding.lastAuthoritativeDigest !== "string" || !/^[0-9a-f]{64}$/u.test(rawBinding.lastAuthoritativeDigest))) throw new Error(`Desktop authoritative digest is invalid: ${bindingId}`);
    if (rawBinding.owner === "bridge" && rawBinding.activeStartFence !== undefined) throw new Error(`Bridge owner cannot retain a Desktop start fence: ${bindingId}`);
    if (rawBinding.owner === "disabled" && (rawBinding.activeStartFence !== undefined || rawBinding.pendingWakeIds.length > 0 || rawBinding.releaseRequested === true)) throw new Error(`Disabled Desktop binding retains obligations: ${bindingId}`);
  }
  for (const [wakeId, rawWake] of Object.entries(gateway.wakes)) {
    if (!isRecord(rawWake)) throw new Error(`Desktop wake is malformed: ${wakeId}`);
    assertExactObjectKeys(rawWake, desktopWakeKeys, "Desktop wake");
    validateOpaqueStateId(wakeId, "wake key");
    if (rawWake.eventId !== wakeId) throw new Error(`Desktop wake key does not match eventId: ${wakeId}`);
    validateOpaqueStateId(rawWake.bindingId, "wake bindingId");
    validateOpaqueStateId(rawWake.turnId, "wake turnId");
    validateCanonicalStateTimestamp(rawWake.observedAt, "wake observedAt");
    const binding = gateway.bindings[rawWake.bindingId as string];
    if (!binding || !binding.pendingWakeIds.includes(wakeId)) throw new Error(`Orphan wake is not referenced by its binding: ${wakeId}`);
  }
  for (const binding of Object.values(gateway.bindings)) {
    for (const wakeId of binding.pendingWakeIds) {
      const wake = gateway.wakes[wakeId];
      if (!wake || wake.bindingId !== binding.bindingId) throw new Error(`Pending wake is missing or belongs to another binding: ${wakeId}`);
    }
  }
}

function validateDesktopFence(value: unknown, binding: DesktopBinding): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error(`Desktop start fence is malformed: ${binding.bindingId}`);
  assertExactObjectKeys(value, desktopFenceKeys, "Desktop start fence");
  validateOpaqueStateId(value.turnId, "fence turnId"); validateOpaqueStateId(value.requestId, "fence requestId");
  if (!Number.isSafeInteger(value.originGeneration) || Number(value.originGeneration) < 1 || Number(value.originGeneration) > binding.generation) throw new Error(`Desktop fence generation is invalid: ${binding.bindingId}`);
  validateSha256StateValue(value.promptCommitment, "fence prompt commitment"); validateCanonicalStateTimestamp(value.issuedAt, "fence issuedAt");
}
function validateDesktopControlTurns(value: unknown, generation: number): void {
  if (!isRecord(value) || Object.keys(value).length > 128) throw new Error("Excluded Desktop control turns are invalid.");
  for (const [turnId, raw] of Object.entries(value)) {
    validateOpaqueStateId(turnId, "excluded control turn ID"); if (!isRecord(raw)) throw new Error(`Excluded Desktop control turn is malformed: ${turnId}`);
    assertExactObjectKeys(raw, desktopControlKeys, "excluded Desktop control turn");
    if (raw.kind !== "takeover" && raw.kind !== "release_request") throw new Error(`Excluded Desktop control kind is invalid: ${turnId}`);
    if (!Number.isSafeInteger(raw.originGeneration) || Number(raw.originGeneration) < 1 || Number(raw.originGeneration) > generation) throw new Error(`Excluded Desktop control generation is invalid: ${turnId}`);
    validateSha256StateValue(raw.promptCommitment, "excluded control prompt commitment"); validateCanonicalStateTimestamp(raw.recordedAt, "excluded control recordedAt");
  }
}
function validateProcessedMutations(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length > 256) throw new Error("Processed Desktop mutations are invalid.");
  for (const [id, digest] of Object.entries(value)) { validateOpaqueStateId(id, "processed mutation ID"); validateSha256StateValue(digest, "processed mutation digest"); }
}
function validateOpaqueStateId(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} must be a bounded opaque string.`); }
function validateSha256StateValue(value: unknown, name: string): void { if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value.`); }
function validateCanonicalStateTimestamp(value: unknown, name: string): void { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${name} must be a canonical UTC timestamp.`); }
function assertExactObjectKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw new Error(`Unknown ${label} field: ${unknown.join(", ")}`); }

function coerceUsageAdvisorState(value: unknown): UsageAdvisorState {
  if (!isRecord(value)) return emptyUsageAdvisorState();
  const rawAggregates = isRecord(value.aggregates) ? value.aggregates : {};
  const aggregates: UsageAdvisorState["aggregates"] = {};
  for (const code of USAGE_ADVISOR_SIGNAL_CODES) {
    const aggregate = coerceUsageAdvisorAggregate(rawAggregates[code], code);
    if (aggregate) aggregates[code] = aggregate;
  }

  const rawProposals = isRecord(value.proposals) ? value.proposals : {};
  const proposals: Record<string, UsageAdvisorProposal> = {};
  for (const code of USAGE_ADVISOR_SIGNAL_CODES) {
    const aggregate = aggregates[code];
    if (!aggregate || aggregate.count < USAGE_ADVISOR_LIMITS.proposalThreshold) continue;
    const canonical = canonicalUsageAdvisorProposal(code, aggregate);
    const raw = rawProposals[canonical.id];
    if (!isRecord(raw) || raw.id !== canonical.id || raw.signalCode !== code) continue;
    if (!isUsageAdvisorProposalStatus(raw.status)) continue;
    const createdAt = normalizedIsoTimestamp(raw.createdAt);
    if (!createdAt) continue;

    canonical.createdAt = createdAt;
    canonical.evidence = { ...aggregate, recentAt: [...aggregate.recentAt] };
    if (raw.status === "pending_review") {
      proposals[canonical.id] = canonical;
      continue;
    }
    const reviewedAt = normalizedIsoTimestamp(raw.reviewedAt);
    if (!reviewedAt || reviewedAt.localeCompare(createdAt) < 0) continue;
    const advisor = new UsageAdvisor({ aggregates: { [code]: aggregate }, proposals: { [canonical.id]: canonical } });
    proposals[canonical.id] = advisor.review(
      canonical.id,
      raw.status === "approved_for_planning" ? "approve_for_planning" : "reject",
      reviewedAt,
    );
  }
  return { aggregates, proposals };
}

function coerceUsageAdvisorAggregate(
  value: unknown,
  code: UsageAdvisorSignalCode,
): UsageAdvisorAggregate | undefined {
  if (!isRecord(value) || value.code !== code) return undefined;
  if (!Number.isSafeInteger(value.count) || (value.count as number) < 1) return undefined;
  const first = normalizedIsoTimestamp(value.firstSeenAt);
  const last = normalizedIsoTimestamp(value.lastSeenAt);
  if (!first || !last) return undefined;
  const validRecent = Array.isArray(value.recentAt)
    ? value.recentAt.map(normalizedIsoTimestamp).filter((item): item is string => Boolean(item))
    : [];
  const ordered = [...validRecent, first, last].sort((left, right) => left.localeCompare(right));
  const recentAt = validRecent.length
    ? validRecent.sort((left, right) => left.localeCompare(right)).slice(-USAGE_ADVISOR_LIMITS.recentTimestamps)
    : first === last
      ? [first]
      : [first, last];
  return {
    code,
    count: value.count as number,
    firstSeenAt: ordered[0]!,
    lastSeenAt: ordered.at(-1)!,
    recentAt,
  };
}

function canonicalUsageAdvisorProposal(
  code: UsageAdvisorSignalCode,
  aggregate: UsageAdvisorAggregate,
): UsageAdvisorProposal {
  const advisor = new UsageAdvisor(emptyUsageAdvisorState());
  let proposal: UsageAdvisorProposal | undefined;
  for (let index = 0; index < USAGE_ADVISOR_LIMITS.proposalThreshold; index += 1) {
    proposal = advisor.record({ code, at: aggregate.lastSeenAt }) ?? proposal;
  }
  if (!proposal) throw new Error("UsageAdvisor proposal template is unavailable.");
  return proposal;
}

function isUsageAdvisorProposalStatus(value: unknown): value is UsageAdvisorProposalStatus {
  return value === "pending_review" || value === "approved_for_planning" || value === "rejected";
}

function normalizedIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function isBridgeStateEnvelope(value: unknown): value is BridgeStateEnvelopeV6 {
  return Boolean(
    isRecord(value) &&
      value.schemaVersion === bridgeStateSchemaVersion &&
      isRecord(value.adapters),
  );
}

function isBridgeStateEnvelopeV5(value: unknown): value is { schemaVersion: 5; adapters: Record<string, BridgeState> } {
  return Boolean(isRecord(value) && value.schemaVersion === 5 && isRecord(value.adapters));
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
    !isBridgeStateEnvelope(value) && !isBridgeStateEnvelopeV5(value) && !isBridgeStateEnvelopeV4(value) && !isBridgeStateEnvelopeV3(value) && !isBridgeStateEnvelopeV2(value)
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

function retentionHoursMs(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("outboundMediaRetentionHours must be a non-negative safe integer.");
  }
  return value * 60 * 60 * 1_000;
}

function enforceDurableRetention(
  state: BridgeState,
  jobRetentionCount: number,
  outboxRetentionCount: number,
  outboundMediaRetentionMs: number,
): void {
  normalizeDeliveryReferences(state);
  const protectedMediaJobs = recentTerminalMediaJobs(state, outboundMediaRetentionMs);
  pruneDeliveredOutbox(state, outboxRetentionCount, protectedMediaJobs);
  pruneTerminalJobs(state, jobRetentionCount, protectedMediaJobs);
  normalizeDeliveryReferences(state);
}

function recentTerminalMediaJobs(state: BridgeState, retentionMs: number): Set<string> {
  const protectedJobs = new Set<string>();
  if (retentionMs <= 0) return protectedJobs;
  const cutoff = Date.now() - retentionMs;
  for (const job of Object.values(state.jobs)) {
    if (!isTerminalJob(job)) continue;
    const deliveries = Object.values(state.outbox).filter((item) => item.jobId === job.id);
    if (!deliveries.some((item) => item.kind === "image" || item.kind === "file")) continue;
    if (!deliveries.length || !deliveries.every((item) => item.status === "delivered")) continue;
    const terminalAt = Date.parse(job.completedAt ?? job.updatedAt);
    if (!Number.isFinite(terminalAt) || terminalAt > cutoff) protectedJobs.add(job.id);
  }
  return protectedJobs;
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

function pruneDeliveredOutbox(
  state: BridgeState,
  retentionCount: number,
  protectedMediaJobs: Set<string>,
): void {
  let outboxCount = Object.keys(state.outbox).length;
  if (outboxCount <= retentionCount) return;
  const groups = completeTerminalDeliveryGroups(state);
  for (const group of groups) {
    if (outboxCount <= retentionCount) break;
    if (protectedMediaJobs.has(group[0]!.jobId)) continue;
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

function pruneTerminalJobs(
  state: BridgeState,
  retentionCount: number,
  protectedMediaJobs: Set<string>,
): void {
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
        !jobsWithActiveTaskObligations.has(job.id) &&
        !protectedMediaJobs.has(job.id),
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
