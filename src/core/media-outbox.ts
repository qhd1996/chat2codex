import { createHash } from "node:crypto";

import type { StagedDeliverable } from "./deliverable-stager.js";
import type { BridgeState, DurableCodexJob, DurableMediaOutboxMessage, DurableOutboxMessage, DurableTextOutboxMessage } from "../state/types.js";
import type { DesktopReconciliationPlan } from "./desktop-reconciler.js";

export interface AppendMediaResultInput {
  text?: string;
  textKind?: "text" | "markdown";
  textEntries?: ReadonlyArray<{ kind: "text" | "markdown"; text: string }>;
  stagedFiles?: readonly StagedDeliverable[];
  createdAt: string;
}

export class MediaOutbox {
  appendDesktopResult(
    state: BridgeState,
    input: { plan: DesktopReconciliationPlan; taskId: string; conversationId: string; cwd: string; stagedFiles: readonly StagedDeliverable[]; createdAt: string },
  ): DurableOutboxMessage[] {
    const task = state.tasks[input.taskId];
    if (!task || task.threadId !== input.plan.rootThreadId || task.conversationId !== input.conversationId) {
      throw new Error("Desktop outbox requires the exact bound task/root/conversation.");
    }
    input.stagedFiles.forEach(validateStagedDeliverable);
    const parts: Array<{ kind: "markdown"; text: string; sha256: string } | { kind: "image" | "file"; file: StagedDeliverable; sha256: string }> = [];
    if (input.plan.visibleText.trim()) {
      parts.push({ kind: "markdown", text: input.plan.visibleText, sha256: createHash("sha256").update(input.plan.visibleText, "utf8").digest("hex") });
    }
    for (const file of input.stagedFiles) parts.push({ kind: file.kind, file, sha256: file.sha256 });
    const jobId = "desktop_job_" + createHash("sha256").update(input.plan.identityPrefix).digest("hex").slice(0, 24);
    if (parts.length === 0) return [];
    const existingJob = state.jobs[jobId];
    if (existingJob && (existingJob.taskId !== input.taskId || existingJob.threadId !== input.plan.rootThreadId)) {
      throw new Error("Desktop outbox job identity conflict.");
    }
    const candidates = parts.map((part, sequence): DurableOutboxMessage => {
      const idempotencyKey = `${input.plan.identityPrefix}:${sequence}:${part.sha256}`;
      const id = "out_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
      const base = { id, jobId, taskId: input.taskId, chatId: input.conversationId, sequence, status: "pending" as const, idempotencyKey, attempts: 0, createdAt: input.createdAt, updatedAt: input.createdAt };
      return part.kind === "markdown"
        ? { ...base, kind: "markdown", text: part.text }
        : { ...base, kind: part.kind, text: "", stagedPath: part.file.stagedPath, fileName: part.file.fileName, mediaType: part.file.mediaType, size: part.file.size, sha256: part.file.sha256 };
    });
    for (const candidate of candidates) {
      const position = `${input.plan.identityPrefix}:${candidate.sequence}:`;
      const atPosition = Object.values(state.outbox).find((item) => item.idempotencyKey.startsWith(position));
      if (atPosition && atPosition.idempotencyKey !== candidate.idempotencyKey) throw new Error("Desktop outbox logical position integrity conflict.");
      if (atPosition && canonicalDelivery(atPosition) !== canonicalDelivery(candidate)) throw new Error("Desktop outbox byte identity conflict.");
    }
    const job = existingJob ?? {
      id: jobId, kind: "control_recovery" as const, messageId: jobId, chatId: input.conversationId, chatType: task.chatType,
      cwd: input.cwd, prompt: "[desktop result]", threadId: input.plan.rootThreadId, status: "completed" as const,
      createdAt: input.createdAt, updatedAt: input.createdAt, completedAt: input.createdAt, deliveryIds: [], taskId: input.taskId,
    };
    state.jobs[jobId] = job;
    for (const candidate of candidates) {
      const existing = Object.values(state.outbox).find((item) => item.idempotencyKey === candidate.idempotencyKey);
      if (!existing) state.outbox[candidate.id] = candidate;
      const deliveryId = existing?.id ?? candidate.id;
      if (!job.deliveryIds.includes(deliveryId)) job.deliveryIds.push(deliveryId);
    }
    return candidates.map((candidate) => Object.values(state.outbox).find((item) => item.idempotencyKey === candidate.idempotencyKey)!);
  }

  appendResult(state: BridgeState, job: DurableCodexJob, input: AppendMediaResultInput): DurableOutboxMessage[] {
    const task = job.taskId ? state.tasks[job.taskId] : undefined;
    if (!task || task.conversationId !== job.chatId) throw new Error("Media outbox requires a task-qualified job owner.");
    if (state.jobs[job.id] !== job) throw new Error("Media outbox job must belong to the current durable state.");
    if (job.deliveryIds.length > 0) throw new Error("Media outbox result has already been appended.");
    const text = input.text?.trim() ? input.text : undefined;
    const textEntries = input.textEntries ?? (text === undefined
      ? []
      : [{ kind: input.textKind ?? "text", text }]);
    const stagedFiles = [...(input.stagedFiles ?? [])];
    stagedFiles.forEach(validateStagedDeliverable);
    const candidates: DurableOutboxMessage[] = [];
    const base = (sequence: number) => {
      const id = stableDeliveryId(job.id, sequence);
      return { id, jobId: job.id, taskId: job.taskId, chatId: job.chatId, sequence, status: "pending" as const, idempotencyKey: id, attempts: 0, createdAt: input.createdAt, updatedAt: input.createdAt };
    };
    const pushText = (kind: DurableTextOutboxMessage["kind"], value: string) => {
      const sequence = candidates.length;
      candidates.push({ ...base(sequence), kind, text: value });
    };
    const pushMedia = (file: StagedDeliverable) => {
      const sequence = candidates.length;
      const item: DurableMediaOutboxMessage = { ...base(sequence), taskId: job.taskId!, kind: file.kind, text: "", stagedPath: file.stagedPath, fileName: file.fileName, mediaType: file.mediaType, size: file.size, sha256: file.sha256 };
      candidates.push(item);
    };
    for (const entry of textEntries) {
      if ((entry.kind !== "text" && entry.kind !== "markdown") || !entry.text.trim()) {
        throw new Error("Media outbox text entry is invalid.");
      }
      pushText(entry.kind, entry.text);
    }
    for (const file of stagedFiles) pushMedia(file);
    for (const item of candidates) {
      if (state.outbox[item.id]) throw new Error("Stable media outbox delivery ID already exists.");
    }
    for (const item of candidates) state.outbox[item.id] = item;
    job.deliveryIds.push(...candidates.map((item) => item.id));
    return candidates;
  }

  recover(state: BridgeState): DurableOutboxMessage[] {
    for (const item of Object.values(state.outbox)) {
      if (item.status === "sending") item.status = "pending";
    }
    const pendingJobs = new Set(
      Object.values(state.outbox).filter((item) => item.status !== "delivered").map((item) => item.jobId),
    );
    return [...pendingJobs]
      .map((jobId) => this.nextUndelivered(state, jobId))
      .filter((item): item is DurableOutboxMessage => item !== undefined)
      .sort(compareSequence);
  }

  nextUndelivered(state: BridgeState, jobId: string): DurableOutboxMessage | undefined {
    return Object.values(state.outbox)
      .filter((item) => item.jobId === jobId && item.status !== "delivered")
      .sort(compareSequence)[0];
  }
}

function canonicalDelivery(item: DurableOutboxMessage): string {
  if (item.kind === "text" || item.kind === "markdown") return JSON.stringify({ kind: item.kind, text: item.text });
  const media = item as DurableMediaOutboxMessage;
  return JSON.stringify({ kind: media.kind, fileName: media.fileName, mediaType: media.mediaType, size: media.size, sha256: media.sha256 });
}

function stableDeliveryId(jobId: string, sequence: number): string {
  return "out_" + createHash("sha256").update(jobId).update("\0").update(String(sequence)).digest("hex").slice(0, 32);
}

function validateStagedDeliverable(item: StagedDeliverable): void {
  if (!item || (item.kind !== "image" && item.kind !== "file")) throw new Error("Invalid staged media kind.");
  if (!item.stagedPath || !item.fileName || !item.mediaType) throw new Error("Staged media metadata is incomplete.");
  if (!Number.isSafeInteger(item.size) || item.size <= 0) throw new Error("Invalid staged media size.");
  if (!/^[a-f0-9]{64}$/u.test(item.sha256)) throw new Error("Invalid staged media hash.");
}

function compareSequence(left: DurableOutboxMessage, right: DurableOutboxMessage): number {
  return left.jobId.localeCompare(right.jobId) || left.sequence - right.sequence || left.id.localeCompare(right.id);
}
