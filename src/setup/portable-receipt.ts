import path from "node:path";

export type PortableReceiptAction = "install" | "upgrade" | "rollback" | "uninstall" | "reinstall" | "doctor";
export type PortableReceiptStatus = "prepared" | "applying" | "committed" | "rolling_back" | "rolled_back" | "rollback_failed" | "aborted";
export type PortableInstallStep = "backup_prior" | "quiesce_service" | "install_package" | "configure" | "migrate_state" | "install_service" | "start_service" | "doctor";
export type PortableRollbackStep = "stop_current_writer" | "uninstall_windows_user_task" | "restore_state" | "restore_configuration" | "restore_package" | "restore_windows_user_task" | "verify_restored";
export interface PortablePrerequisiteSnapshot {
  windowsVersion: string; architecture: "x64" | "arm64"; powershellVersion: string; nodeVersion: string; npmVersion: string;
  codexCliVersion: string; desktopVersion: string | null;
}
export interface PortableOwnedHashes { package: string | null; config: string | null; state: string | null; task: string | null }
export interface PortableBackupReference { backupId: string; hashes: PortableOwnedHashes }
export interface PortableReceiptV1 {
  schemaVersion: 1; receiptId: string; action: PortableReceiptAction; status: PortableReceiptStatus;
  archiveSha256?: string; home: string; npmPrefix: string; receiptRoot: string; createdAt: string; updatedAt: string;
  prerequisites: PortablePrerequisiteSnapshot; backup: PortableBackupReference | null; pendingStep: PortableInstallStep | null; completed: PortableInstallStep[];
  rollbackCompleted: PortableRollbackStep[]; rollbackFailures: PortableRollbackStep[];
}
const keys = ["action", "archiveSha256", "backup", "completed", "createdAt", "home", "npmPrefix", "pendingStep", "prerequisites", "receiptId", "receiptRoot", "rollbackCompleted", "rollbackFailures", "schemaVersion", "status", "updatedAt"];
const actions = ["install", "upgrade", "rollback", "uninstall", "reinstall", "doctor"];
const statuses = ["prepared", "applying", "committed", "rolling_back", "rolled_back", "rollback_failed", "aborted"];
const installSteps = ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service", "doctor"];
const rollbackSteps = ["stop_current_writer", "uninstall_windows_user_task", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"];
export function serializePortableReceipt(value: PortableReceiptV1): string { return JSON.stringify(parsePortableReceipt(value), null, 2) + "\n"; }
export function parsePortableReceipt(value: unknown): PortableReceiptV1 {
  object(value); exact(value, keys);
  if (value.schemaVersion !== 1 || typeof value.receiptId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(value.receiptId)) throw new Error("Portable receipt identity is invalid.");
  if (!actions.includes(String(value.action)) || !statuses.includes(String(value.status))) throw new Error("Portable receipt action or status is invalid.");
  if (value.archiveSha256 !== undefined && (typeof value.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.archiveSha256))) throw new Error("Portable receipt archive hash is invalid.");
  const home = absolute(String(value.home)); const npmPrefix = absolute(String(value.npmPrefix)); const receiptRoot = absolute(String(value.receiptRoot)); inside(npmPrefix, home); inside(receiptRoot, home);
  if (!validTime(value.createdAt) || !validTime(value.updatedAt)) throw new Error("Portable receipt timestamp is invalid.");
  const completed = orderedPrefix(value.completed, installSteps, "completed") as PortableInstallStep[];
  const rollbackCompleted = orderedSubsequence(value.rollbackCompleted, rollbackSteps, "rollback completed") as PortableRollbackStep[];
  const rollbackFailures = orderedSubsequence(value.rollbackFailures, rollbackSteps, "rollback failures") as PortableRollbackStep[];
  if (rollbackCompleted.some((step) => rollbackFailures.includes(step))) throw new Error("Portable receipt rollback result is ambiguous.");
  const pendingStep = value.pendingStep === null ? null : String(value.pendingStep) as PortableInstallStep;
  if (pendingStep !== null && (!installSteps.includes(pendingStep) || installSteps.indexOf(pendingStep) !== completed.length)) throw new Error("Portable receipt pending step is out of sequence.");
  const prerequisites = parsePrerequisites(value.prerequisites);
  const backup = parseBackup(value.backup);
  validateState(value.status as PortableReceiptStatus, completed, pendingStep, backup, rollbackCompleted, rollbackFailures);
  return { schemaVersion: 1, receiptId: value.receiptId, action: value.action as PortableReceiptAction, status: value.status as PortableReceiptStatus, ...(value.archiveSha256 ? { archiveSha256: value.archiveSha256 } : {}), home, npmPrefix, receiptRoot, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string, prerequisites, backup, pendingStep, completed, rollbackCompleted, rollbackFailures };
}
function parsePrerequisites(value: unknown): PortablePrerequisiteSnapshot {
  object(value); exact(value, ["architecture", "codexCliVersion", "desktopVersion", "nodeVersion", "npmVersion", "powershellVersion", "windowsVersion"]);
  for (const name of ["windowsVersion", "powershellVersion", "nodeVersion", "npmVersion", "codexCliVersion"] as const) if (!safeVersion(value[name])) throw new Error("Portable prerequisite snapshot is invalid.");
  if (!["x64", "arm64"].includes(String(value.architecture)) || (value.desktopVersion !== null && !safeVersion(value.desktopVersion))) throw new Error("Portable prerequisite snapshot is invalid.");
  return { windowsVersion: value.windowsVersion as string, architecture: value.architecture as PortablePrerequisiteSnapshot["architecture"], powershellVersion: value.powershellVersion as string, nodeVersion: value.nodeVersion as string, npmVersion: value.npmVersion as string, codexCliVersion: value.codexCliVersion as string, desktopVersion: value.desktopVersion as string | null };
}
function parseBackup(value: unknown): PortableBackupReference | null {
  if (value === null) return null;
  object(value); exact(value, ["backupId", "hashes"]);
  if (typeof value.backupId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(value.backupId)) throw new Error("Portable backup identity is invalid.");
  object(value.hashes); exact(value.hashes, ["config", "package", "state", "task"]);
  const hashes = value.hashes as Record<string, unknown>;
  for (const item of Object.values(hashes)) if (item !== null && (typeof item !== "string" || !/^[a-f0-9]{64}$/u.test(item))) throw new Error("Portable backup hash is invalid.");
  return { backupId: value.backupId, hashes: { package: hashOrNull(hashes.package), config: hashOrNull(hashes.config), state: hashOrNull(hashes.state), task: hashOrNull(hashes.task) } };
}
function hashOrNull(value: unknown): string | null { return value === null ? null : value as string; }
function orderedPrefix(value: unknown, allowed: string[], label: string): string[] { const result = sequence(value, allowed, label); if (result.some((item, index) => item !== allowed[index])) throw new Error("Portable receipt " + label + " sequence is invalid."); return result; }
function orderedSubsequence(value: unknown, allowed: string[], label: string): string[] { const result = sequence(value, allowed, label); if (result.some((item, index) => index > 0 && allowed.indexOf(item) <= allowed.indexOf(result[index - 1]!))) throw new Error("Portable receipt " + label + " sequence is invalid."); return result; }
function sequence(value: unknown, allowed: string[], label: string): string[] { if (!Array.isArray(value) || value.length > allowed.length || value.some((item) => typeof item !== "string" || !allowed.includes(item)) || new Set(value).size !== value.length) throw new Error("Portable receipt " + label + " is invalid."); return [...value]; }
function absolute(value: string): string { if (!path.win32.isAbsolute(value)) throw new Error("Portable receipt path is invalid."); return path.win32.normalize(value); }
function inside(value: string, root: string): void { const relative = path.win32.relative(root, value); if (relative === ".." || relative.startsWith(".." + path.win32.sep) || path.win32.isAbsolute(relative)) throw new Error("Portable receipt path escapes its home."); }
function validTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function safeVersion(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9._ -]+$/u.test(value); }
function validateState(status: PortableReceiptStatus, completed: PortableInstallStep[], pending: PortableInstallStep | null, backup: PortableBackupReference | null, rollbackCompleted: PortableRollbackStep[], rollbackFailures: PortableRollbackStep[]): void {
  if (completed.includes("backup_prior") !== (backup !== null)) throw new Error("Portable receipt backup state is inconsistent.");
  if (status === "prepared" && (completed.length || pending || backup || rollbackCompleted.length || rollbackFailures.length)) throw new Error("Portable receipt prepared state is inconsistent.");
  if (status === "aborted" && (completed.length || pending || backup || rollbackCompleted.length || rollbackFailures.length)) throw new Error("Portable receipt aborted state is inconsistent.");
  if (status === "committed" && (completed.length !== installSteps.length || pending || rollbackCompleted.length || rollbackFailures.length)) throw new Error("Portable receipt committed state is inconsistent.");
  if (["prepared", "applying"].includes(status) && (rollbackCompleted.length || rollbackFailures.length)) throw new Error("Portable receipt active state contains rollback results.");
  if (status === "rolling_back" && (!backup || pending)) throw new Error("Portable receipt rolling-back state is inconsistent.");
  if (["rolled_back", "rollback_failed"].includes(status) && !backup) throw new Error("Portable receipt rollback state lacks a backup.");
  if (["rolled_back", "rollback_failed"].includes(status) && pending) throw new Error("Portable receipt rollback state retains a pending step.");
  if (status === "rolled_back" && (rollbackFailures.length || rollbackCompleted.at(-1) !== "verify_restored")) throw new Error("Portable receipt rolled-back state lacks exact restoration proof.");
  if (status === "rollback_failed" && rollbackFailures.length === 0) throw new Error("Portable receipt rollback-failed state lacks failures.");
}
function object(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Portable receipt must be an object."); }
function exact(value: Record<string, unknown>, allowed: string[]): void { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); const missing = allowed.filter((key) => !Object.hasOwn(value, key) && key !== "archiveSha256"); if (unknown.length) throw new Error("Unknown portable receipt field."); if (missing.length) throw new Error("Missing portable receipt field."); }
