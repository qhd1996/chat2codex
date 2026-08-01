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
  "Choose only supplied task and pending-interaction ids. Never invent approval, permission, path, or output data.",
  "For create_task set executionIntent=output_only only when the user explicitly requests creating new deliverables without modifying existing workspace files; otherwise use general.",
  "When the target or image ownership is ambiguous, return action.kind clarify with one short Chinese question.",
].join(" " );

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}
