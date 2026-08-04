import { spawnSync as nodeSpawnSync } from "node:child_process";
import path from "node:path";

export function stopExactEntrypointWriters(entrypointInput, dependencies = {}) {
  const entrypoint = path.resolve(entrypointInput);
  if (!path.isAbsolute(entrypoint) || /[\r\n\0]/u.test(entrypoint)) throw new Error("Novice process cleanup entrypoint is invalid.");
  const spawnSync = dependencies.spawnSync ?? nodeSpawnSync;
  const script = [
    "$ErrorActionPreference='Stop'",
    "$needle=[string]$env:C2C_ENTRYPOINT",
    "$pattern='(?:^|[\\s\"] )'.Replace(' ','')+[Regex]::Escape($needle)+'(?=$|[\\s\"])'",
    "$matches=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -and [Regex]::IsMatch([string]$_.CommandLine,$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)})",
    "if($matches.Count -gt 1000){exit 87}",
    "foreach($process in $matches){Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop}",
    "$residual=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -and [Regex]::IsMatch([string]$_.CommandLine,$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)}).Count",
    "[ordered]@{matched=$matches.Count;residual=$residual}|ConvertTo-Json -Compress",
    "if($residual -ne 0){exit 88}",
  ].join(";");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, maxBuffer: 1024, env: { ...process.env, C2C_ENTRYPOINT: entrypoint },
  });
  if (result.status !== 0 || typeof result.stdout !== "string" || result.stdout.length > 1024) throw new Error("Novice process cleanup failed.");
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("Novice process cleanup output is invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "matched,residual" || !Number.isSafeInteger(value.matched) || value.matched < 0 || value.matched > 1000 || value.residual !== 0) throw new Error("Novice process cleanup output is invalid.");
  return { attempted: true, succeeded: true, matched: value.matched, residual: value.residual };
}
