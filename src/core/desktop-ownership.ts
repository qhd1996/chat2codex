import { createHash } from "node:crypto";

import type {
  BridgeState,
  DesktopBinding,
  DesktopGatewayState,
  DesktopOwner,
} from "../state/types.js";
import { emptyDesktopGatewayState } from "../state/types.js";

const MAX_MUTATIONS = 256;
const MAX_CONTROL_TURNS = 128;
const MAX_WAKES = 128;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;

export interface DesktopOwnershipCoordinatorOptions {
  leaseDurationMs?: number;
}

export class DesktopOwnershipCoordinator {
  private readonly leaseDurationMs: number;

  constructor(options: DesktopOwnershipCoordinatorOptions = {}) {
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
      throw new RangeError("leaseDurationMs must be a positive safe integer.");
    }
  }

  bind(state: BridgeState, input: {
    mutationId: string; bindingId: string; rootThreadId: string; taskId: string;
    conversationId: string; adapterId: string; bindingAnchorTurnId: string; observedAt: string;
  }): DesktopBinding {
    const gateway = gatewayState(state);
    const existing = gateway.bindings[input.bindingId];
    const digest = mutationDigest("bind", input);
    if (existing) {
      return this.replay(existing, input.mutationId, digest);
    }
    assertOpaqueFields(input, ["mutationId", "bindingId", "rootThreadId", "taskId", "conversationId", "adapterId", "bindingAnchorTurnId"]);
    assertTimestamp(input.observedAt, "observedAt");
    const duplicateMutation = Object.values(gateway.bindings).find((item) => input.mutationId in item.processedMutationIds);
    if (duplicateMutation) return this.replay(duplicateMutation, input.mutationId, digest);
    if (Object.values(gateway.bindings).some((item) => item.rootThreadId === input.rootThreadId || item.taskId === input.taskId)) {
      throw new Error("Duplicate Desktop binding for root thread or task.");
    }
    const task = state.tasks[input.taskId];
    if (!task || task.threadId !== input.rootThreadId || task.conversationId !== input.conversationId) {
      throw new Error("Desktop binding must reference the exact registered root task and conversation.");
    }
    const binding: DesktopBinding = {
      bindingId: input.bindingId, rootThreadId: input.rootThreadId, taskId: input.taskId,
      conversationId: input.conversationId, adapterId: input.adapterId, owner: "bridge", generation: 1,
      bindingAnchorTurnId: input.bindingAnchorTurnId, lastReconciledTurnId: input.bindingAnchorTurnId,
      excludedControlTurns: {}, pendingWakeIds: [], processedMutationIds: { [input.mutationId]: digest },
      createdAt: input.observedAt, updatedAt: input.observedAt,
    };
    gateway.bindings[binding.bindingId] = binding;
    return binding;
  }

  takeover(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; ownerInstanceId: string; observedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("takeover", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.owner === "uncertain") throw new Error("Desktop ownership is uncertain and requires authoritative recovery.");
    if (binding.owner !== "bridge") throw new Error(`Desktop takeover requires bridge ownership, not ${binding.owner}.`);
    if (binding.activeStartFence) throw new Error("Desktop takeover is blocked by an active start fence.");
    if (binding.releaseRequested || binding.pendingWakeIds.length > 0) throw new Error("Desktop takeover is blocked by unreconciled release obligations.");
    if (hasActiveBridgeJob(state, binding.taskId)) throw new Error("Desktop takeover is blocked by an active bridge job.");
    if (hasPendingOutbox(state, binding.taskId)) throw new Error("Desktop takeover is blocked by pending outbox delivery.");
    assertOpaque(input.ownerInstanceId, "ownerInstanceId");
    this.recordMutation(binding, input.mutationId, digest);
    binding.owner = "desktop";
    binding.generation += 1;
    binding.ownerInstanceId = input.ownerInstanceId;
    binding.leaseExpiresAt = addMilliseconds(input.observedAt, this.leaseDurationMs);
    binding.updatedAt = normalizedTimestamp(input.observedAt, "observedAt");
    return binding;
  }

  heartbeat(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; ownerInstanceId: string; observedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("heartbeat", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.owner !== "desktop" || binding.ownerInstanceId !== input.ownerInstanceId) throw new Error("Desktop heartbeat owner does not match the active lease.");
    const observedAt = normalizedTimestamp(input.observedAt, "observedAt");
    if (!binding.leaseExpiresAt || Date.parse(observedAt) > Date.parse(binding.leaseExpiresAt)) {
      binding.owner = "uncertain";
      binding.generation += 1;
      delete binding.ownerInstanceId;
      delete binding.leaseExpiresAt;
      binding.updatedAt = observedAt;
      throw new Error("Desktop lease expired; ownership is uncertain.");
    }
    this.recordMutation(binding, input.mutationId, digest);
    binding.leaseExpiresAt = addMilliseconds(observedAt, this.leaseDurationMs);
    binding.updatedAt = observedAt;
    return binding;
  }

  createFence(state: BridgeState, input: { requestId: string; bindingId: string; expectedGeneration: number; turnId: string; promptCommitment: string; issuedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("create_fence", input);
    if (input.requestId in binding.processedMutationIds) return this.replay(binding, input.requestId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.owner !== "desktop") throw new Error("A start fence requires current Desktop ownership.");
    if (binding.activeStartFence) throw new Error("An active start fence already exists.");
    if (binding.releaseRequested) throw new Error("A release request blocks new Desktop turns.");
    assertOpaque(input.turnId, "turnId");
    assertDigest(input.promptCommitment, "promptCommitment");
    const issuedAt = normalizedTimestamp(input.issuedAt, "issuedAt");
    if (!binding.leaseExpiresAt || Date.parse(issuedAt) > Date.parse(binding.leaseExpiresAt)) {
      binding.owner = "uncertain";
      binding.generation += 1;
      binding.updatedAt = issuedAt;
      throw new Error("Desktop lease expired; ownership is uncertain.");
    }
    this.recordMutation(binding, input.requestId, digest);
    binding.activeStartFence = {
      turnId: input.turnId, originGeneration: binding.generation, requestId: input.requestId,
      promptCommitment: input.promptCommitment, issuedAt,
    };
    binding.updatedAt = issuedAt;
    return binding;
  }

  recordControlTurn(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; turnId: string; kind: "takeover" | "release_request"; promptCommitment: string; recordedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("control_turn", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    assertOpaque(input.turnId, "turnId");
    assertDigest(input.promptCommitment, "promptCommitment");
    const recordedAt = normalizedTimestamp(input.recordedAt, "recordedAt");
    const existing = binding.excludedControlTurns[input.turnId];
    if (existing) {
      const equivalent = existing.kind === input.kind && existing.originGeneration === binding.generation && existing.promptCommitment === input.promptCommitment;
      if (!equivalent) return this.integrityConflict(binding, "Excluded control turn integrity conflict.");
    } else {
      binding.excludedControlTurns[input.turnId] = { kind: input.kind, originGeneration: binding.generation, promptCommitment: input.promptCommitment, recordedAt };
      trimRecord(binding.excludedControlTurns, MAX_CONTROL_TURNS);
    }
    this.recordMutation(binding, input.mutationId, digest);
    binding.updatedAt = recordedAt;
    return binding;
  }

  requestRelease(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; observedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("request_release", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.owner !== "desktop") throw new Error("Release can be requested only by the Desktop owner.");
    this.recordMutation(binding, input.mutationId, digest);
    binding.releaseRequested = true;
    binding.updatedAt = normalizedTimestamp(input.observedAt, "observedAt");
    return binding;
  }

  completeRelease(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; observedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("complete_release", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.owner !== "desktop" || !binding.releaseRequested) throw new Error("Desktop release was not requested.");
    if (binding.activeStartFence || binding.pendingWakeIds.length > 0) throw new Error("Desktop release requires completed reconciliation with no fence or wake.");
    if (binding.lastMirroredTurnId !== binding.lastReconciledTurnId) throw new Error("Desktop release requires matching reconciliation high water.");
    if (hasActiveBridgeJob(state, binding.taskId)) throw new Error("Desktop release is blocked by an active job.");
    if (hasPendingOutbox(state, binding.taskId)) throw new Error("Desktop release is blocked by pending outbox delivery.");
    this.recordMutation(binding, input.mutationId, digest);
    binding.owner = "bridge";
    binding.generation += 1;
    binding.releaseRequested = false;
    delete binding.ownerInstanceId;
    delete binding.leaseExpiresAt;
    binding.updatedAt = normalizedTimestamp(input.observedAt, "observedAt");
    return binding;
  }

  enqueueWake(state: BridgeState, input: { eventId: string; bindingId: string; turnId: string; observedAt: string }): DesktopBinding {
    const gateway = gatewayState(state);
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("enqueue_wake", input);
    if (input.eventId in binding.processedMutationIds) return this.replay(binding, input.eventId, digest);
    assertOpaque(input.turnId, "turnId");
    const observedAt = normalizedTimestamp(input.observedAt, "observedAt");
    this.recordMutation(binding, input.eventId, digest);
    gateway.wakes[input.eventId] = { eventId: input.eventId, bindingId: binding.bindingId, turnId: input.turnId, observedAt };
    binding.pendingWakeIds.push(input.eventId);
    if (binding.pendingWakeIds.length > MAX_WAKES) {
      const removed = binding.pendingWakeIds.splice(0, binding.pendingWakeIds.length - MAX_WAKES);
      for (const eventId of removed) delete gateway.wakes[eventId];
    }
    binding.updatedAt = observedAt;
    return binding;
  }

  markUncertain(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; observedAt: string; reason: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("mark_uncertain", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    assertOpaque(input.reason, "reason");
    this.recordMutation(binding, input.mutationId, digest);
    binding.owner = "uncertain";
    binding.generation += 1;
    delete binding.ownerInstanceId;
    delete binding.leaseExpiresAt;
    binding.updatedAt = normalizedTimestamp(input.observedAt, "observedAt");
    return binding;
  }

  disable(state: BridgeState, input: { mutationId: string; bindingId: string; expectedGeneration: number; observedAt: string }): DesktopBinding {
    const binding = this.binding(state, input.bindingId);
    const digest = mutationDigest("disable", input);
    if (input.mutationId in binding.processedMutationIds) return this.replay(binding, input.mutationId, digest);
    this.expectGeneration(binding, input.expectedGeneration);
    if (binding.activeStartFence || binding.pendingWakeIds.length > 0 || binding.releaseRequested || hasPendingOutbox(state, binding.taskId)) {
      throw new Error("Desktop binding cannot be disabled while obligations remain.");
    }
    this.recordMutation(binding, input.mutationId, digest);
    binding.owner = "disabled";
    binding.generation += 1;
    delete binding.ownerInstanceId;
    delete binding.leaseExpiresAt;
    binding.updatedAt = normalizedTimestamp(input.observedAt, "observedAt");
    return binding;
  }

  private binding(state: BridgeState, bindingId: string): DesktopBinding {
    assertOpaque(bindingId, "bindingId");
    const binding = gatewayState(state).bindings[bindingId];
    if (!binding) throw new Error("Desktop binding was not found.");
    return binding;
  }

  private expectGeneration(binding: DesktopBinding, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || binding.generation !== expected) {
      throw new Error(`Stale generation for Desktop binding ${binding.bindingId}.`);
    }
  }

  private recordMutation(binding: DesktopBinding, mutationId: string, digest: string): void {
    assertOpaque(mutationId, "mutationId");
    binding.processedMutationIds[mutationId] = digest;
    trimRecord(binding.processedMutationIds, MAX_MUTATIONS);
  }

  private replay(binding: DesktopBinding, mutationId: string, digest: string): DesktopBinding {
    if (binding.processedMutationIds[mutationId] === digest) return binding;
    return this.integrityConflict(binding, "Mutation identifier integrity conflict.");
  }

  private integrityConflict(binding: DesktopBinding, message: string): never {
    if (binding.owner !== "disabled") {
      binding.owner = "uncertain";
      binding.generation += 1;
      delete binding.ownerInstanceId;
      delete binding.leaseExpiresAt;
    }
    throw new Error(message);
  }
}

function gatewayState(state: BridgeState): DesktopGatewayState {
  state.desktopGateway ??= emptyDesktopGatewayState();
  return state.desktopGateway;
}

function hasActiveBridgeJob(state: BridgeState, taskId: string): boolean {
  return Object.values(state.jobs).some((job) => job.taskId === taskId && !["completed", "failed", "cancelled", "interrupted"].includes(job.status));
}

function hasPendingOutbox(state: BridgeState, taskId: string): boolean {
  return Object.values(state.outbox).some((delivery) => delivery.taskId === taskId && delivery.status !== "delivered");
}

function mutationDigest(domain: string, value: unknown): string {
  return createHash("sha256").update("chat2codex.desktop-mutation.v1\0").update(domain).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Mutation input cannot contain undefined.");
  return encoded;
}

function assertOpaqueFields(value: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) assertOpaque(value[field], field);
}

function assertOpaque(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RangeError(`${name} must be a bounded opaque string.`);
  }
}

function assertDigest(value: string, name: string): void {
  if (!HEX_SHA256.test(value)) throw new RangeError(`${name} must be a lowercase SHA-256 digest.`);
}

function assertTimestamp(value: string, name: string): void {
  normalizedTimestamp(value, name);
}

function normalizedTimestamp(value: string, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new RangeError(`${name} must be an ISO timestamp.`);
  const normalized = new Date(value).toISOString();
  if (normalized !== value) throw new RangeError(`${name} must be a canonical UTC timestamp.`);
  return normalized;
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(normalizedTimestamp(value, "observedAt")) + milliseconds).toISOString();
}

function trimRecord<T>(record: Record<string, T>, maximum: number): void {
  const keys = Object.keys(record);
  for (const key of keys.slice(0, Math.max(0, keys.length - maximum))) delete record[key];
}

export function isDesktopOwner(value: unknown): value is DesktopOwner {
  return value === "bridge" || value === "desktop" || value === "uncertain" || value === "disabled";
}
