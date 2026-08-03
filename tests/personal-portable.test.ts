import path from "node:path";
import { describe, expect, test } from "bun:test";

import { PersonalPortableError, parsePersonalPortableArgs, planPersonalPortableAction } from "../src/setup/personal-portable.js";

describe("personal portable lifecycle contract", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local", APPDATA: "C:\\Users\\Alice\\AppData\\Roaming", USERPROFILE: "C:\\Users\\Alice" };

  test("accepts the six lifecycle actions with explicit reviewed archive identity", () => {
    for (const action of ["install", "upgrade", "rollback", "uninstall", "reinstall", "doctor"] as const) {
      const parsed = parsePersonalPortableArgs([action, "--archive", "C:\\transfer\\chat2codex.tgz", "--sha256", "a".repeat(64), ...(action === "rollback" ? ["--receipt", "receipt-1"] : []), "--dry-run"], env);
      expect(parsed.action).toBe(action);
      expect(parsed.dryRun).toBeTrue();
      expect(parsed.archivePath).toBe(path.win32.normalize("C:\\transfer\\chat2codex.tgz"));
      expect(parsed.archiveSha256).toBe("a".repeat(64));
      expect(parsed.home).toBe(path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Chat2Codex"));
      expect(parsed.npmPrefix).toBe(path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Chat2Codex\\npm"));
    }
  });

  test("builds a pure plan without filesystem process or network access", () => {
    const options = parsePersonalPortableArgs(["install", "--archive", "C:\\transfer\\candidate.tgz", "--sha256", "b".repeat(64), "--dry-run"], env);
    expect(planPersonalPortableAction(options)).toEqual({
      action: "install", archivePath: path.win32.normalize("C:\\transfer\\candidate.tgz"), archiveSha256: "b".repeat(64),
      receiptId: undefined,
      home: path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Chat2Codex"), npmPrefix: path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Chat2Codex\\npm"),
      receiptRoot: path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Chat2Codex\\receipts"), preserveUserData: true, dryRun: true,
    });
  });

  test("fails closed with stable codes", () => {
    for (const [argv, code] of [
      [["install"], "PORTABLE_ARCHIVE_REQUIRED"],
      [["install", "--archive", "candidate.tgz", "--sha256", "a".repeat(64)], "PORTABLE_ARCHIVE_PATH_INVALID"],
      [["install", "--archive", "C:\\candidate.tgz", "--sha256", "bad"], "PORTABLE_ARCHIVE_HASH_INVALID"],
      [["install", "--archive", "C:\\candidate.tgz", "--sha256", "a".repeat(64), "--home", "relative"], "PORTABLE_HOME_INVALID"],
      [["install", "--archive", "C:\\candidate.tgz", "--sha256", "a".repeat(64), "--purge"], "PORTABLE_PURGE_CONFIRMATION_REQUIRED"],
      [["rollback"], "PORTABLE_RECEIPT_REQUIRED"],
      [["rollback", "--receipt", "bad/receipt"], "PORTABLE_RECEIPT_INVALID"],
      [["install", "--archive", "C:\\candidate.tgz", "--sha256", "a".repeat(64), "--receipt", "receipt-1"], "PORTABLE_RECEIPT_UNEXPECTED"],
      [["unknown"], "PORTABLE_ACTION_INVALID"],
    ] as const) {
      try { parsePersonalPortableArgs([...argv], env); throw new Error("unexpected pass"); }
      catch (error) { expect(error).toBeInstanceOf(PersonalPortableError); expect((error as PersonalPortableError).code).toBe(code); }
    }
  });

  test("binds rollback to one named durable receipt", () => {
    expect(parsePersonalPortableArgs(["rollback", "--receipt", "receipt-20260804"], env)).toMatchObject({ action: "rollback", receiptId: "receipt-20260804" });
  });

  test("allows purge only with exact explicit confirmation", () => {
    const value = parsePersonalPortableArgs(["uninstall", "--archive", "C:\\candidate.tgz", "--sha256", "c".repeat(64), "--purge", "--confirm-purge", "DELETE_USER_DATA"], env);
    expect(value.preserveUserData).toBeFalse();
  });
});
