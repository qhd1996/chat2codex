import { createHash } from "node:crypto";

import type { AuthoritativeCodexThread, AuthoritativeCodexTurn } from "../agent/codex-runner.js";
import { parseOutputDeclaration } from "./output-declarations.js";

export interface DesktopReconciliationFence {
  turnId: string;
  originGeneration: number;
  requestId: string;
  promptCommitment: string;
  issuedAt: string;
}

export interface DesktopExcludedControlTurn {
  kind: "takeover" | "release_request";
  originGeneration: number;
  promptCommitment: string;
  recordedAt: string;
}

export interface DesktopReconciliationBinding {
  bindingId: string;
  rootThreadId: string;
  owner: "bridge" | "desktop" | "uncertain" | "disabled";
  generation: number;
  bindingAnchorTurnId: string;
  bindingAnchorTurnIndex: number;
  lastReconciledTurnId?: string;
  lastReconciledTurnIndex?: number;
  lastAuthoritativeDigest?: string;
  activeStartFence?: DesktopReconciliationFence;
  excludedControlTurns: Record<string, DesktopExcludedControlTurn>;
}

export interface DesktopReconciliationPlan {
  bindingId: string;
  rootThreadId: string;
  originGeneration: number;
  turnId: string;
  authoritativeTurnIndex: number;
  priorDigest?: string;
  authoritativeDigest: string;
  visibleText: string;
  declaredFiles: string[];
  identityPrefix: string;
  excludedControlTurn?: boolean;
  clearsStartFence?: boolean;
}

export type DesktopReconciliationResult =
  | { kind: "noop" }
  | { kind: "ready"; plan: DesktopReconciliationPlan }
  | { kind: "uncertain"; error: string };

export interface DesktopReconciliationInput {
  binding: DesktopReconciliationBinding;
  thread: AuthoritativeCodexThread;
  controlPromptCommitments?: Record<"takeover" | "release_request", string>;
  controlPrompts?: Record<"takeover" | "release_request", string>;
}

export class DesktopReconciler {
  reconcile(input: DesktopReconciliationInput): DesktopReconciliationResult {
    try {
      return reconcileDesktopThread(input);
    } catch (error) {
      return {
        kind: "uncertain",
        error: error instanceof Error ? error.message : "Authoritative reconciliation failed.",
      };
    }
  }
}

export function authoritativeTurnDigest(turn: AuthoritativeCodexTurn): string {
  const canonicalTurn = {
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    items: turn.items.map((item) => item.canonicalPayload ?? item),
  };
  return createHash("sha256").update(canonicalJson(canonicalTurn), "utf8").digest("hex");
}

function reconcileDesktopThread(input: DesktopReconciliationInput): DesktopReconciliationResult {
  const { binding, thread } = input;
  if (thread.id !== binding.rootThreadId || thread.sessionId !== binding.rootThreadId) {
    throw new Error("Authoritative snapshot is not the exact bound concrete root; child and unbound threads are excluded.");
  }
  if (binding.owner === "disabled" || binding.owner === "bridge") {
    return { kind: "noop" };
  }

  const priorTurnId = binding.lastReconciledTurnId ?? binding.bindingAnchorTurnId;
  const priorTurnIndex = binding.lastReconciledTurnIndex ?? binding.bindingAnchorTurnIndex;
  if (!Number.isSafeInteger(priorTurnIndex) || priorTurnIndex < 0) {
    throw new Error("Saved authoritative prior turn position is invalid.");
  }
  const priorTurn = thread.turns[priorTurnIndex];
  if (!priorTurn || priorTurn.id !== priorTurnId) {
    throw new Error("Saved authoritative prior/anchor turn is missing or moved from its expected position/order.");
  }
  if (priorTurn.status === "inProgress") {
    throw new Error("Saved authoritative high-water turn is not terminal.");
  }
  const priorDigest = authoritativeTurnDigest(priorTurn);
  if (!binding.lastAuthoritativeDigest) {
    throw new Error("Saved authoritative high-water digest is missing.");
  }
  if (binding.lastAuthoritativeDigest !== priorDigest) {
    throw new Error("Saved authoritative high-water digest does not match the current snapshot.");
  }

  const nextTurn = thread.turns[priorTurnIndex + 1];
  if (!nextTurn) {
    return { kind: "noop" };
  }

  const exclusion = binding.excludedControlTurns[nextTurn.id];
  if (exclusion) {
    return {
      kind: "ready",
      plan: planExcludedControlTurn(binding, nextTurn, priorDigest, exclusion, input),
    };
  }

  const fence = binding.activeStartFence;
  if (!fence) {
    throw new Error("Authoritative turn after high water has no matching ordinary start fence.");
  }
  if (nextTurn.id !== fence.turnId) {
    throw new Error("Authoritative next turn does not match the fenced actual turn ID.");
  }
  requireTerminalTurn(nextTurn);
  const parsed = parseFinalTurnResult(nextTurn);
  return {
    kind: "ready",
    plan: {
      bindingId: binding.bindingId,
      rootThreadId: binding.rootThreadId,
      originGeneration: fence.originGeneration,
      turnId: nextTurn.id,
      authoritativeTurnIndex: priorTurnIndex + 1,
      priorDigest,
      authoritativeDigest: authoritativeTurnDigest(nextTurn),
      visibleText: parsed.visibleText,
      declaredFiles: parsed.outputFiles,
      identityPrefix: reconciliationIdentityPrefix(binding.bindingId, fence.originGeneration, nextTurn.id),
      clearsStartFence: true,
    },
  };
}

function planExcludedControlTurn(
  binding: DesktopReconciliationBinding,
  turn: AuthoritativeCodexTurn,
  priorDigest: string,
  exclusion: DesktopExcludedControlTurn,
  input: DesktopReconciliationInput,
): DesktopReconciliationPlan {
  const expectedCommitment = input.controlPromptCommitments?.[exclusion.kind];
  const expectedPrompt = input.controlPrompts?.[exclusion.kind];
  if (!expectedCommitment || expectedCommitment !== exclusion.promptCommitment) {
    throw new Error("Excluded control turn prompt commitment does not match the code-owned commitment.");
  }
  const userMessages = turn.items.filter((item) => item.type === "userMessage");
  if (!expectedPrompt || userMessages.length !== 1 || userMessages[0]?.text !== expectedPrompt) {
    throw new Error("Excluded control turn prompt does not match the code-owned control literal.");
  }
  if (turn.items.some((item) => item.type !== "userMessage" && item.type !== "hookPrompt")) {
    throw new Error("Excluded control turn contains model output or a tool item.");
  }
  if (turn.status === "inProgress") {
    throw new Error("Excluded control turn is not terminal.");
  }

  return {
    bindingId: binding.bindingId,
    rootThreadId: binding.rootThreadId,
    originGeneration: exclusion.originGeneration,
    turnId: turn.id,
    authoritativeTurnIndex: (binding.lastReconciledTurnIndex ?? binding.bindingAnchorTurnIndex) + 1,
    priorDigest,
    authoritativeDigest: authoritativeTurnDigest(turn),
    visibleText: "",
    declaredFiles: [],
    identityPrefix: reconciliationIdentityPrefix(binding.bindingId, exclusion.originGeneration, turn.id),
    excludedControlTurn: true,
    clearsStartFence: false,
  };
}

function requireTerminalTurn(turn: AuthoritativeCodexTurn): void {
  if (turn.status === "inProgress") {
    throw new Error("Fenced authoritative turn is not terminal.");
  }
}

function parseFinalTurnResult(turn: AuthoritativeCodexTurn): ReturnType<typeof parseOutputDeclaration> {
  const finalAnswers = turn.items.filter(
    (item) => item.type === "agentMessage" && item.phase !== "commentary" && typeof item.text === "string",
  );
  const finalAnswer = finalAnswers.at(-1);
  if (!finalAnswer?.text || !/\S/u.test(finalAnswer.text)) {
    throw new Error("Fenced authoritative turn must contain a final agent answer.");
  }
  const parsed = parseOutputDeclaration(finalAnswer.text);
  if (parsed.error) {
    throw new Error(`Authoritative output declaration is invalid: ${parsed.error}`);
  }
  return parsed;
}

function reconciliationIdentityPrefix(bindingId: string, generation: number, turnId: string): string {
  return `desktop:${bindingId}:${generation}:${turnId}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
