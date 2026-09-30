import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { createModule } from '../src/module.js'
import { decodeZip, draftFiles, encodeZip, portablePackage, readDirectory, validatePackage } from '../src/package.js'
import { changeVisibility, downloadExpert, uploadExpert } from '../src/remote.js'
import * as Runtime from '../src/runtime.js'
import { openProductDatabase } from '../../local-data/src/index.js'

const manifest = (overrides = {}) => ({ schemaVersion: 'stratex.expert/v1', name: 'writer', version: '0.1.0', entryAgent: 'writer', agents: ['agents/writer.md'], displayName: { zh: '写作专家', en: '' }, profession: { zh: '编辑', en: '' }, description: { zh: '帮助整理文稿', en: '' }, personaInstructions: '按证据写作，保留 {{literal}} 原文。', model: 'test-model', ...overrides })
const packageOf = overrides => validatePackage(draftFiles(manifest(overrides)))
async function temporary(t) { const home = await mkdtemp(join(tmpdir(), 'seal-harness-experts-')); t.after(() => rm(home, { recursive: true, force: true })); return home }
const offline = { account: async () => { throw new Error('not signed in') } }
async function databaseContext(t, base = {}) {
  const dbHome = await mkdtemp(join(tmpdir(), 'seal-harness-experts-db-'))
  const storage = openProductDatabase(dbHome), id = 'local-expert-user', now = new Date().toISOString()
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'expert-user', 'Expert User', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  t.after(async () => { storage.close(); await rm(dbHome, { recursive: true, force: true }) })
  const identity = { getSession: () => ({ accountId: id, subject: id, epoch: 1, accessToken: 'local-test-token' }), subscribe: () => () => {} }
  return { get: name => name === 'sealHarnessDatabase' ? storage : name === 'sealHarnessIdentity' ? identity : base.get?.(name), sealHarnessDatabase: storage, sealHarnessIdentity: identity }
}

test('Stratex manifest and agent documents round-trip without changing content or credentials', () => {
  const pkg = packageOf({ toolPolicy: { mcpServers: { private: { command: 'local', env: { TOKEN: 'local-secret' } } } }, capabilities: [{ kind: 'skill', sourceId: 'local-asset' }] })
  const restored = validatePackage(decodeZip(encodeZip(pkg.files)))
  assert.equal(restored.digest, pkg.digest)
  const portable = portablePackage(restored)
  assert.equal(portable.manifest.toolPolicy, undefined)
  assert.equal(portable.manifest.capabilities, undefined)
  assert.ok(![...portable.files.values()].some(bytes => bytes.includes('local-secret')))
  assert.equal(validatePackage(decodeZip(encodeZip(portable.files))).manifest.personaInstructions, pkg.manifest.personaInstructions)
  assert.throws(() => packageOf({ agentTeam: true }), /Unrecognized/)
  assert.throws(() => packageOf({ entryAgent: 'missing', agents: ['agents/missing.md', 'agents/other.md'] }), /一个入口/)
})

test('ZIP rejects traversal, symlink, case collisions and expanded-size bombs before extraction', () => {
  for (const path of ['../escape', '/absolute', 'C:/absolute', 'a\\b', 'aux.txt', 'a/../b']) {
    const zip = new AdmZip(); zip.addFile('entry', Buffer.from('x')); zip.getEntry('entry').entryName = path
    assert.throws(() => decodeZip(zip.toBuffer()), /不安全/)
  }
  const symlinkZip = new AdmZip(); symlinkZip.addFile('link', Buffer.from('/etc/passwd')); symlinkZip.getEntry('link').attr = (0o120777 << 16) >>> 0
  assert.throws(() => decodeZip(symlinkZip.toBuffer()), /符号链接/)
  const conflict = new AdmZip(); conflict.addFile('A.md', Buffer.from('x')); conflict.addFile('a.md', Buffer.from('y'))
  assert.throws(() => decodeZip(conflict.toBuffer()), /重复路径/)
  const bomb = new AdmZip(); bomb.addFile('huge', Buffer.from('x')); const bytes = bomb.toBuffer()
  bytes.writeUInt32LE(101 * 1024 * 1024, bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24)
  assert.throws(() => decodeZip(bytes), /100 MiB/)
})

test('directory imports reject symlinks', async t => {
  const home = await temporary(t)
  await mkdir(join(home, 'source'))
  await symlink(join(home, 'source'), join(home, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readDirectory(home), /符号链接/)
})

test('local lifecycle keeps immutable versions, rejects stale edits and exports portable ZIP', async t => {
  const home = await temporary(t), ctx = await databaseContext(t), module = await createModule(ctx, { home, backend: offline })
  t.after(() => module.dispose())
  const created = await module.handlers.import({ contentBase64: encodeZip(draftFiles(manifest())).toString('base64') })
  assert.equal(created.version, '0.1.0')
  assert.equal((await module.handlers.list()).items[0].enabled, false)
  await assert.rejects(module.handlers.update({ name: 'writer', expectedDigest: '0'.repeat(64), manifest: manifest({ version: '0.2.0' }) }), /已修改/)
  await module.handlers.update({ name: 'writer', expectedDigest: created.digest, manifest: manifest({ version: '0.2.0', personaInstructions: 'New instructions' }) })
  const detail = await module.handlers.detail({ name: 'writer' })
  assert.deepEqual(detail.versions.map(item => item.version), ['0.1.0', '0.2.0'])
  assert.equal((await module.handlers.detail({ name: 'writer', version: '0.1.0' })).manifest.personaInstructions, manifest().personaInstructions)
  const exported = await module.handlers.export({ name: 'writer' })
  assert.equal(validatePackage(decodeZip(Buffer.from(exported.contentBase64, 'base64'))).manifest.version, '0.2.0')
  await assert.rejects(module.handlers.create({ manifest: manifest({ personaInstructions: 'Conflicting content' }) }), /同一版本/)
  await module.handlers.remove({ name: 'writer', expectedDigest: detail.digest })
  assert.equal((await module.handlers.list()).items.length, 0)
})

test('expert search policy does not introduce an activation gate', async t => {
  const home = await temporary(t), ctx = await databaseContext(t), module = await createModule(ctx, { home, backend: offline })
  t.after(() => module.dispose())
  const result = await module.handlers.create({ manifest: manifest({ toolPolicy: { webSearch: 'live' } }) })
  await assert.rejects(module.handlers.activate({ name: result.name, expectedDigest: result.digest }), /Agent preset 或模型服务/)
  assert.equal((await module.handlers.list()).items[0].enabled, false)
})

test('expert versions persist in SQLite and reload without the materialized directory', async t => {
  const home = await temporary(t), ctx = await databaseContext(t)
  let module = await createModule(ctx, { home, backend: offline })
  const created = await module.handlers.create({ manifest: manifest() })
  const rows = ctx.sealHarnessDatabase.db.prepare('SELECT package_blob FROM experts WHERE user_id = ?').all('local-expert-user')
  assert.equal(rows.length, 1)
  assert.equal(validatePackage(decodeZip(rows[0].package_blob)).digest, created.digest)
  await module.dispose()
  await rm(join(home, 'seal-harness-capabilities', 'experts'), { recursive: true, force: true })
  module = await createModule(ctx, { home, backend: offline })
  t.after(() => module.dispose())
  assert.equal((await module.handlers.detail({ name: 'writer' })).digest, created.digest)
})

test('real scoped runtime preserves literal persona and inherited native tools, then disposes', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { personaPrefix: 'Global identity' })
  await ctx.plugin(ToolRuntime)
  ctx.tools.register({ name: 'dangerous', description: 'test', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'done' })
  const key = {}, scope = createScope(ctx, key)
  await scope.ctx.plugin(Runtime, { persona: manifest().personaInstructions, model: 'test-model', provider: 'test-provider' })
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  assert.ok(renderPrompt(assembly).includes(manifest().personaInstructions))
  assert.equal(assembly.variables.model, 'test-model')
  assert.equal(ctx.tools.schemas(key).some(tool => tool.name === 'dangerous'), true)
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'dangerous'), true)
  await scope.dispose()
  assert.ok(!renderPrompt(await ctx.systemPrompt.assemble()).includes(manifest().personaInstructions))
})

test('official preset registry really loads experts and retains old session generations across updates', async t => {
  const home = await temporary(t), ctx = new Context()
  ctx.baseUrl = new URL('../package.json', import.meta.url).href
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentPresets, { default: 'standard' })
  const host = await databaseContext(t, { get: name => name === 'llm' ? { resolveModelInfo: async (_provider, model) => ({ id: model }) } : ctx.get(name) })
  let module = await createModule(host, { home, backend: offline })
  t.after(() => module.dispose())
  const created = await module.handlers.create({ manifest: manifest() })
  const active = await module.handlers.activate({ name: 'writer', expectedDigest: created.digest, provider: 'test-provider' })
  assert.equal((await ctx.agentPresets.resolve(active.presetId)).broken, undefined)
  const oldLease = await ctx.agentPresets.acquireScope(active.presetId)
  t.after(() => oldLease[Symbol.asyncDispose]())
  const oldKey = oldLease.key
  assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: oldKey })).includes(manifest().personaInstructions))
  const updated = await module.handlers.update({ name: 'writer', expectedDigest: created.digest, manifest: manifest({ version: '0.2.0', personaInstructions: 'Updated expert' }) })
  await module.handlers.activate({ name: 'writer', version: '0.2.0', expectedDigest: updated.digest, provider: 'test-provider' })
  const newLease = await ctx.agentPresets.acquireScope(active.presetId)
  t.after(() => newLease[Symbol.asyncDispose]())
  const newKey = newLease.key
  assert.notEqual(newKey, oldKey)
  assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: newKey })).includes('Updated expert'))
  assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: oldKey })).includes(manifest().personaInstructions))
  await module.dispose()
  assert.equal((await ctx.agentPresets.list()).length, 0)
  module = await createModule(host, { home, backend: offline })
  assert.equal((await module.handlers.list()).items[0].enabled, true)
  assert.equal((await ctx.agentPresets.resolve(active.presetId)).broken, undefined)
  const restored = await ctx.agentPresets.acquireScope(active.presetId)
  try { assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: restored.key })).includes('Updated expert')) }
  finally { await restored[Symbol.asyncDispose]() }
  await module.handlers.deactivate({ name: 'writer', expectedDigest: updated.digest })
  assert.equal((await ctx.agentPresets.list()).length, 0)
})

test('remote expert requests stop after account logout or an identity epoch change', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let session = { accountId: 'a', epoch: 1 }
  ctx.provide('sealHarnessIdentity', { getSession: async () => session })
  await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime)
  const key = {}, scope = createScope(ctx, key)
  await scope.ctx.plugin(Runtime, { persona: 'Private expert', model: 'test-model', provider: 'test-provider', accountId: 'a' })
  await ctx.systemPrompt.assemble({ scope: key })
  const request = next => ctx.waterfall(scopeTarget(ctx, key), 'agent/request', {}, next)
  assert.equal((await request(async () => ({}))).model, 'test-model')
  await assert.rejects(request(async () => { session = { accountId: 'a', epoch: 2 }; return {} }), /账号已变化/)
  session = null
  await assert.rejects(request(async () => ({})), /账号已退出或变化/)
  session = { accountId: 'b', epoch: 3 }
  await assert.rejects(request(async () => ({})), /账号已退出或变化/)
  await scope.dispose()
})

test('remote install verifies release identity and SHA-256 before accepting Stratex package', async () => {
  const pkg = packageOf(), files = new Map(pkg.files)
  files.set('config/agent-assets-bundle.json', Buffer.from(JSON.stringify({ schemaVersion: 1, app: 'agent-earth-platform', kind: 'agent-asset-bundle', clientRelease: { kind: 'asset', assetId: 'asset-1', assetVersionId: 'release-1' }, versions: { 'asset-1': [{ id: 'release-1' }] } })))
  const bytes = encodeZip(files), digest = createHash('sha256').update(bytes).digest('hex')
  const headers = new Headers({ 'x-agent-bundle-sha256': digest, 'x-agent-release-id': 'release-1', etag: `"sha256-${digest}"` })
  const backend = { account: async () => ({ accountId: 'a', epoch: 1 }), assertAccount: async () => {}, request: async () => ({ data: { id: 'asset-1', versions: [{ id: 'release-1', assetId: 'asset-1', version: '0.1.0', status: 'published', packageReady: true }] } }), download: async path => { assert.equal(path, 'experts/asset-1/versions/release-1/export-bundle'); return { bytes, headers } } }
  assert.equal((await downloadExpert(backend, { id: 'asset-1', version: '0.1.0' })).pkg.manifest.name, 'writer')
  headers.set('x-agent-bundle-sha256', '0'.repeat(64))
  await assert.rejects(downloadExpert(backend, { id: 'asset-1', version: '0.1.0' }), /完整性/)
})

test('publication retains private visibility, strips credentials and uses version ETag', async () => {
  const calls = [], version = { id: 'v1', assetId: 'a1', version: '0.1.0', status: 'draft', packageReady: true, etag: 'version-etag' }
  const backend = { account: async () => ({ accountId: 'u1', epoch: 1 }), assertAccount: async () => {}, request: async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path === 'experts') return { data: { id: 'a1', visibility: 'private' } }
    if (path.endsWith('/versions')) return { data: version, headers: new Headers({ etag: 'version-etag' }) }
    if (path.endsWith('/publish')) return { data: {} }
    return { data: { id: 'a1', visibility: 'private', versions: [{ ...version, status: 'published' }] } }
  } }
  let saved
  const result = await uploadExpert(backend, packageOf({ toolPolicy: { mcpServers: { test: { command: 'echo', env: { TOKEN: 'secret-marker' } } } } }), { creationKey: 'key', saveAsset: async (_account, id) => { saved = id } })
  assert.equal(result.visibility, 'private'); assert.equal(saved, 'a1')
  assert.equal(calls.find(call => call.path.endsWith('/publish')).headers['if-match'], 'version-etag')
  assert.equal(calls.some(call => call.path.endsWith('/visibility')), false)
  assert.ok(!JSON.stringify(calls).includes('secret-marker'))
})

test('visibility refuses stale ETag without mutation', async () => {
  const calls = []
  const backend = { account: async () => ({ accountId: 'u1', epoch: 1 }), request: async (path, options) => { calls.push(options); return { data: { id: 'a1' }, headers: new Headers({ etag: 'current' }) } } }
  await assert.rejects(changeVisibility(backend, { assetId: 'a1', scope: 'public', version: '0.1.0', expectedPublicVersion: null, expectedEtag: 'stale' }), /已被修改/)
  assert.equal(calls.length, 1)
})

test('scoped expert registers selected skills and reasoning without leaking to siblings', async t => {
  const { default: SkillRegistry } = await import('@deepseek-ai/dsh-skill')
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(SkillRegistry)
  for (const name of ['selected_tool', 'other_tool', 'knowledge_search', 'knowledge_list', 'knowledge_navigate', 'skill', 'read', 'glob', 'grep']) ctx.tools.register({ name, description: name, parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'ok' })
  const key = {}, scope = createScope(ctx, key)
  await scope.ctx.plugin(Runtime, { persona: 'Expert', provider: 'test', model: 'model', reasoningEffort: 'high', personality: 'friendly', skills: [{ name: 'expert-skill', description: 'A skill', content: 'Read the referenced document.', invocation: { modelInvocable: true, userInvocable: true }, source: 'runtime' }], toolNames: ['selected_tool'] })
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  const prompt = renderPrompt(assembly)
  assert.match(prompt, /Read the referenced document/)
  assert.doesNotMatch(prompt, /知识组/)
  assert.match(prompt, /友善/)
  assert.equal((await ctx.skills.list()).length, 0)
  assert.equal((await ctx.skills.list({ scope: key }))[0].name, 'expert-skill')
  assert.deepEqual(ctx.tools.schemas(key).map(tool => tool.name).sort(), ['glob', 'grep', 'knowledge_list', 'knowledge_navigate', 'knowledge_search', 'other_tool', 'read', 'selected_tool', 'skill'])
  const request = await ctx.waterfall(scopeTarget(ctx, key), 'agent/request', {}, async () => ({}))
  assert.equal(request.reasoningEffort, 'high')
})

test('expert keeps immutable versions and materializes complete embedded skills', async t => {
  const { materializeSkills } = await import('../src/capabilities.js')
  const home = await temporary(t), ctx = await databaseContext(t), module = await createModule(ctx, { home, backend: offline }); t.after(() => module.dispose())
  const created = await module.handlers.create({ manifest: manifest() })
  await module.handlers.update({ name: 'writer', expectedDigest: created.digest, manifest: manifest({ version: '0.2.0' }) })
  assert.equal((await module.handlers.detail({ name: 'writer', version: '0.1.0' })).manifest.version, '0.1.0')
  assert.equal((await module.handlers.detail({ name: 'writer' })).manifest.version, '0.2.0')
  const files = draftFiles(manifest({ skills: ['skills/research'] }))
  files.set('skills/research/SKILL.md', Buffer.from('---\nname: research\ndescription: Research task\n---\nRead references/facts.md.'))
  files.set('skills/research/references/facts.md', Buffer.from('Facts'))
  const [skill] = await materializeSkills(validatePackage(files), join(home, 'materialized'))
  assert.equal(await readFile(join(skill.resourceBase.path, 'references/facts.md'), 'utf8'), 'Facts')
})

 test('portable dependency roots supply complete skill and MCP runtime files', async t => {
  const { materializeSkills, materializeConnectors } = await import('../src/capabilities.js')
  const home = await temporary(t), files = draftFiles(manifest())
  files.set('config/agent-assets-bundle.json', Buffer.from(JSON.stringify({ clientRelease: { portableDependencies: [
    { kind: 'skill', sourceId: 'research', version: '1.0.0', packageRoot: 'materials/skills/research' },
    { kind: 'mcp', sourceId: 'local', version: '1.0.0', packageRoot: 'materials/mcps/local' },
  ] } })))
  files.set('materials/skills/research/SKILL.md', Buffer.from('---\nname: research\ndescription: Research\n---\nStudy evidence.'))
  files.set('materials/mcps/local/descriptor.json', Buffer.from(JSON.stringify({ transport: 'stdio', executable: 'server', args: ['--mcp'], environmentVariables: [{ name: 'MODE', value: 'test' }] })))
  files.set('materials/mcps/local/server', Buffer.from('#!/bin/sh\nexit 0\n'))
  const pkg = validatePackage(files)
  assert.equal((await materializeSkills(pkg, join(home, 'skills')))[0].name, 'research')
  const [server] = await materializeConnectors(pkg, join(home, 'connectors'))
  assert.equal(server.transport, 'stdio')
  assert.deepEqual(server.args, ['--mcp'])
  assert.equal(server.env.MODE, 'test')
  assert.match(await readFile(server.command, 'utf8'), /exit 0/)
})

test('expert conversation loads real Cordis service dependencies and creates in the selected workspace', async t => {
  const { conversationServices, createExpertConversation } = await import('../src/conversation.js')
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  const calls = [], binding = { ctx: {} }
  const presets = { select: async (...args) => { calls.push(['select', ...args]); return { ok: true } } }
  ctx.provide('remote', { agentPresets: presets }); ctx.provide('remote.agentPresets', presets)
  ctx.provide('sessions', { create: async input => { calls.push(['create', input]); return 'session-1' }, retain: () => ({ ready: Promise.resolve(binding), release: () => calls.push(['release']) }) })
  ctx.provide('uiWorkspace', { openSession: id => calls.push(['open', id]) })
  ctx.provide('workspaces', {})
  ctx.provide('conversation', { input: { for: target => { assert.equal(target, binding.ctx); return { setDraft: text => calls.push(['draft', text]) } } } })
  await ctx.plugin({ inject: conversationServices, apply: context => createExpertConversation(context, 'expert-1', 'Start here', 'workspace-2') }).await()
  assert.deepEqual(calls, [['create', { workspaceId: 'workspace-2' }], ['select', 'session-1', 'expert-1'], ['draft', 'Start here'], ['open', 'session-1'], ['release']])
})
