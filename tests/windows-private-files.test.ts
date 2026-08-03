import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { applyOwnerOnlyWindowsAcl, applyOwnerOnlyWindowsDirectoryAcl, canonicalizeWindowsGatewayKeyRoot, createOwnerOnlyWindowsFile, ensureWindowsGatewayKeys, gatewayKeyRoles } from "../src/setup/windows-private-files.js";
import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../src/desktop-gateway/server.js";

describe("Windows Gateway private files", () => {
  const windowsTest = process.platform === "win32" ? test : test.skip;

  windowsTest("applies a protected owner-only DACL to a directory without changing its owner", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chat2codex-directory-acl-"));
    const directory = path.join(parent, "keys");
    try {
      await (await import("node:fs/promises")).mkdir(directory);
      await expect(applyOwnerOnlyWindowsDirectoryAcl(directory)).resolves.toBeUndefined();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  windowsTest("atomically creates a current-user owner-only file without exposing content through argv or env", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chat2codex-atomic-key-"));
    const file = path.join(parent, "key.txt");
    const secret = "atomic-secret-canary-" + Date.now() + "\n";
    try {
      await createOwnerOnlyWindowsFile(file, secret);
      expect(await readFile(file, "utf8")).toBe(secret);
      const report = await inspectWindowsTokenAcl(file);
      expect(() => requireOwnerOnlyWindowsTokenAcl(report)).not.toThrow();
      expect(report.ownerSid).toBe(report.currentUserSid);
      expect(JSON.stringify(process.argv)).not.toContain(secret.trim());
      expect(JSON.stringify(process.env)).not.toContain(secret.trim());
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  windowsTest("never overwrites a preexisting file during owner-only creation", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chat2codex-atomic-existing-"));
    const file = path.join(parent, "key.txt");
    try {
      await writeFile(file, "preserve-me\n");
      const error = await createOwnerOnlyWindowsFile(file, "replacement\n").then(() => null, (value) => value);
      expect(error?.failureDetail).toMatchObject({ stage: "file_create_create", exceptionType: expect.any(String) });
      expect(await readFile(file, "utf8")).toBe("preserve-me\n");
      expect(JSON.stringify(error?.failureDetail)).not.toContain(file);
      expect(JSON.stringify(error?.failureDetail)).not.toContain("replacement");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  windowsTest("returns bounded redacted directory ACL diagnostics across the PowerShell boundary", async () => {
    const missing = path.join(os.tmpdir(), "chat2codex-private-S-1-5-21-123456789-token-secret", "missing");
    let failure: any;
    try { await applyOwnerOnlyWindowsDirectoryAcl(missing); } catch (error) { failure = error; }
    expect(failure?.name).toBe("WindowsAclApplicationError");
    expect(failure?.failureDetail).toMatchObject({
      stage: "directory_acl_owner_read",
      exitCode: 86,
      signal: null,
      exceptionType: expect.any(String),
      hResult: expect.any(Number),
      fullyQualifiedErrorId: expect.any(String),
      category: expect.any(String),
      stderrTail: expect.any(Array),
      stdoutTail: expect.any(Array),
    });
    const serialized = JSON.stringify(failure.failureDetail);
    expect(serialized.length).toBeLessThanOrEqual(4096);
    expect(serialized).not.toContain(missing);
    expect(serialized).not.toContain("S-1-5-21-123456789");
    expect(serialized).not.toContain("token-secret");
  });

  windowsTest("returns bounded redacted file ACL diagnostics across the PowerShell boundary", async () => {
    const missing = path.join(os.tmpdir(), "chat2codex-file-S-1-5-21-123456789-token-secret.key");
    let failure: any;
    try { await applyOwnerOnlyWindowsAcl(missing); } catch (error) { failure = error; }
    expect(failure?.name).toBe("WindowsAclApplicationError");
    expect(failure?.failureDetail).toMatchObject({ stage: "file_acl_owner_read", exitCode: 86, exceptionType: expect.any(String), fullyQualifiedErrorId: expect.any(String) });
    const serialized = JSON.stringify(failure.failureDetail);
    expect(serialized).not.toContain(missing);
    expect(serialized).not.toContain("S-1-5-21-123456789");
    expect(serialized).not.toContain("token-secret");
  });

  test("accepts a Windows temp alias when it resolves to the requested key root", () => {
    expect(canonicalizeWindowsGatewayKeyRoot("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\keys", "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\keys", "win32")).toBe("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\keys");
  });

  test("rejects a key root below an explicit directory junction", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chat2codex-key-root-junction-"));
    const target = path.join(parent, "target");
    const alias = path.join(parent, "alias");
    try {
      await writeFile(path.join(parent, "placeholder"), "x");
      await (await import("node:fs/promises")).mkdir(target);
      await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
      await expect(ensureWindowsGatewayKeys({ root: path.join(alias, "keys"), applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {}, inspectAcl: async () => ({}) })).rejects.toThrow(/symbolic|reparse|symlink/i);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test("creates three distinct bounded keys and verifies every ACL", async () => {
    await withRoot(async (root) => {
      let sequence = 0;
      const aclApplied: string[] = [];
      const inspected: string[] = [];
      const rootApplied: string[] = [];
      const rootInspected: string[] = [];
      const result = await ensureWindowsGatewayKeys({
        root,
        randomBytes: (size) => Buffer.alloc(size, ++sequence),
        applyRootAcl: async (file) => { rootApplied.push(file); },
        inspectRootAcl: async (file) => { rootInspected.push(file); return { ownerSid: "S-1-test" }; },
        applyAcl: async (file) => { aclApplied.push(file); },
        inspectAcl: async (file) => { inspected.push(file); return { ownerSid: "S-1-test" }; },
      });
      expect(result.created).toHaveLength(3);
      expect(result.preserved).toEqual([]);
      expect(Object.keys(result.paths).sort()).toEqual([...gatewayKeyRoles].sort());
      expect(aclApplied).toEqual(result.created);
      expect(inspected).toEqual(result.created);
      expect(rootApplied).toEqual([root]);
      expect(rootInspected).toEqual([root]);
      const values = await Promise.all(Object.values(result.paths).map((file) => readFile(file, "utf8")));
      expect(new Set(values).size).toBe(3);
      for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}\n$/u);
      expect(JSON.stringify(result)).not.toContain(values[0]!.trim());
    });
  });

  test("preserves valid existing keys and never reapplies their ACL", async () => {
    await withRoot(async (root) => {
      const first = await ensureWindowsGatewayKeys({ root, applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {}, inspectAcl: async () => ({}) });
      const before = await Promise.all(Object.values(first.paths).map((file) => readFile(file, "utf8")));
      let randomCalls = 0;
      const second = await ensureWindowsGatewayKeys({
        root, randomBytes: (size) => { randomCalls += 1; return Buffer.alloc(size, 9); }, applyRootAcl: async () => {}, inspectRootAcl: async () => ({}),
        applyAcl: async () => { throw new Error("must not rewrite existing ACL"); },
        inspectAcl: async () => ({}),
      });
      expect(second.created).toEqual([]);
      expect(second.preserved).toHaveLength(3);
      expect(randomCalls).toBe(0);
      expect(await Promise.all(Object.values(second.paths).map((file) => readFile(file, "utf8")))).toEqual(before);
    });
  });

  test("fails closed for malformed, duplicate, or symlinked existing keys", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "prompt-hook.key"), "bad\n");
      await expect(ensureWindowsGatewayKeys({ root, applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {}, inspectAcl: async () => ({}) })).rejects.toThrow(/256-bit|base64url/i);
    });
    await withRoot(async (root) => {
      const same = Buffer.alloc(32, 1).toString("base64url") + "\n";
      await writeFile(path.join(root, "prompt-hook.key"), same);
      await writeFile(path.join(root, "stop-hook.key"), same);
      await expect(ensureWindowsGatewayKeys({ root, applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {}, inspectAcl: async () => ({}) })).rejects.toThrow(/duplicate/i);
    });
    await withRoot(async (root) => {
      const target = path.join(root, "target.key");
      await writeFile(target, Buffer.alloc(32, 2).toString("base64url") + "\n");
      try {
        await symlink(target, path.join(root, "prompt-hook.key"));
        await expect(ensureWindowsGatewayKeys({ root, applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {}, inspectAcl: async () => ({}) })).rejects.toThrow(/symbolic|symlink/i);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EPERM")) throw error;
      }
    });
  });

  test("removes every newly created key after ACL verification failure", async () => {
    await withRoot(async (root) => {
      await expect(ensureWindowsGatewayKeys({
        root, randomBytes: (size) => Buffer.alloc(size, 3), applyRootAcl: async () => {}, inspectRootAcl: async () => ({}), applyAcl: async () => {},
        inspectAcl: async () => { throw new Error("broad ACL"); },
      })).rejects.toThrow(/broad ACL/i);
      for (const role of gatewayKeyRoles) await expect(readFile(path.join(root, `${role}.key`))).rejects.toThrow();
    });
  });
});

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-windows-keys-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
