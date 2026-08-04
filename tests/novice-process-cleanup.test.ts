import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { stopExactEntrypointWriters } from "../scripts/novice-process-cleanup.mjs";

describe("novice Windows process cleanup", () => {
  test("passes the exact entrypoint out of band and rejects unbounded output", () => {
    let observed: { command?: string; args?: string[]; options?: Record<string, unknown> } = {};
    const entrypoint = path.resolve("C:/owned path/novice-service-probe.mjs");
    const result = stopExactEntrypointWriters(entrypoint, {
      spawnSync(command, args, options) {
        observed = { command, args: [...args], options };
        return { status: 0, stdout: '{"matched":1,"residual":0}', stderr: "" };
      },
    });

    expect(result).toEqual({ attempted: true, succeeded: true, matched: 1, residual: 0 });
    expect(observed.command).toBe("powershell.exe");
    expect(observed.args?.join(" " )).not.toContain(entrypoint);
    expect((observed.options?.env as NodeJS.ProcessEnv).C2C_ENTRYPOINT).toBe(entrypoint);
    expect(() => stopExactEntrypointWriters(entrypoint, {
      spawnSync: () => ({ status: 0, stdout: '{"matched":1001,"residual":0}', stderr: "" }),
    })).toThrow(/cleanup output/i);
  });

  test("stops only the writer whose command line contains the exact entrypoint", async () => {
    if (process.platform !== "win32") {
      const result = stopExactEntrypointWriters("/tmp/target-probe.mjs", {
        spawnSync: () => ({ status: 0, stdout: '{"matched":1,"residual":0}', stderr: "" }),
      });
      expect(result.succeeded).toBeTrue();
      return;
    }

    const root = await mkdtemp(path.join(os.tmpdir(), "c2c-cleanup-test-"));
    const target = path.join(root, "target-probe.mjs");
    const neighbor = path.join(root, "neighbor-probe.mjs");
    const source = "setInterval(() => {}, 1000);\n";
    await writeFile(target, source);
    await writeFile(neighbor, source);
    const targetProcess = spawn(process.execPath, [target, "start"], { windowsHide: true });
    const neighborProcess = spawn(process.execPath, [neighbor, "start"], { windowsHide: true });

    try {
      await waitForSpawn(targetProcess);
      await waitForSpawn(neighborProcess);
      expect(stopExactEntrypointWriters(target)).toEqual({ attempted: true, succeeded: true, matched: 1, residual: 0 });
      await waitForExit(targetProcess);
      expect(neighborProcess.exitCode).toBeNull();
    } finally {
      if (targetProcess.exitCode === null) targetProcess.kill();
      if (neighborProcess.exitCode === null) neighborProcess.kill();
      await Promise.all([waitForExit(targetProcess), waitForExit(neighborProcess)]);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid) return;
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
