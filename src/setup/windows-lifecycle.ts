import path from "node:path";

export interface WindowsInstallationManifestV1 {
  schemaVersion: 1;
  packageVersion: string;
  taskName: string;
  userSid: string;
  launcherPath: string;
  nodeBin: string;
  entrypoint: string;
  statePath: string;
  envFile: string;
  keyFiles: string[];
  ownedFiles: string[];
  hashes: Record<string, string>;
  installedAt: string;
}

export type WindowsLifecycleOperation =
  | { kind: "backup_prior" }
  | { kind: "ensure_keys" }
  | { kind: "write_env"; path: string }
  | { kind: "write_launcher"; path: string }
  | { kind: "write_task_xml" }
  | { kind: "write_manifest" }
  | { kind: "verify_owned" }
  | { kind: "register_task"; taskName: string }
  | { kind: "unregister_task"; taskName: string }
  | { kind: "remove_owned"; path: string }
  | { kind: "remove_managed_env"; path: string };

const begin = "# BEGIN CHAT2CODEX WINDOWS MANAGED";
const end = "# END CHAT2CODEX WINDOWS MANAGED";
const manifestKeys = ["entrypoint", "envFile", "hashes", "installedAt", "keyFiles", "launcherPath", "nodeBin", "ownedFiles", "packageVersion", "schemaVersion", "statePath", "taskName", "userSid"];

export function replaceManagedEnvBlock(source: string, values: Record<string, string>): string {
  if (typeof source !== "string") throw new Error("Env source must be text.");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const begins = occurrences(source, begin);
  const ends = occurrences(source, end);
  if (begins > 1 || ends > 1 || begins !== ends) throw new Error("Managed block markers are ambiguous.");
  const lines = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) throw new Error("Managed env key is invalid.");
    if (typeof value !== "string" || /[\r\n\0]/u.test(value)) throw new Error("Managed env value contains control characters.");
    return `${key}=${envValue(value)}`;
  });
  const block = [begin, ...lines, end].join(newline);
  if (begins === 0) {
    const prefix = source.length === 0 || source.endsWith(newline) ? source : source + newline;
    return prefix + block + newline;
  }
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start) + end.length;
  return source.slice(0, start) + block + source.slice(finish);
}

export function removeManagedEnvBlock(source: string): string {
  const begins = occurrences(source, begin);
  const ends = occurrences(source, end);
  if (begins === 0 && ends === 0) return source;
  if (begins !== 1 || ends !== 1) throw new Error("Managed block markers are ambiguous.");
  const start = source.indexOf(begin);
  const finishMarker = source.indexOf(end, start);
  if (finishMarker < start) throw new Error("Managed block markers are reversed.");
  let finish = finishMarker + end.length;
  if (source.slice(finish, finish + 2) === "\r\n") finish += 2;
  else if (source[finish] === "\n") finish += 1;
  return source.slice(0, start) + source.slice(finish);
}

export function parseWindowsInstallationManifest(value: unknown, home: string): WindowsInstallationManifestV1 {
  object(value, "Windows installation manifest");
  exactKeys(value, manifestKeys);
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error("Windows installation manifest schema is unsupported.");
  for (const key of ["packageVersion", "taskName", "userSid", "launcherPath", "nodeBin", "entrypoint", "statePath", "envFile", "installedAt"] as const) {
    if (typeof input[key] !== "string" || !input[key]) throw new Error(`Windows installation manifest ${key} is invalid.`);
  }
  if (!/^S-[0-9]+(?:-[0-9]+)+$/u.test(input.userSid as string)) throw new Error("Windows installation manifest user SID is invalid.");
  if (!Number.isFinite(Date.parse(input.installedAt as string))) throw new Error("Windows installation timestamp is invalid.");
  const root = absoluteWindows(home, "installation home");
  const keyFiles = pathsInside(input.keyFiles, root, "key files");
  const ownedFiles = pathsInside(input.ownedFiles, root, "owned files");
  const launcherPath = insidePath(input.launcherPath as string, root, "launcher");
  const nodeBin = absoluteWindows(input.nodeBin as string, "Node executable");
  const entrypoint = absoluteWindows(input.entrypoint as string, "entrypoint");
  const statePath = insidePath(input.statePath as string, root, "state path");
  const envFile = absoluteWindows(input.envFile as string, "env file");
  object(input.hashes, "Windows installation hashes");
  const hashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(input.hashes as Record<string, unknown>)) {
    if (!name || name.length > 240 || typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Windows installation hash entry is invalid.");
    hashes[name] = hash;
  }
  return {
    schemaVersion: 1, packageVersion: input.packageVersion as string, taskName: input.taskName as string,
    userSid: input.userSid as string, launcherPath, nodeBin, entrypoint, statePath, envFile, keyFiles, ownedFiles, hashes, installedAt: input.installedAt as string,
  };
}

export function planWindowsInstall(input: { home: string; manifest: WindowsInstallationManifestV1; hadPriorManifest: boolean }): WindowsLifecycleOperation[] {
  const manifest = parseWindowsInstallationManifest(input.manifest, input.home);
  return [
    ...(input.hadPriorManifest ? [{ kind: "backup_prior" as const }] : []),
    { kind: "ensure_keys" },
    { kind: "write_env", path: manifest.envFile },
    { kind: "write_launcher", path: manifest.launcherPath },
    { kind: "write_task_xml" }, { kind: "write_manifest" }, { kind: "verify_owned" },
    { kind: "register_task", taskName: manifest.taskName },
  ];
}

export function planWindowsUninstall(input: WindowsInstallationManifestV1, home: string): WindowsLifecycleOperation[] {
  const manifest = parseWindowsInstallationManifest(input, home);
  return [
    { kind: "unregister_task", taskName: manifest.taskName },
    ...[...manifest.ownedFiles, ...manifest.keyFiles].map((filePath) => ({ kind: "remove_owned" as const, path: filePath })),
    { kind: "remove_managed_env", path: manifest.envFile },
  ];
}

function pathsInside(value: unknown, root: string, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64 || !value.every((item) => typeof item === "string")) throw new Error(`Windows installation ${label} are invalid.`);
  const result = value.map((item) => insidePath(item, root, label));
  if (new Set(result.map((item) => item.toLocaleLowerCase())).size !== result.length) throw new Error(`Windows installation ${label} contain duplicates.`);
  return result;
}
function insidePath(value: string, root: string, label: string): string {
  const resolved = absoluteWindows(value, label);
  const relative = path.win32.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.win32.sep}`) || path.win32.isAbsolute(relative)) throw new Error(`Windows installation ${label} is outside its home.`);
  return resolved;
}
function absoluteWindows(value: string, label: string): string {
  if (typeof value !== "string" || !path.win32.isAbsolute(value) || /[\0\r\n]/u.test(value)) throw new Error(`Windows ${label} must be an absolute path.`);
  return path.win32.normalize(value);
}
function object(value: unknown, label: string): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function exactKeys(value: Record<string, unknown>, expected: string[]): void { const actual = Object.keys(value); const unknown = actual.filter((key) => !expected.includes(key)); const missing = expected.filter((key) => !actual.includes(key)); if (unknown.length) throw new Error("Unknown Windows installation manifest field."); if (missing.length) throw new Error("Missing Windows installation manifest field."); }
function occurrences(source: string, value: string): number { return source.split(value).length - 1; }
function envValue(value: string): string { return /[ #"']/u.test(value) || value.includes("\\") ? JSON.stringify(value) : value; }
