import { describe, expect, test } from "bun:test";
import { nativeLifecycleFailure } from "../src/quality/novice-native-diagnostics.js";

describe("native lifecycle diagnostics", () => {
  test("keeps bounded structural fields without paths, identities, or messages", () => {
    const error = Object.assign(new Error("denied C:\\Users\\runneradmin\\secret S-1-5-21-1-2-3-1001"), {
      code: "EACCES",
      errno: -4092,
      name: "Error",
    });
    const detail = nativeLifecycleFailure("journey", error);
    expect(detail).toEqual({ stage: "journey", exceptionType: "Error", code: "EACCES", errno: -4092, hResult: null });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("runneradmin");
    expect(serialized).not.toContain("S-1-5");
    expect(serialized).not.toContain("secret");
    expect(serialized.length).toBeLessThanOrEqual(512);
  });

  test("normalizes unknown and oversized fields", () => {
    expect(nativeLifecycleFailure("x".repeat(200), { name: "Y".repeat(500), code: "Z".repeat(500), hResult: 1.5 })).toEqual({
      stage: "x".repeat(64), exceptionType: "Y".repeat(160), code: "Z".repeat(64), errno: null, hResult: null,
    });
  });

  test("preserves an already-redacted nested boundary stage", () => {
    const error = Object.assign(new Error("outer"), {
      failureDetail: { stage: "file_acl", exitCode: 86, signal: null, exceptionType: "System.UnauthorizedAccessException", hResult: -2147024891, nativeCode: 5, fullyQualifiedErrorId: "UnauthorizedAccess", category: "PermissionDenied", stderrTail: [], stdoutTail: [] },
    });
    expect(nativeLifecycleFailure("journey", error)).toEqual({ stage: "journey/file_acl", exceptionType: "System.UnauthorizedAccessException", code: "exit_86", errno: 5, hResult: -2147024891 });
  });
});
