import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import AdmZip from 'adm-zip'
import { createModule } from '../src/module.js'
import { openProductDatabase } from '../../local-data/src/index.js'
import { createArchive, inspectFiles, parseSkill, readArchive, safeRelative } from '../src/package.js'
import { skillCatalog } from '../../capability-shared/src/catalog.js'

test('system market skills install the complete verified files into SQLite and the real DSH registry', async t => {
  const fixture = await setup(t)
  const item = skillCatalog.find(item => item.source === 'clawhub')
  const files = { 'SKILL.md': instruction('catalog-example'), 'references/guide.md': 'Full reference', LICENSE: 'MIT example license' }
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    if (url.includes('/versions/')) return Response.json({ version: { files: Object.entries(files).map(([path, text]) => ({ path, sha256: createHash('sha256').update(text).digest('hex') })), license: 'MIT' } })
    if (url.includes('/file?')) return new Response(files[new URL(url).searchParams.get('path')])
    return Response.json({ latestVersion: { version: '1.0.0' } })
  }
  t.after(() => { globalThis.fetch = original })
  const initial = await fixture.action('list')
  assert.equal(initial.catalog.length, 407)
  const installed = await fixture.action('installCatalog', { id: item.id, expectedRevision: initial.revision })
  assert.equal(installed.skills.length, 1)
  assert.equal(installed.skills[0].enabled, true)
  assert.equal(installed.skills[0].origin.catalogId, item.id)
  assert.equal(installed.catalog.find(entry => entry.id === item.id).installed, true)
  const archive = fixture.storage.db.prepare('SELECT archive_blob FROM skills').get().archive_blob
  const persisted = readArchive(Buffer.from(archive))
  assert.equal(persisted.find(file => file.path === 'references/guide.md').bytes.toString(), 'Full reference')
  assert(persisted.some(file => file.path === 'LICENSE'))
  assert(persisted.some(file => file.path === 'SEAL-SOURCE.md'))
  assert((await fixture.ctx.skills.list({ scope: scopeOf(fixture.ctx) })).some(skill => skill.name === 'catalog-example'))
  const repeated = await fixture.action('installCatalog', { id: item.id, expectedRevision: installed.revision })
  assert.equal(repeated.skills.length, 1)
})

const instruction = (name = 'sample-skill', policy = '') => `---\nname: ${name}\ndescription: Test skill instructions\n${policy}---\nRead references/guide.md before doing the task.\n`

async function setup(t, backend = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seal-harness-skills-'))
  const ctx = new Context()
  const registry = ctx.plugin(SkillRegistry)
  await registry
  const home = join(root, 'home')
  const storage = openProductDatabase(home)
  const now = new Date().toISOString()
  const account = backend.account ?? (async () => ({ accountId: 'local-skills-user', epoch: 1 }))
  const effectiveBackend = { ...backend, async account() {
    const current = await account()
    if (!storage.db.prepare('SELECT 1 FROM users WHERE id = ?').get(current.accountId)) {
      storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(current.accountId, current.accountId, current.accountId, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
    }
    return current
  }, assertAccount: backend.assertAccount ?? (async () => {}) }
  ctx.provide('sealHarnessDatabase', storage)
  ctx.provide('sealHarnessIdentity', { getSession: () => ({ accountId: 'local-skills-user' }), subscribe: () => () => {} })
  const source = join(root, 'source')
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), instruction())
  await writeFile(join(source, 'references', 'guide.md'), 'Reference contents')
  const module = await createModule(ctx, { home, backend: effectiveBackend })
  const action = (action, payload = {}, signal) => module.handlers[action](payload, signal)
  t.after(async () => { await module.dispose(); await registry.dispose(); storage.close(); await rm(root, { recursive: true, force: true }) })
  return { root, home, source, ctx, module, action, backend: effectiveBackend, storage }
}

async function importLocal(action, source, enable = false) {
  const preview = await action('inspect', { path: source })
  return action('import', { token: preview.token, enable })
}

test('copies complete skill package, honors invocation policy, updates real DSH registry, and disposes', async t => {
  const { action, source, ctx, module } = await setup(t)
  await writeFile(join(source, 'SKILL.md'), instruction('sample-skill', 'disable-model-invocation: true\nuser-invocable: true\n'))
  const imported = await importLocal(action, source)
  const [item] = imported.skills
  assert.equal(item.fileCount, 2)
  assert.deepEqual(await ctx.skills.list(), [])
  await action('setEnabled', { id: item.id, enabled: true, expectedRevision: imported.revision })
  const runtime = await ctx.skills.get('sample-skill')
  assert.equal(runtime.provider, 'seal-harness-skills')
  assert.deepEqual(runtime.invocation, { modelInvocable: false, userInvocable: true })
  assert.match(runtime.content, /references\/guide.md/)
  assert.equal(await readFile(join(runtime.resourceBase.path, 'references', 'guide.md'), 'utf8'), 'Reference contents')
  assert.equal((await action('list')).skills[0].active, true)
  await action('setEnabled', { id: item.id, enabled: false })
  assert.equal(await ctx.skills.get('sample-skill'), undefined)
  await action('setEnabled', { id: item.id, enabled: true })
  await module.dispose()
  assert.deepEqual(await ctx.skills.list(), [])
  await assert.rejects(action('list'), /卸载/)
})

test('model-created personal skill stays uninstalled until explicit installation', async t => {
  const { action, ctx, module } = await setup(t)
  const created = await action('create', { content: instruction('draft-skill'), draft: true })
  const [item] = created.skills
  assert.equal(item.installed, false)
  assert.equal(item.enabled, false)
  assert.equal((await action('list')).skills.find(skill => skill.id === item.id).installed, false)
  assert.deepEqual((await module.hostHandlers.workflowResources()).resources, [])
  await assert.rejects(action('setEnabled', { id: item.id, enabled: true }), /先安装/)
  await assert.rejects(module.hostHandlers.runtimeSkill({ id: item.id }), /未安装/)
  await action('installPersonal', { id: item.id })
  const installed = (await action('list')).skills.find(skill => skill.id === item.id)
  assert.equal(installed.installed, true)
  assert.equal(installed.enabled, true)
  assert.equal((await ctx.skills.get('draft-skill')).provider, 'seal-harness-skills')
})

test('import and export preserve executable script attributes', { skip: process.platform === 'win32' }, async t => {
  const { action, source } = await setup(t)
  const script = join(source, 'run.sh')
  await writeFile(script, '#!/bin/sh\necho skill\n')
  await chmod(script, 0o755)
  const { skills: [item] } = await importLocal(action, source)
  const exported = await action('export', { id: item.id })
  const file = readArchive(Buffer.from(exported.zipBase64, 'base64')).find(file => file.path === 'run.sh')
  assert.equal(file.bytes.toString(), '#!/bin/sh\necho skill\n')
  assert.equal(file.mode, 0o755 & ~process.umask())
})

test('removes only managed copy and exports assets losslessly', async t => {
  const { action, source, ctx } = await setup(t)
  const { skills: [item] } = await importLocal(action, source, true)
  const exported = await action('export', { id: item.id })
  const files = readArchive(Buffer.from(exported.zipBase64, 'base64'))
  assert.equal(files.find(file => file.path === 'references/guide.md').bytes.toString(), 'Reference contents')
  const detail = await action('detail', { id: item.id, path: 'references/guide.md' })
  assert.equal(detail.fileContent, 'Reference contents')
  await assert.rejects(action('detail', { id: item.id, path: '../../outside' }), /不安全/)
  await action('remove', { id: item.id })
  assert.equal((await action('list')).skills.length, 0)
  assert.equal(await ctx.skills.get('sample-skill'), undefined)
  assert.equal(await readFile(join(source, 'SKILL.md'), 'utf8'), instruction())
})

test('custom source discovery and removal preserve imported copies', async t => {
  const { action, root, source } = await setup(t)
  await assert.rejects(action('discover', { sourceId: 'unknown' }), /不存在/)
  const result = await action('approveSource', { path: source, label: '测试来源' })
  const approved = result.sources.find(item => item.label === '测试来源')
  assert.ok(approved.approved)
  const discovery = await action('discover', { sourceId: approved.id })
  assert.equal(discovery.skills[0].name, 'sample-skill')
  const preview = await action('inspect', discovery.skills[0])
  await action('import', { token: preview.token })
  await assert.rejects(action('inspect', { sourceId: approved.id, key: '../../' }), /不安全/)
  await action('revokeSource', { id: approved.id })
  assert.equal((await action('list')).skills.length, 1)
  assert.deepEqual(new Set(await readdir(source)), new Set(['SKILL.md', 'references']))
})

test('rejects links, duplicate names, stale writes, and changed imported content', async t => {
  const { action, source, home } = await setup(t)
  await symlink(tmpdir(), join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(action('inspect', { path: source }), /符号链接/)
  await rm(join(source, 'linked'))
  const { skills: [item] } = await importLocal(action, source)
  const preview = await action('inspect', { path: source })
  await assert.rejects(action('import', { token: preview.token }), /已存在/)
  await assert.rejects(action('setEnabled', { id: item.id, enabled: true, expectedRevision: 0 }), /已变化/)
  await writeFile(join(home, 'seal-harness-cache', 'skills', 'packages', item.id, 'references', 'guide.md'), 'Changed')
  await assert.rejects(action('setEnabled', { id: item.id, enabled: true }), /内容已变化/)
})

test('serializes revision-sensitive mutations and persists toggles across module reload', async t => {
  const { action, source, home, ctx, module, backend } = await setup(t)
  const imported = await importLocal(action, source)
  const id = imported.skills[0].id
  const results = await Promise.allSettled([
    action('setEnabled', { id, enabled: true, expectedRevision: imported.revision }),
    action('remove', { id, expectedRevision: imported.revision }),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  await module.dispose()
  const reloaded = await createModule(ctx, { home, backend })
  try {
    assert.equal((await ctx.skills.get('sample-skill')).name, 'sample-skill')
    assert.equal((await reloaded.handlers.list()).skills[0].enabled, true)
  } finally { await reloaded.dispose() }
})

test('managed skill archive reloads from SQLite after generated files are removed', async t => {
  const { action, source, home, ctx, module, backend, storage } = await setup(t)
  const { skills: [item] } = await importLocal(action, source, true)
  const row = storage.db.prepare('SELECT archive_blob FROM skills WHERE id = ?').get(item.id)
  assert(row)
  assert.equal(readArchive(Buffer.from(row.archive_blob)).find(file => file.path === 'SKILL.md').bytes.toString(), instruction())
  await module.dispose()
  await rm(join(home, 'seal-harness-cache'), { recursive: true, force: true })
  const restarted = await createModule(ctx, { home, backend })
  t.after(() => restarted.dispose())
  assert.equal((await restarted.handlers.list()).skills[0].name, 'sample-skill')
  assert.equal((await ctx.skills.get('sample-skill')).name, 'sample-skill')
})

test('public provider obeys Cordis scopes without leaking into global or sibling views', async t => {
  const { source, root, ctx, storage } = await setup(t)
  const now = new Date().toISOString()
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('scoped-user', 'scoped-user', 'Scoped User', Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
  const scope = createScope(ctx, { preset: 'skills-test' })
  const scopedContext = scope.ctx
  const module = await createModule(scopedContext, { home: join(root, 'scoped'), backend: { account: async () => ({ accountId: 'scoped-user', epoch: 1 }), assertAccount: async () => {} } })
  const action = (action, data = {}) => module.handlers[action](data)
  try {
    await importLocal(action, source, true)
    assert.equal(await ctx.skills.get('sample-skill'), undefined)
    assert.equal((await ctx.skills.get('sample-skill', { scope: scopeOf(scopedContext) })).name, 'sample-skill')
    await scope.dispose()
    assert.equal(await ctx.skills.get('sample-skill', { scope: scopeOf(scopedContext) }), undefined)
  } finally { await module.dispose() }
})

test('ZIP reader can separate archive and expanded-size limits for trusted callers', () => {
  const bytes = createArchive([{ path: 'payload.bin', bytes: Buffer.alloc(2048), mode: 0o644 }])
  assert.equal(readArchive(bytes, { maxPackageBytes: bytes.length + 1, maxFileBytes: 4096, maxExpandedBytes: 4096 })[0].bytes.length, 2048)
  assert.throws(() => readArchive(bytes, { maxPackageBytes: bytes.length + 1, maxFileBytes: 4096, maxExpandedBytes: 1024 }), /解压后超过大小限制/)
})

test('ZIP import supports collections and rejects traversal, symlinks, collisions, and invalid invocation', () => {
  for (const path of ['../escape', '/absolute', 'C:/windows', 'a\\b', 'a/../b', 'a/NUL.txt', 'a/b.']) assert.throws(() => safeRelative(path), /不安全/)
  const zip = new AdmZip()
  zip.addFile('a/SKILL.md', Buffer.from(instruction('skill-a')))
  zip.addFile('b/SKILL.md', Buffer.from(instruction('skill-b')))
  assert.deepEqual(inspectFiles(readArchive(zip.toBuffer())).map(item => item.name), ['skill-a', 'skill-b'])
  const link = new AdmZip()
  link.addFile('SKILL.md', Buffer.from(instruction()))
  link.addFile('link', Buffer.from('/etc/passwd'), '', 0o120777)
  link.getEntry('link').header.attr = (0o120777 << 16) >>> 0
  assert.throws(() => readArchive(link.toBuffer()), /符号链接/)
  const collision = new AdmZip()
  collision.addFile('SKILL.md', Buffer.from(instruction()))
  collision.addFile('skill.md', Buffer.from(instruction()))
  assert.throws(() => readArchive(collision.toBuffer()), /大小写/)
  assert.throws(() => parseSkill(Buffer.from(instruction('sample-skill', 'user-invocable: wrong\n'))), /布尔/)
})

test('remote skill install uses resolver/export protocol and verifies artifact hash before writing', async t => {
  const bytes = createArchive([{ path: 'SKILL.md', bytes: Buffer.from(instruction('remote-skill')), mode: 0o644 }])
  const calls = []
  let badHash = true
  const backend = {
    async account() { return { accountId: 'account-a', epoch: 1 } },
    async assertAccount() {},
    async request(path, options) {
      calls.push({ path, options })
      if (path.endsWith('/result')) return { data: {} }
      return { data: { schemaVersion: 'stratex.registry-lock/v1', resolutionId: 'resolved', capabilities: [{ assetId: 'asset-id', assetType: 'skill', version: '1.0.0', artifact: { sizeBytes: bytes.length, sha256: badHash ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex') } }] } }
    },
    async download(path) { calls.push({ path }); return { bytes } },
  }
  const { action, ctx } = await setup(t, backend)
  await assert.rejects(action('install', { id: 'asset-id', version: '1.0.0' }), /SHA-256/)
  assert.equal((await action('list')).skills.length, 0)
  badHash = false
  const installed = await action('install', { id: 'asset-id', version: '1.0.0', enable: true })
  assert.equal(installed.resolutionId, 'resolved')
  assert.equal(installed.reported, true)
  assert.equal(calls[0].path, 'installations/resolve')
  assert.deepEqual(calls[0].options.body.requirements, [{ assetId: 'asset-id', versionRange: '1.0.0' }])
  assert.equal(calls[1].path, 'skills/asset-id/versions/1.0.0/export')
  assert.equal((await ctx.skills.get('remote-skill')).name, 'remote-skill')
})

test('aborted import leaves no managed package and no registration', async t => {
  const { action, source, home, ctx } = await setup(t)
  const preview = await action('inspect', { path: source })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(action('import', { token: preview.token, enable: true }, controller.signal), { name: 'AbortError' })
  assert.deepEqual(await readdir(join(home, 'seal-harness-cache', 'skills', 'packages')), [])
  assert.deepEqual(await ctx.skills.list(), [])
})

test('remote skill catalog and bodies follow account identity, and pending receipt retries retain local install', async t => {
  const bytes = createArchive([{ path: 'SKILL.md', bytes: Buffer.from(instruction('account-skill')), mode: 0o644 }])
  let account = { accountId: 'alice', epoch: 1 }
  let online = false
  const reports = []
  const backend = {
    async account() {
      if (!account) throw Object.assign(new Error('signed out'), { code: 'authenticationRequired' })
      return { ...account }
    },
    async assertAccount(captured) {
      if (!account || captured.accountId !== account.accountId || captured.epoch !== account.epoch) throw Object.assign(new Error('account changed'), { code: 'identityChanged' })
    },
    async request(path, options) {
      if (path.endsWith('/result')) {
        if (!online) throw Object.assign(new Error('offline'), { code: 'unreachable' })
        reports.push(options.body)
        return { data: {} }
      }
      assert.match(options.body.installationUid, /^[0-9a-f-]{36}$/)
      return { data: { schemaVersion: 'stratex.registry-lock/v1', resolutionId: 'resolution-account', capabilities: [{ assetId: 'account-asset', assetType: 'skill', version: '1.0', permissions: [{ required: true, description: '读取参考文件' }], artifact: { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }] } }
    },
    async download() { return { bytes } },
  }
  const { action, source, ctx } = await setup(t, backend)
  await importLocal(action, source, true)
  const installed = await action('install', { id: 'account-asset', version: '1.0', enable: true })
  assert.equal(installed.reported, false)
  const id = installed.skills[0].id
  assert.equal((await ctx.skills.get('account-skill')).name, 'account-skill')
  assert.equal((await action('list')).pendingReports, 1)
  account = { accountId: 'bob', epoch: 2 }
  assert.deepEqual((await ctx.skills.list()).map(item => item.name), [])
  assert.equal(await ctx.skills.get('account-skill'), undefined)
  await assert.rejects(action('detail', { id }), /不存在/)
  assert.equal((await action('list')).skills.length, 0)
  account = null
  assert.equal(await ctx.skills.get('sample-skill'), undefined)
  assert.equal(await ctx.skills.get('account-skill'), undefined)
  account = { accountId: 'alice', epoch: 3 }
  online = true
  assert.equal((await action('retryReports')).reported, true)
  assert.equal((await action('list')).pendingReports, 0)
  assert.deepEqual(reports, [{ status: 'succeeded', versions: { 'account-asset': '1.0' } }])
})

test('rejects malformed action payloads and validates ZIP file size before expansion', async t => {
  const { module, action } = await setup(t)
  await assert.rejects(module.handlers.list(null), { code: 'skillRejected' })
  await assert.rejects(action('setEnabled', { id: '../outside', enabled: 'true' }), { code: 'skillRejected' })
  const zip = new AdmZip()
  zip.addFile('SKILL.md', Buffer.from(instruction()))
  zip.getEntry('SKILL.md').header.size = 17 * 1024 * 1024
  assert.throws(() => readArchive(zip.toBuffer()), /超过大小限制/)
})

test('creates and edits real managed skill files, refreshes registry and rejects stale writes', async t => {
  const { action, ctx } = await setup(t)
  const { skills: [created] } = await action('create', { content: instruction('created-skill') })
  await action('setEnabled', { id: created.id, enabled: true })
  const detail = await action('detail', { id: created.id })
  assert.equal(detail.rawContent, instruction('created-skill'))
  await action('saveFile', { id: created.id, path: 'SKILL.md', content: instruction('edited-skill'), expectedHash: detail.contentHash })
  assert.equal(await ctx.skills.get('created-skill'), undefined)
  assert.equal((await ctx.skills.get('edited-skill')).name, 'edited-skill')
  await assert.rejects(action('saveFile', { id: created.id, path: 'SKILL.md', content: instruction('stale'), expectedHash: detail.contentHash }), /已变化/)
  const current = await action('detail', { id: created.id })
  await assert.rejects(action('saveFile', { id: created.id, path: 'SKILL.md', content: 'invalid markdown', expectedHash: current.contentHash }), /YAML/)
  assert.equal((await action('detail', { id: created.id })).name, 'edited-skill')
})

test('Host workflow export preserves selected UTF-8 resources and rejects an outdated selection', async t => {
  const { action, module, source } = await setup(t)
  const { skills: [item] } = await importLocal(action, source)
  const { resources: [selection] } = await module.hostHandlers.workflowResources()
  assert.equal(module.handlers.workflowExport, undefined)
  const exported = await module.hostHandlers.workflowExport(selection)
  assert.equal(exported.capabilities[0].assetId, item.id)
  assert.equal(exported.capabilities[0].files.find(file => file.path === 'references/guide.md').content, 'Reference contents')
  assert.deepEqual(exported.credentials, [])
  await action('saveFile', { id: item.id, path: 'references/guide.md', content: 'Updated', expectedHash: item.contentHash })
  await assert.rejects(module.hostHandlers.workflowExport(selection), /已更新/)
})

test('skill resolver installs MCP dependencies through the existing Host service', async t => {
  const bytes = createArchive([{ path: 'SKILL.md', bytes: Buffer.from(instruction('mixed-skill')), mode: 0o644 }])
  const dependency = { assetId: 'mcp-id', assetType: 'mcp', version: '1.0.0', descriptor: {} }
  const backend = { account: async () => ({ accountId: 'a', epoch: 1 }), assertAccount: async () => {}, download: async () => ({ bytes }), request: async path => ({ data: path.endsWith('/result') ? {} : { schemaVersion: 'stratex.registry-lock/v1', resolutionId: 'mixed', capabilities: [{ assetId: 'skill-id', assetType: 'skill', version: '1.0.0', artifact: { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }, dependency] } }) }
  const { ctx, action } = await setup(t, backend)
  const calls = []
  ctx.provide('sealHarnessConnectors', { call: async (action, payload) => { calls.push({ action, payload }); return { items: [] } } })
  const result = await action('install', { id: 'skill-id', version: '1.0.0', enable: true })
  assert.equal(result.reported, true)
  assert.deepEqual(calls, [{ action: 'installResolved', payload: { items: [dependency] } }])
  assert.equal((await ctx.skills.get('mixed-skill')).name, 'mixed-skill')
})


test('workspace standard roots merge duplicate locations, select native default and retain old resource snapshots', async t => {
  const { action, ctx, root } = await setup(t)
  const workspace = join(await realpath(root), 'project')
  const locations = ['.claude/skills/demo', '.codex/skills/demo']
  for (const path of locations) {
    await mkdir(join(workspace, path, 'references'), { recursive: true })
    await writeFile(join(workspace, path, 'SKILL.md'), instruction('project-skill'))
    await writeFile(join(workspace, path, 'references', 'guide.md'), 'Original reference')
  }
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'project', path: workspace, title: 'Project' }] })
  const roots = (await action('sources')).sources.filter(item => item.projectRoot === workspace && item.status === 'ready')
  assert.equal(roots.length, 2)
  const discovery = await action('discover', { projectRoot: workspace })
  assert.equal(discovery.skills.length, 1)
  const [group] = discovery.skills
  assert.equal(group.locations.length, 2)
  assert.equal(group.key, 'demo')
  const automatic = await ctx.skills.get('project-skill', { cwd: workspace })
  assert(automatic, 'project standard root is available without manual import')
  assert.equal(await ctx.skills.get('project-skill', { cwd: root }), undefined)
  const location = group.locations[1]
  await action('setDefaultCopy', { contentHash: group.contentHash, sourceId: location.sourceId, key: location.key })
  const chosen = (await ctx.skills.list({ cwd: workspace })).find(item => item.name === 'project-skill')
  assert.equal(chosen.path, join(location.path, 'SKILL.md'))
  const first = await ctx.skills.get('project-skill', { cwd: workspace })
  assert.match(first.resourceBase.path, /snapshots/)
  await writeFile(join(location.path, 'references', 'guide.md'), 'Updated reference')
  const second = await ctx.skills.get('project-skill', { cwd: workspace })
  assert.notEqual(first.resourceBase.path, second.resourceBase.path)
  await rm(location.path, { recursive: true })
  assert.equal(await readFile(join(first.resourceBase.path, 'references', 'guide.md'), 'utf8'), 'Original reference')
  assert.equal(await readFile(join(second.resourceBase.path, 'references', 'guide.md'), 'utf8'), 'Updated reference')
})


test('project Pi uses .pi/skills and flat Markdown retains native shared resource base without copying the collection', async t => {
  const { action, ctx, root, home } = await setup(t)
  const workspace = join(await realpath(root), 'flat-project')
  const source = join(workspace, '.pi', 'skills')
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'flat.md'), instruction('flat-skill'))
  await writeFile(join(source, 'unrelated.md'), instruction('unrelated-skill'))
  await writeFile(join(source, 'references', 'guide.md'), 'Shared reference')
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'flat', path: workspace, title: 'Flat' }] })
  assert((await action('sources')).sources.some(item => item.path === source && item.status === 'ready'))
  const skill = await ctx.skills.get('flat-skill', { cwd: workspace })
  assert.equal(skill.path, join(source, 'flat.md'))
  assert.equal(skill.resourceBase.path, source)
  assert.equal(await readFile(join(skill.resourceBase.path, 'references', 'guide.md'), 'utf8'), 'Shared reference')
  await assert.rejects(readdir(join(home, 'seal-harness-cache', 'skills', 'snapshots')), { code: 'ENOENT' })
})
