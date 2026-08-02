import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

test("timeout kills the complete process tree and records auditable metrics", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "chat2codex-shard-wrapper-"));
  const report = path.join(temp, "report.json");
  try {
    const child = Bun.spawn([
      process.execPath,
      "scripts/run-test-shard.mjs",
      "--name", "wrapper-timeout-self-test",
      "--timeout-ms", "750",
      "--report", report,
      "--", process.execPath,
      "tests/fixtures/shard-timeout-parent.cjs",
    ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(1);
    const result = JSON.parse(await readFile(report, "utf8")) as Record<string, unknown>;
    expect(result).toMatchObject({
      name: "wrapper-timeout-self-test",
      timedOut: true,
      residualChildren: 0,
      testCount: null,
      reportedPass: null,
      reportedFail: null,
    });
    expect(result.processCpuMs).toBeNumber();
    expect(result.processCpuMs).toBeGreaterThanOrEqual(0);
    const match = String(result.stdoutTail).match(/GRANDCHILD_PID=([0-9]+)/u);
    expect(match).not.toBeNull();
    const processCheck = Bun.spawnSync([
      "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
      `if(Get-Process -Id ${match![1]} -ErrorAction SilentlyContinue){exit 1}else{exit 0}`,
    ]);
    expect(processCheck.exitCode).toBe(0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("records Bun-style test counts written on stderr", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "chat2codex-shard-counts-"));
  const report = path.join(temp, "report.json");
  try {
    const child = Bun.spawn([
      process.execPath, "scripts/run-test-shard.mjs",
      "--name", "count-self-test", "--timeout-ms", "5000", "--report", report,
      "--", process.execPath, "tests/fixtures/shard-success-summary.cjs",
    ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
      timedOut: false,
      exitCode: 0,
      reportedPass: 2,
      reportedFail: 0,
      reportedSkip: 1,
      testCount: 3,
      residualChildren: 0,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
