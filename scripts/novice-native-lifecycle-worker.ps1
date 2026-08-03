param(
  [Parameter(Mandatory=$true)][string]$NodeBin,
  [Parameter(Mandatory=$true)][string]$LifecycleScript,
  [Parameter(Mandatory=$true)][string]$OwnedRoot,
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [Parameter(Mandatory=$true)][string]$IdentityReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Write-FailureReport([string]$stage,[string]$code,[string]$exceptionType) {
  $report = [ordered]@{schemaVersion=1;verdict='fail';summary=$null;failure=[ordered]@{stage=$stage;exceptionType=$exceptionType;code=$code;errno=$null;hResult=$null};cleanup=[ordered]@{attempted=$false;succeeded=$false}}
  [IO.Directory]::CreateDirectory((Split-Path $ReportPath -Parent)) | Out-Null
  [IO.File]::WriteAllText($ReportPath,(($report|ConvertTo-Json -Compress -Depth 6)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
}
try {
  [IO.Directory]::CreateDirectory($OwnedRoot) | Out-Null
  [IO.Directory]::CreateDirectory($ProfilePath) | Out-Null
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $sidHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity.User.Value)))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
  $administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  [IO.File]::WriteAllText($IdentityReportPath,(([ordered]@{schemaVersion=1;sidHash=$sidHash;administrator=$administrator}|ConvertTo-Json -Compress)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  $env:TEMP = $OwnedRoot
  $env:TMP = $OwnedRoot
  $env:USERPROFILE = $ProfilePath
  $env:HOME = $ProfilePath
  $env:C2C_NATIVE_LIFECYCLE_REPORT = $ReportPath
  if (-not (Test-Path -LiteralPath $NodeBin -PathType Leaf)) { Write-FailureReport 'worker/node_check' 'NODE_MISSING' 'ProcessFailure'; exit 1 }
  if (-not (Test-Path -LiteralPath $LifecycleScript -PathType Leaf)) { Write-FailureReport 'worker/script_check' 'SCRIPT_MISSING' 'ProcessFailure'; exit 1 }
  & $NodeBin $LifecycleScript
  $nodeExit = $LASTEXITCODE
  if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) { Write-FailureReport 'worker/report_missing' ('exit_' + $nodeExit) 'ProcessFailure'; exit 1 }
  if ($nodeExit -ne 0) { exit $nodeExit }
  exit 0
} catch {
  try { Write-FailureReport 'worker/node_invoke' 'unavailable' $_.Exception.GetType().FullName } catch {}
  exit 1
}
