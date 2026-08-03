import { execFile } from "node:child_process";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const gatewayKeyRoles = ["prompt-hook", "stop-hook", "desktop-mcp"] as const;
export type GatewayKeyRole = typeof gatewayKeyRoles[number];

export interface EnsureWindowsGatewayKeysOptions {
  root: string;
  randomBytes?: (size: number) => Buffer;
  applyAcl: (filePath: string) => Promise<void>;
  inspectAcl: (filePath: string) => Promise<unknown>;
}

const execFileAsync = promisify(execFile);

export async function ensureWindowsGatewayKeys(options: EnsureWindowsGatewayKeysOptions): Promise<{
  created: string[]; preserved: string[]; paths: Record<GatewayKeyRole, string>;
}> {
  const root = await ensureCanonicalRoot(options.root);
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
      if (!samePath(await realpath(filePath), filePath)) throw new Error("Gateway key path must be canonical and non-symlinked.");
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
        await writeFile(filePath, encoded + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
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

export async function applyOwnerOnlyWindowsAcl(filePath: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows ACL creation requires Windows.");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$securityModule=Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    "Import-Module -Name $securityModule -Force -ErrorAction Stop",
    "$path=$env:CHAT2CODEX_PRIVATE_PATH",
    "$user=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')",
    "$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')",
    "$acl=New-Object Security.AccessControl.FileSecurity",
    "$acl.SetOwner($user)",
    "$acl.SetAccessRuleProtection($true,$false)",
    "foreach($sid in @($user,$system,$admins)){ $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'))) }",
    "Set-Acl -LiteralPath $path -AclObject $acl",
  ].join(";");
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8",
    env: { ...process.env, CHAT2CODEX_PRIVATE_PATH: filePath },
  });
}

async function ensureCanonicalRoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error("Gateway key root must be absolute.");
  const resolved = path.resolve(candidate);
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
  return canonical;
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
