import { execFile } from 'node:child_process'
import { join, win32 } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

async function defaultPowerShell({ script, environment }) {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...environment },
    windowsHide: true,
  })
  return JSON.parse(stdout.trim() || '{"archived":false}')
}

export async function archiveConflictingElectronLink({
  platform = process.platform,
  appData = process.env.APPDATA,
  executablePath = process.execPath,
  appId,
  productName,
  runPowerShell = defaultPowerShell,
}) {
  if (platform !== 'win32' || win32.basename(executablePath).toLowerCase() !== 'electron.exe') return undefined
  if (!appData) throw new Error('APPDATA is unavailable; cannot inspect the Windows development shortcut')
  const environment = {
    SEAL_HARNESS_STALE_SHORTCUT: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk'),
    SEAL_HARNESS_EXPECTED_TARGET: executablePath,
    SEAL_HARNESS_EXPECTED_APP_ID: appId,
    SEAL_HARNESS_SHORTCUT_RECOVERY: join(appData, productName, 'recovery', 'stale-shortcuts'),
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:SEAL_HARNESS_STALE_SHORTCUT
if (-not (Test-Path -LiteralPath $path)) { '{"archived":false}'; exit 0 }
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($path)
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace([IO.Path]::GetDirectoryName($path))
$item = $folder.ParseName([IO.Path]::GetFileName($path))
$appId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
$target = [IO.Path]::GetFullPath($shortcut.TargetPath)
$expectedTarget = [IO.Path]::GetFullPath($env:SEAL_HARNESS_EXPECTED_TARGET)
if (-not $target.Equals($expectedTarget, [StringComparison]::OrdinalIgnoreCase) -or $appId -ne $env:SEAL_HARNESS_EXPECTED_APP_ID) { '{"archived":false}'; exit 0 }
New-Item -ItemType Directory -Path $env:SEAL_HARNESS_SHORTCUT_RECOVERY -Force | Out-Null
$name = 'Electron-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '.lnk.bak'
$backup = Join-Path $env:SEAL_HARNESS_SHORTCUT_RECOVERY $name
Move-Item -LiteralPath $path -Destination $backup
try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\ie4uinit.exe') -ArgumentList '-show' -WindowStyle Hidden -Wait } catch {}
@{ archived = $true; backup = $backup } | ConvertTo-Json -Compress
`
  return runPowerShell({ script, environment })
}
