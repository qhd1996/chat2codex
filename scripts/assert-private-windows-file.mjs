import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const systemSid = "S-1-5-18";
const administratorsSid = "S-1-5-32-544";
const broadSids = new Set(["S-1-1-0", "S-1-5-11", "S-1-5-32-545"]);
const allowedKeys = ["aces", "currentUserSid", "ownerSid"];
const aceKeys = ["accessControlType", "identitySid", "inherited", "rights"];

export function assertPrivateWindowsAcl(value) {
  object(value, "ACL");
  exactKeys(value, allowedKeys, "ACL");
  sid(value.ownerSid, "owner SID");
  sid(value.currentUserSid, "current user SID");
  if (value.ownerSid !== value.currentUserSid) throw new Error("Private file owner must be the current user.");
  if (!Array.isArray(value.aces) || value.aces.length < 1 || value.aces.length > 64) throw new Error("ACL aces must be a bounded array.");
  const allowedSids = new Set([value.currentUserSid, systemSid, administratorsSid]);
  let ownerAllow = false;
  for (const rawAce of value.aces) {
    object(rawAce, "ACE");
    exactKeys(rawAce, aceKeys, "ACE");
    sid(rawAce.identitySid, "ACE identity SID");
    if (rawAce.accessControlType !== "Allow") throw new Error("Deny or unknown access control type is not accepted.");
    if (!Number.isSafeInteger(rawAce.rights) || rawAce.rights < 0 || rawAce.rights > 0x1ffffff) throw new Error("ACE rights are invalid.");
    if (typeof rawAce.inherited !== "boolean") throw new Error("ACE inherited flag is invalid.");
    if (broadSids.has(rawAce.identitySid)) throw new Error("Broad principal is forbidden in a private file ACL.");
    if (!allowedSids.has(rawAce.identitySid)) throw new Error("Unexpected principal in private file ACL.");
    if (rawAce.identitySid === value.currentUserSid) ownerAllow = true;
  }
  if (!ownerAllow) throw new Error("Private file ACL lacks an owner allow rule.");
  return { ownerSid: value.ownerSid, aceCount: value.aces.length };
}

export async function inspectPrivateWindowsFile(filePath) {
  if (process.platform !== "win32") throw new Error("Windows ACL inspection requires Windows.");
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new Error("Private file path must be absolute.");
  const resolved = path.resolve(filePath);
  const info = await lstat(resolved).catch(() => undefined);
  if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("Private file must be a regular non-symlink file.");
  if (!samePath(await realpath(resolved), resolved)) throw new Error("Private file path must be canonical.");
  const powershell = [
    "$ErrorActionPreference='Stop'",
    "$path=$env:CHAT2CODEX_ACL_PATH",
    "$acl=Get-Acl -LiteralPath $path",
    "$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$owner=([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "$aces=@($acl.Access | ForEach-Object { [pscustomobject]@{ identitySid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; accessControlType=$_.AccessControlType.ToString(); rights=[int64]$_.FileSystemRights; inherited=[bool]$_.IsInherited } })",
    "[pscustomobject]@{ownerSid=$owner;currentUserSid=$current;aces=$aces}|ConvertTo-Json -Depth 4 -Compress",
  ].join(";");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], {
    encoding: "utf8", env: { ...process.env, CHAT2CODEX_ACL_PATH: resolved }, maxBuffer: 128 * 1024, timeout: 10_000, windowsHide: true,
  });
  if (!stdout.trim() || stdout.length > 128 * 1024) throw new Error("Windows ACL output is missing or oversized.");
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("Windows ACL output is unparsable."); }
  return assertPrivateWindowsAcl(parsed);
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function exactKeys(value, allowed, label) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); const missing = allowed.filter((key) => !Object.hasOwn(value, key)); if (unknown.length) throw new Error(`Unknown ${label} field.`); if (missing.length) throw new Error(`Missing ${label} field.`); }
function sid(value, label) { if (typeof value !== "string" || !/^S-[0-9]+(?:-[0-9]+)+$/u.test(value)) throw new Error(`${label} is invalid.`); }
function samePath(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  inspectPrivateWindowsFile(process.argv[2]).then((result) => { process.stdout.write(`private Windows file accepted; aces=${result.aceCount}\n`); }).catch((error) => { process.stderr.write(`windows-private-file: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
