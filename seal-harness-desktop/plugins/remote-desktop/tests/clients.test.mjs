import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { spawn as nativeSpawn } from 'node:child_process'
import { createRemoteClients } from '../src/clients.js'

const config = (protocol = 'ssh', extra = {}) => ({ protocol, host: 'example.test', port: { ssh: 22, rdp: 3389, vnc: 5900 }[protocol], username: '', identityFile: '', clientPath: '', ...extra })
function harness(platform, files) {
  const calls = [], exists = async path => files.includes(path.replaceAll('\\', '/'))
  const spawn = (command, args, options) => {
    const child = new EventEmitter(); child.unref = () => {}; child.kill = () => { child.killed = true }
    calls.push({ command, args, options, child })
    queueMicrotask(() => { child.emit('spawn'); if (command.endsWith('powershell.exe') || command.endsWith('osascript')) child.emit('exit', 0) })
    return child
  }
  return { calls, clients: createRemoteClients({ platform, env: { SystemRoot: 'C:\\Windows', PATH: platform === 'win32' ? 'C:\\bin' : '/bin', OPENAI_API_KEY: 'never-forward', ELECTRON_RUN_AS_NODE: '1', SSH_AUTH_SOCK: '/agent' }, exists, spawn }) }
}

test('client discovery requires an executable and interactive terminal, with explicit local platform paths', async () => {
  const { clients } = harness('linux', ['/bin/ssh', '/bin/xterm', '/bin/xfreerdp3', '/bin/vncviewer'])
  assert.equal((await clients.inspect(config())).available, true)
  assert.equal((await clients.inspect(config('rdp'))).executable, '/bin/xfreerdp3')
  assert.equal((await clients.inspect(config('vnc'))).available, true)
  assert.equal((await clients.inspect(config('ssh', { clientPath: '/not-installed' }))).available, false)
  assert.equal((await clients.inspect(config('ssh', { clientPath: 'ssh' }))).available, false)
  const unavailable = harness('linux', ['/bin/ssh']).clients
  assert.match((await unavailable.inspect(config())).reason, /交互终端/)
  assert.equal((await harness('freebsd', []).clients.inspect(config())).available, false)
})

test('Windows GUI launches use argv, preserve IPv6 ports and leave passwords/certificates to clients', async () => {
  const { clients, calls } = harness('win32', ['C:/Windows/System32/mstsc.exe', 'C:/bin/vncviewer.exe'])
  assert.deepEqual(await clients.launch(config('rdp', { host: '2001:db8::2', port: 3390, username: 'DOMAIN\\name' })), { client: '远程桌面' })
  assert.deepEqual(calls[0].args, ['/v:[2001:db8::2]:3390', '/prompt'])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.windowsHide, false)
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined)
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined)
  await clients.launch(config('vnc', { host: '2001:db8::3', port: 5902 }))
  assert.deepEqual(calls[1].args, ['[2001:db8::3]::5902'])
  assert.equal(calls[1].options.shell, false)
  assert.equal((await clients.inspect(config('vnc', { clientPath: 'C:\\bin\\viewer.cmd' }))).available, false)
})

test('Windows SSH launches a visible native console through a static broker and separately serialized argv', async () => {
  const { clients, calls } = harness('win32', ['C:/Windows/System32/OpenSSH/ssh.exe', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'])
  const identityFile = 'C:\\keys\\a space & $(unsafe)\\id_rsa'
  await clients.launch(config('ssh', { username: 'admin', port: 2222, identityFile }))
  const call = calls[0], script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le')
  assert.match(script, /Start-Process/)
  assert.match(script, /-WindowStyle Normal/)
  assert.doesNotMatch(script, /unsafe|example\.test|admin/)
  const payload = JSON.parse(Buffer.from(call.options.env.SEAL_REMOTE_LAUNCH, 'base64').toString('utf8'))
  assert.equal(payload.file, 'C:\\Windows\\System32\\OpenSSH\\ssh.exe')
  assert.equal(payload.arguments, '"-p" "2222" "-l" "admin" "-i" "C:\\keys\\a space & $(unsafe)\\id_rsa" "--" "example.test"')
  assert.equal(call.options.shell, false)
  assert.equal(call.options.windowsHide, true, 'only the broker is hidden; Start-Process creates the interactive console')
  assert.equal(call.options.env.SSH_AUTH_SOCK, '/agent')
  assert.equal(call.options.env.OPENAI_API_KEY, undefined)
})

test('Linux terminal command vectors support SSH identity and FreeRDP native username without disabling verification', async () => {
  const { clients, calls } = harness('linux', ['/bin/ssh', '/bin/gnome-terminal', '/bin/xfreerdp'])
  await clients.launch(config('ssh', { identityFile: '/keys/a b', username: 'user' }))
  assert.deepEqual(calls[0].args, ['--', '/bin/ssh', '-p', '22', '-l', 'user', '-i', '/keys/a b', '--', 'example.test'])
  await clients.launch(config('rdp', { username: 'DOMAIN\\user' }))
  assert.deepEqual(calls[1].args, ['--', '/bin/xfreerdp', '/v:example.test:3389', '/u:DOMAIN\\user'])
  assert.doesNotMatch(JSON.stringify(calls.map(call => call.args)), /StrictHostKeyChecking|cert:ignore|\/p:/)
})

test('macOS Terminal gets shell-quoted arguments as data, never interpolated AppleScript', async () => {
  const { clients, calls } = harness('darwin', ['/bin/ssh', '/usr/bin/osascript'])
  await clients.launch(config('ssh', { identityFile: "/keys/a' $(touch NEVER)" }))
  assert.equal(calls[0].command, '/usr/bin/osascript')
  assert.doesNotMatch(calls[0].args[1], /NEVER/)
  assert.equal(calls[0].args[3], "'/bin/ssh' '-p' '22' '-i' '/keys/a'\\'' $(touch NEVER)' '--' 'example.test'")
})

test('TCP probe checks reachability only and cleans up both successful and refused sockets', async t => {
  const server = createServer(socket => {
    // 探测仅检查TCP；客户端先销毁socket时，服务端发送banner可能收到正常的RST。
    socket.on('error', () => {})
    socket.end('RFB 003.008\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const clients = createRemoteClients({ timeoutMs: 500 }), port = server.address().port
  assert.deepEqual(await clients.probe(config('vnc', { host: '127.0.0.1', port })), { reachable: true })
  await new Promise(resolve => server.close(resolve))
  const result = await clients.probe(config('vnc', { host: '127.0.0.1', port }))
  assert.equal(result.reachable, false)
  assert.match(result.reason, /拒绝连接/)
})

test('timeout and cancellation destroy pending probe sockets and cancelled launch never spawns', async () => {
  const sockets = []
  const clients = createRemoteClients({ timeoutMs: 10, socketConnect() { const socket = new EventEmitter(); socket.destroy = () => { socket.destroyed = true }; sockets.push(socket); return socket } })
  assert.match((await clients.probe(config())).reason, /超时/)
  assert.equal(sockets[0].destroyed, true)
  const controller = new AbortController(), pending = clients.probe(config(), controller.signal)
  controller.abort(new Error('account changed'))
  await assert.rejects(pending, /account changed/)
  assert.equal(sockets[1].destroyed, true)
  const fixture = harness('win32', ['C:/Windows/System32/mstsc.exe'])
  await assert.rejects(fixture.clients.launch(config('rdp'), controller.signal), /account changed/)
  assert.equal(fixture.calls.length, 0)
})

test('missing client and OS launch errors never report a connected or authenticated session', async () => {
  await assert.rejects(harness('win32', []).clients.launch(config('rdp')), error => error.code === 'clientUnavailable' && /未找到/.test(error.message))
  const clients = createRemoteClients({ platform: 'win32', exists: async () => true, spawn() { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('raw secrets'))); return child } })
  await assert.rejects(clients.launch(config('rdp')), error => error.code === 'clientLaunchFailed' && /无法启动/.test(error.message) && !/raw secrets/.test(error.message))
})

test('Windows PowerShell parses broker data containing metacharacters without executing it', { skip: process.platform !== 'win32' }, async () => {
  const fixture = harness('win32', ['C:/Windows/System32/OpenSSH/ssh.exe', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'])
  await fixture.clients.launch(config('ssh', { identityFile: 'C:\\keys\\$(throw 999) & name\\id' }))
  const call = fixture.calls[0], broker = Buffer.from(call.args.at(-1), 'base64').toString('utf16le')
  const mock = 'function Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru) [Console]::WriteLine(($ArgumentList | ConvertTo-Json -Compress)); return @{Id=1} }\n'
  const output = await new Promise((resolve, reject) => {
    const child = nativeSpawn(call.command, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(mock + broker, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, env: call.options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', value => { stdout += value }); child.stderr.on('data', value => { stderr += value })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)))
  })
  assert.match(JSON.parse(output.trim()), /\$\(throw 999\) & name/)
})
