import { describe, expect, test } from "bun:test";

import type { AuthoritativeCodexThread, AuthoritativeCodexTurn } from "../src/agent/codex-runner.js";
import {
  DesktopReconciler,
  authoritativeTurnDigest,
  type DesktopReconciliationBinding,
} from "../src/core/desktop-reconciler.js";

const commitmentA = "a".repeat(64);
const commitmentB = "b".repeat(64);

function turn(
  id: string,
  prompt: string,
  result: string,
  overrides: Partial<AuthoritativeCodexTurn> = {},
): AuthoritativeCodexTurn {
  return {
    id,
    status: "completed",
    items: [
      { id: `${id}-user`, type: "userMessage", text: prompt },
      { id: `${id}-agent`, type: "agentMessage", text: result, phase: "final_answer" },
    ],
    ...overrides,
  };
}

function thread(turns: AuthoritativeCodexTurn[], overrides: Partial<AuthoritativeCodexThread> = {}): AuthoritativeCodexThread {
  return { id: "root-thread", sessionId: "root-thread", cwd: "C:\\repo", turns, ...overrides };
}

function binding(overrides: Partial<DesktopReconciliationBinding> = {}): DesktopReconciliationBinding {
  return {
    bindingId: "binding-1",
    rootThreadId: "root-thread",
    owner: "desktop",
    generation: 8,
    bindingAnchorTurnId: "turn_anchor",
    bindingAnchorTurnIndex: 0,
    lastReconciledTurnId: "turn_anchor",
    lastReconciledTurnIndex: 0,
    lastAuthoritativeDigest: authoritativeTurnDigest(turn("turn_anchor", "anchor prompt", "anchor result")),
    activeStartFence: {
      turnId: "turn_02",
      originGeneration: 7,
      requestId: "request-1",
      promptCommitment: commitmentA,
      issuedAt: "2026-08-02T00:00:00.000Z",
    },
    excludedControlTurns: {},
    ...overrides,
  };
}

describe("DesktopReconciler", () => {
  test("canonical turn digest is key-order independent but content sensitive", () => {
    const first = turn("turn_1", "prompt", "result");
    const reordered: AuthoritativeCodexTurn = {
      items: first.items.map((item) => ({ text: item.text, type: item.type, id: item.id, phase: item.phase })),
      status: first.status,
      id: first.id,
    };

    expect(authoritativeTurnDigest(first)).toBe(authoritativeTurnDigest(reordered));
    expect(authoritativeTurnDigest(first)).not.toBe(authoritativeTurnDigest(turn("turn_1", "prompt", "changed")));
  });

  test("plans a fenced terminal turn after the exact prior digest and authoritative position", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const target = turn(
      "turn_02",
      "desktop prompt",
      'Finished.\nCHAT2CODEX_OUTPUT_FILES: ["C:\\\\repo\\\\report.png"]',
    );

    expect(new DesktopReconciler().reconcile({ binding: binding(), thread: thread([anchor, target]) })).toEqual({
      kind: "ready",
      plan: {
        bindingId: "binding-1",
        rootThreadId: "root-thread",
        originGeneration: 7,
        turnId: "turn_02",
        priorDigest: authoritativeTurnDigest(anchor),
        authoritativeDigest: authoritativeTurnDigest(target),
        visibleText: "Finished.",
        declaredFiles: ["C:\\repo\\report.png"],
        identityPrefix: "desktop:binding-1:7:turn_02",
        clearsStartFence: true,
      },
    });
  });

  test("uses authoritative array order rather than lexical turn ID order", () => {
    const anchor = turn("turn_z", "anchor", "old");
    const target = turn("turn_a", "new prompt", "new result");
    const result = new DesktopReconciler().reconcile({
      binding: binding({
        bindingAnchorTurnId: "turn_z",
        bindingAnchorTurnIndex: 0,
        lastReconciledTurnId: "turn_z",
        lastReconciledTurnIndex: 0,
        lastAuthoritativeDigest: authoritativeTurnDigest(anchor),
        activeStartFence: {
          turnId: "turn_a", originGeneration: 7, requestId: "request-2",
          promptCommitment: commitmentA, issuedAt: "2026-08-02T00:00:00.000Z",
        },
      }),
      thread: thread([anchor, target]),
    });

    expect(result).toMatchObject({ kind: "ready", plan: { turnId: "turn_a" } });
  });

  test.each([
    ["wrong concrete root", thread([turn("turn_anchor", "a", "b")], { id: "child-thread", sessionId: "root-thread" }), /root|unbound|child/i],
    ["reordered prior turn", thread([turn("other", "x", "y"), turn("turn_anchor", "anchor prompt", "anchor result")]), /position|order/i],
    ["missing prior turn", thread([turn("turn_02", "desktop prompt", "done")]), /prior|anchor/i],
  ])("returns uncertain for %s", (_name, snapshot, expected) => {
    expect(new DesktopReconciler().reconcile({ binding: binding(), thread: snapshot })).toMatchObject({
      kind: "uncertain",
      error: expect.stringMatching(expected),
    });
  });

  test("returns uncertain when the saved high-water digest changes", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "tampered result");
    expect(new DesktopReconciler().reconcile({
      binding: binding(),
      thread: thread([anchor, turn("turn_02", "desktop prompt", "done")]),
    })).toMatchObject({ kind: "uncertain", error: expect.stringMatching(/digest/i) });
  });

  test("returns uncertain when the saved high-water digest is missing", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({
      binding: binding({ lastAuthoritativeDigest: undefined }),
      thread: thread([anchor, turn("turn_02", "desktop prompt", "done")]),
    })).toMatchObject({ kind: "uncertain", error: expect.stringMatching(/digest.*missing/i) });
  });

  test("returns uncertain when the saved high-water identity moved from its recorded array position", () => {
    const inserted = turn("turn_inserted", "inserted", "inserted result");
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({
      binding: binding(),
      thread: thread([inserted, anchor, turn("turn_02", "desktop prompt", "done")]),
    })).toMatchObject({ kind: "uncertain", error: expect.stringMatching(/position|order/i) });
  });

  test("returns uncertain when an earlier turn after high water precedes the fenced turn", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({
      binding: binding(),
      thread: thread([
        anchor,
        turn("turn_unexpected", "other prompt", "other result"),
        turn("turn_02", "desktop prompt", "done"),
      ]),
    })).toMatchObject({ kind: "uncertain", error: expect.stringMatching(/fenced|match/i) });
  });

  test.each([
    ["in-progress turn", turn("turn_02", "desktop prompt", "partial", { status: "inProgress" }), /terminal/i],
    ["missing final answer", { ...turn("turn_02", "desktop prompt", "done"), items: [{ id: "user", type: "userMessage", text: "desktop prompt" }] }, /final/i],
    ["malformed output declaration", turn("turn_02", "desktop prompt", 'done\nCHAT2CODEX_OUTPUT_FILES: ["bad"'), /declaration/i],
  ])("returns uncertain for %s", (_name, target, expected) => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({ binding: binding(), thread: thread([anchor, target as AuthoritativeCodexTurn]) })).toMatchObject({
      kind: "uncertain",
      error: expect.stringMatching(expected),
    });
  });

  test("uses the last ordered non-commentary agent message as the final result", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const target: AuthoritativeCodexTurn = {
      id: "turn_02",
      status: "completed",
      items: [
        { id: "user", type: "userMessage", text: "desktop prompt" },
        { id: "agent-a", type: "agentMessage", text: "earlier answer" },
        { id: "agent-commentary", type: "agentMessage", text: "progress", phase: "commentary" },
        { id: "agent-b", type: "agentMessage", text: "authoritative final", phase: "final_answer" },
      ],
    };
    expect(new DesktopReconciler().reconcile({ binding: binding(), thread: thread([anchor, target]) })).toMatchObject({
      kind: "ready",
      plan: { visibleText: "authoritative final" },
    });
  });

  test("accepts a terminal interrupted turn when it contains an authoritative final answer", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const target = turn("turn_02", "desktop prompt", "interrupted final", { status: "interrupted" });
    expect(new DesktopReconciler().reconcile({ binding: binding(), thread: thread([anchor, target]) })).toMatchObject({
      kind: "ready",
      plan: { visibleText: "interrupted final" },
    });
  });

  test("an exact excluded control turn advances with no export and does not clear an ordinary fence", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const control: AuthoritativeCodexTurn = {
      id: "turn_control",
      status: "interrupted",
      items: [{ id: "control-user", type: "userMessage", text: "reserved takeover" }],
    };
    const result = new DesktopReconciler().reconcile({
      binding: binding({
        activeStartFence: {
          turnId: "turn_ordinary", originGeneration: 8, requestId: "request-ordinary",
          promptCommitment: commitmentA, issuedAt: "2026-08-02T00:00:00.000Z",
        },
        excludedControlTurns: {
          turn_control: { kind: "takeover", originGeneration: 7, promptCommitment: commitmentB, recordedAt: "2026-08-02T00:00:00.000Z" },
        },
      }),
      thread: thread([anchor, control]),
      controlPromptCommitments: { takeover: commitmentB, release_request: commitmentA },
      controlPrompts: { takeover: "reserved takeover", release_request: "reserved release" },
    });

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        turnId: "turn_control", originGeneration: 7, visibleText: "", declaredFiles: [],
        identityPrefix: "desktop:binding-1:7:turn_control", excludedControlTurn: true,
        clearsStartFence: false,
      },
    });
    expect(result).not.toMatchObject({ plan: { turnId: "turn_ordinary" } });
  });

  test("an absent excluded control turn is a noop and cannot clear an ordinary fence", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({
      binding: binding({
        activeStartFence: undefined,
        excludedControlTurns: {
          turn_absent: { kind: "takeover", originGeneration: 7, promptCommitment: commitmentB, recordedAt: "2026-08-02T00:00:00.000Z" },
        },
      }),
      thread: thread([anchor]),
      controlPromptCommitments: { takeover: commitmentB, release_request: commitmentA },
      controlPrompts: { takeover: "reserved takeover", release_request: "reserved release" },
    })).toMatchObject({ kind: "noop" });
  });

  test.each([
    ["wrong commitment", { promptCommitment: commitmentA }, /commitment/i],
    ["assistant output", {}, /control|output/i, [{ id: "agent", type: "agentMessage", text: "should not exist", phase: "final_answer" }]],
    ["tool output", {}, /control|tool/i, [{ id: "tool", type: "mcpToolCall", status: "completed" }]],
  ])("rejects conflicting excluded control turn: %s", (_name, exclusionOverride, expected, extraItems = []) => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const control: AuthoritativeCodexTurn = {
      id: "turn_control", status: "interrupted",
      items: [{ id: "control-user", type: "userMessage", text: "reserved takeover" }, ...extraItems],
    };
    expect(new DesktopReconciler().reconcile({
      binding: binding({
        activeStartFence: undefined,
        excludedControlTurns: {
          turn_control: {
            kind: "takeover", originGeneration: 7, promptCommitment: commitmentB,
            recordedAt: "2026-08-02T00:00:00.000Z", ...exclusionOverride,
          },
        },
      }),
      thread: thread([anchor, control]),
      controlPromptCommitments: { takeover: commitmentB, release_request: commitmentA },
      controlPrompts: { takeover: "reserved takeover", release_request: "reserved release" },
    })).toMatchObject({ kind: "uncertain", error: expect.stringMatching(expected) });
  });

  test("returns noop for a bound root with no turn after high water", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    expect(new DesktopReconciler().reconcile({
      binding: binding({ activeStartFence: undefined }),
      thread: thread([anchor]),
    })).toEqual({ kind: "noop" });
  });

  test("is pure and does not reconcile bindings owned by the bridge", () => {
    const anchor = turn("turn_anchor", "anchor prompt", "anchor result");
    const input = {
      binding: binding({ owner: "bridge" }),
      thread: thread([anchor, turn("turn_02", "desktop prompt", "done")]),
    };
    const before = structuredClone(input);

    expect(new DesktopReconciler().reconcile(input)).toEqual({ kind: "noop" });
    expect(input).toEqual(before);
  });
});
