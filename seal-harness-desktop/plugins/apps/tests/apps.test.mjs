import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import AdmZip from 'adm-zip'
import { openProductDatabase } from '../../local-data/src/index.js'
import { ApplicationsService } from '../src/service.js'
import { digest, downloadArtifact, extractArtifact, removeManaged } from '../src/installer.js'
import { dbxArtifacts } from '../src/catalog.js'

function archive(name, content = Buffer.from('MZfixture-binary')) {
  const zip = new AdmZip(); zip.addFile(name, content); return zip.toBuffer()
}
async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'seal-apps-')), storage = openProductDatabase(home)
  for (const id of ['first', 'second']) storage.db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, 'user', 'active', '', '')").run(id, id, id, Buffer.alloc(16), Buffer.alloc(64))
  let session = { accountId: 'first', epoch: 1 }
  const entries = new Map(), calls = [], launches = []
  const connectors = { async call(action, input = {}) {
    calls.push({ action, ...input })
    const owner = session?.accountId
    if (action === 'list') return { items: entries.get(owner) ? [entries.get(owner)] : [] }
    assert.equal(input.expectedAccountId, owner)
    if (action === 'registerApplication') entries.set(owner, { id: `dbx-${owner}`, managedApplication: 'dbx', status: options.mcpError ? 'error' : 'active', tools: [{ name: 'dbx_list_connections' }] })
    if (action === 'removeApplication') entries.delete(owner)
    return { items: entries.get(owner) ? [entries.get(owner)] : [] }
  } }
  const service = new ApplicationsService({ storage, identity: { getSession: () => session }, connectors, platform: 'win32', arch: 'x64', checkRunning: async () => {}, checkStopped: async () => {},
    async download(artifact, signal, progress) {
      signal.throwIfAborted(); progress({ phase: 'test download', total: 100, received: 50 })
      const bytes = archive(artifact.executable)
      if (options.beforeDownload) await options.beforeDownload()
      artifact.sha256 = options.corrupt ? '0'.repeat(64) : digest(bytes)
      return bytes
    },
    launch(command, args, settings) {
      launches.push({ command, args, settings })
      const child = new EventEmitter(); child.exitCode = 0; child.signalCode = null; child.unref = () => {}
      queueMicrotask(() => child.emit('spawn')); return child
    },
  })
  t.after(async () => { await service.dispose(); storage.close(); await rm(home, { recursive: true, force: true }) })
  return { home, service, storage, calls, launches, changeAccount(value) { session = value }, entries }
}

test('install, open, restore and uninstall share one DBX data directory; uninstall restores install state', async t => {
  const { service, storage, calls, launches } = await fixture(t)
  assert.equal(storage.db.prepare('PRAGMA user_version').get().user_version, 8)
  assert.equal((await service.list()).items[0].installed, false)
  service.start('install')
  await service.jobs.get('first').promise
  const installed = (await service.list()).items[0]
  assert.equal(installed.installed, true)
  assert.equal(installed.mcpStatus, 'active')
  const registration = calls.find(call => call.action === 'registerApplication')
  assert.match(registration.command, /dbx-mcp.exe$/)
  await service.open()
  assert.match(launches[0].command, /DBX.exe$/)
  assert.equal(launches[0].settings.shell, false)
  assert.equal(launches[0].settings.env.DBX_DATA_DIR, registration.dataDir)
  assert.equal(launches[0].settings.cwd, registration.dataDir)
  assert.equal(registration.cwd, registration.dataDir)
  assert.equal(launches[0].settings.env.WEBVIEW2_USER_DATA_FOLDER, join(registration.dataDir, 'webview'))
  await writeFile(join(registration.dataDir, 'keep-connections.txt'), 'keep')
  await service.restore(); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].installed, true)
  service.start('uninstall'); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].state, 'uninstalled')
  assert.equal((await service.list()).items[0].mcpStatus, 'uninstalled')
  await assert.rejects(access(registration.command))
  assert.equal(await readFile(join(registration.dataDir, 'keep-connections.txt'), 'utf8'), 'keep')
  service.start('install'); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].installed, true)
})

test('failed archive never becomes installed or registers MCP; retry succeeds', async t => {
  const options = { corrupt: true }, { service } = await fixture(t, options)
  service.start('install'); await service.jobs.get('first').promise
  const failed = (await service.list()).items[0]
  assert.equal(failed.installed, false); assert.match(failed.error, /校验失败/)
  options.corrupt = false
  service.start('install'); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].installed, true)
})

test('installation and connector scope never leak between accounts', async t => {
  const { service, changeAccount, entries } = await fixture(t)
  service.start('install'); await service.jobs.get('first').promise
  changeAccount({ accountId: 'second', epoch: 2 })
  assert.equal((await service.list()).items[0].installed, false)
  service.start('uninstall'); await service.jobs.get('second').promise
  assert(entries.has('first'))
  changeAccount(null)
  assert.throws(() => service.start('install'), /登录/)
})

test('changing account during download cancels commit and does not register a connector for the new user', async t => {
  let change
  const setup = await fixture(t, { beforeDownload: async () => { change({ accountId: 'second', epoch: 2 }) } })
  change = setup.changeAccount
  setup.service.start('install'); await setup.service.jobs.get('first').promise
  assert.equal(setup.storage.db.prepare('SELECT count(*) AS n FROM application_installations').get().n, 0)
  assert.equal(setup.calls.filter(call => call.action === 'registerApplication').length, 0)
})

test('MCP startup failure leaves a truthful installed state that can reconnect', async t => {
  const options = { mcpError: true }, { service } = await fixture(t, options)
  service.start('install'); await service.jobs.get('first').promise
  const result = (await service.list()).items[0]
  assert.equal(result.installed, true); assert.equal(result.mcpStatus, 'error'); assert.match(result.error, /MCP/)
  options.mcpError = false
  service.reconnect(); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].mcpStatus, 'active')
})

test('restart does not override a connector that the user deliberately disabled', async t => {
  const { service, entries, calls } = await fixture(t)
  service.start('install'); await service.jobs.get('first').promise
  entries.get('first').enabled = false; entries.get('first').status = 'disabled'
  const registrations = calls.filter(call => call.action === 'registerApplication').length
  await service.restore()
  assert.equal(calls.filter(call => call.action === 'registerApplication').length, registrations)
  assert.equal((await service.list()).items[0].mcpStatus, 'disabled')
})

test('an open DBX instance blocks uninstall and keeps the installed state until it exits', async t => {
  const { service } = await fixture(t)
  service.start('install'); await service.jobs.get('first').promise
  await service.open()
  service.children.get('first').exitCode = null
  service.start('uninstall'); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].installed, true)
  assert.match((await service.list()).items[0].error, /退出 DBX/)
  service.children.get('first').exitCode = 0
  service.start('uninstall'); await service.jobs.get('first').promise
  assert.equal((await service.list()).items[0].installed, false)
})

test('ZIP traversal, duplicate path and junction deletion boundaries are rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'seal-app-zip-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const zip = new AdmZip(); zip.addFile('safe.exe', Buffer.from('MZ'))
  const bytes = zip.toBuffer(), unsafe = new AdmZip(bytes)
  unsafe.getEntries()[0].entryName = '../safe.exe'
  const bad = unsafe.toBuffer()
  await assert.rejects(extractArtifact(bad, { sha256: digest(bad), executable: 'safe.exe' }, join(root, 'stage')), /不安全/)
  await assert.rejects(removeManaged(root, root), /路径/)
  await assert.rejects(removeManaged(root, join(root, '..', 'outside')), /路径/)
  const duplicate = new AdmZip(); duplicate.addFile('DBX.exe', Buffer.from('MZ')); duplicate.addFile('dbx.EXE', Buffer.from('MZ'))
  const repeated = duplicate.toBuffer()
  await assert.rejects(extractArtifact(repeated, { sha256: digest(repeated), executable: 'DBX.exe' }, join(root, 'duplicates')), /重复/)
  assert.throws(() => dbxArtifacts('darwin', 'arm64'), /Windows/)
})

test('download verifies streamed bytes before accepting a release and rejects HTTP errors', async () => {
  const bytes = archive('DBX.exe'), controller = new AbortController(), progress = []
  const artifact = { kind: 'desktop', url: 'https://github.com/t8y2/dbx/releases/test', sha256: digest(bytes) }
  const received = await downloadArtifact(artifact, controller.signal, value => progress.push(value), async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }))
  assert.deepEqual(received, bytes); assert.equal(progress.at(-1).received, bytes.length)
  await assert.rejects(downloadArtifact({ ...artifact, sha256: '0'.repeat(64) }, controller.signal, () => {}, async () => new Response(bytes)), /校验失败/)
  await assert.rejects(downloadArtifact(artifact, controller.signal, () => {}, async () => new Response(null, { status: 503 })), /HTTP 503/)
})
