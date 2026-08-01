import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createNodeTestExecutable, expectPrivateFileMode, isWindows, supportsFileSymlinks } from "./helpers/platform.js";

describe("platform test helpers", () => {
  test("creates a cross-platform Node command that forwards arguments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-node-command-"));
    try {
      const command = await createNodeTestExecutable(directory, "fake-node-command", "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
      expect(JSON.parse(await run(command, ["--version", "value with spaces"]))).toEqual(["--version", "value with spaces"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("checks POSIX privacy without inventing Windows mode semantics", () => {
    expect(() => expectPrivateFileMode(isWindows ? 0o666 : 0o600)).not.toThrow();
    if (!isWindows) expect(() => expectPrivateFileMode(0o644)).toThrow(/0600/);
  });
  test("feature-detects symlink support", async () => {
    expect(typeof await supportsFileSymlinks()).toBe("boolean");
  });
});

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}
