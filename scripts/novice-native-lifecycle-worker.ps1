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
& $NodeBin $LifecycleScript
exit $LASTEXITCODE
