import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { assertPrivateWindowsAcl, inspectPrivateWindowsFile } from "../scripts/assert-private-windows-file.mjs";

const user = "S-1-5-21-1000-1000-1000-1001";
const system = "S-1-5-18";
const administrators = "S-1-5-32-544";
const allow = (identitySid: string, rights = 0x1f01ff, inherited = false) => ({ identitySid, accessControlType: "Allow", rights, inherited });

describe("Windows private-file ACL policy", () => {
  test("accepts only the current owner, SYSTEM, and Administrators", () => {
    expect(assertPrivateWindowsAcl({ ownerSid: user, currentUserSid: user, aces: [allow(user), allow(system), allow(administrators)] })).toEqual({ ownerSid: user, aceCount: 3 });
  });

  for (const [name, value, pattern] of [
    ["Everyone", { ownerSid: user, currentUserSid: user, aces: [allow(user), allow("S-1-1-0", 0x120089, true)] }, /broad|unexpected.*principal/i],
    ["Authenticated Users", { ownerSid: user, currentUserSid: user, aces: [allow(user), allow("S-1-5-11", 0x120089)] }, /broad|unexpected.*principal/i],
    ["Builtin Users", { ownerSid: user, currentUserSid: user, aces: [allow(user), allow("S-1-5-32-545", 0x120089)] }, /broad|unexpected.*principal/i],
    ["unknown SID", { ownerSid: user, currentUserSid: user, aces: [allow(user), allow("S-1-5-21-9-9-9-9", 0x120089)] }, /unexpected.*principal/i],
    ["deny ambiguity", { ownerSid: user, currentUserSid: user, aces: [allow(user), { ...allow(system), accessControlType: "Deny" }] }, /deny|access control type/i],
    ["wrong owner", { ownerSid: administrators, currentUserSid: user, aces: [allow(user)] }, /owner/i],
    ["missing owner", { ownerSid: "", currentUserSid: user, aces: [allow(user)] }, /owner/i],
    ["malformed rights", { ownerSid: user, currentUserSid: user, aces: [allow(user, -1)] }, /rights/i],
    ["unparsable ACL", { ownerSid: user, currentUserSid: user, aces: "bad" }, /ACL|aces/i],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => assertPrivateWindowsAcl(value)).toThrow(pattern);
    });
  }
});

const nativeTest = process.platform === "win32" ? test : test.skip;

nativeTest("reads a disposable private file without mutating its ACL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-private-acl-"));
  const file = path.join(root, "token.key");
  try {
    await writeFile(file, "test-key");
    setDisposableAcl(file, false);
    const before = aclSddl(file);
    await expect(inspectPrivateWindowsFile(file)).resolves.toMatchObject({ aceCount: expect.any(Number) });
    expect(aclSddl(file)).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

nativeTest("rejects a disposable file with broad read access", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-broad-acl-"));
  const file = path.join(root, "token.key");
  try {
    await writeFile(file, "test-key");
    setDisposableAcl(file, true);
    await expect(inspectPrivateWindowsFile(file)).rejects.toThrow(/broad|unexpected.*principal/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function setDisposableAcl(file: string, broadRead: boolean) {
  const command = [
    `$path=$env:CHAT2CODEX_TEST_ACL_PATH`,
    `$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User`,
    `$acl=New-Object System.Security.AccessControl.FileSecurity`,
    `$acl.SetOwner($user)`,
    `$acl.SetAccessRuleProtection($true,$false)`,
    `$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($user,'FullControl','Allow')`,
    `$acl.AddAccessRule($rule)`,
    broadRead ? `$everyone=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone,'Read','Allow')))` : "",
    `Set-Acl -LiteralPath $path -AclObject $acl`,
  ].filter(Boolean).join(";");
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], { env: { ...process.env, CHAT2CODEX_TEST_ACL_PATH: file }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function aclSddl(file: string): string {
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `(Get-Acl -LiteralPath $env:CHAT2CODEX_TEST_ACL_PATH).Sddl`], { env: { ...process.env, CHAT2CODEX_TEST_ACL_PATH: file }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
