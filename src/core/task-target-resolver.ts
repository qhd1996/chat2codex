import type { RegisteredTask } from "../state/types.js";
export type TaskTargetResolution = { status: "resolved"; taskId: string; reason: "id" | "title" | "alias" | "interaction" | "semantic" | "recency" } | { status: "ambiguous"; taskIds: string[]; question: string } | { status: "missing"; question: string };
export interface TaskTargetRequest { tasks: RegisteredTask[]; conversationId?: string; senderKey?: string; explicitTaskId?: string; reference?: string; pendingInteractionTaskIds?: string[]; semanticTaskId?: string; semanticConfidence?: number; minimumConfidence?: number; allowRecency?: boolean; actionKind: string; }
const highRisk = new Set(["stop_task","archive_task","approve","deny","grant_turn","grant_session","answer_user_input","answer_mcp_field","decide_mcp_url"]);
export class TaskTargetResolver {
  resolve(request: TaskTargetRequest): TaskTargetResolution {
    const tasks = request.tasks.filter((task) => task.status !== "archived" && (!request.conversationId || task.conversationId === request.conversationId) && (!request.senderKey || task.senderKey === request.senderKey));
    if (request.explicitTaskId) return one(tasks.filter((task) => task.taskId === request.explicitTaskId), "id");
    if (request.reference) { const reference = normalize(request.reference); const byTitle = tasks.filter((task) => normalize(task.title) === reference); if (byTitle.length) return one(byTitle, "title"); const byAlias = tasks.filter((task) => task.aliases.some((alias) => normalize(alias) === reference)); if (byAlias.length) return one(byAlias, "alias"); return { status: "missing", question: "没有找到匹配的任务。" }; }
    const interactionIds = [...new Set(request.pendingInteractionTaskIds ?? [])].filter((id) => tasks.some((task) => task.taskId === id)); if (interactionIds.length === 1) return { status: "resolved", taskId: interactionIds[0]!, reason: "interaction" }; if (interactionIds.length > 1) return ambiguous(interactionIds);
    if (request.semanticTaskId && (request.semanticConfidence ?? 0) >= (request.minimumConfidence ?? 1) && tasks.some((task) => task.taskId === request.semanticTaskId)) return { status: "resolved", taskId: request.semanticTaskId, reason: "semantic" };
    if (request.allowRecency && !highRisk.has(request.actionKind) && tasks.length) { const sorted = [...tasks].sort((a,b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)); if (sorted.length === 1 || Date.parse(sorted[0]!.lastActiveAt) > Date.parse(sorted[1]!.lastActiveAt)) return { status: "resolved", taskId: sorted[0]!.taskId, reason: "recency" }; }
    return tasks.length ? ambiguous(tasks.map((task) => task.taskId)) : { status: "missing", question: "没有找到可操作的任务，请说明任务名称。" };
  }
}
function one(tasks: RegisteredTask[], reason: "id"|"title"|"alias"): TaskTargetResolution { return tasks.length === 1 ? { status: "resolved", taskId: tasks[0]!.taskId, reason } : tasks.length > 1 ? ambiguous(tasks.map((task) => task.taskId)) : { status: "missing", question: "没有找到匹配的任务。" }; }
function ambiguous(taskIds: string[]): TaskTargetResolution { return { status: "ambiguous", taskIds: taskIds.slice(0, 12), question: "有多个任务可能匹配，请说明任务名称。" }; }
function normalize(value: string): string { return value.replace(/\s+/gu, "").trim().toLocaleLowerCase(); }
