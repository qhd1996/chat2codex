import path from "node:path";
import { JsonStateStore } from "../state/store.js";
import { diagnoseWindowsDistribution, type DistributionDoctorCheck, type DistributionDoctorSnapshot } from "./distribution-doctor.js";
import type { PortableBackupReference, PortableInstallStep, PortableOwnedHashes, PortablePrerequisiteSnapshot, PortableReceiptV1, PortableRollbackStep } from "./portable-receipt.js";
import { inspectInstalledWindowsDistribution } from "./windows-distribution-inspector.js";
import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceInstallInput, type WindowsServiceIo } from "./windows-service.js";

export const personalPortableActions = ["install", "upgrade", "rollback", "uninstall", "reinstall", "doctor"] as const;
export type PersonalPortableAction = typeof personalPortableActions[number];

export class PersonalPortableError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PersonalPortableError"; }
}

export interface PersonalPortableOptions {
  action: PersonalPortableAction; archivePath?: string; archiveSha256?: string;
  home: string; npmPrefix: string; receiptRoot: string;
  preserveUserData: boolean; dryRun: boolean; json: boolean;
}
export interface PersonalPortablePlan {
  action: PersonalPortableAction; archivePath?: string; archiveSha256?: string;
  home: string; npmPrefix: string; receiptRoot: string;
  preserveUserData: boolean; dryRun: boolean;
}
export interface PersonalPortableInstallIo {
  now(): Date; receiptId(): string; archiveSha256(filePath: string): Promise<string>;
  prerequisiteSnapshot(): Promise<PortablePrerequisiteSnapshot>; assertQuiescent(): Promise<void>;
  writeReceipt(receipt: PortableReceiptV1): Promise<void>;
  backupPrior(): Promise<PortableBackupReference>; installPackage(): Promise<void>; configure(): Promise<void>;
  quiesceWindowsUserTask(): Promise<void>; migrateState(): Promise<void>; installWindowsUserTask(): Promise<void>; doctor(): Promise<boolean>;
  uninstallWindowsUserTask(): Promise<void>; restoreState(): Promise<void>; restoreConfiguration(): Promise<void>; restorePackage(): Promise<void>;
  startWindowsUserTask(): Promise<void>; stopCurrentWriter(): Promise<void>; restoreWindowsUserTask(): Promise<void>;
  ownedHashes(): Promise<PortableOwnedHashes>;
}
export class PersonalPortableTransactionError extends PersonalPortableError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message);
    this.name = "PersonalPortableTransactionError";
    if (options && "cause" in options) this.cause = options.cause;
  }
}
export interface PersonalPortableCoreCompositionInput extends Omit<PersonalPortableInstallIo, "quiesceWindowsUserTask" | "migrateState" | "installWindowsUserTask" | "uninstallWindowsUserTask" | "startWindowsUserTask" | "stopCurrentWriter" | "doctor"> {
  serviceInput: WindowsServiceInstallInput; serviceIo: WindowsServiceIo; statePath: string; adapterId: string;
}
export interface PersonalPortableCoreDependencies {
  installWindowsUserTask: typeof installWindowsUserTask; uninstallWindowsUserTask: typeof uninstallWindowsUserTask;
  createStateStore(statePath: string, options: { adapterId: string; chat2codexHome: string }): Pick<JsonStateStore, "load" | "save">;
  inspectInstalledWindowsDistribution(home: string): Promise<DistributionDoctorSnapshot | null>;
  diagnoseWindowsDistribution(snapshot: DistributionDoctorSnapshot): DistributionDoctorCheck[];
}
const portableCoreDependencies: PersonalPortableCoreDependencies = {
  installWindowsUserTask, uninstallWindowsUserTask,
  createStateStore: (statePath, options) => new JsonStateStore(statePath, options),
  inspectInstalledWindowsDistribution, diagnoseWindowsDistribution,
};
export function composePersonalPortableInstallIo(input: PersonalPortableCoreCompositionInput, dependencies: PersonalPortableCoreDependencies = portableCoreDependencies): PersonalPortableInstallIo {
  let installedTaskPath: string | undefined;
  const install = async () => { installedTaskPath = (await dependencies.installWindowsUserTask(input.serviceInput, input.serviceIo)).taskPath; };
  const start = async () => {
    const writers = await input.serviceIo.countWriters(input.serviceInput.entrypoint);
    if (writers > 1) throw new Error("Windows writer state is ambiguous.");
    if (writers === 0) {
      if (!installedTaskPath) throw new Error("Windows task was not installed.");
      await input.serviceIo.startAndVerifyTask(installedTaskPath, input.serviceInput.entrypoint, input.serviceInput.statePath);
    }
  };
  return {
    ...input,
    quiesceWindowsUserTask: async () => { await input.serviceIo.stopWriters(input.serviceInput.entrypoint); },
    migrateState: async () => { const store = dependencies.createStateStore(input.statePath, { adapterId: input.adapterId, chat2codexHome: input.serviceInput.home }); const state = await store.load(); await store.save(state); },
    installWindowsUserTask: install,
    startWindowsUserTask: start,
    stopCurrentWriter: async () => { await input.serviceIo.stopWriters(input.serviceInput.entrypoint); },
    uninstallWindowsUserTask: async () => { await dependencies.uninstallWindowsUserTask(input.serviceInput.manifestPath, input.serviceIo); },
    doctor: async () => { const snapshot = await dependencies.inspectInstalledWindowsDistribution(input.serviceInput.home); return snapshot !== null && dependencies.diagnoseWindowsDistribution(snapshot).every((check) => check.status !== "error"); },
  };
}
const archiveActions = new Set<PersonalPortableAction>(["install", "upgrade", "reinstall"]);

export function parsePersonalPortableArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): PersonalPortableOptions {
  const [rawAction, ...args] = argv;
  if (!personalPortableActions.includes(rawAction as PersonalPortableAction)) fail("PORTABLE_ACTION_INVALID", "Choose install, upgrade, rollback, uninstall, reinstall, or doctor.");
  const action = rawAction as PersonalPortableAction;
  let archivePath: string | undefined; let archiveSha256: string | undefined;
  let home = defaultPortableHome(env); let npmPrefix: string | undefined; let receiptRoot: string | undefined;
  let dryRun = false; let json = false; let purge = false; let purgeConfirmation: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--archive") { archivePath = requireValue(args, ++index, arg); continue; }
    if (arg === "--sha256") { archiveSha256 = requireValue(args, ++index, arg).toLocaleLowerCase(); continue; }
    if (arg === "--home") { home = requireValue(args, ++index, arg); continue; }
    if (arg === "--npm-prefix") { npmPrefix = requireValue(args, ++index, arg); continue; }
    if (arg === "--receipt-root") { receiptRoot = requireValue(args, ++index, arg); continue; }
    if (arg === "--confirm-purge") { purgeConfirmation = requireValue(args, ++index, arg); continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--purge") { purge = true; continue; }
    fail("PORTABLE_ARGUMENT_UNKNOWN", "Remove the unsupported portable option and retry.");
  }
  if (archiveActions.has(action) && (!archivePath || !archiveSha256)) fail("PORTABLE_ARCHIVE_REQUIRED", "Provide the reviewed archive and its SHA-256.");
  if (archivePath !== undefined) archivePath = absolute(archivePath, "PORTABLE_ARCHIVE_PATH_INVALID");
  if (archiveSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(archiveSha256)) fail("PORTABLE_ARCHIVE_HASH_INVALID", "Provide the 64-character lowercase SHA-256.");
  home = absolute(home, "PORTABLE_HOME_INVALID");
  npmPrefix = absolute(npmPrefix ?? path.win32.join(home, "npm"), "PORTABLE_NPM_PREFIX_INVALID");
  receiptRoot = absolute(receiptRoot ?? path.win32.join(home, "receipts"), "PORTABLE_RECEIPT_ROOT_INVALID");
  requireInside(npmPrefix, home, "PORTABLE_NPM_PREFIX_INVALID");
  requireInside(receiptRoot, home, "PORTABLE_RECEIPT_ROOT_INVALID");
  if (purge && purgeConfirmation !== "DELETE_USER_DATA") fail("PORTABLE_PURGE_CONFIRMATION_REQUIRED", "Purge requires --confirm-purge DELETE_USER_DATA.");
  if (!purge && purgeConfirmation !== undefined) fail("PORTABLE_PURGE_CONFIRMATION_INVALID", "Use --confirm-purge only together with --purge.");
  return { action, archivePath, archiveSha256, home, npmPrefix, receiptRoot, preserveUserData: !purge, dryRun, json };
}
export function planPersonalPortableAction(options: PersonalPortableOptions): PersonalPortablePlan {
  return { action: options.action, archivePath: options.archivePath, archiveSha256: options.archiveSha256, home: options.home, npmPrefix: options.npmPrefix, receiptRoot: options.receiptRoot, preserveUserData: options.preserveUserData, dryRun: options.dryRun };
}
export async function executePersonalPortableInstall(plan: PersonalPortablePlan, io: PersonalPortableInstallIo): Promise<PortableReceiptV1> {
  if (!plan.archivePath || !plan.archiveSha256 || !["install", "upgrade", "reinstall"].includes(plan.action)) fail("PORTABLE_INSTALL_PLAN_INVALID", "Use a reviewed install, upgrade, or reinstall plan.");
  const observed = (await io.archiveSha256(plan.archivePath)).toLocaleLowerCase();
  if (observed !== plan.archiveSha256) throw new PersonalPortableTransactionError("PORTABLE_ARCHIVE_HASH_MISMATCH", "The archive differs from the reviewed SHA-256.");
  const prerequisites = await io.prerequisiteSnapshot();
  await io.assertQuiescent();
  const timestamp = io.now().toISOString();
  const receipt: PortableReceiptV1 = { schemaVersion: 1, receiptId: io.receiptId(), action: plan.action, status: "prepared", archiveSha256: plan.archiveSha256, home: plan.home, npmPrefix: plan.npmPrefix, receiptRoot: plan.receiptRoot, createdAt: timestamp, updatedAt: timestamp, prerequisites, backup: null, pendingStep: null, completed: [], rollbackCompleted: [], rollbackFailures: [] };
  await io.writeReceipt(structuredClone(receipt));
  const prepare = async (step: PortableInstallStep) => { const updatedAt = io.now().toISOString(); await io.writeReceipt({ ...structuredClone(receipt), status: "applying", pendingStep: step, updatedAt }); receipt.status = "applying"; receipt.pendingStep = step; receipt.updatedAt = updatedAt; };
  const complete = async (step: PortableInstallStep) => { receipt.completed.push(step); receipt.pendingStep = null; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt)); };
  const apply = async (step: PortableInstallStep, run: () => Promise<void>) => { await prepare(step); await run(); await complete(step); };
  try {
    await prepare("backup_prior"); receipt.backup = await io.backupPrior(); await complete("backup_prior");
    await apply("quiesce_service", io.quiesceWindowsUserTask);
    await apply("install_package", io.installPackage); await apply("configure", io.configure); await apply("migrate_state", io.migrateState);
    await apply("install_service", io.installWindowsUserTask); await apply("start_service", io.startWindowsUserTask);
    await apply("doctor", async () => { if (!await io.doctor()) throw new Error("doctor failed"); });
    receipt.status = "committed"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt)); return receipt;
  } catch (cause) {
    const attempted = receipt.pendingStep;
    if (!receipt.backup) {
      receipt.pendingStep = null; receipt.status = "aborted"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
      throw new PersonalPortableTransactionError("PORTABLE_TRANSACTION_ABORTED", "Portable transaction stopped before mutation.", { cause });
    }
    receipt.pendingStep = null; receipt.status = "rolling_back"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
    const rollback: Array<[PortableRollbackStep, () => Promise<void>, boolean]> = [
      ["stop_current_writer", io.stopCurrentWriter, receipt.completed.includes("quiesce_service") || attempted === "quiesce_service"],
      ["uninstall_windows_user_task", io.uninstallWindowsUserTask, receipt.completed.includes("install_service") && receipt.backup?.hashes.task === null],
      ["restore_state", io.restoreState, receipt.completed.includes("migrate_state") || attempted === "migrate_state"],
      ["restore_configuration", io.restoreConfiguration, receipt.completed.includes("configure") || attempted === "configure"],
      ["restore_package", io.restorePackage, receipt.completed.includes("install_package") || attempted === "install_package"],
      ["restore_windows_user_task", io.restoreWindowsUserTask, (receipt.completed.includes("quiesce_service") || attempted === "quiesce_service") && receipt.backup?.hashes.task !== null],
    ];
    for (const [step, run, needed] of rollback) if (needed) {
      try { await run(); receipt.rollbackCompleted.push(step); } catch { receipt.rollbackFailures.push(step); }
      receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
    }
    if (receipt.backup && receipt.rollbackFailures.length === 0) {
      try {
        if (!sameHashes(await io.ownedHashes(), receipt.backup.hashes)) throw new Error("restored hashes differ");
        receipt.rollbackCompleted.push("verify_restored");
      } catch { receipt.rollbackFailures.push("verify_restored"); }
      receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
    }
    receipt.pendingStep = null; receipt.status = receipt.rollbackFailures.length ? "rollback_failed" : "rolled_back"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
    if (receipt.rollbackFailures.length) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_INCOMPLETE", "Portable rollback requires repair.", { cause });
    throw new PersonalPortableTransactionError("PORTABLE_TRANSACTION_ROLLED_BACK", "Portable transaction failed and was rolled back.", { cause });
  }
}
function sameHashes(left: PortableOwnedHashes, right: PortableOwnedHashes): boolean { return (["package", "config", "state", "task"] as const).every((name) => left[name] === right[name]); }
function defaultPortableHome(env: NodeJS.ProcessEnv): string {
  const root = env.LOCALAPPDATA || (env.USERPROFILE ? path.win32.join(env.USERPROFILE, "AppData", "Local") : undefined);
  if (!root) fail("PORTABLE_CURRENT_USER_PATH_MISSING", "Set LOCALAPPDATA or run from a normal Windows user profile.");
  return path.win32.join(root, "Chat2Codex");
}
function absolute(value: string, code: string): string {
  if (!path.win32.isAbsolute(value) || value.includes(String.fromCharCode(0)) || value.includes(String.fromCharCode(10)) || value.includes(String.fromCharCode(13))) fail(code, "Use a canonical absolute Windows path.");
  return path.win32.normalize(value);
}
function requireInside(value: string, home: string, code: string): void {
  const relative = path.win32.relative(home, value);
  if (relative === ".." || relative.startsWith(".." + path.win32.sep) || path.win32.isAbsolute(relative)) fail(code, "Keep portable-owned paths under the selected home.");
}
function requireValue(values: string[], index: number, flag: string): string { const value = values[index]; if (!value) fail("PORTABLE_ARGUMENT_VALUE_REQUIRED", flag + " requires a value."); return value; }
function fail(code: string, message: string): never { throw new PersonalPortableError(code, message); }
