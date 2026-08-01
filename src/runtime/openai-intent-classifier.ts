import { naturalIntentDecisionSchema, type NaturalIntentClassifier, type NaturalIntentInput } from "../core/natural-intent.js";
import { type NaturalTaskClassifier, type NaturalTaskRoutingInput } from "../core/natural-task-router.js";

export interface OpenAiIntentClassifierOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiIntentClassifier implements NaturalIntentClassifier, NaturalTaskClassifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiIntentClassifierOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async classify(input: NaturalIntentInput, signal?: AbortSignal): Promise<unknown> {
    return this.complete(classifierPrompt, { text: input.text.slice(0, 4000), context: input.context }, naturalIntentDecisionSchema.parse, signal);
  }

  async classifyTask(input: NaturalTaskRoutingInput, signal?: AbortSignal): Promise<unknown> {
    return this.complete(taskClassifierPrompt, input, (value) => value, signal);
  }

  private async complete(system: string, input: unknown, parse: (value: unknown) => unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: combined,
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Intent classifier HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Intent classifier returned no text content");
    return parse(JSON.parse(stripFence(content)));
  }
}

const classifierPrompt = [
  "Classify one Chinese mobile chat message for a coding-agent bridge.",
  "Return JSON only: {intent, confidence, question?}.",
  "Allowed intents: new_task, continue_task, steer_active, stop, approve, deny, cancel_draft, submit_image_draft, ordinary, clarify.",
  "Use context strictly. When ambiguous, use clarify and ask one short Chinese question. Never invent approval context.",
].join(" ");

const taskClassifierPrompt = [
  "Classify one Chinese mobile message for a multi-task coding-agent bridge.",
  "Return strict JSON only: {action,imageDisposition,confidence}.",
  "The action object must match exactly one of these shapes. Fields marked ? are optional; every other listed field is required:",
  'create_task={"kind":"create_task","instruction":string,"workspaceKind"?:string,"explicitPath"?:string,"collaborationMode"?:"default"|"plan","executionIntent"?:"general"|"output_only"};',
  'continue_task={"kind":"continue_task","taskId"?:string,"instruction":string}; steer_task={"kind":"steer_task","taskId"?:string,"instruction":string}; submit_images={"kind":"submit_images","taskId"?:string,"instruction":string};',
  'stop_task={"kind":"stop_task","taskId":string}; archive_task={"kind":"archive_task","taskId":string};',
  'inspect_task/retry_task/compact_task/reset_task={"kind":"<matching kind>","taskId"?:string};',
  'resume_task/fork_task={"kind":"<matching kind>","taskId"?:string,"selector"?:string,"threadId"?:string,"turnId"?:string};',
  'approve/deny/grant_turn/grant_session={"kind":"<matching kind>","taskId":string,"requestId"?:string,"option"?:string};',
  'answer_user_input/answer_mcp_field/decide_mcp_url={"kind":"<matching kind>","taskId":string,"requestId"?:string,"value":string};',
  'discard_images={"kind":"discard_images","conversationId"?:string,"senderKey"?:string};',
  'show_help/list_tasks/list_projects/list_threads/list_archived/show_status/show_host/show_usage/show_summary/show_files/show_diff/show_logs/show_identity/service_status/service_logs/service_restart={"kind":"<matching kind>"};',
  'show_history={"kind":"show_history","selector"?:string}; select_project={"kind":"select_project","selector":string}; search_threads={"kind":"search_threads","query":string}; unarchive_thread={"kind":"unarchive_thread","selector":string};',
  'clarify={"kind":"clarify","question":string,"candidateTaskIds":string[]}.',
  "Do not add fields such as title, taskName, workspace, reason, or message. Do not copy candidate metadata into action.",
  "Preserve an explicitly requested task name inside create_task.instruction because create_task has no separate title field. Preserve the full requested objective there as well.",
  "Set collaborationMode=plan only when the user explicitly asks for Codex Plan mode; a request to plan, outline, compare, research, or wait for more information is still collaborationMode=default unless Plan mode itself is requested.",
  "Choose only supplied task and pending-interaction ids. Never invent approval, permission, path, or output data.",
  "For create_task set executionIntent=output_only only when the user explicitly requests creating new deliverables without modifying existing workspace files; otherwise use general.",
  "When pendingImageCount is greater than zero, choose exactly one explicit disposition: imageDisposition=attach only to submit them with a create_task, continue_task, or submit_images action; imageDisposition=discard only when the user explicitly abandons them before another action; imageDisposition=clarify when ownership is ambiguous. Never return none while images are pending.",
  "When the target or image ownership is ambiguous, return action.kind clarify with one short Chinese question.",
].join(" " );

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}
