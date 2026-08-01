import { z } from "zod";
import type { CommandAction } from "./command-actions.js";

export interface TaskCandidate { taskId: string; title: string; aliases: string[]; workspaceKind: string; status: string; objectiveSummary: string; recentRequests: string[]; }
export interface WorkspaceCandidate { kind: string; root: string; aliases: string[]; }
export interface PendingInteractionCandidate { taskId: string; requestId: string; kind: "approval" | "permission" | "user_input" | "mcp"; decisions?: string[]; }
export interface NaturalTaskRoutingInput { text: string; conversationId: string; candidates: TaskCandidate[]; workspaces: WorkspaceCandidate[]; pendingImageCount: number; pendingInteractions: PendingInteractionCandidate[]; }
export interface NaturalTaskDecision { action: CommandAction; imageDisposition: "none" | "attach" | "discard" | "clarify"; confidence: number; }
export interface NaturalTaskClassifier { classifyTask(input: NaturalTaskRoutingInput, signal?: AbortSignal): Promise<unknown>; }

const envelope = z.object({ action: z.record(z.string(), z.unknown()), imageDisposition: z.enum(["none", "attach", "discard", "clarify"]), confidence: z.number().min(0).max(1) }).strict();
const fallback = (candidates: string[] = []): NaturalTaskDecision => ({ action: { kind: "clarify", question: "请说明要操作哪个任务。", candidateTaskIds: candidates }, imageDisposition: "clarify", confidence: 0 });
const highRisk = new Set(["stop_task", "archive_task", "approve", "deny", "grant_turn", "grant_session", "answer_user_input", "answer_mcp_field", "decide_mcp_url"]);
const actionKeys: Record<string, ReadonlySet<string>> = Object.fromEntries([
  ...["show_help","list_tasks","list_projects","list_threads","list_archived","show_status","show_host","show_usage","show_summary","show_files","show_diff","show_logs","show_identity","service_status","service_logs","service_restart"].map((kind) => [kind, new Set(["kind"])]),
  ...["stop_task","inspect_task","retry_task","archive_task","compact_task","reset_task"].map((kind) => [kind, new Set(["kind","taskId"])]),
  ...["continue_task","steer_task"].map((kind) => [kind, new Set(["kind","taskId","instruction"])]),
  ...["resume_task","fork_task"].map((kind) => [kind, new Set(["kind","taskId","selector","threadId","turnId"])]),
  ...["approve","deny","grant_turn","grant_session"].map((kind) => [kind, new Set(["kind","taskId","requestId","replyCode","option"])]),
  ...["answer_user_input","answer_mcp_field","decide_mcp_url"].map((kind) => [kind, new Set(["kind","taskId","requestId","replyCode","value"])]),
  ["create_task", new Set(["kind","instruction","workspaceKind","explicitPath","collaborationMode","executionIntent"])], ["discard_images", new Set(["kind","conversationId","senderKey"])], ["submit_images", new Set(["kind","taskId","instruction"])], ["show_history", new Set(["kind","selector"])], ["select_project", new Set(["kind","selector"])], ["search_threads", new Set(["kind","query"])], ["unarchive_thread", new Set(["kind","selector"])], ["clarify", new Set(["kind","question","candidateTaskIds"])],
]);

export async function resolveNaturalTaskDecision(input: NaturalTaskRoutingInput, classifier: NaturalTaskClassifier, minimumConfidence: number, signal?: AbortSignal): Promise<NaturalTaskDecision> {
  try {
    const parsed = envelope.safeParse(await classifier.classifyTask(boundedInput(input), signal));
    if (!parsed.success || parsed.data.confidence < minimumConfidence) return fallback(input.candidates.map((item) => item.taskId));
    const action = validateAction(parsed.data.action, input);
    if (!action) return fallback(input.candidates.map((item) => item.taskId));
    if (input.pendingImageCount > 0 && parsed.data.imageDisposition === "none") return fallback(input.candidates.map((item) => item.taskId));
    return { action, imageDisposition: parsed.data.imageDisposition, confidence: parsed.data.confidence };
  } catch { return fallback(input.candidates.map((item) => item.taskId)); }
}

function validateAction(value: Record<string, unknown>, input: NaturalTaskRoutingInput): CommandAction | null {
  if (typeof value.kind !== "string") return null; const kind = value.kind; const allowed = actionKeys[kind]; if (!allowed || Object.keys(value).some((key) => !allowed.has(key))) return null; const taskId = typeof value.taskId === "string" ? value.taskId : undefined; const requestId = typeof value.requestId === "string" ? value.requestId : undefined;
  for (const key of ["taskId","requestId","instruction","selector","query","replyCode","option","value","conversationId","senderKey","explicitPath","threadId","turnId","question"]) if (value[key] !== undefined && typeof value[key] !== "string") return null;
  if (value.workspaceKind !== undefined && typeof value.workspaceKind !== "string") return null; if (value.collaborationMode !== undefined && value.collaborationMode !== "default" && value.collaborationMode !== "plan") return null;
  if (value.executionIntent !== undefined && value.executionIntent !== "general" && value.executionIntent !== "output_only") return null;
  if (taskId && !input.candidates.some((item) => item.taskId === taskId)) return null;
  if (highRisk.has(kind) && !taskId) return null;
  if (["approve","deny","grant_turn","grant_session","answer_user_input","answer_mcp_field","decide_mcp_url"].includes(kind)) { const pending = input.pendingInteractions.find((item) => item.taskId === taskId && (!requestId || item.requestId === requestId)); if (!pending) return null; if (kind === "grant_session" && !pending.decisions?.includes("grantSession")) return null; }
  const instruction = typeof value.instruction === "string" ? value.instruction : undefined; const selector = typeof value.selector === "string" ? value.selector : undefined; const query = typeof value.query === "string" ? value.query : undefined;
  if (["create_task","continue_task","steer_task","submit_images"].includes(kind) && !instruction?.trim()) return null;
  if (["select_project","unarchive_thread"].includes(kind) && !selector?.trim()) return null;
  if (kind === "search_threads" && !query?.trim()) return null;
  if (["answer_user_input","answer_mcp_field","decide_mcp_url"].includes(kind) && typeof value.value !== "string") return null;
  if (kind === "clarify" && (typeof value.question !== "string" || !Array.isArray(value.candidateTaskIds) || !value.candidateTaskIds.every((id) => typeof id === "string" && input.candidates.some((candidate) => candidate.taskId === id)))) return null;
  return value as unknown as CommandAction;
}

function boundedInput(input: NaturalTaskRoutingInput): NaturalTaskRoutingInput {
  const bounded = { ...input, text: input.text.slice(0, 4000), conversationId: input.conversationId.slice(0, 512), candidates: input.candidates.slice(0, 12).map((item) => ({ ...item, taskId: item.taskId.slice(0, 160), title: item.title.slice(0, 160), aliases: item.aliases.slice(0, 12).map((value) => value.slice(0, 160)), workspaceKind: item.workspaceKind.slice(0, 80), status: item.status.slice(0, 80), objectiveSummary: item.objectiveSummary.slice(0, 500), recentRequests: item.recentRequests.slice(-8).map((value) => value.slice(0, 300)) })), workspaces: input.workspaces.slice(0, 12).map((item) => ({ kind: item.kind.slice(0, 80), root: item.root.slice(0, 1024), aliases: item.aliases.slice(0, 12).map((value) => value.slice(0, 160)) })), pendingInteractions: input.pendingInteractions.slice(0, 32).map((item) => ({ ...item, taskId: item.taskId.slice(0, 160), requestId: item.requestId.slice(0, 160), decisions: item.decisions?.slice(0, 16).map((value) => value.slice(0, 160)) })), pendingImageCount: Math.max(0, Math.min(4, input.pendingImageCount)) };
  while (JSON.stringify(bounded).length > 16 * 1024 && bounded.candidates.length > 1) bounded.candidates.pop();
  while (JSON.stringify(bounded).length > 16 * 1024 && bounded.pendingInteractions.length) bounded.pendingInteractions.pop();
  while (JSON.stringify(bounded).length > 16 * 1024 && bounded.workspaces.length) bounded.workspaces.pop();
  if (JSON.stringify(bounded).length > 16 * 1024) for (const candidate of bounded.candidates) { candidate.aliases = []; candidate.recentRequests = []; candidate.objectiveSummary = candidate.objectiveSummary.slice(0, 160); }
  return bounded;
}
