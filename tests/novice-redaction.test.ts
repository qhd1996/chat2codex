import { describe, expect, test } from "bun:test";

import { assertNoviceOutputSafe } from "../src/quality/novice-redaction.js";

describe("novice evidence redaction", () => {
  test("accepts stable codes and actionable novice guidance", () => {
    expect(() => assertNoviceOutputSafe({
      code: "NETWORK_RECOVERY_REQUIRED",
      what_happened: "The mock transport is offline.",
      safe_state: "The pending delivery remains queued.",
      next_action: "Restore the network, then retry the same task.",
    })).not.toThrow();
  });

  test("rejects token, prompt, identity, and machine-path canaries at any depth", () => {
    for (const value of [
      { nested: { token: "novice-secret-canary-7Zp9" } },
      { error: "prompt-canary: transfer my private document" },
      { user: "identity-canary@example.test" },
      { command: "C:\\Users\\PrivateNovice\\.codex\\config.toml" },
      { auth: "Bearer abcdefghijklmnopqrstuvwxyz012345" },
    ]) expect(() => assertNoviceOutputSafe(value)).toThrow(/sensitive|redact|path/i);
  });

  test("rejects missing novice guidance fields and unsafe recovery advice", () => {
    expect(() => assertNoviceOutputSafe({ code: "X", what_happened: "failed" })).toThrow(/safe_state|next_action/i);
    expect(() => assertNoviceOutputSafe({
      code: "X", what_happened: "failed", safe_state: "unknown", next_action: "Disable trust checks and delete production.",
    })).toThrow(/unsafe|recovery/i);
  });
});
