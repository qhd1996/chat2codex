import path from "node:path";

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
