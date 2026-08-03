export const cleanWindowsFailurePrefix = "NOVICE_CLEAN_WINDOWS_FAILURE ";
const stages = new Set([
  "root_create", "state_seed", "task_precheck", "install_1", "keys_1",
  "another_user_acl", "install_2", "installed_hashes", "start_1", "doctor",
  "stop_1", "start_2", "restart_identity", "stop_2", "uninstall_1",
  "uninstall_2", "task_absent_1", "state_preserved", "install_3", "keys_2",
  "key_rotation", "uninstall_3", "task_absent_2", "protected_checks",
  "owned_root_cleanup", "attestation_build", "unavailable",
]);
const codes = new Set(["failed", "exit_86", "unavailable"]);

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

function boundedFailure(value) {
  return {
    stage: value && stages.has(value.stage) ? value.stage : "unavailable",
    code: value && codes.has(value.code) ? value.code : "unavailable",
  };
}
