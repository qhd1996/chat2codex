import { naturalIntentDecisionSchema, type NaturalIntentClassifier, type NaturalIntentInput } from "../core/natural-intent.js";

export interface OpenAiIntentClassifierOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiIntentClassifier implements NaturalIntentClassifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiIntentClassifierOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async classify(input: NaturalIntentInput, signal?: AbortSignal): Promise<unknown> {
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
          { role: "system", content: classifierPrompt },
          { role: "user", content: JSON.stringify({ text: input.text.slice(0, 4000), context: input.context }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Intent classifier HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Intent classifier returned no text content");
    const parsed = naturalIntentDecisionSchema.parse(JSON.parse(stripFence(content)));
    return parsed;
  }
}

const classifierPrompt = [
  "Classify one Chinese mobile chat message for a coding-agent bridge.",
  "Return JSON only: {intent, confidence, question?}.",
  "Allowed intents: new_task, continue_task, steer_active, stop, approve, deny, cancel_draft, submit_image_draft, ordinary, clarify.",
  "Use context strictly. When ambiguous, use clarify and ask one short Chinese question. Never invent approval context.",
].join(" ");

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}
