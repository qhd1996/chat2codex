import { describe, expect, test } from "bun:test";

import { countWindowsChat2CodexWriters, isWindowsChat2CodexWriter } from "../src/setup/windows-distribution-inspector.js";

const entrypoint = "C:\\Program Files\\chat2codex\\dist\\index.js";
const command = (verb: string) => "node.exe \"" + entrypoint + "\" " + verb;

describe("Windows Chat2Codex writer detection", () => {
  test("counts only an exact start command and excludes the current doctor PID", () => {
    const rows = [
      { ProcessId: 10, CommandLine: command("doctor") },
      { ProcessId: 11, CommandLine: command("start") },
      { ProcessId: 12, CommandLine: command("service print") },
      { ProcessId: 13, CommandLine: "powershell.exe -Command \"inspect " + entrypoint + "\"" },
    ];
    expect(countWindowsChat2CodexWriters(rows, entrypoint, 10)).toBe(1);
    expect(isWindowsChat2CodexWriter(rows[0]!, entrypoint, 10)).toBe(false);
    expect(isWindowsChat2CodexWriter(rows[1]!, entrypoint, 10)).toBe(true);
  });

  test("matches quoted paths case-insensitively without accepting suffix or prefix paths", () => {
    expect(isWindowsChat2CodexWriter({ ProcessId: 20, CommandLine: "\"C:\\Program Files\\nodejs\\node.exe\" \"c:\\PROGRAM FILES\\chat2codex\\dist\\index.js\" start --env x" }, entrypoint, 99)).toBe(true);
    expect(isWindowsChat2CodexWriter({ ProcessId: 21, CommandLine: "node.exe \"" + entrypoint + ".bak\" start" }, entrypoint, 99)).toBe(false);
    expect(isWindowsChat2CodexWriter({ ProcessId: 22, CommandLine: "node.exe \"C:\\prefix" + entrypoint + "\" start" }, entrypoint, 99)).toBe(false);
  });

  test("fails closed for missing, malformed, or ambiguous command lines", () => {
    for (const row of [
      { ProcessId: 0, CommandLine: command("start") },
      { ProcessId: 30, CommandLine: undefined },
      { ProcessId: 31, CommandLine: "node.exe \"" + entrypoint + " start" },
      { ProcessId: 32, CommandLine: "node.exe \"" + entrypoint + "\"" },
      { ProcessId: 33, CommandLine: command("restart") },
    ]) expect(isWindowsChat2CodexWriter(row, entrypoint, 99)).toBe(false);
  });
});
