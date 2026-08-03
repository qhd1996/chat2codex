import { execFile } from "node:child_process";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { FailureDetail } from "../util/failure-detail.js";

export const gatewayKeyRoles = ["prompt-hook", "stop-hook", "desktop-mcp"] as const;
export type GatewayKeyRole = typeof gatewayKeyRoles[number];

export interface EnsureWindowsGatewayKeysOptions {
  root: string;
  randomBytes?: (size: number) => Buffer;
  applyRootAcl: (rootPath: string) => Promise<void>;
  inspectRootAcl: (rootPath: string) => Promise<unknown>;
  applyAcl: (filePath: string) => Promise<void>;
  inspectAcl: (filePath: string) => Promise<unknown>;
  createPrivateFile?: (filePath: string, content: string) => Promise<void>;
}

const execFileAsync = promisify(execFile);

export async function ensureWindowsGatewayKeys(options: EnsureWindowsGatewayKeysOptions): Promise<{
  created: string[]; preserved: string[]; paths: Record<GatewayKeyRole, string>;
}> {
  const root = await ensureCanonicalRoot(options.root);
  await options.applyRootAcl(root);
  await options.inspectRootAcl(root);
  const paths = Object.fromEntries(gatewayKeyRoles.map((role) => [role, path.join(root, `${role}.key`)])) as Record<GatewayKeyRole, string>;
  const created: string[] = [];
  const preserved: string[] = [];
  const materials = new Set<string>();
  try {
    for (const role of gatewayKeyRoles) {
      const filePath = paths[role];
      const info = await lstat(filePath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
      if (!info) continue;
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Gateway key must be a regular non-symbolic file.");
      const canonicalFile = await realpath(filePath);
      if (process.platform !== "win32" && !samePath(canonicalFile, filePath)) throw new Error("Gateway key path must be canonical and non-symlinked.");
      if (process.platform === "win32" && !samePath(path.dirname(canonicalFile), await realpath(path.dirname(filePath)))) throw new Error("Gateway key path must be canonical and non-symlinked.");
      const material = await readKey(filePath);
      if (materials.has(material)) throw new Error("Gateway key files contain duplicate material.");
      materials.add(material);
      await options.inspectAcl(filePath);
      preserved.push(filePath);
    }
    for (const role of gatewayKeyRoles) {
      const filePath = paths[role];
      if (preserved.includes(filePath)) continue;
      let raw = (options.randomBytes ?? cryptoRandomBytes)(32);
      if (!Buffer.isBuffer(raw) || raw.byteLength !== 32) throw new Error("Gateway key generator must return exactly 32 bytes.");
      try {
        const encoded = raw.toString("base64url");
        if (materials.has(encoded)) throw new Error("Gateway key generator produced duplicate material.");
        materials.add(encoded);
        await (options.createPrivateFile ?? defaultPrivateFileCreator)(filePath, encoded + "\n");
        created.push(filePath);
        await options.applyAcl(filePath);
        await options.inspectAcl(filePath);
      } finally {
        raw.fill(0);
        raw = Buffer.alloc(0);
      }
    }
    return { created: [...created], preserved: [...preserved], paths };
  } catch (error) {
    await Promise.all(created.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
}

async function defaultPrivateFileCreator(filePath: string, content: string): Promise<void> {
  if (process.platform === "win32") return createOwnerOnlyWindowsFile(filePath, content);
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function createOwnerOnlyWindowsFile(filePath: string, content: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Owner-only Windows file creation requires Windows.");
  if (!path.isAbsolute(filePath) || typeof content !== "string" || Buffer.byteLength(content, "utf8") > 4096) throw new Error("Owner-only Windows file creation input is invalid.");
  const body = [
    "$created=$false",
    "$stage='identity'",
    "$path=$env:CHAT2CODEX_PRIVATE_PATH",
    "$user=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')",
    "$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')",
    "$acl=New-Object Security.AccessControl.FileSecurity",
    "$acl.SetOwner($user)",
    "$acl.SetAccessRuleProtection($true,$false)",
    "foreach($sid in @($user,$system,$admins)){ $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'))) }",
    "$stage='create'",
    "$stream=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$acl);$created=$true",
    "try{$stage='stdin';$reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false));$text=$reader.ReadToEnd();$bytes=[Text.UTF8Encoding]::new($false).GetBytes($text);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}",
  ].join(";");
  await runWindowsAclCommand("file_create", filePath, body, content);
}

export async function applyOwnerOnlyWindowsAcl(filePath: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows ACL creation requires Windows.");
  const body = [
    "$stage='owner_read'",
    "$path=$env:CHAT2CODEX_PRIVATE_PATH",
    "$user=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$existing=[System.IO.File]::GetAccessControl($path,[Security.AccessControl.AccessControlSections]::Owner)",
    "$owner=$existing.GetOwner([Security.Principal.SecurityIdentifier])",
    "if($owner.Value -ne $user.Value){throw 'Gateway key owner differs from the current user'}",
    "$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')",
    "$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')",
    "$acl=New-Object Security.AccessControl.FileSecurity",
    "$acl.SetAccessRuleProtection($true,$false)",
    "foreach($sid in @($user,$system,$admins)){ $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'))) }",
    "$stage='dacl_apply'",
    "[System.IO.File]::SetAccessControl($path,$acl)",
  ].join(";");
  await applyWindowsAcl("file_acl", filePath, body);
}

export async function applyOwnerOnlyWindowsDirectoryAcl(directoryPath: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows directory ACL creation requires Windows.");
  const body = [
    "$stage='owner_read'",
    "$path=$env:CHAT2CODEX_PRIVATE_PATH",
    "$user=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$existing=[System.IO.Directory]::GetAccessControl($path,[Security.AccessControl.AccessControlSections]::Owner)",
    "$owner=$existing.GetOwner([Security.Principal.SecurityIdentifier])",
    "if($owner.Value -ne $user.Value){throw 'Gateway key directory owner differs from the current user'}",
    "$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')",
    "$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')",
    "$acl=New-Object Security.AccessControl.DirectorySecurity",
    "$acl.SetAccessRuleProtection($true,$false)",
    "$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'",
    "$propagate=[Security.AccessControl.PropagationFlags]::None",
    "foreach($sid in @($user,$system,$admins)){ $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl',$inherit,$propagate,'Allow'))) }",
    "$stage='dacl_apply'",
    "[System.IO.Directory]::SetAccessControl($path,$acl)",
  ].join(";");
  await applyWindowsAcl("directory_acl", directoryPath, body);
}

async function applyWindowsAcl(stage: "file_acl" | "directory_acl", targetPath: string, body: string): Promise<void> {
  await runWindowsAclCommand(stage, targetPath, body);
}

async function runWindowsAclCommand(stage: "file_acl" | "directory_acl" | "file_create", targetPath: string, body: string, input?: string): Promise<void> {
  const diagnostic = [
    "$record=$_",
    ...(stage === "file_create" ? ["if($stream){try{$stream.Dispose()}catch{}}", "if($created){try{[IO.File]::Delete($path)}catch{}}"] : []),
    "$native=if($record.Exception.PSObject.Properties['NativeErrorCode']){[int]$record.Exception.NativeErrorCode}else{$null}",
    "$detail=[ordered]@{stage=('" + stage + "_'+$stage);exceptionType=$record.Exception.GetType().FullName;hResult=[int]$record.Exception.HResult;nativeCode=$native;fullyQualifiedErrorId=[string]$record.FullyQualifiedErrorId;category=[string]$record.CategoryInfo.Category}",
    "[Console]::Error.WriteLine(($detail|ConvertTo-Json -Compress -Depth 3))",
    "exit 86",
  ].join(";");
  const script = "$ErrorActionPreference='Stop';try{" + body + "}catch{" + diagnostic + "}";
  try {
    const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];
    const options = { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8" as const, env: { ...process.env, CHAT2CODEX_PRIVATE_PATH: targetPath } };
    if (input === undefined) await execFileAsync("powershell.exe", args, options);
    else await execFileWithInput("powershell.exe", args, options, input);
  } catch (error) {
    throw windowsAclApplicationError(stage, error);
  }
}

function execFileWithInput(command: string, args: string[], options: Parameters<typeof execFile>[2], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve();
    });
    child.stdin?.end(input, "utf8");
  });
}

class WindowsAclApplicationError extends Error {
  readonly failureDetail: FailureDetail;
  constructor(detail: FailureDetail) {
    super("Windows directory ACL application failed.");
    this.name = "WindowsAclApplicationError";
    this.failureDetail = detail;
  }
}

function windowsAclApplicationError(stage: string, error: unknown): WindowsAclApplicationError {
  const value = isRecord(error) ? error : {};
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  const stdout = typeof value.stdout === "string" ? value.stdout : "";
  const parsed = parsePowerShellAclDetail(stderr);
  return new WindowsAclApplicationError({
    stage: bounded(typeof parsed.stage === "string" ? parsed.stage : stage, 64),
    exitCode: typeof value.code === "number" && Number.isSafeInteger(value.code) ? value.code : null,
    signal: typeof value.signal === "string" ? bounded(value.signal, 32) : null,
    exceptionType: bounded(parsed.exceptionType, 160),
    hResult: integerOrNull(parsed.hResult),
    nativeCode: integerOrNull(parsed.nativeCode),
    fullyQualifiedErrorId: bounded(parsed.fullyQualifiedErrorId, 256),
    category: bounded(parsed.category, 96),
    stderrTail: safeTail(stderr),
    stdoutTail: safeTail(stdout),
  });
}

function parsePowerShellAclDetail(stderr: string): Record<string, unknown> {
  for (const line of stderr.split(/\r?\n/u).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const value = JSON.parse(line);
      if (isRecord(value) && typeof value.stage === "string" && /^(?:(?:directory|file)_acl_(?:owner_read|dacl_apply)|file_create_(?:identity|create|stdin))$/u.test(value.stage)) return value;
    } catch { /* use bounded fallback below */ }
  }
  return { exceptionType: "PowerShellDiagnosticUnavailable", fullyQualifiedErrorId: "unavailable", category: "unavailable" };
}

function safeTail(value: string): string[] {
  return value.split(/\r?\n/u).filter(Boolean).slice(-4).map((line) => redact(line).slice(0, 512));
}

function redact(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"']+/gu, "<path>")
    .replace(/S-\d+(?:-\d+){2,}/gu, "<sid>")
    .replace(/[A-Za-z0-9_-]{40,}/gu, "<secret>");
}

function bounded(value: unknown, max: number): string {
  return redact(typeof value === "string" ? value : "unavailable").slice(0, max) || "unavailable";
}
function integerOrNull(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

async function ensureCanonicalRoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error("Gateway key root must be absolute.");
  const resolved = path.resolve(candidate);
  await assertNoExplicitReparseAncestor(resolved);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Gateway key root must be a non-symlink directory.");
  const canonical = await realpath(resolved);
  return canonicalizeWindowsGatewayKeyRoot(resolved, canonical);
}

export function canonicalizeWindowsGatewayKeyRoot(
  requested: string,
  canonical: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" && !samePath(canonical, requested, platform))
    throw new Error("Gateway key root must not traverse a symbolic link.");
  return platform === "win32" ? requested : canonical;
}

async function assertNoExplicitReparseAncestor(candidate: string): Promise<void> {
  const root = path.parse(candidate).root;
  const components = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = path.join(current, component);
    const linkInfo = await lstat(current).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!linkInfo) break;
    if (linkInfo.isSymbolicLink()) throw new Error("Gateway key root must not traverse a symbolic link or reparse point.");
    if (process.platform === "win32") {
      const followed = await stat(current);
      if (linkInfo.dev !== followed.dev || linkInfo.ino !== followed.ino)
        throw new Error("Gateway key root must not traverse a symbolic link or reparse point.");
    }
  }
}

async function readKey(filePath: string): Promise<string> {
  const value = await readFile(filePath, "utf8");
  if (!/^[A-Za-z0-9_-]{43}\r?\n$/u.test(value)) throw new Error("Gateway key must contain exactly one 256-bit base64url value.");
  const encoded = value.trim();
  const decoded = Buffer.from(encoded, "base64url");
  try {
    if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) throw new Error("Gateway key must contain exactly one 256-bit base64url value.");
    return encoded;
  } finally { decoded.fill(0); }
}

function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right;
}
