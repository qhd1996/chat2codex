import { z } from "zod";

export const naturalIntentNames = [
  "new_task", "continue_task", "steer_active", "stop", "approve",
  "deny", "cancel_draft", "submit_image_draft", "ordinary", "clarify",
] as const;

export interface NaturalIntentContext {
  hasThread: boolean;
  activeRun: boolean;
  pendingApprovalCount: number;
  pendingPermissionCount: number;
  hasImageDraft: boolean;
}

export interface NaturalIntentInput {
  text: string;
  context: NaturalIntentContext;
}

export interface NaturalIntentDecision {
  intent: typeof naturalIntentNames[number];
  confidence: number;
  question?: string;
}

export interface NaturalIntentClassifier {
  classify(input: NaturalIntentInput, signal?: AbortSignal): Promise<unknown>;
}

export const naturalIntentDecisionSchema = z.object({
  intent: z.enum(naturalIntentNames),
  confidence: z.number().min(0).max(1),
  question: z.string().min(1).max(500).optional(),
}).strict();

const fallbackQuestion = "这是继续当前任务，还是新建一个任务？";

export async function resolveNaturalIntent(
  input: NaturalIntentInput,
  classifier: NaturalIntentClassifier,
  minimumConfidence: number,
  signal?: AbortSignal,
): Promise<NaturalIntentDecision> {
  try {
    const parsed = naturalIntentDecisionSchema.safeParse(await classifier.classify(input, signal));
    if (!parsed.success || parsed.data.confidence < minimumConfidence || !decisionAllowed(parsed.data.intent, input.context)) {
      return { intent: "clarify", confidence: 0, question: fallbackQuestion };
    }
    if (parsed.data.intent === "clarify" && !parsed.data.question) {
      return { intent: "clarify", confidence: parsed.data.confidence, question: fallbackQuestion };
    }
    return parsed.data;
  } catch {
    return { intent: "clarify", confidence: 0, question: fallbackQuestion };
  }
}

function decisionAllowed(intent: NaturalIntentDecision["intent"], context: NaturalIntentContext): boolean {
  if ((intent === "approve" || intent === "deny") && context.pendingApprovalCount === 0 && context.pendingPermissionCount === 0) return false;
  if (intent === "steer_active" && !context.activeRun) return false;
  if ((intent === "cancel_draft" || intent === "submit_image_draft") && !context.hasImageDraft) return false;
  return true;
}
