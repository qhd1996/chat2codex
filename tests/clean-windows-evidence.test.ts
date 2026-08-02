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
});

function validComplete() {
  const stages = ["qualify","install","doctor","service","weixin_login","codex_desktop","seven_primitives","weixin_e2e","upgrade","rollback","uninstall"].map((id) => ({ id, verdict: "pass", startedAt: "2026-08-03T01:00:00.000Z", completedAt: "2026-08-03T01:01:00.000Z", evidence: ["sha256:fixture"] }));
  return { schemaVersion: 1, environment: { kind: "second_computer", freshProfile: true, repositoryAbsent: true, priorChat2CodexAbsent: true, os: "Windows 11", arch: "x64" }, archive: { version: "0.8.0-test.1", size: 1, sha256: "a".repeat(64) }, versions: { node: "24.14.0", npm: "11.0.0", codexCli: "0.146.0", codexDesktop: "26.801.0" }, approvals: ["weixin_login","real_codex_home","hook_trust","desktop_restart","computer_use","real_weixin_send"].map((action) => ({ action, approvedBy: "Haoda", approvedAt: "2026-08-03T01:00:00.000Z" })), commands: [{ command: "npm install ./chat2codex.tgz", exitCode: 0, observedAt: "2026-08-03T01:00:00.000Z" }], stages };
}
