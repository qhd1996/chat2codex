import { expect, test } from "bun:test";
import fc from "fast-check";

import type { AuthoritativeCodexThread, AuthoritativeCodexTurn } from "../../src/agent/codex-runner.js";
import { DesktopReconciler, authoritativeTurnDigest, type DesktopReconciliationBinding } from "../../src/core/desktop-reconciler.js";

const seed = 20260802;
const idArbitrary = fc.stringMatching(/^[a-z][a-z0-9_-]{0,31}$/u);

function turn(id: string, prompt: string, result: string): AuthoritativeCodexTurn {
  return {
    id, status: "completed",
    items: [
      { id: id + "-user", type: "userMessage", text: prompt },
      { id: id + "-agent", type: "agentMessage", text: result, phase: "final_answer" },
    ],
  };
}

function binding(anchor: AuthoritativeCodexTurn, targetId: string): DesktopReconciliationBinding {
  return {
    bindingId: "binding-1", rootThreadId: "root-thread", owner: "desktop", generation: 8,
    bindingAnchorTurnId: anchor.id, bindingAnchorTurnIndex: 0, lastReconciledTurnId: anchor.id,
    lastReconciledTurnIndex: 0, lastAuthoritativeDigest: authoritativeTurnDigest(anchor),
    activeStartFence: { turnId: targetId, originGeneration: 7, requestId: "request-1", promptCommitment: "a".repeat(64), issuedAt: "2026-08-02T00:00:00.000Z" },
    excludedControlTurns: {},
  };
}

function thread(turns: AuthoritativeCodexTurn[], overrides: Partial<AuthoritativeCodexThread> = {}): AuthoritativeCodexThread {
  return { id: "root-thread", sessionId: "root-thread", cwd: "C:\\repo", turns, ...overrides };
}

test("property: authoritative array order wins over opaque turn ID ordering", () => {
  fc.assert(fc.property(
    idArbitrary, idArbitrary, fc.string({ minLength: 1, maxLength: 64 }),
    (anchorId, targetId, finalText) => {
      fc.pre(anchorId !== targetId && finalText.trim().length > 0);
      const anchor = turn(anchorId, "anchor prompt", "anchor result");
      const target = turn(targetId, "desktop prompt", finalText);
      const result = new DesktopReconciler().reconcile({ binding: binding(anchor, targetId), thread: thread([anchor, target]) });
      expect(result).toMatchObject({ kind: "ready", plan: { turnId: targetId, visibleText: finalText } });
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: moved high water and concrete child roots fail uncertain without mutation", () => {
  fc.assert(fc.property(idArbitrary, idArbitrary, (anchorId, targetId) => {
    fc.pre(anchorId !== targetId);
    const anchor = turn(anchorId, "anchor prompt", "anchor result");
    const target = turn(targetId, "desktop prompt", "done");
    const currentBinding = binding(anchor, targetId);
    const before = structuredClone(currentBinding);
    const inserted = turn("inserted-turn", "other", "other result");
    expect(new DesktopReconciler().reconcile({ binding: currentBinding, thread: thread([inserted, anchor, target]) }))
      .toMatchObject({ kind: "uncertain" });
    expect(currentBinding).toEqual(before);
    expect(new DesktopReconciler().reconcile({ binding: currentBinding, thread: thread([anchor, target], { id: "child-thread", sessionId: "root-thread" }) }))
      .toMatchObject({ kind: "uncertain" });
    expect(currentBinding).toEqual(before);
  }), { seed, numRuns: 100, endOnFailure: true });
});
