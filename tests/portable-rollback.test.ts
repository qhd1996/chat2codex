import { describe, expect, test } from "bun:test";

import {
  executePersonalPortableReinstall, executePersonalPortableRollback, executePersonalPortableUninstall,
  PersonalPortableTransactionError, type PersonalPortableReinstallIo, type PersonalPortableRollbackIo, type PersonalPortableUninstallIo,
} from "../src/setup/personal-portable.js";
import type { PortableReceiptV1, PortableUninstallManifestV1 } from "../src/setup/portable-receipt.js";

const home = "C:\\Users\\Alice\\AppData\\Local\\Chat2Codex";
const npmPrefix = home + "\\npm";
const oldHashes = { package: "1".repeat(64), config: "2".repeat(64), state: "3".repeat(64), task: "4".repeat(64) };
const candidateHashes = { package: "9".repeat(64), config: "8".repeat(64), state: "7".repeat(64), task: "6".repeat(64) };

describe("personal portable named rollback", () => {
  test("restores exact old package config state task and old doctor from a named receipt", async () => {
    const fixture = rollbackFixture();
    const result = await executePersonalPortableRollback("receipt-upgrade", fixture.io);
    expect(result.status).toBe("rolled_back");
    expect(result.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
    expect(fixture.events).toEqual(["read:receipt-upgrade", "assert_quiescent", "owned_hashes:candidate", "receipt:rolling_back", "stop_current_writer", "receipt:rolling_back", "restore_state", "receipt:rolling_back", "restore_configuration", "receipt:rolling_back", "restore_package", "receipt:rolling_back", "restore_windows_user_task", "receipt:rolling_back", "old_doctor", "receipt:rolling_back", "owned_hashes:old", "receipt:rolling_back", "receipt:rolled_back"]);
  });

  test("rejects drift obligations incompatible schema and a consumed receipt before mutation", async () => {
    for (const [change, code] of [
      [(fixture: ReturnType<typeof rollbackFixture>) => { fixture.currentHashes.package = "0".repeat(64); }, "PORTABLE_ROLLBACK_HASH_DRIFT"],
      [(fixture: ReturnType<typeof rollbackFixture>) => { fixture.failQuiescent = true; }, "PORTABLE_ROLLBACK_OBLIGATIONS_ACTIVE"],
      [(fixture: ReturnType<typeof rollbackFixture>) => { fixture.receipt = { schemaVersion: 999 } as never; }, "PORTABLE_ROLLBACK_RECEIPT_INVALID"],
      [(fixture: ReturnType<typeof rollbackFixture>) => { fixture.receipt.status = "rolled_back"; fixture.receipt.installedHashes = null; fixture.receipt.rollbackCompleted = ["verify_restored"]; }, "PORTABLE_ROLLBACK_RECEIPT_CONSUMED"],
    ] as const) {
      const fixture = rollbackFixture(); change(fixture);
      await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).rejects.toMatchObject({ code });
      expect(fixture.events.some((event) => /^(?:stop|restore|uninstall|receipt:)/u.test(event))).toBeFalse();
    }
  });

  test("fails closed when the restored old doctor is unhealthy", async () => {
    const fixture = rollbackFixture(); fixture.oldDoctorHealthy = false;
    await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).rejects.toMatchObject({ code: "PORTABLE_ROLLBACK_INCOMPLETE" });
    expect(fixture.receipts.at(-1)).toMatchObject({ status: "rollback_failed", rollbackFailures: ["old_doctor"] });
  });

  test("resumes an interrupted applying transaction without trusting partial candidate hashes", async () => {
    const fixture = rollbackFixture();
    fixture.receipt.status = "applying"; fixture.receipt.installedHashes = null; fixture.receipt.completed = ["backup_prior", "quiesce_service", "install_package", "configure"]; fixture.receipt.pendingStep = "migrate_state";
    fixture.currentHashes = { package: candidateHashes.package, config: candidateHashes.config, state: candidateHashes.state, task: oldHashes.task };
    await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).resolves.toMatchObject({ status: "rolled_back" });
    expect(fixture.events).not.toContain("owned_hashes:candidate");
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
  });

  test("resumes rolling-back and failed receipts from the first unconfirmed step", async () => {
    for (const status of ["rolling_back", "rollback_failed"] as const) {
      const fixture = rollbackFixture();
      fixture.receipt.status = status; fixture.receipt.installedHashes = null; fixture.receipt.rollbackCompleted = ["stop_current_writer", "restore_state"]; fixture.receipt.rollbackFailures = status === "rollback_failed" ? ["restore_configuration"] : [];
      fixture.currentHashes.state = oldHashes.state;
      await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).resolves.toMatchObject({ status: "rolled_back" });
      expect(fixture.events).not.toContain("stop_current_writer"); expect(fixture.events).not.toContain("restore_state");
      expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
    }
  });

  test("stops at the first rollback failure and normalizes a historical out-of-order resume", async () => {
    const fixture = rollbackFixture();
    let failOnce = true;
    fixture.io.restoreConfiguration = async () => { fixture.events.push("restore_configuration"); if (failOnce) { failOnce = false; throw new Error("synthetic failure"); } fixture.currentHashes.config = oldHashes.config; };
    await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).rejects.toMatchObject({ code: "PORTABLE_ROLLBACK_INCOMPLETE" });
    expect(fixture.events).not.toContain("restore_package");
    fixture.receipt = structuredClone(fixture.receipts.at(-1)!);
    await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).resolves.toMatchObject({ status: "rolled_back" });
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);

    const historical = rollbackFixture(); historical.receipt.status = "rollback_failed"; historical.receipt.installedHashes = null; historical.receipt.rollbackCompleted = ["stop_current_writer", "restore_state", "restore_package"]; historical.receipt.rollbackFailures = ["restore_configuration"]; historical.currentHashes.state = oldHashes.state; historical.currentHashes.package = oldHashes.package;
    await expect(executePersonalPortableRollback("receipt-upgrade", historical.io)).resolves.toMatchObject({ status: "rolled_back" });
    expect(historical.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
  });

  test("marks a pre-backup interruption aborted without running compensation", async () => {
    const fixture = rollbackFixture(); fixture.receipt.status = "applying"; fixture.receipt.backup = null; fixture.receipt.installedHashes = null; fixture.receipt.completed = []; fixture.receipt.pendingStep = "backup_prior";
    await expect(executePersonalPortableRollback("receipt-upgrade", fixture.io)).resolves.toMatchObject({ status: "aborted" });
    expect(fixture.events.some((event) => /^(?:assert|owned|stop|restore|uninstall|old_doctor)/u.test(event))).toBeFalse();
  });
});

describe("personal portable uninstall and reinstall", () => {
  test("uninstalls twice from manifest ownership only while preserving all user data", async () => {
    const manifest: PortableUninstallManifestV1 = { schemaVersion: 1, home, npmPrefix, ownedPackageFiles: [npmPrefix + "\\node_modules\\chat2codex\\dist\\index.js", npmPrefix + "\\chat2codex.cmd"] };
    const files = new Set([...manifest.ownedPackageFiles, home + "\\unknown.keep"]);
    const preserved = { state: "a".repeat(64), credentials: "b".repeat(64), deliverables: "c".repeat(64), backups: "d".repeat(64) };
    let installed = true;
    const io: PersonalPortableUninstallIo = {
      readUninstallManifest: async () => installed ? manifest : null, assertQuiescent: async () => undefined,
      uninstallWindowsUserTask: async () => ({ removed: installed }),
      removeOwnedFiles: async (paths) => { for (const file of paths) files.delete(file); installed = false; return paths.length; },
      preservedDataHashes: async () => ({ ...preserved }),
    };
    await expect(executePersonalPortableUninstall(io)).resolves.toEqual({ removed: true, serviceRemoved: true, removedFiles: 2, preservedDataHashes: preserved });
    await expect(executePersonalPortableUninstall(io)).resolves.toEqual({ removed: false, serviceRemoved: false, removedFiles: 0, preservedDataHashes: preserved });
    expect([...files]).toEqual([home + "\\unknown.keep"]);
  });

  test("rejects escaping or duplicate manifest ownership before deletion", async () => {
    for (const ownedPackageFiles of [["C:\\outside.txt"], [npmPrefix], [npmPrefix + "\\same", npmPrefix + "\\same"], [npmPrefix + "\\line\nfeed"]]) {
      let mutations = 0;
      const io: PersonalPortableUninstallIo = { readUninstallManifest: async () => ({ schemaVersion: 1, home, npmPrefix, ownedPackageFiles }), assertQuiescent: async () => { mutations += 1; }, uninstallWindowsUserTask: async () => { mutations += 1; return { removed: true }; }, removeOwnedFiles: async () => { mutations += 1; return 0; }, preservedDataHashes: async () => ({ state: null, credentials: null, deliverables: null, backups: null }) };
      await expect(executePersonalPortableUninstall(io)).rejects.toMatchObject({ code: "PORTABLE_UNINSTALL_MANIFEST_INVALID" });
      expect(mutations).toBe(0);
    }
  });

  test("fails closed when uninstall changes preserved user data", async () => {
    let reads = 0;
    const manifest: PortableUninstallManifestV1 = { schemaVersion: 1, home, npmPrefix, ownedPackageFiles: [npmPrefix + "\\node_modules\\chat2codex\\dist\\index.js"] };
    const io: PersonalPortableUninstallIo = {
      readUninstallManifest: async () => manifest, assertQuiescent: async () => undefined, uninstallWindowsUserTask: async () => ({ removed: true }), removeOwnedFiles: async () => 1,
      preservedDataHashes: async () => ({ state: (reads++ ? "f" : "a").repeat(64), credentials: "b".repeat(64), deliverables: "c".repeat(64), backups: "d".repeat(64) }),
    };
    await expect(executePersonalPortableUninstall(io)).rejects.toMatchObject({ code: "PORTABLE_UNINSTALL_DATA_DRIFT" });
  });

  test("fails closed when any manifest-owned package file remains", async () => {
    const manifest: PortableUninstallManifestV1 = { schemaVersion: 1, home, npmPrefix, ownedPackageFiles: [npmPrefix + "\\one", npmPrefix + "\\two"] };
    const io: PersonalPortableUninstallIo = { readUninstallManifest: async () => manifest, assertQuiescent: async () => undefined, uninstallWindowsUserTask: async () => ({ removed: true }), removeOwnedFiles: async () => 1, preservedDataHashes: async () => ({ state: null, credentials: null, deliverables: null, backups: null }) };
    await expect(executePersonalPortableUninstall(io)).rejects.toMatchObject({ code: "PORTABLE_UNINSTALL_RESIDUAL_OWNED_FILES" });
  });

  test("reinstall rotates all three distinct machine keys after data-preserving uninstall", async () => {
    const calls: string[] = [];
    let keys = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    const io: PersonalPortableReinstallIo = {
      keyFingerprints: async () => [...keys],
      uninstall: async () => { calls.push("uninstall"); return { removed: true }; },
      install: async () => { calls.push("install"); keys = ["d".repeat(64), "e".repeat(64), "f".repeat(64)]; },
    };
    await expect(executePersonalPortableReinstall(io)).resolves.toEqual({ rotatedKeyCount: 3 });
    expect(calls).toEqual(["uninstall", "install"]);
  });

  test("fails closed when reinstall preserves duplicates or any old key", async () => {
    for (const after of [["a".repeat(64), "d".repeat(64), "e".repeat(64)], ["d".repeat(64), "d".repeat(64), "e".repeat(64)]]) {
      let phase = 0;
      const io: PersonalPortableReinstallIo = { keyFingerprints: async () => phase ? after : ["a".repeat(64), "b".repeat(64), "c".repeat(64)], uninstall: async () => ({ removed: true }), install: async () => { phase = 1; } };
      await expect(executePersonalPortableReinstall(io)).rejects.toMatchObject({ code: "PORTABLE_REINSTALL_KEY_ROTATION_FAILED" });
    }
  });

  test("rejects an invalid old key inventory before uninstall", async () => {
    let mutations = 0;
    const io: PersonalPortableReinstallIo = { keyFingerprints: async () => ["a".repeat(64), "a".repeat(64), "b".repeat(64)], uninstall: async () => { mutations += 1; return { removed: true }; }, install: async () => { mutations += 1; } };
    await expect(executePersonalPortableReinstall(io)).rejects.toMatchObject({ code: "PORTABLE_REINSTALL_KEY_ROTATION_FAILED" });
    expect(mutations).toBe(0);
  });
});

function rollbackFixture() {
  const events: string[] = []; const receipts: PortableReceiptV1[] = [];
  const fixture = { events, receipts, receipt: committedReceipt(), currentHashes: { ...candidateHashes }, failQuiescent: false, oldDoctorHealthy: true } as { events: string[]; receipts: PortableReceiptV1[]; receipt: PortableReceiptV1; currentHashes: typeof candidateHashes; failQuiescent: boolean; oldDoctorHealthy: boolean; io: PersonalPortableRollbackIo };
  fixture.io = {
    readReceipt: async (id) => { events.push("read:" + id); return structuredClone(fixture.receipt); },
    assertQuiescent: async () => { events.push("assert_quiescent"); if (fixture.failQuiescent) throw new Error("active obligations"); },
    ownedHashes: async () => { const old = fixture.currentHashes.package === oldHashes.package; events.push("owned_hashes:" + (old ? "old" : "candidate")); return { ...fixture.currentHashes }; },
    writeReceipt: async (receipt) => { receipts.push(structuredClone(receipt)); events.push("receipt:" + receipt.status); },
    stopCurrentWriter: async () => { events.push("stop_current_writer"); }, restoreState: async () => { events.push("restore_state"); fixture.currentHashes.state = oldHashes.state; },
    restoreConfiguration: async () => { events.push("restore_configuration"); fixture.currentHashes.config = oldHashes.config; }, restorePackage: async () => { events.push("restore_package"); fixture.currentHashes.package = oldHashes.package; },
    restoreWindowsUserTask: async () => { events.push("restore_windows_user_task"); fixture.currentHashes.task = oldHashes.task; }, uninstallWindowsUserTask: async () => { events.push("uninstall_windows_user_task"); fixture.currentHashes.task = null as never; },
    oldDoctor: async () => { events.push("old_doctor"); return fixture.oldDoctorHealthy; },
  };
  return fixture;
}

function committedReceipt(): PortableReceiptV1 {
  return { schemaVersion: 1, receiptId: "receipt-upgrade", action: "upgrade", status: "committed", archiveSha256: "f".repeat(64), home, npmPrefix, receiptRoot: home + "\\receipts", createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:01:00.000Z", prerequisites: { windowsVersion: "11", architecture: "x64", powershellVersion: "5.1", nodeVersion: "24.14.0", npmVersion: "11.0.0", codexCliVersion: "0.146.0", desktopVersion: null }, backup: { backupId: "backup-old", hashes: { ...oldHashes } }, installedHashes: { ...candidateHashes }, pendingStep: null, completed: ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service", "doctor"], rollbackCompleted: [], rollbackFailures: [] };
}
