import { describe, expect, test } from "bun:test";

import {
  cleanWindowsFailureLine,
  parseCleanWindowsFailureLine,
  parseCleanWindowsFailureOutput,
  parseLifecycleFailure,
} from "../scripts/clean-windows-failure-evidence.mjs";

describe("clean Windows bounded failure evidence", () => {
  test("round-trips only a closed stage and code", () => {
    const line = cleanWindowsFailureLine({ stage: "start_1", code: "failed" });
    expect(line).toBe('NOVICE_CLEAN_WINDOWS_FAILURE {"schemaVersion":1,"stage":"start_1","code":"failed"}');
    expect(parseCleanWindowsFailureLine(line)).toEqual({ stage: "start_1", code: "failed" });
    expect(parseCleanWindowsFailureOutput("noise\n" + line + "\nmore")).toEqual({ stage: "start_1", code: "failed" });
  });

  test("accepts every reviewed lifecycle boundary", () => {
    for (const stage of [
      "root_create", "state_seed", "task_precheck", "install_1", "keys_1",
      "another_user_acl", "install_2", "installed_hashes", "start_1", "doctor",
      "stop_1", "start_2", "restart_identity", "stop_2", "uninstall_1",
      "uninstall_2", "task_absent_1", "state_preserved", "install_3", "keys_2",
      "key_rotation", "uninstall_3", "task_absent_2", "protected_checks",
      "owned_root_cleanup", "attestation_build",
    ]) expect(parseCleanWindowsFailureLine(cleanWindowsFailureLine({ stage, code: "failed" }))).toEqual({ stage, code: "failed" });
  });

  test("rejects unknown, extra, unbounded, or secret-bearing evidence", () => {
    for (const line of [
      'NOVICE_CLEAN_WINDOWS_FAILURE {"schemaVersion":1,"stage":"unknown","code":"failed"}',
      'NOVICE_CLEAN_WINDOWS_FAILURE {"schemaVersion":1,"stage":"start_1","code":"secret"}',
      'NOVICE_CLEAN_WINDOWS_FAILURE {"schemaVersion":1,"stage":"start_1","code":"failed","path":"C:/Users/private"}',
      "NOVICE_CLEAN_WINDOWS_FAILURE " + "x".repeat(5000),
    ]) expect(parseCleanWindowsFailureLine(line)).toBeNull();
    expect(parseCleanWindowsFailureOutput("token C:/Users/private")).toEqual({ stage: "unavailable", code: "unavailable" });
  });

  test("maps only a valid existing ACL failure detail to exit_86", () => {
    const detail = { stage: "directory_acl_owner_read", exitCode: 86, signal: null, exceptionType: "RuntimeException", hResult: -1, nativeCode: null, fullyQualifiedErrorId: "private identity", category: "OperationStopped", stderrTail: [], stdoutTail: [] };
    expect(parseLifecycleFailure("noise\nCHAT2CODEX_FAILURE_DETAIL " + JSON.stringify(detail))).toEqual({ detailStage: "directory_acl_owner_read", code: "exit_86" });
    expect(parseLifecycleFailure("CHAT2CODEX_FAILURE_DETAIL " + JSON.stringify({ ...detail, stage: "unknown" }))).toEqual({ detailStage: null, code: "failed" });
    expect(parseLifecycleFailure("token C:/Users/private")).toEqual({ detailStage: null, code: "failed" });
    expect(parseCleanWindowsFailureLine(cleanWindowsFailureLine({ stage: "install_1/directory_acl_owner_read", code: "exit_86" }))).toEqual({ stage: "install_1/directory_acl_owner_read", code: "exit_86" });
  });
});
