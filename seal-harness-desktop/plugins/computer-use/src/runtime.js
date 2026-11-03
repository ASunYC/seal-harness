import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { posix, win32, join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { profileSchema, ComputerUseError } from './config.js'

const executeFile = promisify(execFile)
const DRIVER_VERSION = '0.38.0'
const allowedEnvironment = /^(PATH|HOME|USER|LOGNAME|SHELL|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|LANG|LC_[A-Z_]+|SSH_AUTH_SOCK)$/i
const quotePosix = value => `'${value.replaceAll("'", "'\\''")}'`
export const DEFAULT_WINDOWS_PIPE = '\\\\.\\pipe\\cua-driver'

function runtimeEnvironment(source) {
  return { ...Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && allowedEnvironment.test(key))),
    DO_NOT_TRACK: '1', CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_TELEMETRY_ENABLED: '0' }
}
async function executableExists(file, platform) {
  try { return (await stat(file)).isFile() && (await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK), true) }
  catch { return false }
}
async function readableFile(file) {
  try { return (await stat(file)).isFile() && (await access(file, constants.R_OK), true) }
  catch { return false }
}
function remoteCommand(profile) {
  const driver = profile.driverPath || (profile.guestOS === 'win32' ? 'cua-driver.exe' : 'cua-driver')
  const args = ['mcp', ...(profile.socket || profile.guestOS === 'win32' ? ['--socket', profile.socket || DEFAULT_WINDOWS_PIPE] : [])]
  if (profile.guestOS !== 'win32') return `env CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_TELEMETRY_ENABLED=0 DO_NOT_TRACK=1 ${[driver, ...args].map(quotePosix).join(' ')}`
  // 远端默认shell可能是cmd或PowerShell；仅固定脚本进入命令，路径数据使用独立编码。
  const payload = Buffer.from(JSON.stringify({ driver, args })).toString('base64')
  const script = `$ErrorActionPreference='Stop';$env:CUA_DRIVER_RS_TELEMETRY_ENABLED='0';$env:CUA_TELEMETRY_ENABLED='0';$env:DO_NOT_TRACK='1';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;$a=@($p.args);& $p.driver @a;exit $LASTEXITCODE`
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

export function createComputerRuntime({ platform = process.platform, arch = process.arch, env = process.env,
  exists = file => executableExists(file, platform), readable = readableFile, runVersion = executeFile,
  createTransport = specification => new StdioClientTransport(specification), createClient = () => new Client({ name: 'seal-harness-computer-use', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } }),
  startupTimeoutMs = 20000, toolTimeoutMs = 30000, runtimeRoot = join(import.meta.dirname, 'runtime') } = {}) {
  const paths = platform === 'win32' ? win32 : posix
  const value = name => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  const environment = runtimeEnvironment(env)
  async function find(candidates) { for (const file of candidates) if (paths.isAbsolute(file) && await exists(file)) return file }
  function searchPath(command) {
    return (value('PATH') ?? '').split(platform === 'win32' ? ';' : ':').filter(directory => paths.isAbsolute(directory)).map(directory => paths.join(directory, command))
  }
  async function specification(input, signal) {
    const profile = profileSchema.parse(input)
    signal?.throwIfAborted()
    if (profile.mode === 'local') {
      if (!['win32', 'linux', 'darwin'].includes(platform)) throw new ComputerUseError('platformUnavailable', '当前系统尚未支持电脑操作。')
      const file = profile.driverPath || await find([
        join(runtimeRoot, `${platform}-${arch}`, platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'),
        join(import.meta.dirname, '../lib/runtime', `${platform}-${arch}`, platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'),
      ])
      if (!file || !paths.isAbsolute(file) || !await exists(file) || platform === 'win32' && !/\.exe$/i.test(file))
        throw new ComputerUseError('driverUnavailable', '未找到随包 Cua Driver，请修复安装，或配置当前系统驱动的绝对路径。')
      return { command: file, args: ['mcp'], env: environment, stderr: 'pipe', maxBufferSize: 16 * 1024 * 1024 }
    }
    const systemRoot = value('SystemRoot') || 'C:\\Windows'
    const ssh = await find(platform === 'win32' ? [win32.join(systemRoot, 'System32/OpenSSH/ssh.exe'), ...searchPath('ssh.exe')] : ['/usr/bin/ssh', ...searchPath('ssh')])
    if (!ssh) throw new ComputerUseError('sshUnavailable', '未找到 OpenSSH 客户端，请安装后重试。')
    if (profile.identityFile && !await readable(profile.identityFile)) throw new ComputerUseError('keyUnavailable', 'SSH 私钥文件不存在或不可读取，请检查路径。')
    signal?.throwIfAborted()
    return { command: ssh, args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', String(profile.port),
      ...(profile.username ? ['-l', profile.username] : []), ...(profile.identityFile ? ['-i', profile.identityFile] : []), '--', profile.host, remoteCommand(profile)],
    env: environment, stderr: 'pipe', maxBufferSize: 16 * 1024 * 1024 }
  }
  async function inspect(input, signal) {
    try {
      const profile = profileSchema.parse(input), spec = await specification(profile, signal)
      if (profile.mode === 'vm') return { available: true, command: spec.command, remoteDesktopVerified: false, reason: 'SSH 客户端可用；需连接后检查来宾桌面和权限。' }
      let result
      try { result = await runVersion(spec.command, ['--version'], { env: spec.env, timeout: 5000, signal, maxBuffer: 65536, windowsHide: true }) }
      catch { signal?.throwIfAborted(); throw new ComputerUseError('driverVersionFailed', '无法读取驱动版本，请检查驱动文件与系统权限。') }
      signal?.throwIfAborted()
      const reported = (result.stdout ?? '').match(/\b(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)/i)?.[1]
      if (reported !== DRIVER_VERSION) throw new ComputerUseError('driverVersionMismatch', `驱动版本不匹配，需要 Cua Driver ${DRIVER_VERSION}。`)
      return { available: true, version: DRIVER_VERSION, command: spec.command, remoteDesktopVerified: false }
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof ComputerUseError)) throw error
      return { available: false, reason: error.message, code: error.code, remoteDesktopVerified: false }
    }
  }
  async function launch(input, { signal, sessionLabel } = {}) {
    signal?.throwIfAborted()
    const profile = profileSchema.parse(input), spec = await specification(profile, signal)
    if (profile.mode === 'local') {
      const state = await inspect(profile, signal)
      if (!state.available) throw new ComputerUseError(state.code, state.reason)
    }
    const transport = createTransport(spec), client = createClient()
    let closed = false, closing
    const close = () => {
      if (closing) return closing
      closed = true; signal?.removeEventListener('abort', abort)
      closing = (async () => { await client.close().catch(() => {}); await transport.close().catch(() => {}) })()
      return closing
    }
    const abort = () => { void close() }
    signal?.addEventListener('abort', abort, { once: true })
    // stderr只消耗不外传，远端错误可能包含登录名、路径或认证细节。
    transport.stderr?.on('data', () => {})
    const startup = AbortSignal.any([AbortSignal.timeout(startupTimeoutMs), ...(signal ? [signal] : [])])
    const abortStartup = () => { void close() }
    startup.addEventListener('abort', abortStartup, { once: true })
    try {
      await client.connect(transport, { signal: startup, timeout: startupTimeoutMs })
      startup.throwIfAborted(); signal?.throwIfAborted()
      return {
        async listTools() {
          if (closed) throw new ComputerUseError('runtimeClosed', '电脑操作连接已关闭。')
          const tools = [], seen = new Set()
          let cursor
          do {
            const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: toolTimeoutMs })
            for (const tool of page.tools) {
              if (seen.has(tool.name)) throw new ComputerUseError('invalidToolCatalog', '驱动返回重复工具，请检查版本。')
              seen.add(tool.name); tools.push(tool)
            }
            cursor = page.nextCursor
          } while (cursor)
          return tools
        },
        async callTool(name, args, requestSignal) {
          if (closed) throw new ComputerUseError('runtimeClosed', '电脑操作连接已关闭。')
          const active = AbortSignal.any([...(signal ? [signal] : []), ...(requestSignal ? [requestSignal] : []), AbortSignal.timeout(toolTimeoutMs)])
          active.throwIfAborted()
          return client.callTool({ name, arguments: args }, { signal: active, timeout: toolTimeoutMs })
        },
        close,
        sessionLabel,
      }
    } catch {
      await close(); signal?.throwIfAborted()
      throw new ComputerUseError('driverConnectionFailed', profile.mode === 'vm'
        ? '虚拟机驱动连接失败。请检查 SSH 密钥、known_hosts、驱动路径和来宾交互桌面服务；Windows 来宾需使用同一账号的桌面命名管道。'
        : 'Cua Driver 初始化失败，请检查安装及桌面权限。')
    } finally { startup.removeEventListener('abort', abortStartup) }
  }
  return { inspect, launch, specification }
}
