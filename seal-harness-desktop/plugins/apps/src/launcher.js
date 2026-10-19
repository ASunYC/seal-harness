import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AppError } from './installer.js'

const execute = promisify(execFile)

/** DBX 是单实例应用，不能把另一份安装或账号的窗口当作当前账号的窗口。 */
async function dbxProcesses() {
  if (process.platform !== 'win32') return []
  let output
  try {
    output = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-Process -Name DBX -ErrorAction SilentlyContinue | ForEach-Object { @{ path = $_.Path } }) | ConvertTo-Json -Compress`],
    { windowsHide: true, timeout: 20000, maxBuffer: 65536 })
  } catch (cause) { throw new AppError('无法核对 DBX 运行状态，请稍后重试。', { cause }) }
  const value = output.stdout.trim() ? JSON.parse(output.stdout) : []
  return Array.isArray(value) ? value : [value]
}

async function identity(path) {
  return (await realpath(path).catch(error => { if (error.code === 'ENOENT') return resolve(path); throw error })).toLowerCase()
}

export async function assertNoOtherDbx(executable) {
  const expected = await identity(executable)
  for (const process of await dbxProcesses()) {
    if (!process.path || await identity(process.path) !== expected) throw new AppError('另一份 DBX 正在运行，请先退出它（包括托盘），再打开本账号的 DBX。')
  }
}

export async function assertDbxStopped(executable) {
  const expected = await identity(executable)
  for (const process of await dbxProcesses()) {
    if (process.path && await identity(process.path) === expected) throw new AppError('请先退出 DBX（包括托盘），再卸载。')
  }
}
