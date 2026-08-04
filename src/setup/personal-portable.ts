import path from "node:path";
import { JsonStateStore } from "../state/store.js";
import { diagnoseWindowsDistribution, type DistributionDoctorCheck, type DistributionDoctorSnapshot } from "./distribution-doctor.js";
import { parsePortableReceipt, parsePortableUninstallManifest, type PortableBackupReference, type PortableInstallStep, type PortableOwnedHashes, type PortablePrerequisiteSnapshot, type PortableReceiptV1, type PortableRollbackStep, type PortableUninstallManifestV1 } from "./portable-receipt.js";
import { inspectInstalledWindowsDistribution } from "./windows-distribution-inspector.js";
import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceInstallInput, type WindowsServiceIo } from "./windows-service.js";

export const personalPortableActions = ["install", "upgrade", "rollback", "uninstall", "reinstall", "doctor"] as const;
export type PersonalPortableAction = typeof personalPortableActions[number];

export class PersonalPortableError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PersonalPortableError"; }
}

export interface PersonalPortableOptions {
  action: PersonalPortableAction; archivePath?: string; archiveSha256?: string; receiptId?: string;
  home: string; npmPrefix: string; receiptRoot: string;
  preserveUserData: boolean; dryRun: boolean; json: boolean;
}
export interface PersonalPortablePlan {
  action: PersonalPortableAction; archivePath?: string; archiveSha256?: string; receiptId?: string;
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
  oldDoctor(): Promise<boolean>;
  doctorFailureCodes?(): string[];
  ownedHashes(): Promise<PortableOwnedHashes>;
}
export class PersonalPortableTransactionError extends PersonalPortableError {
  readonly stage?: string;
  readonly failureCodes?: string[];
  constructor(code: string, message: string, options?: ErrorOptions & { stage?: string }) {
    super(code, message);
    this.name = "PersonalPortableTransactionError";
    if (options && "cause" in options) this.cause = options.cause;
    this.stage = options?.stage;
    const failureCodes = options?.cause && typeof options.cause === "object" && "failureCodes" in options.cause && Array.isArray(options.cause.failureCodes) ? options.cause.failureCodes.filter((code): code is string => typeof code === "string" && /^DIST_[A-Z0-9_]+$/u.test(code)).slice(0, 20) : [];
    if (failureCodes.length) this.failureCodes = failureCodes;
  }
}
export interface PersonalPortableCoreCompositionInput extends Omit<PersonalPortableInstallIo, "quiesceWindowsUserTask" | "migrateState" | "installWindowsUserTask" | "uninstallWindowsUserTask" | "startWindowsUserTask" | "stopCurrentWriter" | "doctor" | "oldDoctor"> {
  serviceInput: WindowsServiceInstallInput; serviceIo: WindowsServiceIo; statePath: string; adapterId: string;
  priorWriterWasOnline?(): boolean;
  activeReceiptId?(): string | undefined;
}
export interface PersonalPortableCoreDependencies {
  installWindowsUserTask: typeof installWindowsUserTask; uninstallWindowsUserTask: typeof uninstallWindowsUserTask;
  createStateStore(statePath: string, options: { adapterId: string; chat2codexHome: string }): Pick<JsonStateStore, "load" | "save">;
  migrateState?(statePath: string, home: string): Promise<void>;
  inspectInstalledWindowsDistribution(home: string, installedPackageRoot?: string): Promise<DistributionDoctorSnapshot | null>;
  diagnoseWindowsDistribution(snapshot: DistributionDoctorSnapshot): DistributionDoctorCheck[];
}
const portableCoreDependencies: PersonalPortableCoreDependencies = {
  installWindowsUserTask, uninstallWindowsUserTask,
  createStateStore: (statePath, options) => new JsonStateStore(statePath, options),
  inspectInstalledWindowsDistribution, diagnoseWindowsDistribution,
};
export const personalPortableDeferredDoctorCodes = ["DIST_WEIXIN_NOT_CONFIGURED", "DIST_WEIXIN_BOUNDARY_INVALID", "DIST_MCP_UNCONFIGURED", "DIST_INSTALLED_HOOK_DRIFT"] as const;
export function composePersonalPortableInstallIo(input: PersonalPortableCoreCompositionInput, dependencies: PersonalPortableCoreDependencies = portableCoreDependencies): PersonalPortableInstallIo {
  const deferredOnboardingDoctorCodes = new Set<string>(personalPortableDeferredDoctorCodes);
  let installedTaskPath: string | undefined;
  let priorWriterCount = 0;
  let latestDoctorFailureCodes: string[] = [];
  const install = async () => { installedTaskPath = (await dependencies.installWindowsUserTask(input.serviceInput, input.serviceIo)).taskPath; };
  const start = async () => {
    const writers = await input.serviceIo.countWriters(input.serviceInput.entrypoint);
    requireWriterCount(writers);
    if (writers > 1) throw new Error("Windows writer state is ambiguous.");
    if (writers === 0) {
      if (!installedTaskPath) throw new Error("Windows task was not installed.");
      await input.serviceIo.startAndVerifyTask(installedTaskPath, input.serviceInput.entrypoint, input.serviceInput.statePath);
    }
  };
  const healthy = async () => {
    const installedPackageRoot = typeof input.serviceInput.entrypoint === "string" ? path.dirname(path.dirname(input.serviceInput.entrypoint)) : undefined;
    const snapshot = await dependencies.inspectInstalledWindowsDistribution(input.serviceInput.home, installedPackageRoot);
    latestDoctorFailureCodes = [];
    if (snapshot === null) return false;
    const offlineAllowed = priorWriterCount === 0;
    const activeReceiptId = input.activeReceiptId?.();
    const currentReceiptPending = typeof activeReceiptId === "string" && /^[A-Za-z0-9._-]{1,100}$/u.test(activeReceiptId) && snapshot.rollbackReceipt?.pending === true && snapshot.rollbackReceipt.receiptId === activeReceiptId;
    const failures = dependencies.diagnoseWindowsDistribution(snapshot).filter((check) => check.status === "error" && !deferredOnboardingDoctorCodes.has(check.code) && !(offlineAllowed && check.code === "DIST_WRITER_CONFLICT") && !(currentReceiptPending && check.code === "DIST_ROLLBACK_PENDING"));
    if (failures.length) {
      latestDoctorFailureCodes = failures.map((check) => check.code).filter((code) => /^DIST_[A-Z0-9_]+$/u.test(code)).slice(0, 20);
      return false;
    }
    return true;
  };
  return {
    ...input,
    quiesceWindowsUserTask: async () => {
      if (input.priorWriterWasOnline?.()) {
        if (await input.serviceIo.countWriters(input.serviceInput.entrypoint) !== 0) throw new Error("A writer reappeared after the portable snapshot.");
        priorWriterCount = 1;
      } else { priorWriterCount = await input.serviceIo.stopWriters(input.serviceInput.entrypoint); requireWriterCount(priorWriterCount); }
    },
    migrateState: async () => { if (dependencies.migrateState) await dependencies.migrateState(input.statePath, input.serviceInput.home); else { const store = dependencies.createStateStore(input.statePath, { adapterId: input.adapterId, chat2codexHome: input.serviceInput.home }); const state = await store.load(); await store.save(state); } },
    installWindowsUserTask: install,
    startWindowsUserTask: async () => { if (priorWriterCount === 1) await start(); },
    stopCurrentWriter: async () => { await input.serviceIo.stopWriters(input.serviceInput.entrypoint); },
    uninstallWindowsUserTask: async () => { await dependencies.uninstallWindowsUserTask(input.serviceInput.manifestPath, input.serviceIo); },
    doctor: healthy,
    oldDoctor: healthy,
    doctorFailureCodes: () => [...latestDoctorFailureCodes],
  };
}
const archiveActions = new Set<PersonalPortableAction>(["install", "upgrade", "reinstall"]);

export function parsePersonalPortableArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): PersonalPortableOptions {
  const [rawAction, ...args] = argv;
  if (!personalPortableActions.includes(rawAction as PersonalPortableAction)) fail("PORTABLE_ACTION_INVALID", "Choose install, upgrade, rollback, uninstall, reinstall, or doctor.");
  const action = rawAction as PersonalPortableAction;
  let archivePath: string | undefined; let archiveSha256: string | undefined;
  let home = defaultPortableHome(env); let npmPrefix: string | undefined; let receiptRoot: string | undefined; let receiptId: string | undefined;
  let dryRun = false; let json = false; let purge = false; let purgeConfirmation: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--archive") { archivePath = requireValue(args, ++index, arg); continue; }
    if (arg === "--sha256") { archiveSha256 = requireValue(args, ++index, arg).toLocaleLowerCase(); continue; }
    if (arg === "--home") { home = requireValue(args, ++index, arg); continue; }
    if (arg === "--npm-prefix") { npmPrefix = requireValue(args, ++index, arg); continue; }
    if (arg === "--receipt-root") { receiptRoot = requireValue(args, ++index, arg); continue; }
    if (arg === "--receipt") { receiptId = requireValue(args, ++index, arg); continue; }
    if (arg === "--confirm-purge") { purgeConfirmation = requireValue(args, ++index, arg); continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--purge") { purge = true; continue; }
    fail("PORTABLE_ARGUMENT_UNKNOWN", "Remove the unsupported portable option and retry.");
  }
  if (archiveActions.has(action) && (!archivePath || !archiveSha256)) fail("PORTABLE_ARCHIVE_REQUIRED", "Provide the reviewed archive and its SHA-256.");
  if (action === "rollback" && !receiptId) fail("PORTABLE_RECEIPT_REQUIRED", "Provide the named durable receipt to roll back.");
  if (receiptId && !/^[A-Za-z0-9._-]{1,100}$/u.test(receiptId)) fail("PORTABLE_RECEIPT_INVALID", "Use a valid bounded receipt identity.");
  if (receiptId && action !== "rollback") fail("PORTABLE_RECEIPT_UNEXPECTED", "Use --receipt only with rollback.");
  if (archivePath !== undefined) archivePath = absolute(archivePath, "PORTABLE_ARCHIVE_PATH_INVALID");
  if (archiveSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(archiveSha256)) fail("PORTABLE_ARCHIVE_HASH_INVALID", "Provide the 64-character lowercase SHA-256.");
  home = absolute(home, "PORTABLE_HOME_INVALID");
  npmPrefix = absolute(npmPrefix ?? path.win32.join(home, "npm"), "PORTABLE_NPM_PREFIX_INVALID");
  receiptRoot = absolute(receiptRoot ?? path.win32.join(home, "receipts"), "PORTABLE_RECEIPT_ROOT_INVALID");
  requireInside(npmPrefix, home, "PORTABLE_NPM_PREFIX_INVALID");
  requireInside(receiptRoot, home, "PORTABLE_RECEIPT_ROOT_INVALID");
  if (purge && purgeConfirmation !== "DELETE_USER_DATA") fail("PORTABLE_PURGE_CONFIRMATION_REQUIRED", "Purge requires --confirm-purge DELETE_USER_DATA.");
  if (!purge && purgeConfirmation !== undefined) fail("PORTABLE_PURGE_CONFIRMATION_INVALID", "Use --confirm-purge only together with --purge.");
  return { action, archivePath, archiveSha256, receiptId, home, npmPrefix, receiptRoot, preserveUserData: !purge, dryRun, json };
}
export function planPersonalPortableAction(options: PersonalPortableOptions): PersonalPortablePlan {
  return { action: options.action, archivePath: options.archivePath, archiveSha256: options.archiveSha256, receiptId: options.receiptId, home: options.home, npmPrefix: options.npmPrefix, receiptRoot: options.receiptRoot, preserveUserData: options.preserveUserData, dryRun: options.dryRun };
}
export async function executePersonalPortableInstall(plan: PersonalPortablePlan, io: PersonalPortableInstallIo): Promise<PortableReceiptV1> {
  if (!plan.archivePath || !plan.archiveSha256 || !["install", "upgrade", "reinstall"].includes(plan.action)) fail("PORTABLE_INSTALL_PLAN_INVALID", "Use a reviewed install, upgrade, or reinstall plan.");
  const observed = (await io.archiveSha256(plan.archivePath)).toLocaleLowerCase();
  if (observed !== plan.archiveSha256) throw new PersonalPortableTransactionError("PORTABLE_ARCHIVE_HASH_MISMATCH", "The archive differs from the reviewed SHA-256.");
  const prerequisites = await io.prerequisiteSnapshot();
  await io.assertQuiescent();
  const timestamp = io.now().toISOString();
  const receipt: PortableReceiptV1 = { schemaVersion: 1, receiptId: io.receiptId(), action: plan.action, status: "prepared", archiveSha256: plan.archiveSha256, home: plan.home, npmPrefix: plan.npmPrefix, receiptRoot: plan.receiptRoot, createdAt: timestamp, updatedAt: timestamp, prerequisites, backup: null, installedHashes: null, pendingStep: null, completed: [], rollbackCompleted: [], rollbackFailures: [] };
  await io.writeReceipt(structuredClone(receipt));
  const prepare = async (step: PortableInstallStep) => { const updatedAt = io.now().toISOString(); await io.writeReceipt({ ...structuredClone(receipt), status: "applying", pendingStep: step, updatedAt }); receipt.status = "applying"; receipt.pendingStep = step; receipt.updatedAt = updatedAt; };
  const complete = async (step: PortableInstallStep) => { receipt.completed.push(step); receipt.pendingStep = null; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt)); };
  const apply = async (step: PortableInstallStep, run: () => Promise<void>) => { await prepare(step); await run(); await complete(step); };
  try {
    await prepare("backup_prior"); receipt.backup = await io.backupPrior(); await complete("backup_prior");
    await apply("quiesce_service", io.quiesceWindowsUserTask);
    await apply("install_package", io.installPackage); await apply("configure", io.configure); await apply("migrate_state", io.migrateState);
    await apply("install_service", io.installWindowsUserTask);
    if (receipt.backup.wasOnline) {
      await apply("start_service", io.startWindowsUserTask);
      await apply("doctor", async () => {
        if (!await io.doctor()) {
          const error = new Error("doctor failed") as Error & { failureCodes?: string[] };
          const failureCodes = io.doctorFailureCodes?.().filter((code) => /^DIST_[A-Z0-9_]+$/u.test(code)).slice(0, 20) ?? [];
          if (failureCodes.length) error.failureCodes = failureCodes;
          throw error;
        }
      });
    }
    receipt.installedHashes = await io.ownedHashes(); receipt.status = receipt.backup.wasOnline ? "committed" : "awaiting_setup"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt)); return receipt;
  } catch (cause) {
    const attempted = receipt.pendingStep;
    if (!receipt.backup) {
      receipt.pendingStep = null; receipt.status = "aborted"; receipt.updatedAt = io.now().toISOString(); await io.writeReceipt(structuredClone(receipt));
      throw new PersonalPortableTransactionError("PORTABLE_TRANSACTION_ABORTED", "Portable transaction stopped before mutation.", { cause, stage: attempted ?? "backup_prior" });
    }
    receipt.pendingStep = null; receipt.installedHashes = null; receipt.status = "rolling_back"; receipt.updatedAt = io.now().toISOString();
    const persistRollback = async (): Promise<boolean> => { try { await io.writeReceipt(structuredClone(receipt)); return true; } catch { return false; } };
    await persistRollback();
    const rollback: Array<[PortableRollbackStep, () => Promise<void>, boolean]> = [
      ["stop_current_writer", io.stopCurrentWriter, true],
      ["uninstall_windows_user_task", io.uninstallWindowsUserTask, receipt.completed.includes("install_service") && receipt.backup?.hashes.task === null],
      ["restore_state", io.restoreState, true],
      ["restore_configuration", io.restoreConfiguration, true],
      ["restore_package", io.restorePackage, true],
      ["restore_windows_user_task", io.restoreWindowsUserTask, receipt.backup?.hashes.task !== null],
      ["old_doctor", async () => { if (!await io.oldDoctor()) throw new Error("old doctor failed"); }, Object.values(receipt.backup.hashes).some((value) => value !== null)],
    ];
    for (const [step, run, needed] of rollback) if (needed) {
      try { await run(); receipt.rollbackCompleted.push(step); } catch { receipt.rollbackFailures.push(step); }
      receipt.updatedAt = io.now().toISOString(); await persistRollback();
      if (receipt.rollbackFailures.length) break;
    }
    if (receipt.backup && receipt.rollbackFailures.length === 0) {
      try {
        if (!sameHashes(await io.ownedHashes(), receipt.backup.hashes)) throw new Error("restored hashes differ");
        receipt.rollbackCompleted.push("verify_restored");
      } catch { receipt.rollbackFailures.push("verify_restored"); }
      receipt.updatedAt = io.now().toISOString(); await persistRollback();
    }
    receipt.pendingStep = null; receipt.status = receipt.rollbackFailures.length ? "rollback_failed" : "rolled_back"; receipt.updatedAt = io.now().toISOString();
    const finalPersisted = await persistRollback();
    if (!finalPersisted) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_INCOMPLETE", "Portable rollback receipt could not be persisted.", { cause, stage: attempted ?? receipt.completed.at(-1) ?? "prepared" });
    if (receipt.rollbackFailures.length) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_INCOMPLETE", "Portable rollback requires repair.", { cause, stage: attempted ?? receipt.completed.at(-1) ?? "prepared" });
    throw new PersonalPortableTransactionError("PORTABLE_TRANSACTION_ROLLED_BACK", "Portable transaction failed and was rolled back.", { cause, stage: attempted ?? receipt.completed.at(-1) ?? "prepared" });
  }
}
export interface PersonalPortableRollbackIo {
  readReceipt(receiptId: string): Promise<unknown>; assertQuiescent(): Promise<void>; ownedHashes(): Promise<PortableOwnedHashes>; writeReceipt(receipt: PortableReceiptV1): Promise<void>;
  stopCurrentWriter(): Promise<void>; restoreState(): Promise<void>; restoreConfiguration(): Promise<void>; restorePackage(): Promise<void>;
  restoreWindowsUserTask(): Promise<void>; uninstallWindowsUserTask(): Promise<void>; oldDoctor(): Promise<boolean>;
}
export interface PortablePreservedDataHashes { state: string | null; credentials: string | null; deliverables: string | null; backups: string | null }
export interface PersonalPortableUninstallIo {
  expectedHome: string; expectedNpmPrefix: string;
  readUninstallManifest(): Promise<unknown | null>; assertQuiescent(): Promise<void>; uninstallWindowsUserTask(): Promise<{ removed: boolean }>;
  removeOwnedFiles(paths: readonly string[]): Promise<number>; preservedDataHashes(): Promise<PortablePreservedDataHashes>;
}
export interface PersonalPortableReinstallIo { keyFingerprints(): Promise<string[]>; uninstall(): Promise<{ removed: boolean }>; install(): Promise<void>; }

export async function executePersonalPortableRollback(receiptId: string, io: PersonalPortableRollbackIo): Promise<PortableReceiptV1> {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(receiptId)) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_RECEIPT_INVALID", "Choose a valid named rollback receipt.");
  let receipt: PortableReceiptV1;
  try { receipt = parsePortableReceipt(await io.readReceipt(receiptId)); } catch (cause) { throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_RECEIPT_INVALID", "The named rollback receipt is invalid.", { cause }); }
  const startingStatus = receipt.status;
  if (startingStatus === "applying" && !receipt.backup && receipt.completed.length === 0 && receipt.pendingStep === "backup_prior") {
    receipt.status = "aborted"; receipt.pendingStep = null; receipt.updatedAt = new Date().toISOString(); await io.writeReceipt(structuredClone(receipt)); return receipt;
  }
  const resumable = ["applying", "rolling_back", "rollback_failed"].includes(startingStatus);
  const candidateTerminal = ["committed", "awaiting_setup"].includes(startingStatus);
  if (receipt.receiptId !== receiptId || !receipt.backup || !candidateTerminal && !resumable || candidateTerminal && !receipt.installedHashes) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_RECEIPT_CONSUMED", "The named rollback receipt is not recoverable.");
  try { await io.assertQuiescent(); } catch (cause) { throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_OBLIGATIONS_ACTIVE", "Rollback is blocked by active obligations.", { cause }); }
  if (candidateTerminal && !sameHashes(await io.ownedHashes(), receipt.installedHashes!)) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_HASH_DRIFT", "Installed bytes differ from the named rollback receipt.");
  receipt.status = "rolling_back"; receipt.installedHashes = null; receipt.pendingStep = null; receipt.rollbackFailures = []; receipt.updatedAt = new Date().toISOString(); await io.writeReceipt(structuredClone(receipt));
  const steps: Array<[PortableRollbackStep, () => Promise<void>, boolean]> = [
    ["stop_current_writer", io.stopCurrentWriter, true], ["uninstall_windows_user_task", io.uninstallWindowsUserTask, receipt.backup.hashes.task === null],
    ["restore_state", io.restoreState, true], ["restore_configuration", io.restoreConfiguration, true], ["restore_package", io.restorePackage, true],
    ["restore_windows_user_task", io.restoreWindowsUserTask, receipt.backup.hashes.task !== null], ["old_doctor", async () => { if (!await io.oldDoctor()) throw new Error("old doctor failed"); }, Object.values(receipt.backup.hashes).some((value) => value !== null)],
  ];
  const neededOrder = steps.filter(([, , needed]) => needed).map(([step]) => step);
  receipt.rollbackCompleted = confirmedPrefix(receipt.rollbackCompleted, neededOrder);
  for (const [step, run, needed] of steps) if (needed && !receipt.rollbackCompleted.includes(step)) {
    try { await run(); receipt.rollbackCompleted.push(step); } catch { receipt.rollbackFailures.push(step); }
    receipt.updatedAt = new Date().toISOString(); await io.writeReceipt(structuredClone(receipt));
    if (receipt.rollbackFailures.length) break;
  }
  if (receipt.rollbackFailures.length === 0) { try { if (!sameHashes(await io.ownedHashes(), receipt.backup.hashes)) throw new Error("restored hashes differ"); receipt.rollbackCompleted.push("verify_restored"); } catch { receipt.rollbackFailures.push("verify_restored"); } receipt.updatedAt = new Date().toISOString(); await io.writeReceipt(structuredClone(receipt)); }
  receipt.status = receipt.rollbackFailures.length ? "rollback_failed" : "rolled_back"; receipt.updatedAt = new Date().toISOString(); await io.writeReceipt(structuredClone(receipt));
  if (receipt.rollbackFailures.length) throw new PersonalPortableTransactionError("PORTABLE_ROLLBACK_INCOMPLETE", "Portable rollback requires repair.");
  return receipt;
}

export async function executePersonalPortableUninstall(io: PersonalPortableUninstallIo): Promise<{ removed: boolean; serviceRemoved: boolean; removedFiles: number; preservedDataHashes: PortablePreservedDataHashes }> {
  const source = await io.readUninstallManifest();
  if (source === null) return { removed: false, serviceRemoved: false, removedFiles: 0, preservedDataHashes: await io.preservedDataHashes() };
  let manifest: PortableUninstallManifestV1;
  try { manifest = parseBoundPortableUninstallManifest(source, io.expectedHome, io.expectedNpmPrefix); } catch (cause) { throw new PersonalPortableTransactionError("PORTABLE_UNINSTALL_MANIFEST_INVALID", "The portable uninstall manifest is invalid.", { cause }); }
  const before = await io.preservedDataHashes(); await io.assertQuiescent(); const service = await io.uninstallWindowsUserTask(); const removedFiles = await io.removeOwnedFiles(manifest.ownedPackageFiles); const after = await io.preservedDataHashes();
  if (removedFiles !== manifest.ownedPackageFiles.length) throw new PersonalPortableTransactionError("PORTABLE_UNINSTALL_RESIDUAL_OWNED_FILES", "Manifest-owned package files remain after uninstall.");
  if (!samePreservedHashes(before, after)) throw new PersonalPortableTransactionError("PORTABLE_UNINSTALL_DATA_DRIFT", "Uninstall changed preserved user data.");
  return { removed: true, serviceRemoved: service.removed, removedFiles, preservedDataHashes: after };
}

export async function executePersonalPortableReinstall(io: PersonalPortableReinstallIo): Promise<{ rotatedKeyCount: number }> {
  const before = validFingerprints(await io.keyFingerprints());
  if (!before) throw new PersonalPortableTransactionError("PORTABLE_REINSTALL_KEY_ROTATION_FAILED", "Existing machine key inventory is invalid.");
  await io.uninstall(); await io.install(); const after = validFingerprints(await io.keyFingerprints());
  if (!after || after.some((fingerprint) => before.includes(fingerprint))) throw new PersonalPortableTransactionError("PORTABLE_REINSTALL_KEY_ROTATION_FAILED", "Reinstall did not create three fresh distinct machine keys.");
  return { rotatedKeyCount: 3 };
}
function validFingerprints(value: string[]): string[] | null { return value.length === 3 && new Set(value).size === 3 && value.every((item) => /^[a-f0-9]{64}$/u.test(item)) ? value : null; }
function confirmedPrefix(completed: PortableRollbackStep[], needed: PortableRollbackStep[]): PortableRollbackStep[] { const result: PortableRollbackStep[] = []; for (const step of needed) { if (!completed.includes(step)) break; result.push(step); } return result; }
function samePreservedHashes(left: PortablePreservedDataHashes, right: PortablePreservedDataHashes): boolean { return (["state", "credentials", "deliverables", "backups"] as const).every((name) => left[name] === right[name]); }
function sameHashes(left: PortableOwnedHashes, right: PortableOwnedHashes): boolean { return (["package", "config", "state", "task"] as const).every((name) => left[name] === right[name]); }
function sameWindowsPath(left: string, right: string): boolean { return path.win32.normalize(left).toLocaleLowerCase() === path.win32.normalize(right).toLocaleLowerCase(); }
function requireWriterCount(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > 1) throw new Error("Windows writer state is ambiguous."); }
export function parseBoundPortableUninstallManifest(source: unknown, expectedHome: string, expectedNpmPrefix: string): PortableUninstallManifestV1 {
  const manifest = parsePortableUninstallManifest(source);
  if (!sameWindowsPath(manifest.home, expectedHome) || !sameWindowsPath(manifest.npmPrefix, expectedNpmPrefix)) throw new Error("Portable uninstall manifest is not bound to this installation.");
  return manifest;
}
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
