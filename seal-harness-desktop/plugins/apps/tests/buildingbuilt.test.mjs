import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProductDatabase } from '../../local-data/src/index.js'
import { BuildingBuiltService } from '../src/buildingbuilt-service.js'
import { inspectLocalRelease, installLocalRelease } from '../src/local-release.js'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

async function release(root, files = { 'BuildingBuilt.exe': Buffer.from('MZfixture'), '_internal/src/workbench/static/index.html': Buffer.from('<html>ok</html>') }) {
  await mkdir(root, { recursive: true })
  const entries = []
  for (const [path, bytes] of Object.entries(files)) {
    const target = join(root, ...path.split('/'))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, bytes)
    entries.push({ path, size: bytes.length, sha256: sha(bytes) })
  }
  const manifest = { id: 'buildingbuilt', name: 'BuildingBuilt', version: '0.1.0', platform: 'win32', arch: 'x64', entry: 'BuildingBuilt.exe', files: entries }
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  await writeFile(join(root, 'release.json'), bytes)
  return { manifest, hash: sha(bytes) }
}

test('only the pinned local release can be installed and staged bytes are verified', async t => {
  const home = await mkdtemp(join(tmpdir(), 'buildingbuilt-release-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const source = join(home, 'source'), output = join(home, 'install')
  const { hash } = await release(source)
  await assert.rejects(inspectLocalRelease(source, '0'.repeat(64)), /清单校验失败/)
  const inspected = await inspectLocalRelease(source, hash)
  await writeFile(join(source, 'BuildingBuilt.exe'), 'tampered')
  await assert.rejects(installLocalRelease(output, inspected, new AbortController().signal), /文件校验失败/)
  await assert.rejects(access(join(output, 'runtime', 'BuildingBuilt.exe')))
})

test('failed replacement restores the previous runnable release', async t => {
  const home = await mkdtemp(join(tmpdir(), 'buildingbuilt-replace-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const oldSource = join(home, 'old'), newSource = join(home, 'new'), output = join(home, 'install')
  const oldBytes = Buffer.from('MZold'), newBytes = Buffer.from('MZnew')
  const oldRelease = await release(oldSource, { 'BuildingBuilt.exe': oldBytes })
  const newRelease = await release(newSource, { 'BuildingBuilt.exe': newBytes })
  await installLocalRelease(output, await inspectLocalRelease(oldSource, oldRelease.hash), new AbortController().signal)
  await assert.rejects(installLocalRelease(output, await inspectLocalRelease(newSource, newRelease.hash),
    new AbortController().signal, () => {}, async () => { throw new Error('database commit failed') }), /database commit failed/)
  assert.deepEqual(await readFile(join(output, 'runtime', 'BuildingBuilt.exe')), oldBytes)
})

test('Seal installs, opens and uninstalls the independent release while retaining account data', async t => {
  const home = await mkdtemp(join(tmpdir(), 'buildingbuilt-app-'))
  const storage = openProductDatabase(home)
  t.after(async () => { storage.close(); await rm(home, { recursive: true, force: true }) })
  storage.db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, 'user', 'active', '', '')").run('first', 'first', 'first', Buffer.alloc(16), Buffer.alloc(64))
  const source = join(home, 'source'), { hash } = await release(source)
  const launches = []
  const service = new BuildingBuiltService({ storage, identity: { getSession: () => ({ accountId: 'first', epoch: 1 }) },
    platform: 'win32', arch: 'x64', catalog: { id: 'buildingbuilt', version: '0.1.0', manifestSha256: hash },
    checkRunning: async () => false, checkStopped: async () => {},
    launch(executable, args, options) {
      launches.push({ executable, args, options })
      const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.unref = () => {}
      queueMicrotask(async () => {
        child.emit('spawn')
        await writeFile(options.env.BUILDING_BUILT_READY_FILE,
          JSON.stringify({ nonce: options.env.BUILDING_BUILT_LAUNCH_NONCE }))
      })
      return child
    },
  })
  t.after(() => service.dispose())
  service.start('install', source)
  await service.jobs.get('first').promise
  assert.equal(service.list().installed, true)
  assert.equal(await readFile(join(service.paths('first').runtime, 'BuildingBuilt.exe'), 'utf8'), 'MZfixture')
  await writeFile(join(service.paths('first').data, 'keep.txt'), 'result')
  assert.deepEqual(await service.open(), { opened: true, ready: true })
  assert.equal(launches[0].args.length, 0)
  assert.equal(launches[0].options.cwd, service.paths('first').data)
  assert.equal(launches[0].options.env.BUILDING_BUILT_DATA_DIR, service.paths('first').data)
  service.start('uninstall')
  await service.jobs.get('first').promise
  assert.equal(service.list().installed, false)
  assert.equal(await readFile(join(service.paths('first').data, 'keep.txt'), 'utf8'), 'result')
})
