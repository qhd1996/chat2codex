import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { descendantIdentities, sameProcessIdentity } from "./process-identity.mjs";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const read = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const name = read("--name", "unnamed");
const timeoutMs = Number(read("--timeout-ms", "60000"));
const reportPath = path.resolve(read("--report", `.tmp/shard-${Date.now()}.json`));
const separator = args.indexOf("--");
const command = separator >= 0 ? args[separator + 1] : undefined;
const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];
if (!command || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("Usage: node run-test-shard.mjs --name N --timeout-ms MS --report FILE -- command args...");
}

async function processRows() {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='parentPid';e={[int]$_.ParentProcessId}},@{n='createdAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}},@{n='name';e={$_.Name}},@{n='commandLine';e={$_.CommandLine}},@{n='cpuMs';e={[int64](($_.KernelModeTime+$_.UserModeTime)/10000)}} | ConvertTo-Json -Compress",
    ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function currentRootIdentity(pid) {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{pid=[int]$p.Id;createdAt=$p.StartTime.ToUniversalTime().ToString('o');cpuMs=[int64](($p.UserProcessorTime+$p.PrivilegedProcessorTime).TotalMilliseconds)} | ConvertTo-Json -Compress}`,
    ], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch {
    return null;
  }
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
const started = Date.now();
const child = spawn(command, commandArgs, {
  cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
const exitPromise = new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, signal: null, spawnError: error.message }));
  child.once("exit", (code, signal) => resolve({ code, signal, spawnError: null }));
});

let stdout = "";
let stderr = "";
const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-2_000_000);
child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

let rootIdentity = null;
let initialRows = [];
for (let attempt = 0; attempt < 3 && !rootIdentity; attempt += 1) {
  initialRows = await processRows();
  rootIdentity = initialRows.find((row) => Number(row.pid) === child.pid) ?? null;
  if (!rootIdentity) await new Promise((resolve) => setTimeout(resolve, 50));
}
const trackedDescendants = new Map();
const identityKey = (row) => String(row.pid) + "|" + String(row.createdAt);
let lastCpuMs = Number(rootIdentity?.cpuMs) || 0;
if (rootIdentity) {
  for (const descendant of descendantIdentities(initialRows, rootIdentity)) {
    trackedDescendants.set(identityKey(descendant), descendant);
  }
}
let samplePromise = null;
async function sampleTree() {
  if (samplePromise) return samplePromise;
  samplePromise = (async () => {
    const rows = await processRows();
    if (!rootIdentity) return { rows, currentRoot: null };
    const currentRoot = rows.find((row) => Number(row.pid) === child.pid) ?? null;
    if (!sameProcessIdentity(rootIdentity, currentRoot)) return { rows, currentRoot };
    lastCpuMs = Math.max(lastCpuMs, Number(currentRoot.cpuMs) || 0);
    for (const descendant of descendantIdentities(rows, rootIdentity)) {
      trackedDescendants.set(identityKey(descendant), descendant);
    }
    return { rows, currentRoot };
  })().finally(() => { samplePromise = null; });
  return samplePromise;
}
const sampleTimer = setInterval(() => { void sampleTree(); }, 1_000);

let timedOut = false;
let killResult = null;
let killRefusedReason = null;
let killPromise = Promise.resolve();
const remainingMs = Math.max(0, timeoutMs - (Date.now() - started));
const timer = setTimeout(() => {
  timedOut = true;
  killPromise = (async () => {
    const currentRoot = await currentRootIdentity(child.pid);
    lastCpuMs = Math.max(lastCpuMs, Number(currentRoot?.cpuMs) || 0);
    if (rootIdentity && sameProcessIdentity(rootIdentity, currentRoot)) {
      killResult = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
    } else {
      killRefusedReason = rootIdentity ? "root-pid-identity-changed" : "root-identity-unavailable";
      child.kill();
    }
  })();
}, remainingMs);

const exit = await exitPromise;
clearTimeout(timer);
clearInterval(sampleTimer);
await killPromise;
await samplePromise;
await new Promise((resolve) => setTimeout(resolve, 250));
const tracked = [...trackedDescendants.values()];
const currentDescendants = await Promise.all(tracked.map((item) => currentRootIdentity(item.pid)));
const residualProcesses = tracked.filter((item, index) => sameProcessIdentity(item, currentDescendants[index]));
const currentRoot = rootIdentity ? await currentRootIdentity(rootIdentity.pid) : null;
const residualRoot = Boolean(rootIdentity && sameProcessIdentity(rootIdentity, currentRoot));
const residualChildren = residualProcesses.length;

const combinedOutput = stdout + "\n" + stderr;
const passMatch = combinedOutput.match(/\b(\d+) pass\b/u);
const failMatch = combinedOutput.match(/\b(\d+) fail\b/u);
const skipMatch = combinedOutput.match(/\b(\d+) skip(?:ped)?\b/u);
const testCount = passMatch || failMatch || skipMatch
  ? Number(passMatch?.[1] ?? 0) + Number(failMatch?.[1] ?? 0) + Number(skipMatch?.[1] ?? 0)
  : null;
const report = {
  name, command: [command, ...commandArgs], startedAt: new Date(started).toISOString(),
  wallMs: Date.now() - started, timeoutMs, timedOut, pid: child.pid, rootIdentity,
  exitCode: exit.code, signal: exit.signal, spawnError: exit.spawnError,
  reportedPass: passMatch ? Number(passMatch[1]) : null,
  reportedFail: failMatch ? Number(failMatch[1]) : null,
  reportedSkip: skipMatch ? Number(skipMatch[1]) : null,
  testCount, processCpuMs: lastCpuMs, residualChildren, residualRoot, residualProcesses,
  taskkillExit: killResult?.status ?? null, killRefusedReason,
  stdoutTail: stdout.slice(-16_000), stderrTail: stderr.slice(-16_000),
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ...report, stdoutTail: undefined, stderrTail: undefined }, null, 2));
const passed = !timedOut && exit.code === 0 && !residualRoot && residualChildren === 0 && (report.reportedFail === null || report.reportedFail === 0);
process.exitCode = passed ? 0 : 1;
