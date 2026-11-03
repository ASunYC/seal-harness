import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createComputerRuntime, DEFAULT_WINDOWS_PIPE } from '../src/runtime.js'
import { profileSchema, localProfile } from '../src/config.js'
import { verifyArchive } from '../scripts/prepare-driver.mjs'

const vm = changes => ({ ...localProfile, id: 'c4dec84e-e3a9-467d-bf1b-55ef2862ad09', name: 'VM', mode: 'vm', guestOS: 'linux', host: 'example.test', ...changes })
const windows = { platform: 'win32', env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\Fixture', OPENAI_API_KEY: 'not-forwarded', ELECTRON_RUN_AS_NODE: '1' }, exists: async () => true, readable: async () => true }

test('profiles default local and reject extra commands, malicious hosts, invalid sockets and implicit local credentials', () => {
  assert.equal(profileSchema.parse(localProfile).mode, 'local')
  for (const change of [{ args: ['bad'] }, { password: 'secret' }, { host: '-oProxyCommand=bad' }, { host: 'user@host' }, { host: 'host:22' }, { driverPath: 'echo bad' }, { port: 0 }, { identityFile: 'relative' }])
    assert.equal(profileSchema.safeParse(vm(change)).success, false, JSON.stringify(change))
  assert.equal(profileSchema.safeParse({ ...localProfile, host: 'host' }).success, false)
  assert.equal(profileSchema.safeParse(vm({ guestOS: 'win32', socket: '/tmp/wrong' })).success, false)
  assert.equal(profileSchema.parse(vm({ host: '2001:db8::1', identityFile: 'C:\\keys\\id' })).host, '2001:db8::1')
})

test('local discovery checks fixed driver version without leaking environment credentials', async () => {
  const calls = []
  const runtime = createComputerRuntime({ ...windows, runVersion: async (...args) => { calls.push(args); return { stdout: 'cua-driver 0.38.0\n' } } })
  const profile = { ...localProfile, driverPath: 'C:\\driver\\cua-driver.exe' }
  assert.equal((await runtime.inspect(profile)).version, '0.38.0')
  assert.equal(calls[0][2].windowsHide, true)
  assert.equal(calls[0][2].env.OPENAI_API_KEY, undefined)
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(calls[0][2].env.CUA_DRIVER_RS_TELEMETRY_ENABLED, '0')
  assert.deepEqual(calls[0][1], ['--version'])
  const wrong = createComputerRuntime({ ...windows, runVersion: async () => ({ stdout: '0.37.0' }) })
  assert.equal((await wrong.inspect(profile)).code, 'driverVersionMismatch')
  assert.equal((await createComputerRuntime({ ...windows, runVersion: async () => ({ stdout: 'cua-driver 0.38.0-nightly.123' }) }).inspect(profile)).code, 'driverVersionMismatch')
  assert.equal((await createComputerRuntime({ ...windows, exists: async () => false }).inspect(profile)).code, 'driverUnavailable')
})

test('VM transport uses batch SSH and strict known_hosts with separately quoted remote driver data', async () => {
  const runtime = createComputerRuntime(windows)
  const spec = await runtime.specification(vm({ host: '2001:db8::1', port: 2222, username: 'test', identityFile: 'C:\\keys with spaces\\id', driverPath: "/opt/a' b/cua-driver" }))
  assert.deepEqual(spec.args.slice(0, 10), ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-p', '2222', '-l'])
  assert.ok(spec.args.includes('C:\\keys with spaces\\id'))
  assert.match(spec.args.at(-1), /'\/opt\/a'\\'' b\/cua-driver' 'mcp'/)
  assert.equal(spec.env.OPENAI_API_KEY, undefined)
  const state = await runtime.inspect(vm())
  assert.equal(state.available, true); assert.equal(state.remoteDesktopVerified, false)
  assert.match(state.reason, /需连接后检查/)
})

test('Windows guest always proxies to an existing same-user desktop pipe, never SSH Session 0 direct runtime', async () => {
  const spec = await createComputerRuntime(windows).specification(vm({ guestOS: 'win32', driverPath: 'C:\\Apps\\Cua Driver\\cua-driver.exe' }))
  const script = Buffer.from(spec.args.at(-1).split(' ').at(-1), 'base64').toString('utf16le')
  assert.match(script, /\$p\.driver @a/)
  const payload = JSON.parse(Buffer.from(script.match(/FromBase64String\('([^']+)'\)/)[1], 'base64').toString('utf8'))
  assert.deepEqual(payload.args, ['mcp', '--socket', DEFAULT_WINDOWS_PIPE])
  assert.equal(payload.driver, 'C:\\Apps\\Cua Driver\\cua-driver.exe')
  assert.doesNotMatch(script, /Apps\\Cua Driver/)
})

test('SSH requires a readable identity but does not require executable permission on keys', async () => {
  const runtime = createComputerRuntime({ ...windows, readable: async () => false })
  await assert.rejects(runtime.specification(vm({ identityFile: 'C:\\keys\\missing' })), { code: 'keyUnavailable' })
  const missingSsh = createComputerRuntime({ ...windows, exists: async () => false })
  assert.equal((await missingSsh.inspect(vm())).code, 'sshUnavailable')
})

function fixtureRuntime(overrides = {}) {
  const transports = []
  const runtime = createComputerRuntime({ ...windows, runVersion: async () => ({ stdout: 'cua-driver 0.38.0' }),
    createClient: () => new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode: 'legacy' } }),
    createTransport(spec) {
      const transport = new StdioClientTransport({ ...spec, command: process.execPath, args: [fileURLToPath(new URL('./mcp-fixture.mjs', import.meta.url))] })
      transports.push(transport); return transport
    }, ...overrides })
  return { runtime, transports }
}

test('real MCP stdio initialization preserves image/text/structured results and closes process on disposal', async () => {
  const { runtime, transports } = fixtureRuntime()
  const connection = await runtime.launch({ ...localProfile, driverPath: 'C:\\driver.exe' }, { sessionLabel: 'private-fixture' })
  try {
    assert.equal((await connection.listTools())[0].name, 'get_window_state')
    const result = await connection.callTool('get_window_state', { delivery_mode: 'background', pid: 123 })
    assert.equal(result.content[1].type, 'image'); assert.equal(result.content[1].mimeType, 'image/png')
    assert.equal(result.content[1].data, 'iVBORw0KGgo=')
    assert.equal(JSON.parse(result.content[0].text).secret, null)
    assert.equal(JSON.parse(result.content[0].text).telemetry, '0')
    assert.deepEqual(result.structuredContent, { observed: true })
  } finally { await connection.close() }
  assert.equal(transports[0].pid, null)
  await assert.rejects(connection.listTools(), { code: 'runtimeClosed' })
})

test('cancellation prevents spawning and terminates the owned MCP process without replaying actions', async () => {
  const { runtime, transports } = fixtureRuntime()
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runtime.launch(localProfile, { signal: controller.signal }))
  assert.equal(transports.length, 0)
  const lifetime = new AbortController(), connection = await runtime.launch({ ...localProfile, driverPath: 'C:\\driver.exe' }, { signal: lifetime.signal })
  const request = new AbortController(), pending = connection.callTool('wait', {}, request.signal)
  request.abort()
  await assert.rejects(pending)
  lifetime.abort()
  await connection.close()
  assert.equal(transports[0].pid, null)
})

test('asset verification checks both pinned size and SHA256 before extraction', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-cua-archive-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const path = join(home, 'archive.zip'), bytes = Buffer.from('not-an-executable')
  await writeFile(path, bytes)
  const asset = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  assert.deepEqual(await verifyArchive(path, asset), bytes)
  await assert.rejects(verifyArchive(path, { ...asset, bytes: bytes.length + 1 }), /校验失败/)
  await assert.rejects(verifyArchive(path, { ...asset, sha256: '0'.repeat(64) }), /校验失败/)
})

test('an unresponsive MCP initialization times out and reaps the owned stdio child', async () => {
  let transport
  const { runtime } = fixtureRuntime({ startupTimeoutMs: 120,
    createTransport(spec) {
      transport = new StdioClientTransport({ ...spec, command: process.execPath, args: [fileURLToPath(new URL('./mcp-fixture.mjs', import.meta.url)), '--hang-initialize'] })
      return transport
    } })
  await assert.rejects(runtime.launch({ ...localProfile, driverPath: 'C:\\driver.exe' }), { code: 'driverConnectionFailed' })
  assert.equal(transport.pid, null)
})

test('VM MCP crosses a real OpenSSH connection with strict host verification and retained image results', async t => {
  const require = createRequire(import.meta.url), { Server, utils } = require('ssh2')
  const key = utils.generateKeyPairSync('ed25519'), clients = new Set(), children = new Set(), commands = []
  const server = new Server({ hostKeys: [key.private] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
    client.on('authentication', context => context.method === 'none' ? context.accept() : context.reject())
    client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      commands.push(info.command)
      const stream = acceptExec(), child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-fixture.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      children.add(child); stream.on('error', () => {}); child.stdin.on('error', () => {}); child.stderr.resume()
      stream.pipe(child.stdin); child.stdout.pipe(stream)
      stream.on('close', () => child.kill()); child.on('close', code => { children.delete(child); stream.exit(code ?? 1); stream.end() })
    })))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const home = await mkdtemp(join(tmpdir(), 'seal-cua-ssh-')), knownHosts = join(home, 'known_hosts')
  await writeFile(knownHosts, `[127.0.0.1]:${server.address().port} ${key.public}\n`)
  let connection
  t.after(async () => {
    await connection?.close()
    for (const client of clients) client.end()
    for (const child of children) child.kill()
    await new Promise(resolve => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  })
  const runtime = createComputerRuntime({
    createClient: () => new Client({ name: 'ssh-fixture', version: '1' }, { versionNegotiation: { mode: 'legacy' } }),
    createTransport: spec => new StdioClientTransport({ ...spec, args: ['-o', `UserKnownHostsFile="${knownHosts.replaceAll('\\', '/')}"`, ...spec.args] }),
  })
  const profile = vm({ host: '127.0.0.1', port: server.address().port, username: 'fixture', driverPath: '/usr/local/bin/cua-driver' })
  const availability = await runtime.inspect(profile)
  if (!availability.available) { t.skip('本机没有 OpenSSH；其他平台需安装后运行此真实SSH夹具'); return }
  connection = await runtime.launch(profile)
  assert.equal((await connection.listTools())[0].name, 'get_window_state')
  const result = await connection.callTool('get_window_state', {})
  assert.equal(result.content[1].type, 'image')
  assert.match(commands[0], /'\/usr\/local\/bin\/cua-driver' 'mcp'/)
  assert.equal(commands.length, 1)
})
