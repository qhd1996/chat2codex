import path from "node:path";

export interface WindowsTaskDefinition {
  taskName: string;
  userSid: string;
  launcherPath: string;
}

export interface WindowsLauncherDefinition {
  nodeBin: string;
  entrypoint: string;
  envFile: string;
  logFile: string;
  pathEnv: string;
  workingDirectory: string;
}

const sidPattern = /^S-[0-9]+(?:-[0-9]+)+$/u;
const controlPattern = /[\u0000-\u001f\u007f]/u;

export function renderWindowsTaskXml(input: WindowsTaskDefinition): string {
  const taskName = validateTaskName(input.taskName);
  if (!sidPattern.test(input.userSid)) throw new Error("Windows task user SID is invalid.");
  const launcherPath = windowsAbsolute(input.launcherPath, "Windows task launcher");
  const argumentsText = [
    "-NoLogo", "-NoProfile", "-NonInteractive",
    "-ExecutionPolicy", "Bypass", "-File", psQuote(launcherPath),
  ].join(" " );
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><URI>\\Chat2Codex\\${xml(taskName)}</URI></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(input.userSid)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xml(input.userSid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>${xml(argumentsText)}</Arguments></Exec></Actions>
</Task>
`;
}

export function renderWindowsLauncher(input: WindowsLauncherDefinition): string {
  const nodeBin = windowsAbsolute(input.nodeBin, "Node executable");
  const entrypoint = windowsAbsolute(input.entrypoint, "Chat2Codex entrypoint");
  const envFile = windowsAbsolute(input.envFile, "Chat2Codex env file");
  const logFile = windowsAbsolute(input.logFile, "Chat2Codex log file");
  const workingDirectory = windowsAbsolute(input.workingDirectory, "Chat2Codex working directory");
  boundedText(input.pathEnv, "Windows service PATH", 32_768);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$env:CHAT2CODEX_ENV = ${psQuote(envFile)}`,
    `$env:CHAT2CODEX_LOG_FILE = ${psQuote(logFile)}`,
    "$env:CHAT2CODEX_SERVICE_RESTART_ENABLED = 'true'",
    "$env:NODE_ENV = 'production'",
    `$env:PATH = ${psQuote(input.pathEnv)}`,
    `Set-Location -LiteralPath ${psQuote(workingDirectory)}`,
    `& ${psQuote(nodeBin)} ${psQuote(entrypoint)} start *>> ${psQuote(logFile)}`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
}

export function windowsTaskPath(taskName: string): string {
  return `\\Chat2Codex\\${validateTaskName(taskName)}`;
}

function validateTaskName(value: string): string {
  boundedText(value, "Windows task name", 80);
  if (!value.trim() || /[\\/<>:"|?*]/u.test(value)) throw new Error("Windows task name is invalid.");
  return value;
}

function windowsAbsolute(value: string, label: string): string {
  boundedText(value, label, 32_768);
  if (!path.win32.isAbsolute(value)) throw new Error(`${label} must be an absolute Windows path.`);
  return path.win32.normalize(value);
}

function boundedText(value: string, label: string, max: number): void {
  if (typeof value !== "string" || !value || value.length > max) throw new Error(`${label} is missing or oversized.`);
  if (controlPattern.test(value)) throw new Error(`${label} contains control characters.`);
}

function psQuote(value: string): string { return `'${value.replace(/'/gu, "''")}'`; }
function xml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}
