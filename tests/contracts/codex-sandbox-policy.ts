import type { CodexSandboxPolicy } from "../../src/agent/codex-runner.js";

const outputOnlyPolicy: CodexSandboxPolicy = {
  type: "workspaceWrite",
  writableRoots: ["C:\\workspace\\outputs\\tasks\\tsk_1"],
};

// The public type must match the runtime fail-closed contract: a per-turn
// workspace-write policy is never valid without explicit writable roots.
// @ts-expect-error workspace-write policies require explicit writableRoots
const missingWritableRoots: CodexSandboxPolicy = { type: "workspaceWrite" };

// @ts-expect-error Task 5 supports only readOnly, dangerFullAccess, and workspaceWrite
const unsupportedExternalSandbox: CodexSandboxPolicy = { type: "externalSandbox" };

void outputOnlyPolicy;
void missingWritableRoots;
void unsupportedExternalSandbox;
