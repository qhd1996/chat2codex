$ErrorActionPreference = 'Stop'

$userName = $env:C2C_TEST_USER
$passwordText = $env:C2C_TEST_PASSWORD
$keyPath = $env:C2C_TEST_KEY

if ($userName -notmatch '^C2CN[a-f0-9]{8}$') { throw 'Invalid novice ACL test user name.' }
if ($keyPath -notmatch '^[A-Za-z]:[\\/]') { throw 'Invalid novice ACL key path.' }
if ($keyPath -match '["\r\n&|<>^%!]') { throw 'Invalid novice ACL key path.' }
if (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue) { throw 'Novice ACL test user already exists.' }

$created = $false
function Invoke-AsTestUser([string]$fileName, [string]$arguments, [bool]$captureOutput) {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $fileName
  $startInfo.Arguments = $arguments
  $startInfo.UserName = $userName
  $startInfo.Domain = $env:COMPUTERNAME
  $startInfo.Password = $secure
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $captureOutput
  $startInfo.RedirectStandardError = $captureOutput
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Another-user denial probe did not start.' }
  $stdout = if ($captureOutput) { $process.StandardOutput.ReadToEnd() } else { '' }
  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Another-user denial probe timed out.'
  }
  return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout }
}
try {
  $beforeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $keyPath).Hash
  $secure = [Security.SecureString]::new()
  foreach ($character in $passwordText.ToCharArray()) { $secure.AppendChar($character) }
  $secure.MakeReadOnly()
  $createdUser = New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires
  $created = $true
  $whoamiPath = Join-Path $env:SystemRoot 'System32\whoami.exe'
  $identity = Invoke-AsTestUser $whoamiPath '/user /fo csv /nh' $true
  if ($identity.ExitCode -ne 0 -or $identity.Stdout -notmatch [regex]::Escape($createdUser.SID.Value)) { throw ('Another-user denial probe identity is invalid: exit ' + $identity.ExitCode) }
  $cmdPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $read = Invoke-AsTestUser $cmdPath ('/d /q /c type "' + $keyPath + '" >nul 2>&1') $false
  if ($read.ExitCode -eq 0) { throw 'Another interactive user read an owner-only key.' }
  $delete = Invoke-AsTestUser $cmdPath ('/d /q /c del /f /q "' + $keyPath + '" >nul 2>&1') $false
  if ($delete.ExitCode -eq 0 -or -not (Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'Another interactive user deleted an owner-only key.' }
  $replace = Invoke-AsTestUser $cmdPath ('/d /q /c echo tampered>"' + $keyPath + '" 2>nul') $false
  if ($replace.ExitCode -eq 0) { throw 'Another interactive user replaced an owner-only key.' }
  $afterHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $keyPath).Hash
  if ($afterHash -ne $beforeHash) { throw 'Owner-only key bytes changed during another-user probes.' }
} finally {
  if ($created) { Remove-LocalUser -Name $userName }
}
