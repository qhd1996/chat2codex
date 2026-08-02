import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  CONTROL_PROMPTS,
  runStopWake,
  runUserPromptSubmit,
} from "../scripts/codex-hooks/hook-client.mjs";

const secret = Buffer.alloc(32, 7);
const requestId = "019fc160-7e0d-7990-9317-e830a4425a8f";
const basePrompt = { hook_event_name: "UserPromptSubmit", session_id: "root-1", turn_id: "turn-1", prompt: "do work", permission_mode: "default" };

describe("UserPromptSubmit Hook", () => {
  test("permits only an authenticated allow and forwards actual turn_id without raw prompt", async () => {
    let sent: unknown;
    const result = await runUserPromptSubmit(JSON.stringify(basePrompt), {
      secret, now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId,
      request: async (_endpoint, body) => { sent = body; return { requestId, decision: "allow", generation: 2, fenceId: "fence-1" }; },
    });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(sent).toMatchObject({ kind: "user_prompt_submit", sessionId: "root-1", turnId: "turn-1" });
    expect(JSON.stringify(sent)).not.toContain("do work");
  });

  test("fails closed for bridge, stale, missing, uncertain, refusal, bad signature, connection, redirect, timeout, and malformed input", async () => {
    const cases: Array<unknown> = [
      { request: async () => ({ requestId, decision: "block" }) },
      { request: async () => ({ requestId, decision: "stale_generation" }) },
      { request: async () => ({ requestId, decision: "not_found" }) },
      { request: async () => ({ requestId, decision: "ownership_uncertain" }) },
      { request: async () => { throw new Error("bad response signature with secret/path"); } },
      { request: async () => { throw new TypeError("connection refused"); } },
      { request: async () => { throw new Error("redirect blocked"); } },
      { request: async () => { throw new DOMException("timeout", "AbortError"); } },
    ];
    for (const overrides of cases) {
      const result = await runUserPromptSubmit(JSON.stringify(basePrompt), { secret, now: () => new Date(), randomUUID: () => requestId, ...(overrides as object) });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^Desktop prompt blocked: [a-z0-9_-]+\n$/u);
      expect(result.stderr).not.toMatch(/secret|path|connection refused/i);
    }
    for (const malformed of ["{", "{}", JSON.stringify({ ...basePrompt, turn_id: "" }), JSON.stringify({ ...basePrompt, prompt: 2 })]) {
      expect((await runUserPromptSubmit(malformed, { secret })).exitCode).toBe(2);
    }
  });

  test("handles only exact code-owned control literals and always blocks the model turn", async () => {
    for (const [controlKind, prompt] of Object.entries(CONTROL_PROMPTS)) {
      let sent: any;
      const result = await runUserPromptSubmit(JSON.stringify({ ...basePrompt, prompt }), {
        secret, now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId,
        request: async (_endpoint, body) => { sent = body; return { requestId, decision: "accepted" }; },
      });
      expect(sent.controlKind).toBe(controlKind);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("Desktop control request accepted; check authenticated status before submitting work.\n");
    }
    let sent: any;
    await runUserPromptSubmit(JSON.stringify({ ...basePrompt, prompt: `${CONTROL_PROMPTS.takeover} now` }), { secret, request: async (_endpoint, body) => { sent = body; return { requestId, decision: "allow" }; } });
    expect(sent.controlKind).toBeUndefined();
    const refused = await runUserPromptSubmit(JSON.stringify({ ...basePrompt, prompt: CONTROL_PROMPTS.takeover }), { secret, request: async () => ({ requestId, decision: "block" }) });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toBe("Desktop prompt blocked: control_refused\n");
  });
});

describe("Stop Hook", () => {
  test("sends only wake identifiers and never hook content", async () => {
    let sent: any;
    const input = { hook_event_name: "Stop", session_id: "root-1", turn_id: "turn-1", last_assistant_message: "SECRET RESULT", transcript_path: "C:/private/transcript", cwd: "C:/private", model: "secret-model" };
    const result = await runStopWake(JSON.stringify(input), { now: () => new Date("2026-08-02T10:00:00.000Z"), randomUUID: () => requestId, request: async (_endpoint, body) => { sent = body; return { requestId, decision: "accepted" }; } });
    expect(sent).toEqual({ kind: "stop_wake", eventId: requestId, sessionId: "root-1", turnId: "turn-1", observedAt: "2026-08-02T10:00:00.000Z" });
    expect(JSON.stringify(sent)).not.toMatch(/SECRET RESULT|transcript|private|model/u);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("is best effort and always exits zero without continuation or block output", async () => {
    for (const request of [async () => ({ requestId, decision: "accepted" }), async () => { throw new Error("down"); }, async () => { throw new DOMException("timeout", "AbortError"); }]) {
      const result = await runStopWake(JSON.stringify({ hook_event_name: "Stop", session_id: "root-1", turn_id: "turn-1" }), { request });
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(JSON.stringify(result)).not.toMatch(/decision|block|continue/i);
    }
    expect((await runStopWake("{", { request: async () => { throw new Error(); } })).exitCode).toBe(0);
  });
});

describe("repository Hook executables", () => {
  test("UserPromptSubmit wrapper blocks malformed stdin without exposing configuration", async () => {
    const child = Bun.spawn([process.execPath, "scripts/codex-hooks/user-prompt-submit.mjs"], { cwd: path.resolve("."), env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write("{"); child.stdin.end();
    expect(await child.exited).toBe(2);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await new Response(child.stderr).text()).toBe("Desktop prompt blocked: local_configuration\n");
  });

  test("Stop wrapper stays silent and exits zero when local configuration is absent", async () => {
    const child = Bun.spawn([process.execPath, "scripts/codex-hooks/stop-wake.mjs"], { cwd: path.resolve("."), env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(JSON.stringify({ hook_event_name: "Stop", session_id: "root-1", turn_id: "turn-1", last_assistant_message: "secret" })); child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("examples are inert and require separate installation approvals", async () => {
    const hook = JSON.parse(await Bun.file("docs/phase3/codex-hooks.example.json").text());
    const mcp = await Bun.file("docs/phase3/codex-mcp.example.toml").text();
    expect(hook.installation_status).toBe("INERT_EXAMPLE_ONLY");
    expect(hook.approval_required_before_copying_into_codex_home).toBe(true);
    expect(hook.approval_required_before_key_creation).toBe(true);
    expect(hook.approval_required_before_hook_trust).toBe(true);
    expect(hook.approval_required_before_desktop_restart).toBe(true);
    expect(JSON.stringify(hook)).not.toMatch(/SubagentStop"s*:/u);
    expect(mcp).toContain("enabled = false");
    expect(mcp).toContain("Separate approval is required");
    expect(hook).not.toHaveProperty("token");
  });
});
