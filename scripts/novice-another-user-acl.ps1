$ErrorActionPreference = 'Stop'

$userName = $env:C2C_TEST_USER
$passwordText = $env:C2C_TEST_PASSWORD
$keyPath = $env:C2C_TEST_KEY

if ($userName -notmatch '^C2CN[a-f0-9]{8}$') { throw 'Invalid novice ACL test user name.' }
if ($keyPath -notmatch '^[A-Za-z]:[\\/]') { throw 'Invalid novice ACL key path.' }
if (Get-LocalUser -Name $userName -ErrorAction SilentlyContinue) { throw 'Novice ACL test user already exists.' }

$created = $false
try {
  $secure = [Security.SecureString]::new()
  foreach ($character in $passwordText.ToCharArray()) { $secure.AppendChar($character) }
  $secure.MakeReadOnly()
  New-LocalUser -Name $userName -Password $secure -AccountNeverExpires -PasswordNeverExpires | Out-Null
  $created = $true
  $credential = [Management.Automation.PSCredential]::new(".\$userName", $secure)
  $payload = "try{[IO.File]::ReadAllText('$($keyPath.Replace("'", "''"))')|Out-Null;exit 0}catch{exit 5}"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))
  $process = Start-Process powershell.exe -Credential $credential -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Another-user denial probe timed out.'
  }
  if ($process.ExitCode -eq 0) { throw 'Another interactive user read an owner-only key.' }
  if ($process.ExitCode -ne 5) { throw 'Another-user denial probe did not execute.' }
} finally {
  if ($created) { Remove-LocalUser -Name $userName }
}
