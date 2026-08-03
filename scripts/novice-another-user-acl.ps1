$ErrorActionPreference = 'Stop'

$userName = $env:C2C_TEST_USER
$passwordText = $env:C2C_TEST_PASSWORD
$keyPath = $env:C2C_TEST_KEY

if ($userName -notmatch '^C2CN[a-f0-9]{8}$') { throw 'Invalid novice ACL test user name.' }
if ($keyPath -notmatch '^[A-Za-z]:[\\/]') { throw 'Invalid novice ACL key path.' }
if ($keyPath -match '["\r\n&|<>^%!]') { throw 'Invalid novice ACL key path.' }
if (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue) { throw 'Novice ACL test user already exists.' }

$created = $false
try {
  $secure = [Security.SecureString]::new()
  foreach ($character in $passwordText.ToCharArray()) { $secure.AppendChar($character) }
  $secure.MakeReadOnly()
  $createdUser = New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires
  $created = $true
  $credential = [Management.Automation.PSCredential]::new(".\$userName", $secure)
  $identityCommand = 'whoami /user /fo csv /nh ^| findstr /i /c:"' + $createdUser.SID.Value + '" >nul'
  $identityProcess = Start-Process cmd.exe -Credential $credential -ArgumentList @('/d', '/q', '/c', $identityCommand) -WindowStyle Hidden -PassThru
  if (-not $identityProcess.WaitForExit(15000)) {
    $identityProcess.Kill()
    $identityProcess.WaitForExit()
    throw 'Another-user denial probe timed out.'
  }
  if ($identityProcess.ExitCode -ne 0) { throw ('Another-user denial probe identity is invalid: exit ' + $identityProcess.ExitCode) }
  $command = 'type "' + $keyPath + '" >nul'
  $process = Start-Process cmd.exe -Credential $credential -ArgumentList @('/d', '/q', '/c', $command) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Another-user denial probe timed out.'
  }
  if ($process.ExitCode -eq 0) { throw 'Another interactive user read an owner-only key.' }
} finally {
  if ($created) { Remove-LocalUser -Name $userName }
}
