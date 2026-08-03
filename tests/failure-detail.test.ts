import { describe, expect, test } from "bun:test";
import { failureDetailPrefix, parseFailureDetailLine, renderFailureDetailLine } from "../src/util/failure-detail.js";

describe("CLI failure detail", () => {
  test("renders exactly one parseable bounded marker without an Error command", () => {
    const detail = {
      stage: "directory_acl", exitCode: 86, signal: null,
      exceptionType: "System.UnauthorizedAccessException", hResult: -2147024891, nativeCode: 5,
      fullyQualifiedErrorId: "System.UnauthorizedAccessException", category: "PermissionDenied",
      stderrTail: ["{redacted}"], stdoutTail: [],
    };
    const error = Object.assign(new Error("Windows directory ACL application failed."), { failureDetail: detail });
    const line = renderFailureDetailLine(error);
    expect(line?.startsWith(failureDetailPrefix)).toBeTrue();
    expect(JSON.parse(line!.slice(failureDetailPrefix.length))).toEqual(detail);
    expect(line).not.toContain("powershell.exe -Command");
    expect(line!.length).toBeLessThanOrEqual(4096);
    expect(parseFailureDetailLine(line!)).toEqual(detail);
  });

  test("does not emit a marker for ordinary errors", () => {
    expect(renderFailureDetailLine(new Error("ordinary"))).toBeUndefined();
  });

  test("rejects unknown, oversized, or malformed detail", () => {
    expect(parseFailureDetailLine(failureDetailPrefix + JSON.stringify({ stage: "x", secret: "bad" }))).toBeUndefined();
    expect(parseFailureDetailLine(failureDetailPrefix + "{" + "x".repeat(4096))).toBeUndefined();
    expect(parseFailureDetailLine("ordinary")).toBeUndefined();
  });
});
