export const noviceRequirements = ["NOVICE-001", "NOVICE-002", "NOVICE-003"] as const;
export const noviceEnvironments = ["fresh_user", "upgrade_user", "recovery_user"] as const;
export const novicePreconditions = [
  "candidate_available", "empty_config", "no_package", "no_service", "no_state", "no_secrets",
  "disposable_workspace", "package_installed", "service_installed", "valid_config", "old_version_installed",
  "durable_tasks_present", "pending_outbox_present", "configured_gateway", "bound_root", "unbound_root_and_child",
] as const;
export const noviceActions = [
  "download_candidate", "verify_sha256", "install_node", "install_codex_cli", "install_chat2codex",
  "setup_weixin", "simulate_scan_login", "run_doctor", "service_install", "service_start", "service_stop",
  "service_restart", "service_upgrade", "service_uninstall", "service_reinstall", "install_twice", "upgrade_twice",
  "uninstall_twice", "reinstall_twice", "migrate_schema", "rollback_schema", "create_task", "continue_task",
  "stop_task", "retry_task", "receive_text", "receive_image", "receive_file", "send_text", "send_image",
  "send_file", "select_multiple_tasks", "choose_workspace", "enable_plan_mode", "submit_approval",
  "set_permissions", "submit_structured_input", "request_data_purge",
] as const;
export const novicePromptCodes = [
  "CANDIDATE_HASH_OK", "PREREQUISITES_READY", "SETUP_COMPLETE", "DOCTOR_OK", "SERVICE_READY",
  "TASK_ACTION_COMPLETE", "MEDIA_ACTION_COMPLETE", "WORKSPACE_SELECTED", "PLAN_MODE_READY", "APPROVAL_REQUIRED",
  "STRUCTURED_INPUT_ACCEPTED", "UPGRADE_COMPLETE", "MIGRATION_COMPLETE", "ROLLBACK_COMPLETE",
  "UNINSTALL_DATA_PRESERVED", "PURGE_CONFIRMATION_REQUIRED", "CONFIG_RECOVERY_REQUIRED", "NETWORK_RECOVERY_REQUIRED",
  "DUPLICATE_IGNORED", "PROCESS_RECOVERY_REQUIRED", "STORAGE_RECOVERY_REQUIRED", "GATEWAY_RECOVERY_REQUIRED",
  "UNBOUND_EXPORT_BLOCKED",
] as const;
export const noviceInvariants = [
  "candidate_bytes_unchanged", "no_secret_output", "no_sensitive_path_output", "user_data_preserved",
  "single_writer", "state_loadable", "task_identity_stable", "outbox_order_preserved", "delivery_exactly_once",
  "no_codex_rerun", "workspace_contained", "approval_scoped", "schema_compatible", "backup_hash_verified",
  "gateway_fail_closed", "generation_monotonic", "unbound_not_exported", "child_not_exported", "no_residual_process",
] as const;
export const noviceFaults = [
  "config_error", "unstable_network", "network_offline", "duplicate_message", "reordered_message",
  "process_crash", "power_loss", "disk_full", "permission_denied", "gateway_offline", "wrong_token",
  "expired_generation", "malformed_schema", "future_schema", "interrupted_install", "interrupted_upgrade",
  "interrupted_uninstall",
] as const;
export const noviceRecoveries = [
  "retain_candidate", "correct_configuration", "rerun_doctor", "restart_service", "retry_same_identity",
  "restore_network", "resume_outbox", "restore_hash_verified_backup", "restore_permissions", "free_owned_disk_space",
  "restart_gateway", "use_correct_token", "rebind_generation", "reject_unsupported_schema", "cancel_purge",
  "reinstall_reviewed_archive", "preserve_failure_evidence",
] as const;
export const noviceProbes = [
  "archive_identity", "prerequisite_versions", "setup_state", "doctor_diagnostics", "service_lifecycle",
  "double_idempotency", "task_control", "media_transport", "outbox_idempotency", "workspace_routing",
  "plan_mode", "scoped_approval", "structured_input", "schema_migration", "rollback_integrity",
  "user_data_retention", "prompt_redaction", "gateway_authentication", "generation_fence",
  "unbound_child_exclusion", "process_identity", "zero_residual_processes",
] as const;

export type NoviceRequirement = typeof noviceRequirements[number];
export type NoviceEnvironment = typeof noviceEnvironments[number];
export type NovicePrecondition = typeof novicePreconditions[number];
export type NoviceAction = typeof noviceActions[number];
export type NovicePromptCode = typeof novicePromptCodes[number];
export type NoviceInvariant = typeof noviceInvariants[number];
export type NoviceFault = typeof noviceFaults[number];
export type NoviceRecovery = typeof noviceRecoveries[number];
export type NoviceProbe = typeof noviceProbes[number];

export interface NoviceScenario {
  id: string;
  requirement: NoviceRequirement;
  environment: NoviceEnvironment;
  preconditions: NovicePrecondition[];
  actions: NoviceAction[];
  expectedPromptCodes: NovicePromptCode[];
  invariants: NoviceInvariant[];
  faults: NoviceFault[];
  recovery: NoviceRecovery[];
  requiredProbes: NoviceProbe[];
}

const scenarioKeys = ["actions", "environment", "expectedPromptCodes", "faults", "id", "invariants", "preconditions", "recovery", "requiredProbes", "requirement"];

export const requiredNoviceCoverage = [
  ...noviceActions, ...noviceFaults, ...noviceProbes,
] as const;

export function parseNoviceScenarioInventory(value: unknown): NoviceScenario[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) throw new Error("Novice scenario inventory is invalid.");
  const ids = new Set<string>();
  return value.map((candidate, index) => {
    const item = object(candidate, `Novice scenario ${index}`);
    exactKeys(item, scenarioKeys, `novice scenario ${index}`);
    if (typeof item.id !== "string" || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(item.id) || item.id.length > 100) throw new Error("Novice scenario ID is invalid.");
    if (ids.has(item.id)) throw new Error(`Duplicate novice scenario ID: ${item.id}`);
    ids.add(item.id);
    const result: NoviceScenario = {
      id: item.id,
      requirement: closed(item.requirement, noviceRequirements, "requirement"),
      environment: closed(item.environment, noviceEnvironments, "environment"),
      preconditions: closedArray(item.preconditions, novicePreconditions, "precondition"),
      actions: closedArray(item.actions, noviceActions, "action"),
      expectedPromptCodes: closedArray(item.expectedPromptCodes, novicePromptCodes, "prompt code"),
      invariants: closedArray(item.invariants, noviceInvariants, "invariant"),
      faults: closedArray(item.faults, noviceFaults, "fault", true),
      recovery: closedArray(item.recovery, noviceRecoveries, "recovery"),
      requiredProbes: closedArray(item.requiredProbes, noviceProbes, "probe"),
    };
    if (result.actions.includes("request_data_purge") && (!result.expectedPromptCodes.includes("PURGE_CONFIRMATION_REQUIRED") || !result.invariants.includes("user_data_preserved") || !result.recovery.includes("cancel_purge"))) {
      throw new Error("Data purge requires explicit confirmation, preservation, and cancel recovery.");
    }
    return result;
  });
}

export function validateNoviceCoverage(items: NoviceScenario[]): { requirements: number; scenarios: number; coverageTokens: number; missing: string[] } {
  const requirements = new Set(items.map((item) => item.requirement));
  const covered = new Set<string>();
  for (const item of items) for (const token of [...item.actions, ...item.faults, ...item.requiredProbes]) covered.add(token);
  const missing: string[] = requiredNoviceCoverage.filter((token) => !covered.has(token));
  for (const requirement of noviceRequirements) if (!requirements.has(requirement)) missing.push(requirement);
  if (missing.length) throw new Error(`Missing novice coverage: ${missing.join(", ")}`);
  return { requirements: requirements.size, scenarios: items.length, coverageTokens: requiredNoviceCoverage.length, missing: [] };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new Error(`Unknown ${label} field: ${unknown.join(", ")}`);
  if (missing.length) throw new Error(`Missing ${label} field: ${missing.join(", ")}`);
}
function closed<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Unknown novice ${label}: ${String(value)}`);
  return value as T;
}
function closedArray<T extends string>(value: unknown, allowed: readonly T[], label: string, empty = false): T[] {
  if (!Array.isArray(value) || (!empty && value.length === 0) || value.length > 64) throw new Error(`Novice scenario ${label} list is invalid.`);
  const result = value.map((item) => closed(item, allowed, label));
  if (new Set(result).size !== result.length) throw new Error(`Duplicate novice scenario ${label}.`);
  return result;
}
