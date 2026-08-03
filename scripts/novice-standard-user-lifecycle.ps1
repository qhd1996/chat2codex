param([Parameter(Mandatory=$true)][string]$NodeBin,[Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = $env:GITHUB_SHA
if ($identity -notmatch '^[a-f0-9]{40}$') { $identity = 'local' + ([Guid]::NewGuid().ToString('N')) }
$userName = 'C2CN' + $identity.Substring(0,8)
$taskName = 'C2C-Native-' + $identity.Substring(0,8)
$profileRoot = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -Name ProfilesDirectory -ErrorAction Stop).ProfilesDirectory)
$profilePath = Join-Path $profileRoot $userName
$ownedRoot = Join-Path $profilePath ('AppData\Local\Temp\C2C-Native-' + $identity.Substring(0,8))
$childReport = Join-Path $ownedRoot 'native-lifecycle-status.json'
$worker = Join-Path $PSScriptRoot 'novice-native-lifecycle-worker.ps1'
$lifecycleScript = Join-Path $PSScriptRoot 'novice-native-lifecycle-built.mjs'
$created = $false
$createdSid = $null
$failure = $null
$stage = 'preflight'
$childExit = -1
$value = $null
function New-Password([string]$source) {
  $bytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($source + [Guid]::NewGuid().ToString('N')))
  return 'Aa1!' + [Convert]::ToBase64String($bytes).Replace('+','A').Replace('/','B').Replace('=','C')
}
function Quote-TaskArgument([string]$value) {
  if ($value.Contains('"')) { throw 'Scheduled Task argument contains a quote.' }
  return '"' + $value + '"'
}
try {
  $stage = 'preflight'
  if (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue) { throw 'Exact diagnostic user already exists.' }
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Exact diagnostic task already exists.' }
  if (Test-Path -LiteralPath $profilePath) { throw 'Exact diagnostic profile already exists.' }
  if (Test-Path -LiteralPath $ownedRoot) { throw 'Exact diagnostic root already exists.' }
  $stage = 'user_create'
  $plain = New-Password $identity
  $secure = ConvertTo-SecureString $plain -AsPlainText -Force
  New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires | Out-Null
  $created = $true
  $createdSid = (Get-LocalUser -Name $userName -ErrorAction Stop).SID.Value
  $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Quote-TaskArgument $worker),'-NodeBin',(Quote-TaskArgument $NodeBin),'-LifecycleScript',(Quote-TaskArgument $lifecycleScript),'-OwnedRoot',(Quote-TaskArgument $ownedRoot),'-ProfilePath',(Quote-TaskArgument $profilePath),'-ReportPath',(Quote-TaskArgument $childReport)) -join ' '
  $stage = 'scheduled_task/action'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $PSScriptRoot
  $stage = 'scheduled_task/settings'
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(1)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $stage = 'scheduled_task/register'
  Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -User ($env:COMPUTERNAME + '\' + $userName) -Password $plain -RunLevel Limited | Out-Null
  $stage = 'scheduled_task/export'
  $registeredXml = Export-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $stage = 'scheduled_task/verify_logon'
  if ($registeredXml -notmatch '<LogonType>Password</LogonType>') { throw 'Scheduled Task principal is not password-logon.' }
  $stage = 'scheduled_task/verify_runlevel'
  if ($registeredXml -notmatch '<RunLevel>LeastPrivilege</RunLevel>') { throw 'Scheduled Task principal is not least-privilege.' }
  $stage = 'scheduled_task/verify_password'
  if ($registeredXml -match [Regex]::Escape($plain)) { throw 'Scheduled Task action exposes the password.' }
  $stage = 'scheduled_task/start'
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $task = @(Get-ScheduledTask -TaskName $taskName -ErrorAction Stop | Where-Object TaskName -EQ $taskName | Select-Object -First 1)
    if ($task.Count -eq 1 -and $task[0].State -ne 'Running' -and (Test-Path -LiteralPath $childReport -PathType Leaf)) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  $childExit = [int]$taskInfo.LastTaskResult
  if ($childExit -ne 0) {
    $failure = [ordered]@{stage='standard_user_wrapper/scheduled_task/exit';exceptionType='ProcessFailure';code=('exit_' + $childExit);errno=$null;hResult=$null}
    throw 'Scheduled Task lifecycle worker failed.'
  }
  $stage = 'owner_check'
  $owner = [IO.Directory]::GetAccessControl($ownedRoot,[Security.AccessControl.AccessControlSections]::Owner).GetOwner([Security.Principal.SecurityIdentifier])
  if ($owner.Value -ne $createdSid) { throw 'Standard-user root owner differs.' }
  $stage = 'report_read'
  if (-not (Test-Path -LiteralPath $childReport -PathType Leaf)) {
    $failure = [ordered]@{stage='standard_user_wrapper/scheduled_task/report_missing';exceptionType='ProcessFailure';code='unavailable';errno=$null;hResult=$null}
    throw 'Standard-user lifecycle report is missing.'
  }
  $value = Get-Content -LiteralPath $childReport -Raw | ConvertFrom-Json
  if ($childExit -ne 0 -or $value.verdict -ne 'pass') { $failure = $value.failure }
} catch {
  if (-not $failure) { $failure = [ordered]@{stage=('standard_user_wrapper/'+$stage);exceptionType=$_.Exception.GetType().FullName;code='unavailable';errno=$null;hResult=[int]$_.Exception.HResult} }
}
finally {
  $cleanupFailure = $null
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop }; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop }
  } catch { $cleanupFailure = 'task_cleanup' }
  try { if ($created -and (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue)) { Remove-LocalUser -Name $userName -ErrorAction Stop } } catch { if (-not $cleanupFailure) { $cleanupFailure = 'user_cleanup' } }
  try {
    if ($created -and $createdSid) {
      $profileDeadline = [DateTime]::UtcNow.AddSeconds(10)
      do {
        $profile = @(Get-CimInstance Win32_UserProfile -ErrorAction Stop | Where-Object { $_.SID -eq $createdSid } | Select-Object -First 1)
        if ($profile.Count -eq 0) { break }
        if (-not $profile[0].Loaded) { $profile[0] | Remove-CimInstance -ErrorAction Stop; break }
        Start-Sleep -Milliseconds 50
      } while ([DateTime]::UtcNow -lt $profileDeadline)
      $remainingProfile = @(Get-CimInstance Win32_UserProfile -ErrorAction Stop | Where-Object { $_.SID -eq $createdSid })
      if ($remainingProfile.Count -ne 0) { throw 'Exact diagnostic profile remained loaded.' }
      if (Test-Path -LiteralPath $profilePath) { Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction Stop }
    }
  } catch { if (-not $cleanupFailure) { $cleanupFailure = 'profile_cleanup' } }
  if (Test-Path -LiteralPath $ownedRoot) { Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction SilentlyContinue }
  try { $residualTasks = @(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Where-Object TaskName -EQ $taskName).Count } catch { $residualTasks = -1; if (-not $cleanupFailure) { $cleanupFailure = 'task_query' } }
  try { $residualUsers = @(Get-LocalUser -ErrorAction Stop | Where-Object Name -EQ $userName).Count } catch { $residualUsers = -1; if (-not $cleanupFailure) { $cleanupFailure = 'user_query' } }
  try { $residualProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*C2C-Native-' + $identity.Substring(0,8) + '*') }).Count } catch { $residualProcesses = -1; if (-not $cleanupFailure) { $cleanupFailure = 'process_query' } }
  $profileExists = Test-Path -LiteralPath $profilePath
  $ownedRootExists = Test-Path -LiteralPath $ownedRoot
  $report = [ordered]@{schemaVersion=1;verdict=if(-not$failure-and-not$cleanupFailure-and$childExit-eq0-and$residualTasks-eq0-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists){'pass'}else{'fail'};summary=if($value){$value.summary}else{$null};failure=$failure;cleanup=[ordered]@{attempted=$true;succeeded=-not$cleanupFailure-and$residualTasks-eq0-and$residualUsers-eq0-and$residualProcesses-eq0-and-not$profileExists-and-not$ownedRootExists;failure=$cleanupFailure;residualTasks=$residualTasks;residualUsers=$residualUsers;residualProcesses=$residualProcesses;profileExists=$profileExists;ownedRootExists=$ownedRootExists}}
  [IO.Directory]::CreateDirectory((Split-Path $ReportPath -Parent)) | Out-Null
  [IO.File]::WriteAllText($ReportPath,(($report|ConvertTo-Json -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
}
if ($report.verdict -ne 'pass') { Write-Host ('NATIVE_LIFECYCLE_FAIL ' + ($report|ConvertTo-Json -Compress -Depth 8)); exit 1 }
