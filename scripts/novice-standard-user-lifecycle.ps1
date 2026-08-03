param([Parameter(Mandatory=$true)][string]$NodeBin,[Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = $env:GITHUB_SHA
if ($identity -notmatch '^[a-f0-9]{40}$') { $identity = 'local' + ([Guid]::NewGuid().ToString('N')) }
$taskName = 'C2C-Native-' + $identity.Substring(0,8)
$ownedRoot = Join-Path ([IO.Path]::GetTempPath()) ('C2C-Native-' + $identity.Substring(0,8))
$profilePath = Join-Path $ownedRoot 'profile'
$childReport = Join-Path $ownedRoot 'native-lifecycle-status.json'
$identityReport = Join-Path $ownedRoot 'identity.json'
$worker = Join-Path $PSScriptRoot 'novice-native-lifecycle-worker.ps1'
$lifecycleScript = Join-Path $PSScriptRoot 'novice-native-lifecycle-built.mjs'
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $currentIdentity.User.Value
$hasher = [Security.Cryptography.SHA256]::Create()
try { $currentSidHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($currentSid)))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
$failure = $null
$stage = 'preflight'
$childExit = -1
$value = $null
$execution = $null
function Quote-TaskArgument([string]$value) {
  if ($value.Contains('"')) { throw 'Scheduled Task argument contains a quote.' }
  return '"' + $value + '"'
}
try {
  $stage = 'preflight'
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Exact diagnostic task already exists.' }
  if (Test-Path -LiteralPath $ownedRoot) { throw 'Exact diagnostic root already exists.' }
  $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Quote-TaskArgument $worker),'-NodeBin',(Quote-TaskArgument $NodeBin),'-LifecycleScript',(Quote-TaskArgument $lifecycleScript),'-OwnedRoot',(Quote-TaskArgument $ownedRoot),'-ProfilePath',(Quote-TaskArgument $profilePath),'-ReportPath',(Quote-TaskArgument $childReport),'-IdentityReportPath',(Quote-TaskArgument $identityReport)) -join ' '
  $stage = 'scheduled_task/action'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $PSScriptRoot
  $stage = 'scheduled_task/settings'
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(1)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $stage = 'scheduled_task/register'
  $principal = New-ScheduledTaskPrincipal -UserId $currentSid -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal | Out-Null
  $registeredTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $stage = 'scheduled_task/verify_logon'
  if ($registeredTask.Principal.LogonType -ne 'Interactive') { throw 'Scheduled Task principal is not interactive-token.' }
  $stage = 'scheduled_task/verify_runlevel'
  if ($registeredTask.Principal.RunLevel -ne 'Limited') { throw 'Scheduled Task principal is not least-privilege.' }
  $stage = 'scheduled_task/start'
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $task = @(Get-ScheduledTask -TaskName $taskName -ErrorAction Stop | Where-Object TaskName -EQ $taskName | Select-Object -First 1)
    if ($task.Count -eq 1 -and $task[0].State -ne 'Running' -and (Test-Path -LiteralPath $childReport -PathType Leaf) -and (Test-Path -LiteralPath $identityReport -PathType Leaf)) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  $childExit = [int]$taskInfo.LastTaskResult
  if ($childExit -ne 0) {
    $failure = [ordered]@{stage='standard_user_wrapper/scheduled_task/exit';exceptionType='ProcessFailure';code=('exit_' + $childExit);errno=$null;hResult=$null}
    throw 'Scheduled Task lifecycle worker failed.'
  }
  $stage = 'identity_report'
  if (-not (Test-Path -LiteralPath $identityReport -PathType Leaf)) { throw 'Limited-token identity report is missing.' }
  $limitedIdentity = Get-Content -LiteralPath $identityReport -Raw | ConvertFrom-Json
  if ($limitedIdentity.schemaVersion -ne 1 -or $limitedIdentity.administrator -ne $false -or $limitedIdentity.sidHash -ne $currentSidHash) { throw 'Limited-token identity report is invalid.' }
  $execution = [ordered]@{identity='current_runner';logonType='Interactive';runLevel='Limited';administrator=$false;sidMatched=$true;profileMode='disposable_env'}
  $stage = 'owner_check'
  $owner = [IO.Directory]::GetAccessControl($ownedRoot,[Security.AccessControl.AccessControlSections]::Owner).GetOwner([Security.Principal.SecurityIdentifier])
  if ($owner.Value -ne $currentSid) { throw 'Limited-token root owner differs.' }
  $stage = 'report_read'
  if (-not (Test-Path -LiteralPath $childReport -PathType Leaf)) {
    $failure = [ordered]@{stage='standard_user_wrapper/scheduled_task/report_missing';exceptionType='ProcessFailure';code='unavailable';errno=$null;hResult=$null}
    throw 'Limited-token lifecycle report is missing.'
  }
  $value = Get-Content -LiteralPath $childReport -Raw | ConvertFrom-Json
  if ($value.verdict -ne 'pass') { $failure = $value.failure }
} catch {
  if (-not $failure) { $failure = [ordered]@{stage=('standard_user_wrapper/'+$stage);exceptionType=$_.Exception.GetType().FullName;code='unavailable';errno=$null;hResult=[int]$_.Exception.HResult} }
}
finally {
  $cleanupFailure = $null
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop }; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop }
  } catch { $cleanupFailure = 'task_cleanup' }
  try { if (Test-Path -LiteralPath $ownedRoot) { Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction Stop } } catch { if (-not $cleanupFailure) { $cleanupFailure = 'root_cleanup' } }
  try { $residualTasks = @(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Where-Object TaskName -EQ $taskName).Count } catch { $residualTasks = -1; if (-not $cleanupFailure) { $cleanupFailure = 'task_query' } }
  $residualUsers = 0
  try { $residualProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -like ('*C2C-Native-' + $identity.Substring(0,8) + '*') }).Count } catch { $residualProcesses = -1; if (-not $cleanupFailure) { $cleanupFailure = 'process_query' } }
  $profileExists = Test-Path -LiteralPath $profilePath
  $ownedRootExists = Test-Path -LiteralPath $ownedRoot
  $report = [ordered]@{schemaVersion=1;verdict=if(-not$failure-and$execution-and-not$cleanupFailure-and$childExit-eq0-and$residualTasks-eq0-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists){'pass'}else{'fail'};execution=$execution;summary=if($value){$value.summary}else{$null};failure=$failure;cleanup=[ordered]@{attempted=$true;succeeded=-not$cleanupFailure-and$residualTasks-eq0-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists;failure=$cleanupFailure;residualTasks=$residualTasks;residualUsers=$residualUsers;residualProcesses=$residualProcesses;profileExists=$profileExists;ownedRootExists=$ownedRootExists}}
  [IO.Directory]::CreateDirectory((Split-Path $ReportPath -Parent)) | Out-Null
  [IO.File]::WriteAllText($ReportPath,(($report|ConvertTo-Json -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
}
if ($report.verdict -ne 'pass') { Write-Host ('NATIVE_LIFECYCLE_FAIL ' + ($report|ConvertTo-Json -Compress -Depth 8)); exit 1 }
