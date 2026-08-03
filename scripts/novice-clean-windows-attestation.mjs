import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const ownedRoot = path.resolve(read("--owned-root") ?? "");
const packageRoot = path.resolve(read("--package-root") ?? "");
const codexBin = path.resolve(read("--codex-bin") ?? "");
const productionRoot = path.resolve(read("--production-root") ?? "");
const protectedRealCodexHome = path.resolve(read("--protected-real-codex-home") ?? "");
const taskName = read("--task-name") ?? "";
const archiveSha256 = read("--archive-sha256") ?? "";
const repositoryCommit = read("--repository-commit") ?? "";
const oldArchiveSha256 = read("--old-archive-sha256") ?? "";
const oldRepositoryCommit = read("--old-repository-commit") ?? "";
const runIdentity = read("--run-identity") ?? "";
const environmentRoot = path.resolve(read("--environment-root") ?? "");
const rehearsal = args.includes("--rehearsal");
if (!process.env.CHAT2CODEX_NOVICE_ISOLATION || !path.isAbsolute(ownedRoot) || !path.isAbsolute(packageRoot) || !path.isAbsolute(codexBin) || !path.isAbsolute(productionRoot) || !path.isAbsolute(protectedRealCodexHome)) throw new Error("Clean Windows attestation requires owned absolute inputs.");
if (!/^Chat2Codex-Novice-[a-f0-9]{8}$/u.test(taskName)) throw new Error("Clean Windows attestation scope is invalid.");
if (!/^[a-f0-9]{64}$/u.test(archiveSha256) || !/^[a-f0-9]{40}$/u.test(repositoryCommit) || !/^[a-f0-9]{64}$/u.test(oldArchiveSha256) || !/^[a-f0-9]{40}$/u.test(oldRepositoryCommit) || !/^[A-Za-z0-9._-]{8,200}$/u.test(runIdentity)) throw new Error("Clean Windows attestation binding is invalid.");
if (!path.isAbsolute(environmentRoot) || !inside(environmentRoot, ownedRoot) || !inside(environmentRoot, packageRoot) || overlaps(environmentRoot, productionRoot)) throw new Error("Clean Windows owned environment is invalid.");
const actualScript = path.resolve(fileURLToPath(import.meta.url));
if (path.resolve(packageRoot, "scripts", "novice-clean-windows-attestation.mjs").toLocaleLowerCase() !== actualScript.toLocaleLowerCase()) throw new Error("Clean Windows attestation must run from the reviewed package.");
for (const file of [path.join(packageRoot, "package.json"), path.join(packageRoot, "dist", "index.js"), path.join(packageRoot, "scripts", "novice-service-probe.mjs")]) { const info = await lstat(file).catch(() => null); if (!info?.isFile() || info.isSymbolicLink()) throw new Error("Clean Windows attestation package input is invalid."); }
if (await lstat(ownedRoot).catch(() => null)) throw new Error("Clean Windows attestation owned root must start absent.");
if ([packageRoot, process.cwd(), productionRoot].some((root) => overlaps(ownedRoot, root))) throw new Error("Clean Windows attestation owned root overlaps an excluded root.");
const githubActions = process.env.GITHUB_ACTIONS === "true";
const runnerEnvironment = process.env.C2C_RUNNER_ENVIRONMENT ?? "local-rehearsal";
if (!rehearsal && (!githubActions || runnerEnvironment !== "github-hosted")) throw new Error("Qualifying attestation requires a GitHub-hosted ephemeral runner.");
if (await findGitDirectory(process.cwd())) throw new Error("Qualifying attestation found a repository checkout.");
const projectedRealCodexHome = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
const defaultChat2CodexHome = path.join(os.homedir(), ".chat2codex");
if (!inside(environmentRoot, projectedRealCodexHome) || overlaps(environmentRoot, protectedRealCodexHome)) throw new Error("Projected fresh Codex Home or protected real Codex Home scope is invalid.");
const realCodexHomeAbsentBefore = !(await lstat(projectedRealCodexHome).catch(() => null));
if (!realCodexHomeAbsentBefore) throw new Error("Projected fresh Codex Home must start absent.");
const protectedRealCodexHomeBefore = await snapshotTree(protectedRealCodexHome);
if (await lstat(defaultChat2CodexHome).catch(() => null) || await lstat(productionRoot).catch(() => null)) throw new Error("Prior Chat2Codex state, configuration, or production path is present.");
const priorTasks = spawnSync("schtasks.exe", ["/Query", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
if (priorTasks.status !== 0 || priorTasks.stdout.toLocaleLowerCase().includes("\\chat2codex\\")) throw new Error("Prior Chat2Codex Scheduled Task is present or uncertain.");
const globalNpmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", windowsHide: true });
if (globalNpmRoot.status !== 0 || await lstat(path.join(globalNpmRoot.stdout.trim(), "chat2codex")).catch(() => null)) throw new Error("Prior global Chat2Codex package is present or uncertain.");
const home = path.join(ownedRoot, "installed-home");
const workspace = path.join(ownedRoot, "workspace");
const envFile = path.join(home, ".env");
const statePath = path.join(home, ".data", "state.json");
const readyPath = path.join(home, ".data", "service-ready.json");
const stopPath = path.join(home, ".data", "service-stop.request");
const entrypoint = path.join(packageRoot, "scripts", "novice-service-probe.mjs");
const cli = path.join(packageRoot, "dist", "index.js");
const taskPath = "\\Chat2Codex\\" + taskName;
const baseArgs = ["--target", "windows-task", "--project-dir", home, "--entrypoint", entrypoint, "--env", envFile, "--node-bin", process.execPath, "--path", process.env.PATH ?? "", "--windows-task-name", taskName, "--windows-launcher", path.join(home, ".service", "windows", "launcher.ps1"), "--stderr", path.join(home, ".data", "logs", "probe.log")];
const commands = [];
let completed = false;
try {
  await mkdir(workspace, { recursive: true });
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ schemaVersion: 6, adapters: {} }, null, 2) + "\n", { flag: "wx" });
  await writeFile(envFile, [
    "CHAT2CODEX_NOVICE_SERVICE_PROBE=1", "CHAT2CODEX_HOME=" + slash(home), "CHAT2CODEX_NOVICE_SERVICE_READY_PATH=" + slash(readyPath), "CHAT2CODEX_NOVICE_SERVICE_STOP_PATH=" + slash(stopPath),
    "CHAT2CODEX_ADAPTER=feishu", "FEISHU_APP_ID=synthetic", "FEISHU_APP_SECRET=synthetic", "CODEX_BIN=" + slash(codexBin),
    "CODEX_WORKDIR=" + slash(workspace), "BRIDGE_STATE_PATH=" + slash(statePath), "ATTACHMENT_DOWNLOAD_DIR=" + slash(path.join(home, ".data", "attachments")),
    "ALLOW_DIRECT_MESSAGES=false", "ALLOW_GROUPS=false", "CODEX_APPROVAL_POLICY=on-request", "CODEX_RUN_TIMEOUT_MS=60000", "CODEX_APPROVAL_TIMEOUT_MS=60000",
  ].join("\n") + "\n", { flag: "wx" });
  const prior = queryTask(taskPath);
  if (prior.exists) throw new Error("Novice task already exists before attestation.");
  runCli(["service", "install", ...baseArgs], commands);
  const firstKeys = await keyFingerprints(home);
  const anotherInteractiveUserDenied = verifyAnotherUserDenied(path.join(home, ".secrets", "desktop-gateway", "prompt-hook.key"), taskName);
  runCli(["service", "install", ...baseArgs], commands);
  const installedFiles = await hashInstalledFiles(home, packageRoot);
  const first = await startTask(taskPath, readyPath, stopPath, statePath, commands);
  const doctor = runCli(["doctor", "--env", envFile], commands, true);
  if (doctor.status !== 0) throw new Error("Installed doctor failed.");
  await stopTask(stopPath, first, commands);
  const second = await startTask(taskPath, readyPath, stopPath, statePath, commands);
  if (second.pid === first.pid && second.createdAt === first.createdAt) throw new Error("Scheduled Task restart reused one process identity.");
  await stopTask(stopPath, second, commands);
  runCli(["service", "uninstall", ...baseArgs], commands);
  runCli(["service", "uninstall", ...baseArgs], commands);
  if (queryTask(taskPath).exists) throw new Error("Scheduled Task remained after double uninstall.");
  if (await readFile(statePath, "utf8").then((value) => !value.includes('"schemaVersion": 6')).catch(() => true)) throw new Error("User state was not preserved.");
  runCli(["service", "install", ...baseArgs], commands);
  const secondKeys = await keyFingerprints(home);
  if (firstKeys.length !== 3 || secondKeys.length !== 3 || firstKeys.some((value) => secondKeys.includes(value))) throw new Error("Reinstall did not rotate three fresh keys.");
  runCli(["service", "uninstall", ...baseArgs], commands);
  if (queryTask(taskPath).exists) throw new Error("Scheduled Task remained after final uninstall.");
  if (await lstat(projectedRealCodexHome).catch(() => null)) throw new Error("Attestation changed the projected fresh Codex Home.");
  if (await snapshotTree(protectedRealCodexHome) !== protectedRealCodexHomeBefore) throw new Error("Attestation changed the protected real Codex Home.");
  if (await lstat(productionRoot).catch(() => null)) throw new Error("Attestation changed the excluded production path.");
  await rm(ownedRoot, { recursive: true, force: true });
  const ownedRootRemoved = !(await lstat(ownedRoot).catch(() => null));
  if (!ownedRootRemoved) throw new Error("Attestation owned root remained after cleanup.");
  const attestation = {
    environmentKind: rehearsal ? "local_rehearsal" : "equivalent_isolated_windows", archiveSha256, repositoryCommit, oldArchiveSha256, oldRepositoryCommit, runIdentityHash: sha256(runIdentity), ownedEnvironmentHash: sha256(environmentRoot.toLocaleLowerCase()),
    githubActions, runnerEnvironment,
    freshProfile: !rehearsal && realCodexHomeAbsentBefore,
    repositoryAbsent: true,
    priorPackageAbsent: true,
    realUserCodexHomeUntouched: true,
    productionUntouched: true,
    taskNameHash: sha256(taskName), installAttempts: 3, startAttempts: 2, stopAttempts: 2, uninstallAttempts: 3,
    doctorExitCode: doctor.status, singleWriter: true, lockHealthy: true, userDataPreserved: true,
    firstProcess: first, secondProcess: second, taskRemoved: true, newKeysAfterReinstall: true,
    anotherInteractiveUserDenied, zeroResidualProcesses: !processIdentityExists(first) && !processIdentityExists(second), installedFiles,
    ownedRootRemoved,
    commands: commands.map(redactCommand),
  };
  attestation.attestationHash = sha256(JSON.stringify(attestation));
  completed = true;
  process.stdout.write("NOVICE_CLEAN_WINDOWS_ATTESTATION " + JSON.stringify(attestation) + "\n");
} finally {
  if (!completed) {
    spawnSync("schtasks.exe", ["/End", "/TN", taskPath], { windowsHide: true });
    spawnSync("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"], { windowsHide: true });
  }
}

function runCli(cliArgs, commands, allowOutput = false) { const command = [process.execPath, cli, ...cliArgs]; commands.push(command); const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); if (result.status !== 0 && !allowOutput) throw new Error("Installed lifecycle command failed."); return result; }
async function startTask(taskPath, readyPath, stopPath, statePath, commands) { await rm(readyPath, { force: true }); await rm(stopPath, { force: true }); commands.push(["schtasks.exe", "/Run", "/TN", taskPath]); const run = spawnSync("schtasks.exe", ["/Run", "/TN", taskPath], { encoding: "utf8", windowsHide: true }); if (run.status !== 0) throw new Error("Scheduled Task start failed."); const ready = await waitJson(readyPath, 15_000); const identity = queryProcess(ready.pid); const writers = matchingWriters(); const lock = await lstat(statePath + ".lock").catch(() => null); if (!identity || !identity.commandLine.includes(entrypoint) || !identity.commandLine.includes(" start") || writers.length !== 1 || writers[0].pid !== identity.pid || !lock) throw new Error("Scheduled Task writer identity or lock is invalid."); return { pid: identity.pid, createdAt: identity.createdAt, commandHash: sha256(identity.commandLine), stateSha256: ready.stateSha256 }; }
async function stopTask(stopPath, identity, commands) { commands.push(["novice-service-stop", stopPath]); await writeFile(stopPath, "stop\n", { flag: "w" }); const deadline = Date.now() + 15_000; while (Date.now() < deadline) { if (!processExists(identity.pid)) { await rm(stopPath, { force: true }); return; } await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("Scheduled Task writer remained after stop."); }
function queryTask(taskPath) { const result = spawnSync("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"], { encoding: "utf8", windowsHide: true }); return { exists: result.status === 0, xml: result.stdout }; }
function queryProcess(pid) { const script = "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "'; if(!$p){exit 3}; [pscustomobject]@{pid=[int]$p.ProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');commandLine=[string]$p.CommandLine} | ConvertTo-Json -Compress"; const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }); return result.status === 0 ? JSON.parse(result.stdout) : null; }
function processExists(pid) { return queryProcess(pid) !== null; }
function processIdentityExists(identity) { const observed = queryProcess(identity.pid); return Boolean(observed && observed.createdAt === identity.createdAt); }
function matchingWriters() { const script = "$p=Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like ('*'+$env:C2C_ENTRYPOINT+'*') -and $_.CommandLine -like '* start*'} | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');commandLine=[string]$_.CommandLine}}; @($p)|ConvertTo-Json -Compress"; const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, C2C_ENTRYPOINT: entrypoint } }); if (result.status !== 0) throw new Error("Could not enumerate Scheduled Task writers."); const parsed = JSON.parse(result.stdout || "[]"); return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []; }
async function waitJson(file, deadlineMs) { const deadline = Date.now() + deadlineMs; while (Date.now() < deadline) { const source = await readFile(file, "utf8").catch(() => null); if (source) return JSON.parse(source); await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("Scheduled Task readiness deadline exceeded."); }
async function keyFingerprints(home) { const root = path.join(home, ".secrets", "desktop-gateway"); const files = ["prompt-hook.key", "stop-hook.key", "desktop-mcp.key"]; return await Promise.all(files.map(async (name) => sha256((await readFile(path.join(root, name), "utf8")).trim()))); }
async function hashInstalledFiles(home, packageRoot) { const files = [path.join(packageRoot, "package.json"), path.join(packageRoot, "dist", "index.js"), path.join(packageRoot, "scripts", "novice-service-probe.mjs"), path.join(home, ".env"), path.join(home, ".service", "windows", "launcher.ps1"), path.join(home, ".service", "windows", "task.xml"), path.join(home, ".service", "windows", "installation.json"), path.join(home, ".data", "state.json")]; return await Promise.all(files.map(async (file) => ({ path: inside(packageRoot, file) ? "package/" + slash(path.relative(packageRoot, file)) : "owned/" + slash(path.relative(home, file)), sha256: sha256(await readFile(file)) }))); }
function redactCommand(command) { return command.map((part) => path.isAbsolute(part) ? "<owned-path>" : part).join(" "); }
function verifyAnotherUserDenied(keyPath, sourceName) {
  const userName = "C2CN" + sha256(sourceName).slice(0, 8);
  const password = "Aa1!" + createHash("sha256").update(sourceName + process.pid).digest("base64url").slice(0, 20);
  const scriptPath = path.join(packageRoot, "scripts", "novice-another-user-acl.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { encoding: "utf8", windowsHide: true, env: { ...process.env, C2C_TEST_USER: userName, C2C_TEST_PASSWORD: password, C2C_TEST_KEY: keyPath } });
  if (result.status !== 0) throw new Error("Another-interactive-user ACL denial probe failed.");
  return true;
}
function slash(value) { return value.replaceAll("\\", "/"); }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function overlaps(left, right) { return inside(left, right) || inside(right, left); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function snapshotTree(root) {
  const info = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return sha256("absent");
  const records = [];
  async function visit(current, relative) {
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error("Protected real Codex Home contains a symbolic link; snapshot is uncertain.");
    if (entry.isDirectory()) {
      records.push([relative, "directory"]);
      const children = await readdir(current);
      children.sort((left, right) => left.localeCompare(right));
      for (const child of children) await visit(path.join(current, child), relative ? relative + "/" + child : child);
      return;
    }
    if (!entry.isFile()) throw new Error("Protected real Codex Home contains an unsupported entry.");
    records.push([relative, "file", sha256(await readFile(current))]);
  }
  await visit(root, "");
  return sha256(JSON.stringify(records));
}
async function findGitDirectory(start) { let current = path.resolve(start); while (true) { if (await lstat(path.join(current, ".git")).catch(() => null)) return true; const parent = path.dirname(current); if (parent === current) return false; current = parent; } }
