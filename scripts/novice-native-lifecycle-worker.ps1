param(
  [Parameter(Mandatory=$true)][string]$NodeBin,
  [Parameter(Mandatory=$true)][string]$LifecycleScript,
  [Parameter(Mandatory=$true)][string]$OwnedRoot,
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[IO.Directory]::CreateDirectory($OwnedRoot) | Out-Null
$env:TEMP = $OwnedRoot
$env:TMP = $OwnedRoot
$env:USERPROFILE = $ProfilePath
$env:HOME = $ProfilePath
$env:C2C_NATIVE_LIFECYCLE_REPORT = $ReportPath
& $NodeBin $LifecycleScript
exit $LASTEXITCODE
