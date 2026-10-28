import { spawn as nativeSpawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createConnection } from 'node:net'
import { posix, win32 } from 'node:path'
import { RemoteHostError } from './config.js'

const names = { ssh: 'OpenSSH', rdp: '远程桌面', vnc: 'TigerVNC' }
const allowedEnvironment = /^(PATH|HOME|USER|LOGNAME|SHELL|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|LANG|LC_[A-Z_]+|SSH_AUTH_SOCK)$/i
const powershellBroker = `
$ErrorActionPreference = 'Stop'
try {
  $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SEAL_REMOTE_LAUNCH)) | ConvertFrom-Json
  Remove-Item Env:SEAL_REMOTE_LAUNCH
  $process = Start-Process -FilePath $payload.file -ArgumentList $payload.arguments -WindowStyle Normal -PassThru
  if (-not $process) { exit 1 }
  exit 0
} catch { exit 1 }
`
const appleTerminal = 'on run argv\n tell application "Terminal"\n activate\n do script (item 1 of argv)\n end tell\nend run'
const quoteShell = value => `'${value.replaceAll("'", "'\\''")}'`
// Start-Process接收的是单个Windows命令行字符串，不能把数组直接交给它拼接。
const quoteWindows = value => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
const target = ({ host, port }, separator = ':') => `${host.includes(':') ? `[${host}]` : host}${separator}${port}`

function childEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && allowedEnvironment.test(key)))
}

async function executableExists(path, platform) {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch { return false }
}

export function createRemoteClients({ platform = process.platform, env = process.env, spawn = nativeSpawn,
  exists = path => executableExists(path, platform), socketConnect = createConnection, timeoutMs = 5000 } = {}) {
  const paths = platform === 'win32' ? win32 : posix
  const environmentValue = name => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  async function find(candidates) {
    for (const path of candidates) if (paths.isAbsolute(path) && await exists(path)) return path
  }
  function onPath(commands) {
    const directories = (environmentValue('PATH') ?? '').split(platform === 'win32' ? ';' : ':').map(value => value.replace(/^"|"$/g, ''))
    return directories.filter(value => paths.isAbsolute(value)).flatMap(directory => commands.map(command => paths.join(directory, command)))
  }
  async function terminal() {
    if (platform === 'win32') {
      const systemRoot = environmentValue('SystemRoot') ?? 'C:\\Windows'
      const executable = await find([win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')])
      return executable ? { executable, kind: 'powershell' } : null
    }
    if (platform === 'darwin') return await exists('/usr/bin/osascript') ? { executable: '/usr/bin/osascript', kind: 'apple' } : null
    if (platform !== 'linux') return null
    for (const name of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      const executable = await find(onPath([name]))
      if (executable) return { executable, kind: name }
    }
    return null
  }
  async function resolve(config) {
    if (!['win32', 'darwin', 'linux'].includes(platform)) return { available: false, reason: '当前平台尚未提供远程客户端启动方式。' }
    let candidates
    if (config.clientPath) {
      if (!paths.isAbsolute(config.clientPath) || /[\x00-\x1f\x7f]/.test(config.clientPath)
        || (platform === 'win32' && !/\.exe$/i.test(config.clientPath))) {
        return { available: false, reason: '请选择当前系统中客户端可执行文件的绝对路径；Windows需选择.exe。' }
      }
      candidates = [config.clientPath]
    } else if (platform === 'win32') {
      const systemRoot = environmentValue('SystemRoot') ?? 'C:\\Windows'
      const programFiles = environmentValue('ProgramFiles') ?? 'C:\\Program Files'
      candidates = config.protocol === 'ssh' ? [win32.join(systemRoot, 'System32/OpenSSH/ssh.exe'), ...onPath(['ssh.exe'])]
        : config.protocol === 'rdp' ? [win32.join(systemRoot, 'System32/mstsc.exe')]
          : [win32.join(programFiles, 'TigerVNC/vncviewer.exe'), ...onPath(['vncviewer.exe'])]
    } else {
      const commands = config.protocol === 'ssh' ? ['ssh'] : config.protocol === 'rdp' ? ['xfreerdp3', 'xfreerdp'] : ['vncviewer', 'xtigervncviewer']
      candidates = [...onPath(commands), ...commands.flatMap(command => ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'].map(directory => posix.join(directory, command)))]
      if (config.protocol === 'vnc' && platform === 'darwin') candidates.push('/Applications/TigerVNC Viewer.app/Contents/MacOS/TigerVNC Viewer')
    }
    const executable = await find(candidates)
    if (!executable) return { available: false, reason: config.clientPath ? '客户端文件不存在或不可执行，请重新选择。'
      : `未找到${config.protocol === 'rdp' && platform !== 'win32' ? 'FreeRDP（xfreerdp）' : names[config.protocol]}，请先安装客户端或填写可执行文件路径。` }
    const needsTerminal = config.protocol === 'ssh' || (config.protocol === 'rdp' && platform !== 'win32')
    const wrapper = needsTerminal ? await terminal() : null
    if (needsTerminal && !wrapper) return { available: false, reason: '没有可用的交互终端。Windows需要系统PowerShell，Linux需要x-terminal-emulator、gnome-terminal、konsole或xterm，macOS需要Terminal。' }
    return { available: true, executable, wrapper }
  }
  async function inspect(config) {
    const { wrapper, ...result } = await resolve(config)
    return result
  }
  function argumentsFor(config) {
    if (config.protocol === 'ssh') return ['-p', String(config.port), ...(config.username ? ['-l', config.username] : []),
      ...(config.identityFile ? ['-i', config.identityFile] : []), '--', config.host]
    if (config.protocol === 'rdp') return platform === 'win32' ? [`/v:${target(config)}`, '/prompt']
      : [`/v:${target(config)}`, ...(config.username ? [`/u:${config.username}`] : [])]
    return [target(config, '::')]
  }
  function start(command, args, options, signal, waitForExit = false) {
    signal?.throwIfAborted()
    return new Promise((resolvePromise, reject) => {
      let child, timer, settled = false
      const finish = error => {
        if (settled) return
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
        if (error) reject(error); else { child.unref?.(); resolvePromise() }
      }
      const abort = () => { child?.kill(); finish(signal.reason ?? new Error('连接操作已取消。')) }
      try { child = spawn(command, args, { ...options, shell: false, stdio: 'ignore', env: options.env ?? childEnvironment(env) }) }
      catch { finish(new RemoteHostError('clientLaunchFailed', '无法启动客户端，请检查客户端路径与系统权限。')); return }
      child.once('error', () => finish(new RemoteHostError('clientLaunchFailed', '无法启动客户端，请检查客户端路径与系统权限。')))
      if (waitForExit) {
        child.once('exit', code => finish(code === 0 ? undefined : new RemoteHostError('clientLaunchFailed', '无法打开交互终端，请检查客户端和终端的系统权限。')))
        timer = setTimeout(() => { child.kill(); finish(new RemoteHostError('launchTimeout', '客户端启动超时，请重试。')) }, 15000)
      } else child.once('spawn', () => finish())
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  async function launch(config, signal) {
    signal?.throwIfAborted()
    const resolved = await resolve(config)
    signal?.throwIfAborted()
    if (!resolved.available) throw new RemoteHostError('clientUnavailable', resolved.reason)
    const args = argumentsFor(config), wrapper = resolved.wrapper
    if (wrapper?.kind === 'powershell') {
      const launchEnvironment = childEnvironment(env)
      launchEnvironment.SEAL_REMOTE_LAUNCH = Buffer.from(JSON.stringify({ file: resolved.executable, arguments: args.map(quoteWindows).join(' ') })).toString('base64')
      await start(wrapper.executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(powershellBroker, 'utf16le').toString('base64')],
        { windowsHide: true, env: launchEnvironment }, signal, true)
    } else if (wrapper?.kind === 'apple') {
      await start(wrapper.executable, ['-e', appleTerminal, '--', [resolved.executable, ...args].map(quoteShell).join(' ')], { windowsHide: true }, signal, true)
    } else if (wrapper) {
      const prefix = wrapper.kind === 'gnome-terminal' ? ['--'] : ['-e']
      await start(wrapper.executable, [...prefix, resolved.executable, ...args], { detached: true, windowsHide: false }, signal)
    } else await start(resolved.executable, args, { detached: true, windowsHide: false }, signal)
    return { client: config.protocol === 'rdp' && platform !== 'win32' ? 'FreeRDP' : names[config.protocol] }
  }
  function probe(config, signal) {
    signal?.throwIfAborted()
    return new Promise((resolvePromise, reject) => {
      let socket, timer, finished = false
      const done = (result, error) => {
        if (finished) return
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket?.destroy()
        if (error) reject(error); else resolvePromise(result)
      }
      const abort = () => done(null, signal.reason ?? new Error('连接检查已取消。'))
      try { socket = socketConnect({ host: config.host, port: config.port }) }
      catch { done({ reachable: false, reason: '无法发起连接，请检查服务器地址与端口。' }); return }
      socket.once('connect', () => done({ reachable: true }))
      socket.once('error', error => done({ reachable: false, reason: error.code === 'ECONNREFUSED' ? '端口拒绝连接，请检查远端服务是否启动。'
        : ['ENOTFOUND', 'EAI_AGAIN'].includes(error.code) ? '无法解析服务器地址，请检查地址和DNS。' : '无法连接此端口，请检查网络、防火墙和服务状态。' }))
      timer = setTimeout(() => done({ reachable: false, reason: '端口连接超时，请检查网络、防火墙和服务状态。' }), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  return { inspect, launch, probe }
}
