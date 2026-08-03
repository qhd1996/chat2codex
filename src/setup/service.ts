import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { defaultChat2CodexHome, defaultEnvPath } from "../config/paths.js";
import { inspectWindowsTokenAcl, requireOwnerOnlyWindowsTokenAcl } from "../desktop-gateway/server.js";
import { readPackageVersion } from "../package-info.js";
import { applyOwnerOnlyWindowsAcl, ensureWindowsGatewayKeys } from "./windows-private-files.js";
import { assertCanonicalWindowsOwnedPath, installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceIo } from "./windows-service.js";
import { isWindowsChat2CodexWriter } from "./windows-distribution-inspector.js";
import { renderWindowsLauncher, renderWindowsTaskXml, windowsTaskPath } from "./windows-task.js";

export type ServiceTarget = "launchd" | "systemd" | "windows-task";
type ServiceCommand = "print" | "install" | "uninstall";

export interface ServiceOptions {
  target: ServiceTarget;
  projectDir: string;
  entrypoint: string;
  envFile: string;
  nodeBin: string;
  pathEnv: string;
  launchdLabel: string;
  systemdServiceName: string;
  windowsTaskName: string;
  windowsLauncherPath: string;
  stdoutPath: string;
  stderrPath: string;
}

const defaultLaunchdLabel = "com.chat2codex.bridge";
const defaultSystemdServiceName = "chat2codex";
const defaultWindowsTaskName = "Chat2Codex";
const execFileAsync = promisify(execFile);

if (isDirectRun()) {
  await runServiceSetup(process.argv.slice(2));
}

export async function runServiceSetup(argv: string[]): Promise<void> {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      printHelp();
      return;
    }

    const options = createServiceOptions(parsed);
    if (parsed.command === "print") {
      printService(options);
      return;
    }
    if (parsed.command === "install") {
      await installService(options);
      return;
    }
    await uninstallService(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function defaultServiceTarget(platform: NodeJS.Platform = process.platform): ServiceTarget {
  return platform === "darwin" ? "launchd" : platform === "win32" ? "windows-task" : "systemd";
}

export function createServiceOptions(args: ServiceCliArgs = {}): ServiceOptions {
  const target = args.target ?? defaultServiceTarget();
  const projectDir = path.resolve(args.projectDir ?? defaultChat2CodexHome());
  const logsDir = path.join(defaultChat2CodexHome(), ".data", "logs");
  return {
    target,
    projectDir,
    entrypoint: path.resolve(args.entrypoint ?? defaultEntrypoint(projectDir)),
    envFile: path.resolve(args.envFile ?? defaultEnvPath()),
    nodeBin: args.nodeBin ?? findExecutable("node"),
    pathEnv: args.pathEnv ?? defaultServicePath(target),
    launchdLabel: args.launchdLabel ?? defaultLaunchdLabel,
    systemdServiceName: normalizeSystemdServiceName(
      args.systemdServiceName ?? defaultSystemdServiceName,
    ),
    windowsTaskName: args.windowsTaskName ?? defaultWindowsTaskName,
    windowsLauncherPath: path.resolve(args.windowsLauncherPath ?? path.join(projectDir, ".service", "windows", "launcher.ps1")),
    stdoutPath: path.resolve(
      projectDir,
      args.stdoutPath ?? path.join(logsDir, "chat2codex.out.log"),
    ),
    stderrPath: path.resolve(
      projectDir,
      args.stderrPath ?? path.join(logsDir, "chat2codex.err.log"),
    ),
  };
}

export function launchdPlistPath(label = defaultLaunchdLabel): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export function systemdUnitPath(serviceName = defaultSystemdServiceName): string {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    `${normalizeSystemdServiceName(serviceName)}.service`,
  );
}

export function defaultServicePath(target: ServiceTarget = defaultServiceTarget()): string {
  if (target === "launchd") {
    return "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  if (target === "windows-task") return process.env.PATH ?? "C:\\Windows\\System32";
  return "/usr/local/bin:/usr/bin:/bin";
}

export function renderLaunchdPlist(options: ServiceOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodeBin)}</string>
    <string>${escapeXml(options.entrypoint)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.projectDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CHAT2CODEX_ENV</key>
    <string>${escapeXml(options.envFile)}</string>
    <key>CHAT2CODEX_LOG_FILE</key>
    <string>${escapeXml(options.stderrPath)}</string>
    <key>CHAT2CODEX_SERVICE_RESTART_ENABLED</key>
    <string>true</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>${escapeXml(options.pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(options: ServiceOptions): string {
  return `[Unit]
Description=Chat2Codex Feishu/Lark bridge
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${quoteSystemd(options.projectDir)}
Environment=${quoteSystemd("NODE_ENV=production")}
Environment=${quoteSystemd("CHAT2CODEX_SERVICE_RESTART_ENABLED=true")}
Environment=${quoteSystemd(`PATH=${options.pathEnv}`)}
EnvironmentFile=-${quoteSystemd(options.envFile)}
ExecStart=${quoteSystemd(options.nodeBin)} ${quoteSystemd(options.entrypoint)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

async function installService(options: ServiceOptions): Promise<void> {
  await ensureInstallInputs(options);
  if (options.target === "windows-task") {
    assertPlatform("win32", "windows-task");
    const home = path.resolve(options.projectDir);
    const serviceRoot = path.join(home, ".service", "windows");
    const result = await installWindowsUserTask({
      home, envFile: options.envFile, launcherPath: options.windowsLauncherPath,
      taskXmlPath: path.join(serviceRoot, "task.xml"), manifestPath: path.join(serviceRoot, "installation.json"),
      nodeBin: options.nodeBin, entrypoint: options.entrypoint, logFile: options.stderrPath,
      pathEnv: options.pathEnv, taskName: options.windowsTaskName, statePath: path.join(home, ".data", "state.json"),
    }, windowsServiceIo(home));
    console.log(`Installed Windows user task: ${result.taskPath}`);
    console.log(`Manifest: ${path.join(serviceRoot, "installation.json")}`);
    return;
  }
  if (options.target === "launchd") {
    await installLaunchd(options);
    return;
  }
  await installSystemd(options);
}

async function uninstallService(options: ServiceOptions): Promise<void> {
  if (options.target === "windows-task") {
    assertPlatform("win32", "windows-task");
    const home = path.resolve(options.projectDir);
    await uninstallWindowsUserTask(path.join(home, ".service", "windows", "installation.json"), windowsServiceIo(home));
    console.log(`Uninstalled Windows user task: ${windowsTaskPath(options.windowsTaskName)}`);
    return;
  }
  if (options.target === "launchd") {
    await uninstallLaunchd(options);
    return;
  }
  await uninstallSystemd(options);
}

async function installLaunchd(options: ServiceOptions): Promise<void> {
  assertPlatform("darwin", "launchd");
  const plistPath = launchdPlistPath(options.launchdLabel);
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(path.dirname(options.stderrPath), { recursive: true });
  await fs.writeFile(plistPath, renderLaunchdPlist(options));

  const domain = launchdDomain();
  run("launchctl", ["bootout", domain, plistPath], { allowFailure: true });
  run("launchctl", ["enable", `${domain}/${options.launchdLabel}`]);
  run("launchctl", ["bootstrap", domain, plistPath]);
  run("launchctl", ["kickstart", "-k", `${domain}/${options.launchdLabel}`]);

  console.log(`Installed launchd service: ${options.launchdLabel}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Rotating log: ${options.stderrPath}`);
}

async function uninstallLaunchd(options: ServiceOptions): Promise<void> {
  assertPlatform("darwin", "launchd");
  const plistPath = launchdPlistPath(options.launchdLabel);
  run("launchctl", ["bootout", launchdDomain(), plistPath], { allowFailure: true });
  await fs.rm(plistPath, { force: true });
  console.log(`Uninstalled launchd service: ${options.launchdLabel}`);
}

async function installSystemd(options: ServiceOptions): Promise<void> {
  assertPlatform("linux", "systemd");
  const unitPath = systemdUnitPath(options.systemdServiceName);
  await fs.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.writeFile(unitPath, renderSystemdUnit(options));

  const unitName = `${options.systemdServiceName}.service`;
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", unitName]);

  console.log(`Installed systemd user service: ${unitName}`);
  console.log(`Unit: ${unitPath}`);
  console.log(`Logs: journalctl --user -u ${unitName} -f`);
}

async function uninstallSystemd(options: ServiceOptions): Promise<void> {
  assertPlatform("linux", "systemd");
  const unitName = `${options.systemdServiceName}.service`;
  run("systemctl", ["--user", "disable", "--now", unitName], { allowFailure: true });
  await fs.rm(systemdUnitPath(options.systemdServiceName), { force: true });
  run("systemctl", ["--user", "daemon-reload"], { allowFailure: true });
  console.log(`Uninstalled systemd user service: ${unitName}`);
}

async function ensureInstallInputs(options: ServiceOptions): Promise<void> {
  const missing: string[] = [];
  if (!(await fileExists(options.envFile))) {
    missing.push(`${options.envFile} (.env; run chat2codex setup first)`);
  }
  if (!(await fileExists(options.entrypoint))) {
    missing.push(`${options.entrypoint} (install chat2codex globally, or run bun run build first)`);
  }
  if (missing.length > 0) {
    throw new Error(`Cannot install service; missing required file(s):\n- ${missing.join("\n- ")}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function printService(options: ServiceOptions): void {
  if (options.target === "windows-task") {
    console.log(`# target: ${options.target}`);
    console.log(`# task: ${windowsTaskPath(options.windowsTaskName)}`);
    console.log(renderWindowsLauncher({ nodeBin: options.nodeBin, entrypoint: options.entrypoint, envFile: options.envFile, logFile: options.stderrPath, pathEnv: options.pathEnv, workingDirectory: options.projectDir }));
    console.log(renderWindowsTaskXml({ taskName: options.windowsTaskName, userSid: "S-1-0-0", launcherPath: options.windowsLauncherPath }));
    return;
  }
  const filePath =
    options.target === "launchd"
      ? launchdPlistPath(options.launchdLabel)
      : systemdUnitPath(options.systemdServiceName);
  const content =
    options.target === "launchd" ? renderLaunchdPlist(options) : renderSystemdUnit(options);

  console.log(`# target: ${options.target}`);
  console.log(`# file: ${filePath}`);
  console.log(content);
}

export interface ServiceCliArgs {
  command?: ServiceCommand;
  target?: ServiceTarget;
  projectDir?: string;
  entrypoint?: string;
  envFile?: string;
  nodeBin?: string;
  pathEnv?: string;
  launchdLabel?: string;
  systemdServiceName?: string;
  windowsTaskName?: string;
  windowsLauncherPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  help?: boolean;
}

function parseCliArgs(argv: string[]): ServiceCliArgs {
  const result: ServiceCliArgs = {};
  const rest = [...argv];
  const first = rest[0];
  if (first === "print" || first === "install" || first === "uninstall") {
    result.command = rest.shift() as ServiceCommand;
  } else {
    result.command = "print";
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    const [name, inlineValue] = arg.split("=", 2);
    if (!name.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = inlineValue ?? rest[++index];
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }

    switch (name) {
      case "--target":
        result.target = parseTarget(value);
        break;
      case "--project-dir":
        result.projectDir = value;
        break;
      case "--entrypoint":
        result.entrypoint = value;
        break;
      case "--env":
      case "--env-file":
        result.envFile = value;
        break;
      case "--node-bin":
        result.nodeBin = value;
        break;
      case "--path":
        result.pathEnv = value;
        break;
      case "--launchd-label":
        result.launchdLabel = value;
        break;
      case "--systemd-name":
        result.systemdServiceName = value;
        break;
      case "--windows-task-name":
        result.windowsTaskName = value;
        break;
      case "--windows-launcher":
        result.windowsLauncherPath = value;
        break;
      case "--stdout":
        result.stdoutPath = value;
        break;
      case "--stderr":
        result.stderrPath = value;
        break;
      default:
        throw new Error(`Unknown option: ${name}`);
    }
  }

  return result;
}

function parseTarget(value: string): ServiceTarget {
  if (value === "launchd" || value === "systemd" || value === "windows-task") {
    return value;
  }
  throw new Error(`Unsupported service target: ${value}`);
}

function normalizeSystemdServiceName(value: string): string {
  return value.endsWith(".service") ? value.slice(0, -".service".length) : value;
}

function findExecutable(command: string): string {
  if (command === "node" && path.isAbsolute(process.execPath)) return process.execPath;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { encoding: "utf8", windowsHide: true });
  const found = result.status === 0 ? result.stdout.split(/\r?\n/u).map((item) => item.trim()).find((item) => path.isAbsolute(item)) ?? "" : "";
  if (found) {
    return found;
  }
  if (path.basename(process.execPath) === command) {
    return process.execPath;
  }
  return command;
}

function defaultEntrypoint(projectDir: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.dirname(moduleDir);
  if (path.basename(parentDir) === "dist") {
    return path.join(parentDir, "index.js");
  }
  return path.join(projectDir, "dist", "index.js");
}

function run(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function windowsServiceIo(home: string): WindowsServiceIo {
  return {
    currentUserSid: async () => {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      ], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
      const sid = stdout.trim();
      if (!/^S-[0-9]+(?:-[0-9]+)+$/u.test(sid)) throw new Error("Could not determine the current Windows user SID.");
      return sid;
    },
    now: () => new Date(), packageVersion: readPackageVersion,
    readText: async (filePath) => fs.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
    writeTextAtomic: async (filePath, content) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
        await fs.rename(temporary, filePath);
      } finally { await fs.rm(temporary, { force: true }); }
    },
    removeFile: (filePath) => fs.rm(filePath, { force: true }),
    assertOwnedPath: (filePath) => assertCanonicalWindowsOwnedPath(home, filePath),
    protectPrivateFile: async (filePath) => { await applyOwnerOnlyWindowsAcl(filePath); const report = await inspectWindowsTokenAcl(filePath); requireOwnerOnlyWindowsTokenAcl(report); },
    stopWriters: async (entrypoint) => {
      const script = "Get-CimInstance Win32_Process | ForEach-Object {[pscustomobject]@{ProcessId=[int]$_.ProcessId;CreationDate=$_.CreationDate.ToUniversalTime().ToString('o');CommandLine=[string]$_.CommandLine}} | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const raw = JSON.parse(stdout || "[]"); const rows = Array.isArray(raw) ? raw : [raw];
      const writers = rows.filter((row) => isWindowsChat2CodexWriter(row, entrypoint, process.pid));
      for (const writer of writers) {
        const stopScript = "$p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:C2C_PID); if(!$p){exit 0}; if($p.CreationDate.ToUniversalTime().ToString('o') -ne $env:C2C_CREATED){throw 'writer identity changed'}; Stop-Process -Id ([int]$env:C2C_PID) -Force -ErrorAction Stop";
        await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", stopScript], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true, env: { ...process.env, C2C_PID: String(writer.ProcessId), C2C_CREATED: String(writer.CreationDate) } });
      }
      const { stdout: remainingSource } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const remainingRaw = JSON.parse(remainingSource || "[]"); const remaining = (Array.isArray(remainingRaw) ? remainingRaw : [remainingRaw]).filter((row) => isWindowsChat2CodexWriter(row, entrypoint, process.pid));
      if (remaining.length > 0) throw new Error("Windows writer remained after stop.");
      return writers.length;
    },
    taskExists: async (taskPath) => {
      const result = spawnSync("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"], { encoding: "utf8", windowsHide: true });
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" || result.status === 1 || result.status === -1073741510) return false;
      if (result.status === 0) return true;
      throw new Error("Windows task state is uncertain.", { cause: result.error });
    },
    ensureGatewayKeys: () => ensureWindowsGatewayKeys({
      root: path.join(home, ".secrets", "desktop-gateway"),
      applyAcl: applyOwnerOnlyWindowsAcl,
      inspectAcl: async (filePath) => {
        const report = await inspectWindowsTokenAcl(filePath);
        requireOwnerOnlyWindowsTokenAcl(report);
        return report;
      },
    }),
    runFile: async (command, args) => {
      const { stdout } = await execFileAsync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
      return stdout;
    },
  };
}

function assertPlatform(expected: NodeJS.Platform, target: ServiceTarget): void {
  if (process.platform !== expected) {
    throw new Error(`${target} install is only supported on ${expected}; use print to render files.`);
  }
}

function launchdDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("Cannot determine current uid for launchd bootstrap domain.");
  }
  return `gui/${uid}`;
}

function quoteSystemd(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url));
}

function printHelp(): void {
  console.log(`Usage:
  chat2codex service print [options]
  chat2codex service install [options]
  chat2codex service uninstall [options]

Options:
  --target launchd|systemd|windows-task
                                  Defaults to the native current-user target
  --project-dir <path>           Defaults to ~/.chat2codex
  --entrypoint <path>            Defaults to the installed chat2codex entrypoint,
                                  or dist/index.js when run from source
  --env <path>                   Env file path; defaults to ~/.chat2codex/.env
  --node-bin <path>              Defaults to the current node executable from PATH
  --path <PATH>                  PATH passed to the service environment
                                  Defaults to a stable service PATH
  --launchd-label <label>        Defaults to com.chat2codex.bridge
  --systemd-name <name>          Defaults to chat2codex
  --windows-task-name <name>     Defaults to Chat2Codex
  --windows-launcher <path>      Defaults under CHAT2CODEX_HOME/.service/windows
  --stdout <path>                Legacy launchd stdout path option; service output
                                  is discarded in favor of the rotating log
  --stderr <path>                launchd rotating application log path; defaults
                                  under ~/.chat2codex/.data/logs
`);
}
