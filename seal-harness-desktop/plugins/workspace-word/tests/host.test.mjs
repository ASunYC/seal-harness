import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { copyFile, link, mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { OfficeService as LibraryOfficeService } from '../../office/src/service.js'
import JSZip from 'jszip'

const fixture = name => join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name)

test('Word RPC opens a local workspace DOCX, commits bytes, and rejects stale or outside files', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-office-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  const outside = join(home, 'outside.docx')
  const source = join(workspace, 'sample.docx')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(workspace)
  await copyFile(fixture('sample.docx'), source)
  await copyFile(fixture('sample.docx'), outside)
  let account = { accountId: 'owner', epoch: 1 }
  const routes = new Map()
  apply({
    sessions: { get: id => id === 'session-1' ? { header: { cwd: workspace } } : undefined },
    sandboxPolicy: { workspaceRoot: workspace },
    fs: { processPathFromHostPath: path => path },
    sealHarnessIdentity: { getSession: () => account },
    sealHarnessDatabase: { path: join(home, 'seal.sqlite') },
    sealHarnessOffice: { transform: async () => { throw new Error('Unexpected Office worker call') } },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    effect() {}, logger: { error() {} },
  })
  const rpc = async (action, payload) => {
    const method = `seal-harness-workspace-word/${action}`
    const response = await routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
    }))
    return (await response.json()).result
  }

  const outsideResult = await rpc('open', { sessionId: 'session-1', path: outside })
  assert.equal(outsideResult.error.code, 'outsideWorkspace')
  const opened = await rpc('open', { sessionId: 'session-1', path: source })
  assert.equal(opened.ok, true)
  assert.equal(Buffer.from(opened.value.data, 'base64').equals(await readFile(source)), true)
  const replacement = await readFile(fixture('blank.docx'))
  const saved = await rpc('save', { leaseId: opened.value.leaseId, data: replacement.toString('base64') })
  assert.equal(saved.ok, true)
  assert.equal((await readFile(source)).equals(replacement), true)
  assert.deepEqual(await readdir(join(home, 'office', 'preimages')), [])

  const paddedZip = await JSZip.loadAsync(await readFile(fixture('sample.docx')))
  paddedZip.file('word/media/large.bin', randomBytes(9 * 1024 * 1024), { compression: 'STORE' })
  const padded = await paddedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  assert.ok(padded.length > 8 * 1024 * 1024)
  const large = join(workspace, 'large.docx')
  await writeFile(large, padded)
  const largeOpen = await rpc('open', { sessionId: 'session-1', path: large })
  assert.equal(largeOpen.ok, true)
  assert.equal((await rpc('save', { leaseId: largeOpen.value.leaseId, data: largeOpen.value.data })).ok, true)
  assert.equal((await readFile(large)).equals(padded), true)

  await writeFile(source, await readFile(fixture('sample.docx')))
  const stale = await rpc('save', { leaseId: opened.value.leaseId, data: replacement.toString('base64') })
  assert.equal(stale.error.code, 'sourceChanged')
  assert.equal((await readFile(source)).equals(await readFile(fixture('sample.docx'))), true)
  account = { accountId: 'other', epoch: 2 }
  assert.equal((await rpc('save', { leaseId: opened.value.leaseId, data: replacement.toString('base64') })).error.code, 'accountChanged')
})

test('Word RPC rejects invalid content and final symlinks without replacing the source', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-office-invalid-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  const { mkdir, symlink } = await import('node:fs/promises')
  await mkdir(workspace)
  const source = join(workspace, 'sample.docx')
  await copyFile(fixture('sample.docx'), source)
  const linked = join(workspace, 'linked.docx')
  try { await symlink(source, linked) }
  catch (error) {
    if (error.code !== 'EPERM') throw error
    t.diagnostic('Windows 当前用户不能创建符号链接，链接拒绝用例跳过。')
  }
  const routes = new Map()
  apply({ sessions: { get: () => ({ header: { cwd: workspace } }) }, sandboxPolicy: { workspaceRoot: workspace },
    fs: { processPathFromHostPath: path => path }, sealHarnessIdentity: { getSession: () => ({ accountId: 'owner', epoch: 1 }) },
    sealHarnessOffice: { transform: async () => { throw new Error('Unexpected Office worker call') } },
    sealHarnessDatabase: { path: join(home, 'seal.sqlite') }, connection: { fetch: { register: route => routes.set(route.path, route) } }, effect() {}, logger: { error() {} } })
  const rpc = async (action, payload) => {
    const method = `seal-harness-workspace-word/${action}`
    const response = await routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
    }))
    return (await response.json()).result
  }
  if ((await readdir(workspace)).includes('linked.docx'))
    assert.equal((await rpc('open', { sessionId: 's', path: linked })).error.code, 'invalidPath')
  const opened = await rpc('open', { sessionId: 's', path: source })
  assert.equal(opened.ok, true)
  assert.equal((await rpc('save', { leaseId: opened.value.leaseId, data: Buffer.from('not a docx').toString('base64') })).error.code, 'invalidDocument')
  assert.equal((await readFile(source)).equals(await readFile(fixture('sample.docx'))), true)
  const oversized = join(workspace, 'oversized.docx')
  const oversizedHandle = await open(oversized, 'wx')
  try { await oversizedHandle.truncate(64 * 1024 * 1024 + 1) } finally { await oversizedHandle.close() }
  assert.equal((await rpc('open', { sessionId: 's', path: oversized })).error.code, 'tooLarge')
  const hardlinked = join(workspace, 'hardlinked.docx')
  await link(source, hardlinked)
  assert.equal((await rpc('open', { sessionId: 's', path: hardlinked })).error.code, 'invalidPath')
})

test('workspace Office RPC creates, imports, edits and exports real XLSX and PPTX files in place', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-workspace-office-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(workspace)
  let account = { accountId: 'owner', epoch: 1 }
  const identity = { getSession: () => account, subscribe: () => () => {} }
  const library = new LibraryOfficeService({ root: join(home, 'library'), identity })
  t.after(() => library.dispose())
  const routes = new Map()
  apply({
    sessions: { get: id => id === 'session-1' ? { header: { cwd: workspace } } : undefined },
    sandboxPolicy: { workspaceRoot: workspace }, fs: { processPathFromHostPath: path => path },
    sealHarnessIdentity: identity, sealHarnessDatabase: { path: join(home, 'seal.sqlite') },
    sealHarnessOffice: library,
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    effect() {}, logger: { error() {} },
  })
  const rpc = async (action, payload) => {
    const method = `seal-harness-workspace-word/${action}`
    const response = await routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
    }))
    return (await response.json()).result
  }

  for (const [kind, content, replacement] of [['xlsx', 'A,B\n1,2', 'Changed'], ['pptx', 'Before', 'After']]) {
    const path = join(workspace, `source.${kind}`)
    const created = await rpc('create', { sessionId: 'session-1', path, content })
    assert.equal(created.ok, true, JSON.stringify(created.error))
    assert.equal(created.value.status, 'created')
    assert.equal(created.value.kind, kind)
    assert.equal(created.value.view.kind, kind)
    const original = await readFile(path)
    const editable = created.value.view.blocks.find(block => block.editable)
    assert.ok(editable)
    const edited = await rpc('edit', { leaseId: created.value.leaseId, updates: [{ id: editable.id, text: replacement }] })
    assert.equal(edited.ok, true, JSON.stringify(edited.error))
    assert.ok(edited.value.view.blocks.some(block => block.text.includes(replacement)))
    assert.equal((await readFile(path)).equals(original), false)
    const downloaded = await rpc('download', { leaseId: created.value.leaseId })
    assert.equal(downloaded.ok, true)
    assert.equal(Buffer.from(downloaded.value.base64, 'base64').equals(await readFile(path)), true)
    const importedPath = join(workspace, `imported.${kind}`)
    const imported = await rpc('import', { sessionId: 'session-1', path: importedPath, data: downloaded.value.base64 })
    assert.equal(imported.ok, true, JSON.stringify(imported.error))
    assert.equal(imported.value.status, 'created')
    assert.equal((await readFile(importedPath)).equals(await readFile(path)), true)
    assert.equal((await rpc('import', { sessionId: 'session-1', path: importedPath, data: downloaded.value.base64 })).error.code, 'targetExists')
    const saved = await rpc('save', { leaseId: imported.value.leaseId, data: downloaded.value.base64 })
    assert.equal(saved.ok, true)
    assert.equal((await readFile(importedPath)).equals(await readFile(path)), true)
  }

  const outside = join(home, 'outside.xlsx')
  assert.equal((await rpc('create', { sessionId: 'session-1', path: outside })).error.code, 'outsideWorkspace')
  const source = join(workspace, 'source.xlsx')
  const opened = await rpc('open', { sessionId: 'session-1', path: source })
  await writeFile(source, Buffer.from('external change'))
  assert.equal((await rpc('download', { leaseId: opened.value.leaseId })).error.code, 'sourceChanged')
  account = { accountId: 'other', epoch: 2 }
  assert.equal((await rpc('edit', { leaseId: opened.value.leaseId, updates: [{ id: '["Sheet1","A1"]', text: 'X' }] })).error.code, 'accountChanged')
})

test('new workspace documents reject stale accounts and parent links, and report a file created before its editor closed', async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-office-create-boundaries-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace')
  const { mkdir, symlink } = await import('node:fs/promises')
  await mkdir(workspace)
  await mkdir(join(workspace, 'real'))
  let account = { accountId: 'owner', epoch: 1 }
  let changeDuringTransform = true
  let sessionReads = 0
  let closeDuringOpen = false
  const routes = new Map()
  apply({
    sessions: { get: () => ++sessionReads > 3 && closeDuringOpen ? undefined : { header: { cwd: workspace } } },
    sandboxPolicy: { workspaceRoot: workspace }, fs: { processPathFromHostPath: path => path },
    sealHarnessIdentity: { getSession: () => account }, sealHarnessDatabase: { path: join(home, 'seal.sqlite') },
    sealHarnessOffice: { async transform(input) {
      if (changeDuringTransform) account = { accountId: 'other', epoch: 2 }
      return input.action === 'create' ? { bytes: await readFile(fixture('sample.docx')) } : { view: { kind: input.kind, blocks: [] } }
    } },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    effect() {}, logger: { error() {} },
  })
  const rpc = async (action, payload) => {
    const method = `seal-harness-workspace-word/${action}`
    const response = await routes.get(`/api/${method}`).fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
    }))
    return (await response.json()).result
  }

  const staleTarget = join(workspace, 'stale.docx')
  assert.equal((await rpc('create', { sessionId: 's', path: staleTarget })).error.code, 'accountChanged')
  assert.equal((await readdir(workspace)).includes('stale.docx'), false)
  account = { accountId: 'owner', epoch: 1 }
  const imported = join(workspace, 'stale.xlsx')
  assert.equal((await rpc('import', { sessionId: 's', path: imported, data: Buffer.from('fake').toString('base64') })).error.code, 'accountChanged')
  assert.equal((await readdir(workspace)).includes('stale.xlsx'), false)
  account = { accountId: 'owner', epoch: 1 }
  changeDuringTransform = false
  const linkedParent = join(workspace, 'linked')
  try { await symlink(join(workspace, 'real'), linkedParent, 'dir') }
  catch (error) {
    if (error.code !== 'EPERM') throw error
    t.diagnostic('Windows 当前用户不能创建目录符号链接，父级链接拒绝用例跳过。')
  }
  if ((await readdir(workspace)).includes('linked'))
    assert.equal((await rpc('create', { sessionId: 's', path: join(linkedParent, 'linked.docx') })).error.code, 'invalidPath')
  sessionReads = 0
  closeDuringOpen = true
  const createdPath = join(workspace, 'survives.docx')
  const result = await rpc('create', { sessionId: 's', path: createdPath })
  assert.equal(result.ok, true)
  assert.equal(result.value.status, 'createdNotOpened')
  assert.equal((await readFile(createdPath)).equals(await readFile(fixture('sample.docx'))), true)
})
