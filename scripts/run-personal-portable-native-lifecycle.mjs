#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const archive = requiredFile(read("--archive"), "archive");
const expectedSha256 = requiredHash(read("--sha256"));
const nodeBin = requiredFile(read("--node-bin"), "Node");
const codexBin = requiredFile(read("--codex-bin"), "Codex");
const npmCli = requiredFile(read("--npm-cli"), "npm CLI");
const actualSha256 = sha256(await readFile(archive));
if (actualSha256 !== expectedSha256) throw new Error("archive_hash_mismatch");

const root = await mkdtemp(path.join(os.tmpdir(), "c2c-portable-native-"));
const marker = path.basename(root);
const taskName = "Chat2Codex-Portable-" + sha256(marker).slice(0, 8);
const taskPath = "\\Chat2Codex\\" + taskName;
const runner = path.join(root, "runner");
const home = path.join(root, "home");
const prefix = path.join(home, "npm");
const profile = path.join(root, "profile");
const results = [];
let stage = "extract"; let failureCode = null;
let diagnostic = null;
try {
  await mkdir(runner);
  await mkdir(path.join(profile, "AppData", "Local"), { recursive: true });
  await mkdir(path.join(profile, "AppData", "Roaming"), { recursive: true });
  await mkdir(path.join(root, "powershell"), { recursive: true });
  run("tar.exe", ["-xf", archive, "-C", runner]);
  const bootstrap = requiredFile(path.join(runner, "package", "scripts", "chat2codex-personal.ps1"), "bootstrap");
  const env = { ...process.env, CHAT2CODEX_PORTABLE_TASK_NAME: taskName, CODEX_HOME: path.join(root, "codex-home"), USERPROFILE: profile, LOCALAPPDATA: path.join(profile, "AppData", "Local"), APPDATA: path.join(profile, "AppData", "Roaming"), PSModuleAnalysisCachePath: path.join(root, "powershell", "ModuleAnalysisCache") };
  const invoke = (action, receiptId, expectedSuccess, includeArchive = true) => {
    const command = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bootstrap, "-Action", action, "-InstallHome", home, "-NpmPrefix", prefix, "-NodeBin", nodeBin, "-CodexBin", codexBin, "-Json"];
    if (includeArchive) command.push("-ArchivePath", archive, "-ArchiveSha256", expectedSha256);
    if (receiptId) command.push("-ReceiptId", receiptId);
    const result = spawnSync("powershell.exe", command, { encoding: "utf8", windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 });
    const lines = String(result.stdout ?? "").split(/\r?\n/u).filter((line) => line.trim().startsWith("{"));
    let value; try { value = JSON.parse(lines.at(-1) ?? "null"); } catch { value = null; }
    if (!value || expectedSuccess && result.status !== 0 || !expectedSuccess && result.status === 0) {
      const combined = String(result.stdout ?? "") + "\n" + String(result.stderr ?? "");
      const bounded = value?.code && /^[A-Z][A-Z0-9_]{2,100}$/u.test(value.code) ? value.code.toLocaleLowerCase() : combined.match(/\b(?:PORTABLE|DIST)_[A-Z0-9_]{2,100}\b/u)?.[0]?.toLocaleLowerCase();
      const failureCodes = Array.isArray(value?.failureCodes) ? value.failureCodes.filter((item) => typeof item === "string" && /^DIST_[A-Z0-9_]+$/u.test(item)).slice(0, 20) : [];
      diagnostic = { exitCode: result.status, jsonPresent: Boolean(value), failureCodes, tail: redactDiagnostic(combined) };
      throw new Error(bounded ?? "action_" + action.toLocaleLowerCase() + "_failed");
    }
    results.push({ action, exitCode: result.status, status: value.status ?? value.code ?? "unknown", receiptId: value.receiptId ?? null, codes: Array.isArray(value.checks) ? value.checks.map((item) => item.code) : [] });
    return value;
  };
  stage = "install_1"; const install1 = invoke("Install", null, true);
  stage = "install_2"; const install2 = invoke("Install", null, true);
  stage = "doctor_prelogin"; const doctor = invoke("Doctor", null, false);
  if (!doctor.checks.some((item) => item.code === "DIST_WEIXIN_NOT_CONFIGURED")) throw new Error("doctor_weixin_code_missing");
  if (!doctor.checks.some((item) => item.code === "DIST_WRITER_CONFLICT")) throw new Error("doctor_prelogin_writer_code_missing");
  stage = "rollback"; invoke("Rollback", install2.receiptId, true);
  stage = "uninstall_1"; invoke("Uninstall", null, true);
  stage = "uninstall_2"; invoke("Uninstall", null, true, false);
  stage = "reinstall"; const reinstall = invoke("Reinstall", null, true);
  if (reinstall.rotatedKeyCount !== 3) throw new Error("reinstall_rotation_invalid");
  stage = "uninstall_final"; invoke("Uninstall", null, true);
  stage = "verify";
  if (taskExists(taskPath) || matchingProcesses(marker) !== 0) throw new Error("residual_before_cleanup");
} catch (error) { failureCode = /^[a-z0-9_]+$/u.test(error?.message ?? "") ? error.message : "portable_native_failure"; }
finally {
  spawnSync("schtasks.exe", ["/End", "/TN", taskPath], { windowsHide: true });
  spawnSync("schtasks.exe", ["/Delete", "/TN", taskPath, "/F"], { windowsHide: true });
  stopMatchingProcesses(marker);
  if (!inside(os.tmpdir(), root)) throw new Error("cleanup_scope_invalid");
  await rm(root, { recursive: true, force: true });
}
const evidence = { schemaVersion: 1, verdict: failureCode ? "fail" : "pass", stage, failureCode, diagnostic, archiveSha256: expectedSha256, taskNameHash: sha256(taskName), results, cleanup: { taskResidual: taskExists(taskPath), processResidual: matchingProcesses(marker), rootResidual: await exists(root) } };
process.stdout.write("PERSONAL_PORTABLE_NATIVE " + JSON.stringify(evidence) + "\n");
if (failureCode || Object.values(evidence.cleanup).some(Boolean)) process.exitCode = 1;

function requiredFile(value, label) { if (!value || !path.isAbsolute(value)) throw new Error(label.toLocaleLowerCase().replaceAll(" ", "_") + "_invalid"); return path.resolve(value); }
function requiredHash(value) { if (!/^[a-f0-9]{64}$/u.test(value ?? "")) throw new Error("archive_hash_invalid"); return value; }
function run(command, commandArgs) { const result = spawnSync(command, commandArgs, { encoding: "utf8", windowsHide: true }); if (result.status !== 0) throw new Error("archive_extract_failed"); }
function taskExists(name) { return spawnSync("schtasks.exe", ["/Query", "/TN", name], { windowsHide: true }).status === 0; }
function matchingProcesses(value) { const script = "@((Get-CimInstance Win32_Process)|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$env:C2C_MARKER+'*')}).Count"; const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, C2C_MARKER: value } }); return result.status === 0 && /^[0-9]+$/u.test(result.stdout.trim()) ? Number(result.stdout.trim()) : -1; }
function stopMatchingProcesses(value) { const script = "Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$env:C2C_MARKER+'*')}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop}"; spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, C2C_MARKER: value } }); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function redactDiagnostic(value) { return String(value).replace(/[A-Za-z]:[\\/][^\r\n"']+/gu, "<path>").replace(/[a-f0-9]{40,}/giu, "<hash>").replace(/(?:token|prompt|identity|credential)[^\r\n]{0,120}/giu, "<redacted>").slice(-500); }
function inside(parent, child) { const relative = path.relative(parent, child); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }
async function exists(target) { try { await realpath(target); return true; } catch { return false; } }
