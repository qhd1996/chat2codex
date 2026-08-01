import { randomBytes } from "node:crypto";
import path from "node:path";
import { createSessionEpoch, type BridgeState, type RegisteredTask, type TaskStatus, type WorkspaceKind } from "../state/types.js";

export interface CreateTaskInput { conversationId: string; chatType: "direct" | "group"; senderKey: string; title: string; aliases: string[]; workspaceKind: WorkspaceKind; workspaceRoot: string; objective: string; }

const transitions: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  draft: new Set(["queued", "archived"]), queued: new Set(["waiting_workspace", "running", "failed", "interrupted", "archived"]),
  waiting_workspace: new Set(["queued", "running", "stopping", "failed", "interrupted", "archived"]),
  running: new Set(["waiting_approval", "waiting_input", "stopping", "completed", "failed", "interrupted"]),
  waiting_approval: new Set(["running", "stopping", "failed", "interrupted"]), waiting_input: new Set(["running", "stopping", "failed", "interrupted"]),
  stopping: new Set(["completed", "failed", "interrupted"]), completed: new Set(["queued", "archived"]), failed: new Set(["queued", "archived"]), interrupted: new Set(["queued", "archived"]), archived: new Set(),
};

export class TaskRegistry {
  private readonly now: () => number;
  constructor(options: { now?: () => number } = {}) { this.now = options.now ?? Date.now; }
  create(state: BridgeState, input: CreateTaskInput): RegisteredTask {
    const now = new Date(this.now()).toISOString();
    let taskId: string;
    do { taskId = "tsk_" + randomBytes(12).toString("hex"); } while (state.tasks[taskId]);
    const task: RegisteredTask = { taskId, conversationId: identity(input.conversationId, "conversationId"), chatType: input.chatType, senderKey: identity(input.senderKey, "senderKey"), title: text(input.title, 48) || taskId.slice(0, 12), aliases: unique(input.aliases, 12, 48), workspaceKind: input.workspaceKind, workspaceRoot: path.resolve(input.workspaceRoot), executionCwd: path.resolve(input.workspaceRoot), isolationMode: "canonical_fifo", sessionEpoch: createSessionEpoch(), status: "draft", objectiveSummary: text(input.objective, 500), recentRequests: [], createdAt: now, updatedAt: now, lastActiveAt: now };
    state.tasks[taskId] = task; const conversation = state.conversations[task.conversationId] ?? { taskIds: [] }; conversation.taskIds = [...new Set([...conversation.taskIds, taskId])]; conversation.lastTaskId = taskId; state.conversations[task.conversationId] = conversation; return task;
  }
  get(state: BridgeState, taskId: string) { return state.tasks[taskId]; }
  listConversation(state: BridgeState, conversationId: string, senderKey?: string): RegisteredTask[] { return (state.conversations[conversationId]?.taskIds ?? []).flatMap((id) => { const task = state.tasks[id]; return task && (!senderKey || task.senderKey === senderKey) ? [task] : []; }); }
  bindThread(state: BridgeState, taskId: string, threadId: string): void { const task = required(state, taskId); const normalized = identity(threadId, "threadId"); const owner = Object.values(state.tasks).find((candidate) => candidate.taskId !== taskId && candidate.threadId === normalized); if (owner) throw new Error("Codex thread is already bound to another task."); task.threadId = normalized; this.touch(task); }
  transition(state: BridgeState, taskId: string, next: TaskStatus): RegisteredTask { const task = required(state, taskId); if (task.status !== next && !transitions[task.status].has(next)) throw new Error("Invalid task status transition: " + task.status + " -> " + next); task.status = next; this.touch(task); return task; }
  appendRequest(state: BridgeState, taskId: string, value: string): void { const task = required(state, taskId); const normalized = text(value, 300); if (normalized) task.recentRequests = [...task.recentRequests, normalized].slice(-8); this.touch(task); }
  addAlias(state: BridgeState, taskId: string, alias: string): void { const task = required(state, taskId); task.aliases = unique([...task.aliases, alias], 12, 48); this.touch(task); }
  archive(state: BridgeState, taskId: string): void { this.transition(state, taskId, "archived"); }
  private touch(task: RegisteredTask): void { const now = new Date(this.now()).toISOString(); task.updatedAt = now; task.lastActiveAt = now; }
}

function required(state: BridgeState, taskId: string): RegisteredTask { const task = state.tasks[taskId]; if (!task) throw new Error("Task not found: " + taskId); return task; }
function unique(values: string[], limit: number, max: number): string[] { const result: string[] = []; const seen = new Set<string>(); for (const raw of values) { const value = text(raw, max); const key = value.toLocaleLowerCase(); if (!value || seen.has(key)) continue; seen.add(key); result.push(value); } return result.slice(-limit); }
function text(value: string, max: number): string { return [...value.replace(/[\u0000-\u001f\u007f]/gu, " " ).replace(/\s+/gu, " " ).trim()].slice(0, max).join(""); }
function identity(value: string, label: string): string { const normalized = value.trim(); if (!normalized || normalized.length > 4096 || /[\u0000-\u001f]/u.test(normalized)) throw new RangeError(label + " must be a bounded non-empty identity."); return normalized; }
