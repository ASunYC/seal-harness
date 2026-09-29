$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Docker remains a separately maintained prerequisite; never package its source.
function Get-FlowEnvironmentValue([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name)
}
$flowProgramFiles = Get-FlowEnvironmentValue 'ProgramW6432'
if ([string]::IsNullOrWhiteSpace($flowProgramFiles)) { $flowProgramFiles = Get-FlowEnvironmentValue 'ProgramFiles' }
if ([string]::IsNullOrWhiteSpace($flowProgramFiles)) { $flowProgramFiles = 'C:\Program Files' }
$flowLocalAppData = Get-FlowEnvironmentValue 'LOCALAPPDATA'
$flowDesktopCandidates = @(
  (Join-Path $flowProgramFiles 'Docker\Docker\Docker Desktop.exe')
)
if (-not [string]::IsNullOrWhiteSpace($flowLocalAppData)) {
  $flowDesktopCandidates += Join-Path $flowLocalAppData 'Programs\DockerDesktop\Docker Desktop.exe'
}
# Docker Desktop can be installed outside the two default roots. Keep this
# fallback aligned with the Node-side executable discovery used by the doctor.
foreach ($flowHive in @('HKCU', 'HKLM')) {
  $flowInstall = Get-ItemProperty -LiteralPath "${flowHive}:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Docker Desktop" -Name InstallLocation -ErrorAction SilentlyContinue
  $flowRoot = [string]$flowInstall.InstallLocation
  if (-not [string]::IsNullOrWhiteSpace($flowRoot)) {
    $flowDesktopCandidates += Join-Path $flowRoot.Trim().Trim('"') 'Docker Desktop.exe'
  }
}
$flowDesktop = $flowDesktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $flowDesktop) {
  throw 'Docker Desktop is not installed; install and start it before retrying'
}
Start-Process -FilePath $flowDesktop -WindowStyle Hidden
$flowDocker = Join-Path (Split-Path $flowDesktop) 'resources\bin\docker.exe'
$flowDockerHosts = @(
  'npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopLinuxEngine'
)
function Test-FlowDockerHost([string]$DockerPath, [string]$DockerHost) {
  $flowInfo = New-Object System.Diagnostics.ProcessStartInfo
  $flowInfo.FileName = $DockerPath
  $flowInfo.Arguments = '--host "' + $DockerHost + '" info --format "{{.OSType}}"'
  $flowInfo.UseShellExecute = $false
  $flowInfo.CreateNoWindow = $true
  $flowInfo.RedirectStandardOutput = $true
  $flowInfo.RedirectStandardError = $true
  $flowProcess = New-Object System.Diagnostics.Process
  $flowProcess.StartInfo = $flowInfo
  try {
    if (-not $flowProcess.Start()) { return $false }
    $flowStdout = $flowProcess.StandardOutput.ReadToEndAsync()
    [void]$flowProcess.StandardError.ReadToEndAsync()
    if (-not $flowProcess.WaitForExit(2000)) {
      try { $flowProcess.Kill() } catch { }
      return $false
    }
    return $flowProcess.ExitCode -eq 0 -and $flowStdout.Result.Trim() -eq 'linux'
  } catch {
    return $false
  } finally {
    $flowProcess.Dispose()
  }
}
for ($flowAttempt = 0; $flowAttempt -lt 40; $flowAttempt++) {
  foreach ($flowDockerHost in $flowDockerHosts) {
    if (Test-FlowDockerHost $flowDocker $flowDockerHost) { exit 0 }
  }
  Start-Sleep -Seconds 2
}
throw 'Docker is not ready; complete its first-run steps and retry'
