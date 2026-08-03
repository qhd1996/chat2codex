import { describe, expect, test } from "bun:test";

import { composePersonalPortableInstallIo, executePersonalPortableInstall, PersonalPortableTransactionError, type PersonalPortableInstallIo } from "../src/setup/personal-portable.js";
import { parsePortableReceipt, serializePortableReceipt, type PortableReceiptV1 } from "../src/setup/portable-receipt.js";

const plan = {
  action: "install" as const, archivePath: "C:\\transfer\\candidate.tgz", archiveSha256: "a".repeat(64),
  home: "C:\\Users\\Alice\\AppData\\Local\\Chat2Codex", npmPrefix: "C:\\Users\\Alice\\AppData\\Local\\Chat2Codex\\npm",
  receiptRoot: "C:\\Users\\Alice\\AppData\\Local\\Chat2Codex\\receipts", preserveUserData: true, dryRun: false,
};

describe("personal portable install transaction", () => {
  test("commits the reviewed archive through backup package config service and doctor", async () => {
    const fixture = transactionFixture();
    const result = await executePersonalPortableInstall(plan, fixture.io);
    expect(result.status).toBe("committed");
    expect(result.installedHashes).toEqual({ package: "9".repeat(64), config: "8".repeat(64), state: "7".repeat(64), task: "6".repeat(64) });
    expect(result.completed).toEqual(["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service", "doctor"]);
    expect(fixture.events).toEqual([
      "archive_hash", "prerequisite_snapshot", "assert_quiescent", "receipt:prepared",
      "receipt:applying:pending:backup_prior", "backup_prior", "receipt:applying:backup_prior",
      "receipt:applying:pending:quiesce_service", "quiesce_windows_user_task", "receipt:applying:quiesce_service",
      "receipt:applying:pending:install_package", "install_package", "receipt:applying:install_package",
      "receipt:applying:pending:configure", "configure", "receipt:applying:configure",
      "receipt:applying:pending:migrate_state", "migrate_state", "receipt:applying:migrate_state",
      "receipt:applying:pending:install_service", "install_windows_user_task", "receipt:applying:install_service",
      "receipt:applying:pending:start_service", "start_windows_user_task", "receipt:applying:start_service",
      "receipt:applying:pending:doctor", "doctor", "receipt:applying:doctor", "installed_hashes", "receipt:committed",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/token|prompt|message|weixin|secret/i);
  });

  test("rejects archive drift before receipt or mutation", async () => {
    const fixture = transactionFixture({ archiveHash: "b".repeat(64) });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_ARCHIVE_HASH_MISMATCH" });
    expect(fixture.events).toEqual(["archive_hash"]);
  });

  test("records an aborted transaction when the backup cannot be completed", async () => {
    const fixture = transactionFixture({ failAt: "backup_prior" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ABORTED" });
    expect(fixture.receipts.at(-1)).toMatchObject({ status: "aborted", backup: null, pendingStep: null, completed: [], rollbackCompleted: [], rollbackFailures: [] });
    expect(fixture.events).not.toContain("install_package");
  });

  for (const [failure, completed, rollback] of [
    ["quiesce_windows_user_task", ["backup_prior"], ["stop_current_writer", "restore_windows_user_task", "verify_restored"]],
    ["install_package", ["backup_prior", "quiesce_service"], ["stop_current_writer", "restore_package", "restore_windows_user_task", "verify_restored"]],
    ["configure", ["backup_prior", "quiesce_service", "install_package"], ["stop_current_writer", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]],
    ["migrate_state", ["backup_prior", "quiesce_service", "install_package", "configure"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]],
    ["install_windows_user_task", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]],
    ["start_windows_user_task", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]],
    ["doctor", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]],
  ] as const) {
    test("rolls back after " + failure + " fails", async () => {
      const fixture = transactionFixture({ failAt: failure });
      try { await executePersonalPortableInstall(plan, fixture.io); throw new Error("unexpected pass"); }
      catch (error) {
        expect(error).toBeInstanceOf(PersonalPortableTransactionError);
        expect((error as PersonalPortableTransactionError).code).toBe("PORTABLE_TRANSACTION_ROLLED_BACK");
      }
      const final = fixture.receipts.at(-1)!;
      expect(final.status).toBe("rolled_back");
      expect(final.completed).toEqual(completed);
      expect(final.rollbackCompleted).toEqual(rollback);
      const rollbackEvents = fixture.events.filter((event) => rollback.includes(event as never));
      expect(rollbackEvents).toEqual(rollback);
    });
  }

  test("fails closed when rollback is incomplete", async () => {
    const fixture = transactionFixture({ failAt: "doctor", rollbackFailAt: "restore_configuration" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_ROLLBACK_INCOMPLETE" });
    expect(fixture.receipts.at(-1)).toMatchObject({ status: "rollback_failed", rollbackFailures: ["restore_configuration"] });
  });

  test("fails closed when rollback calls succeed but restored hashes drift", async () => {
    const fixture = transactionFixture({ failAt: "doctor", restoredHashDrift: true });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_ROLLBACK_INCOMPLETE" });
    expect(fixture.receipts.at(-1)).toMatchObject({ status: "rollback_failed", rollbackFailures: ["verify_restored"] });
  });

  test("compensates a service that succeeded before its completion receipt failed", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:applying:install_service" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "verify_restored"]);
  });

  test("clears candidate hashes before rollback when the committed receipt write fails", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:committed" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.receipts.filter((receipt) => receipt.status === "rolling_back").every((receipt) => receipt.installedHashes === null)).toBeTrue();
  });

  test("does not compensate an operation whose pending intent could not be written", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:applying:pending:install_package" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.events).not.toContain("install_package");
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_windows_user_task", "verify_restored"]);
  });

  test("does not create an old task while rolling back a fresh install", async () => {
    const fixture = transactionFixture({ failAt: "doctor", freshInstall: true });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "uninstall_windows_user_task", "restore_state", "restore_configuration", "restore_package", "verify_restored"]);
    expect(fixture.events).not.toContain("restore_windows_user_task");
  });

  test("retains the internal cause without exposing it in the stable message", async () => {
    const fixture = transactionFixture({ failAt: "configure" });
    try {
      await executePersonalPortableInstall(plan, fixture.io);
      throw new Error("unexpected pass");
    } catch (error) {
      expect(error).toBeInstanceOf(PersonalPortableTransactionError);
      expect((error as PersonalPortableTransactionError).cause).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Portable transaction failed and was rolled back.");
      expect((error as Error).message).not.toContain("synthetic failure");
    }
  });

  test("fails before the receipt and mutation when prerequisites or obligations are unsafe", async () => {
    for (const failAt of ["prerequisite_snapshot", "assert_quiescent"]) {
      const fixture = transactionFixture({ failAt });
      await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toBeInstanceOf(Error);
      expect(fixture.receipts).toHaveLength(0);
    expect(fixture.events.some((event) => ["backup_prior", "quiesce_windows_user_task", "install_package", "configure", "migrate_state", "install_windows_user_task", "start_windows_user_task"].includes(event))).toBeFalse();
    }
  });
});

describe("portable receipt", () => {
  test("round trips an exact secret-free schema", () => {
    const receipt: PortableReceiptV1 = {
      schemaVersion: 1, receiptId: "receipt-1", action: "upgrade", status: "prepared",
      archiveSha256: "a".repeat(64), home: plan.home, npmPrefix: plan.npmPrefix, receiptRoot: plan.receiptRoot,
      createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z",
      prerequisites: { windowsVersion: "11", architecture: "x64", powershellVersion: "5.1", nodeVersion: "24.14.0", npmVersion: "11.0.0", codexCliVersion: "0.146.0", desktopVersion: null },
      backup: null, installedHashes: null, pendingStep: null, completed: [], rollbackCompleted: [], rollbackFailures: [],
    };
    const source = serializePortableReceipt(receipt);
    expect(parsePortableReceipt(JSON.parse(source))).toEqual(receipt);
    expect(source).not.toMatch(/token|prompt|message|weixin|secret/i);
    expect(() => parsePortableReceipt({ ...receipt, token: "bad" })).toThrow(/unknown/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "committed", completed: ["backup_prior"] })).toThrow(/status|completed|sequence|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, completed: ["configure", "install_package"] })).toThrow(/sequence/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rolled_back", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null } }, completed: ["backup_prior"], rollbackCompleted: [] })).toThrow(/rollback|verify|restor|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rolled_back", rollbackCompleted: ["verify_restored"] })).toThrow(/backup|rollback|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rollback_failed", rollbackFailures: ["verify_restored"] })).toThrow(/backup|rollback|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, receiptRoot: receipt.receiptRoot + "\n" })).toThrow(/path/i);
    const committed = { ...receipt, status: "committed", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null } }, installedHashes: { package: null, config: "a".repeat(64), state: "b".repeat(64), task: "c".repeat(64) }, completed: ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service", "doctor"] };
    expect(() => parsePortableReceipt(committed)).toThrow(/installed|hash|committed/i);
    expect(() => parsePortableReceipt({ ...committed, status: "rolling_back" })).toThrow(/installed|hash|rollback/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rollback_failed", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null } }, completed: ["backup_prior"], rollbackCompleted: ["restore_package", "restore_state"], rollbackFailures: ["verify_restored"] })).toThrow(/sequence/i);
  });
});

describe("personal portable existing-core composition", () => {
  test("delegates service state migration and doctor to the existing core boundaries", async () => {
    const fixture = transactionFixture();
    const calls: string[] = [];
    const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\npm\\node_modules\\chat2codex\\dist\\index.js", statePath: plan.home + "\\state.json" } as never;
    const serviceIo = { countWriters: async () => { calls.push("countWriters"); return 0; }, startAndVerifyTask: async () => { calls.push("startAndVerifyTask"); } } as never;
    const io = composePersonalPortableInstallIo({
      ...fixture.io,
      restoreWindowsUserTask: async () => { calls.push("restoreWindowsUserTask"); },
      serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test",
    }, {
      installWindowsUserTask: async () => { calls.push("installWindowsUserTask"); return { taskPath: "\\Chat2Codex\\Chat2Codex" } as never; },
      uninstallWindowsUserTask: async () => { calls.push("uninstallWindowsUserTask"); return { removed: true }; },
      createStateStore: () => ({ load: async () => { calls.push("state.load"); return { migrated: true } as never; }, save: async () => { calls.push("state.save"); } }),
      inspectInstalledWindowsDistribution: async () => { calls.push("inspectInstalledWindowsDistribution"); return { manifest: {} } as never; },
      diagnoseWindowsDistribution: () => { calls.push("diagnoseWindowsDistribution"); return [{ status: "ok" }] as never; },
    });
    await io.migrateState(); await io.installWindowsUserTask(); await io.startWindowsUserTask(); expect(await io.doctor()).toBeTrue();
    await io.uninstallWindowsUserTask(); await io.restoreWindowsUserTask();
    expect(calls).toEqual(["state.load", "state.save", "installWindowsUserTask", "countWriters", "startAndVerifyTask", "inspectInstalledWindowsDistribution", "diagnoseWindowsDistribution", "uninstallWindowsUserTask", "restoreWindowsUserTask"]);
  });

  test("does not start a second writer and rejects an ambiguous writer count", async () => {
    const fixture = transactionFixture();
    for (const [writers, starts, rejected] of [[1, 0, false], [2, 0, true]] as const) {
      let startCalls = 0;
      const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\entry.js", statePath: plan.home + "\\state.json" } as never;
      const serviceIo = { countWriters: async () => writers, startAndVerifyTask: async () => { startCalls += 1; } } as never;
      const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
        installWindowsUserTask: async () => ({ taskPath: "\\Chat2Codex\\Chat2Codex" } as never), uninstallWindowsUserTask: async () => ({ removed: true }),
        createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
        inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [] as never,
      });
      await io.installWindowsUserTask();
      if (rejected) await expect(io.startWindowsUserTask()).rejects.toThrow(/writer/i); else await expect(io.startWindowsUserTask()).resolves.toBeUndefined();
      expect(startCalls).toBe(starts);
    }
  });

  test("doctor fails closed for absent inspection or any error check", async () => {
    const fixture = transactionFixture();
    for (const [snapshot, checks] of [[null, []], [{ manifest: {} }, [{ status: "error" }]]] as const) {
      const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput: {} as never, serviceIo: {} as never, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
        installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }),
        createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
        inspectInstalledWindowsDistribution: async () => snapshot as never, diagnoseWindowsDistribution: () => checks as never,
      });
      expect(await io.doctor()).toBeFalse();
    }
  });
});

function transactionFixture(options: { archiveHash?: string; failAt?: string; rollbackFailAt?: string; restoredHashDrift?: boolean; receiptFailAt?: string; freshInstall?: boolean } = {}) {
  const events: string[] = [];
  const receipts: PortableReceiptV1[] = [];
  let receiptFailureTriggered = false;
  const step = async (name: string) => { events.push(name); if (options.failAt === name || options.rollbackFailAt === name) throw new Error("synthetic failure"); };
  const io: PersonalPortableInstallIo = {
    now: () => new Date("2026-08-04T00:00:00.000Z"), receiptId: () => "receipt-1",
    archiveSha256: async () => { events.push("archive_hash"); return options.archiveHash ?? "a".repeat(64); },
    prerequisiteSnapshot: async () => { await step("prerequisite_snapshot"); return { windowsVersion: "11", architecture: "x64", powershellVersion: "5.1", nodeVersion: "24.14.0", npmVersion: "11.0.0", codexCliVersion: "0.146.0", desktopVersion: null }; },
    assertQuiescent: async () => await step("assert_quiescent"),
    writeReceipt: async (receipt) => { parsePortableReceipt(receipt); const event = "receipt:" + receipt.status + (receipt.status === "applying" ? receipt.pendingStep ? ":pending:" + receipt.pendingStep : ":" + receipt.completed.at(-1) : ""); receipts.push(structuredClone(receipt)); events.push(event); if (!receiptFailureTriggered && options.receiptFailAt === event) { receiptFailureTriggered = true; throw new Error("synthetic receipt failure"); } },
    backupPrior: async () => { await step("backup_prior"); return { backupId: "backup-1", hashes: options.freshInstall ? { package: null, config: null, state: null, task: null } : { package: "b".repeat(64), config: "c".repeat(64), state: "d".repeat(64), task: "e".repeat(64) } }; },
    installPackage: async () => await step("install_package"), configure: async () => await step("configure"), migrateState: async () => await step("migrate_state"),
    installWindowsUserTask: async () => await step("install_windows_user_task"), startWindowsUserTask: async () => await step("start_windows_user_task"), doctor: async () => { await step("doctor"); return true; },
    quiesceWindowsUserTask: async () => await step("quiesce_windows_user_task"), stopCurrentWriter: async () => await step("stop_current_writer"), uninstallWindowsUserTask: async () => await step("uninstall_windows_user_task"), restoreState: async () => await step("restore_state"),
    restoreConfiguration: async () => await step("restore_configuration"), restorePackage: async () => await step("restore_package"),
    restoreWindowsUserTask: async () => await step("restore_windows_user_task"),
    ownedHashes: async () => {
      if (!options.failAt && !options.receiptFailAt) { events.push("installed_hashes"); return { package: "9".repeat(64), config: "8".repeat(64), state: "7".repeat(64), task: "6".repeat(64) }; }
      events.push("verify_restored");
      if (options.freshInstall) return { package: null, config: null, state: null, task: null };
      return options.restoredHashDrift
        ? { package: "f".repeat(64), config: "c".repeat(64), state: "d".repeat(64), task: "e".repeat(64) }
        : { package: "b".repeat(64), config: "c".repeat(64), state: "d".repeat(64), task: "e".repeat(64) };
    },
  };
  return { io, events, receipts };
}
