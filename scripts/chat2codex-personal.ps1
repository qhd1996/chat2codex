param(
  [Parameter(Mandatory=$true)][ValidateSet('Install','Upgrade','Rollback','Uninstall','Reinstall','Doctor')][string]$Action,
  [string]$ArchivePath,
  [string]$ArchiveSha256,
  [string]$ReceiptId,
  [string]$InstallHome,
  [string]$NpmPrefix,
  [string]$NodeBin,
  [string]$CodexBin,
  [switch]$RequireDesktop,
  [switch]$DryRun,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Stop-Portable([string]$code,[string]$nextAction) {
  $value = [ordered]@{ code=$code; what_happened='The personal portable action could not continue.'; safe_state='No Chat2Codex mutation was started.'; next_action=$nextAction }
  if ($Json) { Write-Output ($value | ConvertTo-Json -Compress) } else { Write-Output ($code + ': ' + $nextAction) }
  exit 1
}
function Resolve-Executable([string]$explicit,[string]$name) {
  if ($explicit) { if (Test-Path -LiteralPath $explicit -PathType Leaf) { return (Resolve-Path -LiteralPath $explicit).Path }; return $null }
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}
function Test-AbsoluteWindowsPath([string]$value) {
  if (-not $value -or -not [IO.Path]::IsPathRooted($value)) { return $false }
  return $value -match '^[A-Za-z]:[\\/]' -or $value -match '^\\\\[^\\]+\\[^\\]+'
}

$archiveRequired = $Action -in @('Install','Upgrade','Reinstall')
if ($archiveRequired -and (-not $ArchivePath -or -not $ArchiveSha256)) { Stop-Portable 'PORTABLE_ARCHIVE_REQUIRED' 'Provide the reviewed archive and SHA-256.' }
if ($ArchivePath) {
  if (-not (Test-AbsoluteWindowsPath $ArchivePath) -or -not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { Stop-Portable 'PORTABLE_ARCHIVE_INVALID' 'Provide an existing absolute archive path.' }
  if ($ArchiveSha256 -notmatch '^[a-fA-F0-9]{64}$') { Stop-Portable 'PORTABLE_ARCHIVE_HASH_INVALID' 'Provide the 64-character archive SHA-256.' }
  $actualArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
  if ($actualArchiveHash -ne $ArchiveSha256.ToLowerInvariant()) { Stop-Portable 'PORTABLE_ARCHIVE_HASH_MISMATCH' 'Download or select the reviewed archive and retry.' }
}

if (-not $InstallHome) {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'AppData\Local' } else { $null }
  if (-not $base) { Stop-Portable 'PORTABLE_CURRENT_USER_PATH_MISSING' 'Run from a normal Windows user profile.' }
  $InstallHome = Join-Path $base 'Chat2Codex'
}
if (-not (Test-AbsoluteWindowsPath $InstallHome)) { Stop-Portable 'PORTABLE_HOME_INVALID' 'Use an absolute personal installation home.' }
if (-not $NpmPrefix) { $NpmPrefix = Join-Path $InstallHome 'npm' }
if (-not (Test-AbsoluteWindowsPath $NpmPrefix)) { Stop-Portable 'PORTABLE_NPM_PREFIX_INVALID' 'Use an absolute npm prefix under the personal home.' }
$normalizedHome = [IO.Path]::GetFullPath($InstallHome).TrimEnd('\','/')
$normalizedPrefix = [IO.Path]::GetFullPath($NpmPrefix)
if (-not $normalizedPrefix.StartsWith($normalizedHome + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Stop-Portable 'PORTABLE_NPM_PREFIX_INVALID' 'Use an absolute npm prefix under the personal home.' }

if ($Action -eq 'Uninstall' -and -not $ArchivePath) {
  $portableManifest = Join-Path $InstallHome 'portable-installation.json'
  $serviceManifest = Join-Path $InstallHome '.service\windows\installation.json'
  $installedEntrypoint = Join-Path $NpmPrefix 'node_modules\chat2codex\dist\index.js'
  if (-not (Test-Path -LiteralPath $portableManifest) -and -not (Test-Path -LiteralPath $serviceManifest) -and -not (Test-Path -LiteralPath $installedEntrypoint) -and -not (Test-Path -LiteralPath $NpmPrefix)) {
    if ($Json) { Write-Output '{"action":"uninstall","status":"already_uninstalled","removed":false}' } else { Write-Output 'Chat2Codex is already uninstalled.' }
    exit 0
  }
}

$NodeBin = Resolve-Executable $NodeBin 'node.exe'
if (-not $NodeBin) { Stop-Portable 'PORTABLE_NODE_MISSING' 'Install a supported Node.js release and retry.' }
$npmCli = Join-Path (Split-Path $NodeBin -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand) {
    $resolvedNpmCli = Join-Path (Split-Path $npmCommand.Source -Parent) 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $resolvedNpmCli -PathType Leaf) { $npmCli = $resolvedNpmCli } else { Stop-Portable 'PORTABLE_NPM_MISSING' 'Install npm with Node.js and retry.' }
  } else { Stop-Portable 'PORTABLE_NPM_MISSING' 'Install npm with Node.js and retry.' }
}
$CodexBin = Resolve-Executable $CodexBin 'codex.exe'
if (-not $CodexBin) { Stop-Portable 'PORTABLE_CODEX_MISSING' 'Install the supported Codex CLI and retry.' }
if ($RequireDesktop) {
  $desktop = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue
  if (-not $desktop) { Stop-Portable 'PORTABLE_DESKTOP_MISSING' 'Install Codex Desktop before requesting Desktop integration.' }
}

$portableArgs = @('portable',$Action.ToLowerInvariant(),'--home',$InstallHome,'--npm-prefix',$NpmPrefix)
if ($ArchivePath) { $portableArgs += @('--archive',$ArchivePath,'--sha256',$ArchiveSha256.ToLowerInvariant()) }
if ($ReceiptId) { $portableArgs += @('--receipt',$ReceiptId) }
if ($DryRun) { $portableArgs += '--dry-run' }
if ($Json) { $portableArgs += '--json' }

$controllerRoot = $null
try {
  $entrypoint = Join-Path $NpmPrefix 'node_modules\chat2codex\dist\index.js'
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    if (-not $ArchivePath -or -not $ArchiveSha256) { Stop-Portable 'PORTABLE_ARCHIVE_REQUIRED' 'Provide the reviewed archive and SHA-256 when no installed controller is available.' }
    $controllerRoot = Join-Path ([IO.Path]::GetTempPath()) ('chat2codex-controller-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($controllerRoot) | Out-Null
    & $NodeBin $npmCli install --ignore-scripts --no-audit --no-fund --prefix $controllerRoot $ArchivePath | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Portable 'PORTABLE_CONTROLLER_INSTALL_FAILED' 'Verify npm access and the reviewed archive, then retry.' }
    $entrypoint = Join-Path $controllerRoot 'node_modules\chat2codex\dist\index.js'
  }
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { Stop-Portable 'PORTABLE_PACKAGE_INVALID' 'Reinstall the reviewed Chat2Codex package.' }
  $env:CODEX_BIN = $CodexBin
  $env:CHAT2CODEX_NPM_CLI = $npmCli
  & $NodeBin $entrypoint @portableArgs
  $portableExitCode = $LASTEXITCODE
  exit $portableExitCode
} finally {
  if ($controllerRoot -and (Test-Path -LiteralPath $controllerRoot)) { Remove-Item -LiteralPath $controllerRoot -Recurse -Force }
}
