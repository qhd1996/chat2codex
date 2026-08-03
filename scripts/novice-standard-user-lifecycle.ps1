param([Parameter(Mandatory=$true)][string]$NodeBin,[Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = $env:GITHUB_SHA
if ($identity -notmatch '^[a-f0-9]{40}$') { $identity = 'local' + ([Guid]::NewGuid().ToString('N')) }
$userName = 'C2CN' + $identity.Substring(0,8)
$profileRoot = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -Name ProfilesDirectory -ErrorAction Stop).ProfilesDirectory)
$profilePath = Join-Path $profileRoot $userName
$ownedRoot = Join-Path $profilePath ('AppData\Local\Temp\C2C-Native-' + $identity.Substring(0,8))
$childReport = Join-Path $ownedRoot 'native-lifecycle-status.json'
$created = $false
$failure = $null
$stage = 'preflight'
$childExit = -1
$stdout = ''
$stderr = ''
$value = $null
function New-Password([string]$source) {
  $bytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($source + [Guid]::NewGuid().ToString('N')))
  return 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('+','A').Replace('/','B').Replace('=','C')
}
function Start-AsUser([string]$file,[string]$arguments,[hashtable]$environment) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $file
  $info.Arguments = $arguments
  $info.UserName = $userName
  $info.Domain = $env:COMPUTERNAME
  $info.Password = $secure
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.LoadUserProfile = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach($item in $environment.GetEnumerator()) { $info.EnvironmentVariables[$item.Key] = [string]$item.Value }
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw 'Standard-user process did not start.' }
  $out = $process.StandardOutput.ReadToEnd()
  $err = $process.StandardError.ReadToEnd()
  if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit(); throw 'Standard-user process exceeded the fixed diagnostic bound.' }
  return [ordered]@{ ExitCode=$process.ExitCode; Stdout=$out; Stderr=$err }
}
try {
  $stage = 'preflight'
  if (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue) { throw 'Exact diagnostic user already exists.' }
  if (Test-Path -LiteralPath $profilePath) { throw 'Exact diagnostic profile already exists.' }
  if (Test-Path -LiteralPath $ownedRoot) { throw 'Exact diagnostic root already exists.' }
  $stage = 'user_create'
  $plain = New-Password $identity
  $secure = ConvertTo-SecureString $plain -AsPlainText -Force
  New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires | Out-Null
  $created = $true
  $stage = 'root_create'
  $cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $make = Start-AsUser $cmd ('/d /c mkdir "' + $ownedRoot + '"') @{ USERPROFILE=$profilePath; HOME=$profilePath }
  if ($make.ExitCode -ne 0) {
    $failure = [ordered]@{stage='standard_user_wrapper/root_create';exceptionType='ProcessFailure';code=('exit_' + $make.ExitCode);errno=$null;hResult=$null}
    throw 'Standard-user root creation failed.'
  }
  if (-not (Test-Path -LiteralPath $ownedRoot -PathType Container)) { throw 'Standard-user root creation failed.' }
  $owner = [IO.Directory]::GetAccessControl($ownedRoot,[Security.AccessControl.AccessControlSections]::Owner).GetOwner([Security.Principal.SecurityIdentifier])
  $stage = 'owner_check'
  $createdUser = Get-LocalUser -Name $userName
  if ($owner.Value -ne $createdUser.SID.Value) { throw 'Standard-user root owner differs.' }
  $environment = @{ TEMP=$ownedRoot; TMP=$ownedRoot; USERPROFILE=$profilePath; HOME=$profilePath; C2C_NATIVE_LIFECYCLE_REPORT=$childReport }
  $script = Join-Path $PSScriptRoot 'novice-native-lifecycle-built.mjs'
  $stage = 'process_start'
  $run = Start-AsUser $NodeBin ('"' + $script + '"') $environment
  $childExit = $run.ExitCode
  $stdout = $run.Stdout
  $stderr = $run.Stderr
  $stage = 'report_read'
  if (-not (Test-Path -LiteralPath $childReport -PathType Leaf)) { throw 'Standard-user lifecycle report is missing.' }
  $value = Get-Content -LiteralPath $childReport -Raw | ConvertFrom-Json
  if ($childExit -ne 0 -or $value.verdict -ne 'pass') { $failure = $value.failure }
} catch { if (-not $failure) { $failure = [ordered]@{stage=('standard_user_wrapper/'+$stage);exceptionType=$_.Exception.GetType().FullName;code='unavailable';errno=$null;hResult=[int]$_.Exception.HResult} } }
finally {
  $cleanupFailure = $null
  try { if ($created -and (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue)) { Remove-LocalUser -Name $userName -ErrorAction Stop } } catch { $cleanupFailure = 'user_cleanup' }
  try { if ($created -and (Test-Path -LiteralPath $profilePath)) { Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction Stop } } catch { if (-not $cleanupFailure) { $cleanupFailure = 'profile_cleanup' } }
  if (Test-Path -LiteralPath $ownedRoot) { Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction SilentlyContinue }
  try { $residualUsers = @(Get-LocalUser -ErrorAction Stop | Where-Object Name -EQ $userName).Count } catch { $residualUsers = -1; if (-not $cleanupFailure) { $cleanupFailure = 'user_query' } }
  try { $residualProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*C2C-Native-' + $identity.Substring(0,8) + '*') }).Count } catch { $residualProcesses = -1; if (-not $cleanupFailure) { $cleanupFailure = 'process_query' } }
  $profileExists = Test-Path -LiteralPath $profilePath
  $ownedRootExists = Test-Path -LiteralPath $ownedRoot
  $report = [ordered]@{schemaVersion=1;verdict=if(-not$failure-and-not$cleanupFailure-and$childExit-eq0-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists){'pass'}else{'fail'};summary=if($value){$value.summary}else{$null};failure=$failure;cleanup=[ordered]@{attempted=$true;succeeded=-not$cleanupFailure-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists;failure=$cleanupFailure;residualUsers=$residualUsers;residualProcesses=$residualProcesses;profileExists=$profileExists;ownedRootExists=$ownedRootExists}}
  [IO.Directory]::CreateDirectory((Split-Path $ReportPath -Parent)) | Out-Null
  [IO.File]::WriteAllText($ReportPath,(($report|ConvertTo-Json -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
}
$stdout | Write-Host
if ($failure) { Write-Host ('NATIVE_LIFECYCLE_FAIL ' + ($report|ConvertTo-Json -Compress -Depth 8)); exit 1 }
