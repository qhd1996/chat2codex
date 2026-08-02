import { createHmac, randomUUID } from "node:crypto";

export const CONTROL_PROMPTS = Object.freeze({
  takeover: "/chat2codex:takeover-desktop",
  release_request: "/chat2codex:release-to-bridge",
});

export async function runUserPromptSubmit(rawInput, dependencies = {}) {
  try {
    const input = parseInput(rawInput, "UserPromptSubmit", ["session_id", "turn_id", "prompt"]);
    const secret = dependencies.secret;
    if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) throw new Error("local_configuration");
    const requestId = (dependencies.randomUUID ?? randomUUID)();
    const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const controlKind = Object.entries(CONTROL_PROMPTS).find(([, literal]) => input.prompt === literal)?.[0];
    const body = {
      kind: "user_prompt_submit", requestId, sessionId: input.session_id, turnId: input.turn_id,
      promptCommitment: promptCommitment(secret, input.prompt), observedAt,
      ...(controlKind ? { controlKind } : {}),
    };
    const response = await dependencies.request("user_prompt_submit", body);
    if (controlKind) {
      if (response?.decision !== "accepted") throw new Error("control_refused");
      return { exitCode: 2, stdout: "", stderr: "Desktop control request accepted; check authenticated status before submitting work.\n" };
    }
    if (response?.decision !== "allow") throw new Error(safeReason(response?.decision));
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (error) {
    return { exitCode: 2, stdout: "", stderr: "Desktop prompt blocked: " + safeReason(error instanceof Error ? error.message : "internal_error") + "\n" };
  }
}

export async function runStopWake(rawInput, dependencies = {}) {
  try {
    const input = parseInput(rawInput, "Stop", ["session_id", "turn_id"]);
    const eventId = (dependencies.randomUUID ?? randomUUID)();
    const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    await dependencies.request("stop_wake", { kind: "stop_wake", eventId, sessionId: input.session_id, turnId: input.turn_id, observedAt });
  } catch { /* Stop is advisory; recovery scanning is authoritative. */ }
  return { exitCode: 0, stdout: "", stderr: "" };
}

function parseInput(rawInput, eventName, fields) {
  const input = JSON.parse(rawInput);
  if (!input || typeof input !== "object" || Array.isArray(input) || input.hook_event_name !== eventName) throw new Error("malformed_input");
  for (const field of fields) if (typeof input[field] !== "string" || input[field].length < 1 || input[field].length > 65_536) throw new Error("malformed_input");
  return input;
}

function safeReason(reason) {
  const allowed = new Set(["block", "stale_generation", "not_found", "ownership_uncertain", "authentication_failed", "integrity_conflict", "control_refused", "local_configuration", "malformed_input"]);
  return allowed.has(reason) ? reason : "gateway_unavailable";
}

function promptCommitment(secret, prompt) {
  const promptBytes = Buffer.from(prompt, "utf8");
  const length = Buffer.allocUnsafe(8); length.writeBigUInt64BE(BigInt(promptBytes.byteLength));
  return createHmac("sha256", secret).update("C2C-DESKTOP-PROMPT-COMMITMENT-V1\0", "utf8").update(length).update(promptBytes).digest("hex");
}
