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

  test("finishes an offline install as awaiting_setup without claiming start or doctor", async () => {
    const fixture = transactionFixture({ freshInstall: true });
    const result = await executePersonalPortableInstall(plan, fixture.io);
    expect(result.status).toBe("awaiting_setup");
    expect(result.completed).toEqual(["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service"]);
    expect(result.installedHashes).toEqual({ package: "9".repeat(64), config: "8".repeat(64), state: "7".repeat(64), task: "6".repeat(64) });
    expect(fixture.events).not.toContain("start_windows_user_task");
    expect(fixture.events).not.toContain("doctor");
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
    ["quiesce_windows_user_task", ["backup_prior"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["install_package", ["backup_prior", "quiesce_service"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["configure", ["backup_prior", "quiesce_service", "install_package"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["migrate_state", ["backup_prior", "quiesce_service", "install_package", "configure"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["install_windows_user_task", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["start_windows_user_task", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
    ["doctor", ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service"], ["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]],
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
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
  });

  test("restores an online prior task when the completed backup receipt write fails", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:applying:backup_prior" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.events).not.toContain("quiesce_windows_user_task");
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
  });

  test("conservatively restores every owned surface after any post-backup failure", async () => {
    const fixture = transactionFixture({ failAt: "quiesce_windows_user_task" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
  });

  test("clears candidate hashes before rollback when the committed receipt write fails", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:committed" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.receipts.filter((receipt) => receipt.status === "rolling_back").every((receipt) => receipt.installedHashes === null)).toBeTrue();
  });

  test("continues compensation when one rollback receipt write fails transiently", async () => {
    const fixture = transactionFixture({ failAt: "doctor", receiptFailAt: "receipt:rolling_back" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.events).toContain("restore_state");
    expect(fixture.events).toContain("restore_configuration");
    expect(fixture.events).toContain("restore_package");
    expect(fixture.receipts.at(-1)).toMatchObject({ status: "rolled_back", rollbackFailures: [] });
  });

  test("does not compensate an operation whose pending intent could not be written", async () => {
    const fixture = transactionFixture({ receiptFailAt: "receipt:applying:pending:install_package" });
    await expect(executePersonalPortableInstall(plan, fixture.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK" });
    expect(fixture.events).not.toContain("install_package");
    expect(fixture.receipts.at(-1)?.rollbackCompleted).toEqual(["stop_current_writer", "restore_state", "restore_configuration", "restore_package", "restore_windows_user_task", "old_doctor", "verify_restored"]);
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
    expect(() => parsePortableReceipt({ ...receipt, status: "rolled_back", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null }, wasOnline: false }, completed: ["backup_prior"], rollbackCompleted: [] })).toThrow(/rollback|verify|restor|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rolled_back", rollbackCompleted: ["verify_restored"] })).toThrow(/backup|rollback|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rollback_failed", rollbackFailures: ["verify_restored"] })).toThrow(/backup|rollback|inconsistent/i);
    expect(() => parsePortableReceipt({ ...receipt, receiptRoot: receipt.receiptRoot + "\n" })).toThrow(/path/i);
    const committed = { ...receipt, status: "committed", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null }, wasOnline: false }, installedHashes: { package: null, config: "a".repeat(64), state: "b".repeat(64), task: "c".repeat(64) }, completed: ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service", "start_service", "doctor"] };
    expect(() => parsePortableReceipt(committed)).toThrow(/installed|hash|committed/i);
    expect(() => parsePortableReceipt({ ...committed, status: "rolling_back" })).toThrow(/installed|hash|rollback/i);
    expect(() => parsePortableReceipt({ ...receipt, status: "rollback_failed", backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null }, wasOnline: false }, completed: ["backup_prior"], rollbackCompleted: ["restore_package", "restore_state"], rollbackFailures: ["verify_restored"] })).toThrow(/sequence/i);
    expect(() => parsePortableReceipt({ ...committed, backup: { backupId: "backup-1", hashes: { package: null, config: null, state: null, task: null } } })).toThrow(/online|backup|missing/i);
    const awaitingSetup = { ...committed, status: "awaiting_setup", installedHashes: { package: "d".repeat(64), config: "a".repeat(64), state: "b".repeat(64), task: "c".repeat(64) }, completed: ["backup_prior", "quiesce_service", "install_package", "configure", "migrate_state", "install_service"] };
    expect(parsePortableReceipt(awaitingSetup)).toMatchObject({ status: "awaiting_setup", completed: awaitingSetup.completed });
    expect(() => parsePortableReceipt({ ...awaitingSetup, completed: [...awaitingSetup.completed, "start_service"] })).toThrow(/awaiting|setup|state|inconsistent/i);
  });
});

describe("personal portable existing-core composition", () => {
  test("delegates service state migration and doctor to the existing core boundaries", async () => {
    const fixture = transactionFixture();
    const calls: string[] = [];
    const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\npm\\node_modules\\chat2codex\\dist\\index.js", statePath: plan.home + "\\state.json" } as never;
    const serviceIo = { stopWriters: async () => { calls.push("stopWriters"); return 1; }, countWriters: async () => { calls.push("countWriters"); return 0; }, startAndVerifyTask: async () => { calls.push("startAndVerifyTask"); } } as never;
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
    await io.quiesceWindowsUserTask(); await io.migrateState(); await io.installWindowsUserTask(); await io.startWindowsUserTask(); expect(await io.doctor()).toBeTrue();
    await io.uninstallWindowsUserTask(); await io.restoreWindowsUserTask();
    expect(calls).toEqual(["stopWriters", "state.load", "state.save", "installWindowsUserTask", "countWriters", "startAndVerifyTask", "inspectInstalledWindowsDistribution", "diagnoseWindowsDistribution", "uninstallWindowsUserTask", "restoreWindowsUserTask"]);
  });

  test("runs doctor against the installed package root derived from the managed entrypoint", async () => {
    const fixture = transactionFixture();
    const installedRoot = plan.npmPrefix + "\\node_modules\\chat2codex";
    const serviceInput = { home: plan.home, entrypoint: installedRoot + "\\dist\\index.js" } as never;
    let observedRoot: string | undefined;
    const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo: { stopWriters: async () => 0 } as never, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
      installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
      inspectInstalledWindowsDistribution: async (_home, root) => { observedRoot = root; return { manifest: {} } as never; }, diagnoseWindowsDistribution: () => [] as never,
    });
    expect(await io.doctor()).toBeTrue();
    expect(observedRoot?.toLocaleLowerCase()).toBe(installedRoot.toLocaleLowerCase());
  });

  test("does not start a second writer and rejects an ambiguous writer count", async () => {
    const fixture = transactionFixture();
    for (const [writers, starts, rejected] of [[1, 0, false], [2, 0, true]] as const) {
      let startCalls = 0;
      const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\entry.js", statePath: plan.home + "\\state.json" } as never;
      const serviceIo = { stopWriters: async () => 1, countWriters: async () => writers, startAndVerifyTask: async () => { startCalls += 1; } } as never;
      const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
        installWindowsUserTask: async () => ({ taskPath: "\\Chat2Codex\\Chat2Codex" } as never), uninstallWindowsUserTask: async () => ({ removed: true }),
        createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
        inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [] as never,
      });
      await io.quiesceWindowsUserTask(); await io.installWindowsUserTask();
      if (rejected) await expect(io.startWindowsUserTask()).rejects.toThrow(/writer/i); else await expect(io.startWindowsUserTask()).resolves.toBeUndefined();
      expect(startCalls).toBe(starts);
    }
  });

  test("starts a replacement only when the transaction quiesced one prior writer", async () => {
    for (const [priorWriters, expectedStarts] of [[0, 0], [1, 1]] as const) {
      let starts = 0;
      const fixture = transactionFixture();
      const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\entry.js", statePath: plan.home + "\\state.json" } as never;
      const serviceIo = { stopWriters: async () => priorWriters, countWriters: async () => 0, startAndVerifyTask: async () => { starts += 1; } } as never;
      const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, { installWindowsUserTask: async () => ({ taskPath: "\\Chat2Codex\\Chat2Codex" } as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }), inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [] as never });
      await io.quiesceWindowsUserTask(); await io.installWindowsUserTask(); await io.startWindowsUserTask();
      expect(starts).toBe(expectedStarts);
    }
  });

  test("keeps a fresh install offline until setup while deferring its expected writer warning", async () => {
    let starts = 0;
    const fixture = transactionFixture();
    const serviceInput = { home: plan.home, manifestPath: plan.home + "\\installation.json", entrypoint: plan.home + "\\entry.js", statePath: plan.home + "\\state.json" } as never;
    const serviceIo = { stopWriters: async () => 0, countWriters: async () => 0, startAndVerifyTask: async () => { starts += 1; } } as never;
    const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
      installWindowsUserTask: async () => ({ taskPath: "\\Chat2Codex\\Chat2Codex" } as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
      inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [{ status: "error", code: "DIST_WRITER_CONFLICT" }] as never,
    });
    await io.quiesceWindowsUserTask(); await io.installWindowsUserTask(); await io.startWindowsUserTask();
    expect(starts).toBe(0); expect(await io.doctor()).toBeTrue();
  });

  test("fails closed on negative or nonsafe writer enumeration", async () => {
    for (const writers of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const fixture = transactionFixture();
      const serviceInput = { home: plan.home, entrypoint: plan.home + "\\entry.js" } as never;
      const build = (stopWriters: number, countWriters: number) => composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo: { stopWriters: async () => stopWriters, countWriters: async () => countWriters } as never, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, { installWindowsUserTask: async () => ({ taskPath: "\\Chat2Codex\\Chat2Codex" } as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }), inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [] as never });
      await expect(build(writers, 0).quiesceWindowsUserTask()).rejects.toThrow(/writer/i);
      const start = build(1, writers); await start.quiesceWindowsUserTask(); await start.installWindowsUserTask();
      await expect(start.startWindowsUserTask()).rejects.toThrow(/writer/i);
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

  test("carries only bounded doctor codes through transaction rollback", async () => {
    const fixture = transactionFixture();
    const serviceInput = { home: plan.home, entrypoint: plan.home + "\\entry.js" } as never;
    const serviceIo = { stopWriters: async () => 0 } as never;
    const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
      installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
      inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [{ status: "error", code: "DIST_KEYS_INVALID" }, { status: "error", code: "unsafe path token" }] as never,
    });
    expect(await io.doctor()).toBeFalse();
    expect(io.doctorFailureCodes?.()).toEqual(["DIST_KEYS_INVALID"]);

    const transaction = transactionFixture({ failAt: "doctor" });
    transaction.io.doctor = io.doctor;
    transaction.io.doctorFailureCodes = io.doctorFailureCodes;
    await expect(executePersonalPortableInstall(plan, transaction.io)).rejects.toMatchObject({ code: "PORTABLE_TRANSACTION_ROLLED_BACK", failureCodes: ["DIST_KEYS_INVALID"] });
  });

  test("allows explicitly deferred onboarding checks during install but not core health errors", async () => {
    const fixture = transactionFixture();
    const deferred = ["DIST_WEIXIN_NOT_CONFIGURED", "DIST_WEIXIN_BOUNDARY_INVALID", "DIST_MCP_UNCONFIGURED", "DIST_INSTALLED_HOOK_DRIFT"];
    const build = (codes: string[], priorWriters = 0) => composePersonalPortableInstallIo({ ...fixture.io, serviceInput: { home: plan.home, entrypoint: plan.home + "\\entry.js" } as never, serviceIo: { stopWriters: async () => priorWriters } as never, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
      installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }), inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => codes.map((code) => ({ status: "error", code })) as never,
    });
    expect(await build(deferred).doctor()).toBeTrue();
    expect(await build(["DIST_ROLLBACK_PENDING"]).doctor()).toBeFalse();
    const online = build(["DIST_WRITER_CONFLICT"], 1); await online.quiesceWindowsUserTask();
    expect(await online.doctor()).toBeFalse();
  });

  test("defers rollback pending only for the exact active transaction receipt", async () => {
    const fixture = transactionFixture();
    const serviceInput = { home: plan.home, entrypoint: plan.home + "\\entry.js" } as never;
    const build = (pendingReceiptId: string) => composePersonalPortableInstallIo({ ...fixture.io, activeReceiptId: () => "receipt-current", serviceInput, serviceIo: { stopWriters: async () => 1 } as never, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, {
      installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }),
      inspectInstalledWindowsDistribution: async () => ({ manifest: {}, rollbackReceipt: { pending: true, status: "applying", receiptId: pendingReceiptId } }) as never, diagnoseWindowsDistribution: () => [{ status: "error", code: "DIST_ROLLBACK_PENDING" }] as never,
    });
    expect(await build("receipt-current").doctor()).toBeTrue();
    expect(await build("receipt-other").doctor()).toBeFalse();
  });

  test("defers fresh-install writer readiness but requires it for an online upgrade", async () => {
    for (const [priorWriters, expected] of [[0, true], [1, false]] as const) {
      const fixture = transactionFixture();
      const serviceInput = { home: plan.home, entrypoint: plan.home + "\\entry.js" } as never;
      const serviceIo = { stopWriters: async () => priorWriters } as never;
      const io = composePersonalPortableInstallIo({ ...fixture.io, serviceInput, serviceIo, statePath: plan.home + "\\state.json", adapterId: "weixin:test" }, { installWindowsUserTask: async () => ({} as never), uninstallWindowsUserTask: async () => ({ removed: true }), createStateStore: () => ({ load: async () => ({} as never), save: async () => undefined }), inspectInstalledWindowsDistribution: async () => ({ manifest: {} } as never), diagnoseWindowsDistribution: () => [{ status: "error", code: "DIST_WRITER_CONFLICT" }] as never });
      await io.quiesceWindowsUserTask(); expect(await io.doctor()).toBe(expected);
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
    backupPrior: async () => { await step("backup_prior"); return { backupId: "backup-1", hashes: options.freshInstall ? { package: null, config: null, state: null, task: null } : { package: "b".repeat(64), config: "c".repeat(64), state: "d".repeat(64), task: "e".repeat(64) }, wasOnline: !options.freshInstall }; },
    installPackage: async () => await step("install_package"), configure: async () => await step("configure"), migrateState: async () => await step("migrate_state"),
    installWindowsUserTask: async () => await step("install_windows_user_task"), startWindowsUserTask: async () => await step("start_windows_user_task"), doctor: async () => { await step("doctor"); return true; },
    quiesceWindowsUserTask: async () => await step("quiesce_windows_user_task"), stopCurrentWriter: async () => await step("stop_current_writer"), uninstallWindowsUserTask: async () => await step("uninstall_windows_user_task"), restoreState: async () => await step("restore_state"),
    restoreConfiguration: async () => await step("restore_configuration"), restorePackage: async () => await step("restore_package"),
    restoreWindowsUserTask: async () => await step("restore_windows_user_task"), oldDoctor: async () => { await step("old_doctor"); return true; },
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
