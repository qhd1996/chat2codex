export const cleanWindowsFailurePrefix = "NOVICE_CLEAN_WINDOWS_FAILURE ";
const stages = new Set([
  "root_create", "state_seed", "task_precheck", "install_1", "keys_1",
  "another_user_acl", "install_2", "installed_hashes", "start_1", "doctor",
  "stop_1", "start_2", "restart_identity", "stop_2", "uninstall_1",
  "uninstall_2", "task_absent_1", "state_preserved", "install_3", "keys_2",
  "key_rotation", "uninstall_3", "task_absent_2", "protected_checks",
  "owned_root_cleanup", "attestation_build", "unavailable",
  ...["install_1", "install_2", "install_3"].flatMap((operation) => ["file_acl_owner_read", "file_acl_dacl_apply", "directory_acl_owner_read", "directory_acl_dacl_apply", "file_create_identity", "file_create_create", "file_create_stdin"].map((detail) => operation + "/" + detail)),
  ...["DIST_INSPECTION_FAILED", "DIST_TASK_MISSING", "DIST_WRITER_CONFLICT", "DIST_LOCK_UNHEALTHY", "DIST_KEYS_INVALID", "DIST_LOOPBACK_INVALID"].map((code) => "doctor/" + code),
]);
const codes = new Set(["failed", "exit_86", "unavailable"]);
const aclStages = new Set(["file_acl_owner_read", "file_acl_dacl_apply", "directory_acl_owner_read", "directory_acl_dacl_apply", "file_create_identity", "file_create_create", "file_create_stdin"]);
const doctorCodes = new Set(["DIST_INSPECTION_FAILED", "DIST_PLATFORM_UNSUPPORTED", "DIST_POWERSHELL_MISSING", "DIST_POWERSHELL_UNSUPPORTED", "DIST_NODE_MISSING", "DIST_NODE_UNSUPPORTED", "DIST_NPM_MISSING", "DIST_NPM_UNSUPPORTED", "DIST_CODEX_MISSING", "DIST_CODEX_UNSUPPORTED", "DIST_PACKAGE_DRIFT", "DIST_TASK_DRIFT", "DIST_WRITER_CONFLICT", "DIST_SCHEMA_UNSUPPORTED", "DIST_KEYS_INVALID", "DIST_LOOPBACK_INVALID", "DIST_HOOK_HASH_DRIFT", "DIST_INSTALLED_HOOK_DRIFT", "DIST_MCP_UNCONFIGURED", "DIST_WEIXIN_NOT_CONFIGURED", "DIST_WEIXIN_BOUNDARY_INVALID", "DIST_ROLLBACK_PENDING"]);

export function cleanWindowsFailureLine(value) {
  const bounded = boundedFailure(value);
  return cleanWindowsFailurePrefix + JSON.stringify({ schemaVersion: 1, ...bounded });
}

export function parseCleanWindowsFailureLine(line) {
  if (typeof line !== "string" || !line.startsWith(cleanWindowsFailurePrefix) || line.length > 1024) return null;
  try {
    const value = JSON.parse(line.slice(cleanWindowsFailurePrefix.length));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "code,schemaVersion,stage" || value.schemaVersion !== 1) return null;
    const bounded = boundedFailure(value);
    return bounded.stage === value.stage && bounded.code === value.code ? bounded : null;
  } catch { return null; }
}

export function parseCleanWindowsFailureOutput(source) {
  if (typeof source !== "string" || source.length > 1024 * 1024) return { stage: "unavailable", code: "unavailable" };
  for (const line of source.split(/\r?\n/u).reverse()) {
    const value = parseCleanWindowsFailureLine(line.trim());
    if (value) return value;
  }
  return { stage: "unavailable", code: "unavailable" };
}

export function parseLifecycleFailure(source) {
  if (typeof source !== "string" || source.length > 4 * 1024 * 1024) return { detailStage: null, code: "failed" };
  for (const line of source.split(/\r?\n/u).reverse()) {
    if (!line.startsWith("CHAT2CODEX_FAILURE_DETAIL ")) continue;
    try {
      const value = JSON.parse(line.slice("CHAT2CODEX_FAILURE_DETAIL ".length));
      if (value && typeof value === "object" && !Array.isArray(value) && aclStages.has(value.stage) && value.exitCode === 86) return { detailStage: value.stage, code: "exit_86" };
    } catch { return { detailStage: null, code: "failed" }; }
  }
  return { detailStage: null, code: "failed" };
}

export function parseDoctorFailureCodes(source) {
  if (typeof source !== "string" || source.length > 1024 * 1024) return [];
  return [...doctorCodes].filter((code) => source.includes(code + ":") || source.includes("[" + code + "]")).sort();
}

function boundedFailure(value) {
  return {
    stage: value && stages.has(value.stage) ? value.stage : "unavailable",
    code: value && codes.has(value.code) ? value.code : "unavailable",
  };
}
