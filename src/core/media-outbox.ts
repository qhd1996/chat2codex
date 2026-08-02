import { createHash } from "node:crypto";

import type { StagedDeliverable } from "./deliverable-stager.js";
import type { BridgeState, DurableCodexJob, DurableMediaOutboxMessage, DurableOutboxMessage, DurableTextOutboxMessage } from "../state/types.js";

export interface AppendMediaResultInput {
  text?: string;
  textKind?: "text" | "markdown";
  textEntries?: ReadonlyArray<{ kind: "text" | "markdown"; text: string }>;
  stagedFiles?: readonly StagedDeliverable[];
  createdAt: string;
}

export class MediaOutbox {
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
