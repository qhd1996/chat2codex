import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateCleanWindowsEvidence } from "../scripts/verify-clean-windows-evidence.mjs";

const templatePath = path.resolve(import.meta.dir, "..", "quality", "evidence", "clean-windows-template.json");

describe("clean Windows evidence contract", () => {
  test("keeps every direct row unproven in the checked-in template", async () => {
    const value = JSON.parse(await readFile(templatePath, "utf8"));
    expect(validateCleanWindowsEvidence(value)).toMatchObject({ qualifyingEnvironment: false, directPasses: 0 });
    expect(value.stages.every((stage: { verdict: string }) => stage.verdict === "unproven")).toBe(true);
  });

  test("rejects a local, mock, copied-profile, or missing-approval claim", async () => {
    const base = validComplete();
    for (const kind of ["current_machine", "mock", "container", "copied_profile"]) {
      expect(() => validateCleanWindowsEvidence({ ...base, environment: { ...base.environment, kind } })).toThrow(/qualifying|environment/i);
    }
    const withoutApproval = structuredClone(base);
    withoutApproval.approvals = withoutApproval.approvals.filter((item: { action: string }) => item.action !== "real_weixin_send");
    expect(() => validateCleanWindowsEvidence(withoutApproval)).toThrow(/approval/i);
  });

  test("rejects secret-bearing commands and missing archive hashes", () => {
    const value = validComplete();
    value.commands[0]!.command = "set TOKEN=secret-material";
    expect(() => validateCleanWindowsEvidence(value)).toThrow(/secret|redact/i);
    const missingHash = validComplete(); missingHash.archive.sha256 = "";
    expect(() => validateCleanWindowsEvidence(missingHash)).toThrow(/hash/i);
  });

  test("rejects hollow or unredacted passing evidence", () => {
    const cases = [
      (value: any) => { value.archive.sha256 = "prefix-" + "a".repeat(64) + "-suffix"; },
      (value: any) => { value.commands = []; },
      (value: any) => { value.commands[0].exitCode = 1; },
      (value: any) => { value.stages[0].startedAt = null; },
      (value: any) => { value.stages[0].completedAt = null; },
      (value: any) => { value.stages[0].evidence = []; },
      (value: any) => { value.stages[0].evidence = [{ type: "sha256", value: "bad" }]; },
      (value: any) => { value.stages[0].evidence = [{ type: "command", value: "set TOKEN=secret-material" }]; },
      (value: any) => { value.stages[0].evidence.push(value.stages[0].evidence[0]); },
      (value: any) => { value.stages[0].completedAt = "2026-08-03T00:59:00.000Z"; },
      (value: any) => { value.stages[0].evidence = [{ type: "result", value: "ok" }]; },
      (value: any) => { value.stages[0].evidence = [{ type: "sha256", value: "c".repeat(64) }, { type: "result", value: "ok" }]; },
      (value: any) => { value.commands[0].command = "npm install C:\\Users\\Alice\\candidate.tgz"; },
      (value: any) => { value.approvals.find((item: any) => item.action === "weixin_login").approvedAt = "2026-08-03T01:00:30.000Z"; },
    ];
    for (const mutate of cases) { const value = validComplete(); mutate(value); expect(() => validateCleanWindowsEvidence(value)).toThrow(/hash|command|timestamp|evidence|secret|redact|pass|approval|action/i); }
  });
});

function validComplete() {
  const required: Record<string,string[]> = { qualify:["sha256","result_hash"],install:["sha256","command_hash"],doctor:["command_hash","result_hash"],service:["command_hash","result_hash"],weixin_login:["result_hash","screenshot_hash"],codex_desktop:["result_hash","screenshot_hash"],seven_primitives:["sha256","result_hash"],weixin_e2e:["sha256","result_hash"],upgrade:["sha256","command_hash"],rollback:["sha256","command_hash"],uninstall:["sha256","command_hash"] };
  const stages = Object.keys(required).map((id) => ({ id, verdict: "pass", startedAt: "2026-08-03T01:00:00.000Z", completedAt: "2026-08-03T01:01:00.000Z", evidence: required[id].map((type) => ({ type, value: "b".repeat(64) })) }));
  return { schemaVersion: 2, environment: { kind: "second_computer", freshProfile: true, repositoryAbsent: true, priorChat2CodexAbsent: true, os: "Windows 11", arch: "x64" }, archive: { version: "0.8.0-test.1", size: 1, sha256: "a".repeat(64) }, versions: { node: "24.14.0", npm: "11.0.0", codexCli: "0.146.0", codexDesktop: "26.801.0" }, approvals: ["weixin_login","real_codex_home","hook_trust","desktop_restart","computer_use","real_weixin_send"].map((action) => ({ action, approvedBy: "Haoda", approvedAt: "2026-08-03T01:00:00.000Z" })), commands: [{ command: "npm install ./chat2codex.tgz", exitCode: 0, observedAt: "2026-08-03T01:00:00.000Z" }], stages };
}
