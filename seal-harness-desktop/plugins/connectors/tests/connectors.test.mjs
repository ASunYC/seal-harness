import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Session } from '@deepseek-ai/dsh-session'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { createModule } from '../src/module.js'
import { fromDescriptor } from '../src/schema.js'
import { capabilityOptions } from '../../experts/src/capabilities.js'
import { createArchive } from '../../skills/src/package.js'
import { MAX_CONNECTOR_PACKAGE_BYTES, MAX_CONNECTOR_PACKAGE_EXPANDED_BYTES } from '../src/package.js'

test('system MCP catalog installs per account and sends query credentials only to the transport', async t => {
  const fixture = await httpFixture(t), listeners = new Set()
  let account = { accountId: 'catalog-owner', epoch: 1 }
  const { handlers, ctx } = await host(t, {}, ctx => ctx.provide('sealHarnessIdentity', {
    getSession: () => account, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }))
  const installed = await handlers.installCatalog({ id: 'tencent-maps' })
  assert.equal(installed.catalog.length, 55)
  const entry = installed.items[0]
  assert.equal(entry.catalogId, 'tencent-maps')
  assert.equal(entry.enabled, false)
  const secret = 'example&token ?% value'
  const saved = await handlers.save({ id: entry.id, revision: entry.revision, name: entry.name, transport: entry.transport,
    url: fixture.url, enabled: true, queryValues: { key: secret } })
  assert.equal(saved.items[0].status, 'active')
  assert.equal(JSON.stringify(saved).includes(secret), false)
  assert.deepEqual(saved.items[0].queryCredentials, ['key'])
  assert.deepEqual(saved.items[0].configuredQuery, ['key'])
  assert(fixture.requestUrls.length > 0)
  const request = new URL(fixture.requestUrls[0], fixture.url)
  assert.equal(request.searchParams.get('format'), '0')
  assert.equal(request.searchParams.get('key'), secret)
  const cleared = await handlers.clearAuthorization({ id: entry.id, revision: saved.items[0].revision })
  const missing = await handlers.setEnabled({ id: entry.id, revision: cleared.items[0].revision, enabled: true })
  assert.equal(missing.items[0].status, 'unconfigured')
  account = { accountId: 'second-owner', epoch: 2 }
  for (const listener of listeners) listener()
  assert.equal((await handlers.list()).items.length, 0)
  assert.notEqual((await handlers.installCatalog({ id: 'tencent-maps' })).items[0].id, entry.id)
})

async function host(t, backend = {}, prepare) {
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-connectors-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(LocalCredentials, { dshHome: home, watch: false }).await()
  await prepare?.(ctx)
  const module = await createModule(ctx, { home, backend })
  t.after(async () => { await module.dispose(); await ctx.fiber.dispose(); ctx.sealHarnessDatabase?.close(); await rm(home, { recursive: true, force: true }) })
  return { ctx, home, module, handlers: module.handlers }
}

test('session selection isolates connector schemas and execution between agents', async t => {
  const fixture = await httpFixture(t)
  const agents = new Map()
  const { handlers, ctx } = await host(t, {}, hostCtx => hostCtx.provide('agents', { get: id => agents.get(String(id)) }))
  const saved = await handlers.save({ id: 'session-http', name: 'Session HTTP', transport: 'streamable-http', url: fixture.url, enabled: true })
  const makeAgent = id => {
    const session = Session.create(id)
    session.append('turn/start', { turn: 1 })
    const agent = { id: session.id, session }
    agent.ctx = createScope(ctx, agent).ctx
    agents.set(String(agent.id), agent)
    return agent
  }
  const first = makeAgent('connector-session-a')
  const second = makeAgent('connector-session-b')
  const tool = 'mcp__zz-session-http__ping'

  assert.deepEqual((await handlers.sessionList({ sessionId: String(first.id) })).selectedIds, [])
  assert.equal(ctx.tools.schemas(first).some(schema => schema.name === tool), false)
  const selected = await handlers.sessionSet({ sessionId: String(first.id), id: 'session-http', revision: saved.items[0].revision, selected: true })
  assert.deepEqual(selected.selectedIds, ['session-http'])
  assert.equal(ctx.tools.schemas(first).some(schema => schema.name === tool), true)

  await ctx.serial(scopeTarget(second, second), 'agent/created', { agent: second, source: 'startup' })
  assert.equal(ctx.tools.schemas(second).some(schema => schema.name === tool), false)
  const denied = await ctx.tools.execute({ name: tool, callId: 'session-denied', arguments: {}, agent: second, signal: new AbortController().signal })
  assert.equal(denied.isError, true)

  await handlers.sessionSet({ sessionId: String(first.id), id: 'session-http', revision: saved.items[0].revision, selected: false })
  assert.equal(ctx.tools.schemas(first).some(schema => schema.name === tool), false)
})

async function httpFixture(t) {
  const headers = []
  const requestUrls = []
  const environmentHeaders = []
  let toolCalls = 0
  const server = createServer(async (request, response) => {
    requestUrls.push(request.url)
    if (request.method !== 'POST') { response.writeHead(405).end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const message = JSON.parse(Buffer.concat(chunks).toString())
    headers.push(request.headers.authorization)
    environmentHeaders.push(request.headers['x-from-environment'])
    if (message.id === undefined) { response.writeHead(202).end(); return }
    let result
    if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
    else if (message.method === 'tools/list') result = { tools: [{ name: 'ping', description: 'Returns pong', inputSchema: { type: 'object', properties: {} } }] }
    else if (message.method === 'tools/call') { toolCalls++; result = { content: [{ type: 'text', text: 'pong' }] } }
    else result = {}
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, headers, requestUrls, environmentHeaders, toolCalls: () => toolCalls }
}

test('personal connector stays uninstalled and account-scoped until explicit installation', async t => {
  const fixture = await httpFixture(t)
  let session = { accountId: 'owner-a', epoch: 1 }
  const agents = new Map()
  const { handlers, module, ctx } = await host(t, {}, hostCtx => {
    hostCtx.provide('sealHarnessIdentity', { getSession: () => session, subscribe: () => () => {} })
    hostCtx.provide('agents', { get: id => agents.get(String(id)) })
  })
  const conversation = Session.create('draft-session')
  conversation.append('turn/start', { turn: 1 })
  const agent = { id: conversation.id, session: conversation }
  agent.ctx = createScope(ctx, agent).ctx
  agents.set(String(agent.id), agent)
  const created = await handlers.createDraft({ id: 'local-draft-one', name: 'Draft MCP', summary: 'Find resources', category: 'office', transport: 'streamable-http', url: fixture.url })
  const draft = created.items.find(item => item.id === 'local-draft-one')
  assert.equal(draft.installed, false)
  assert.equal(draft.status, 'uninstalled')
  assert.deepEqual((await module.hostHandlers.workflowResources()).resources, [])
  assert.deepEqual((await handlers.sessionList({ sessionId: String(agent.id) })).items, [])
  assert.equal(ctx.tools.schemas().some(tool => tool.name === 'mcp__zz-local-draft-one__ping'), false)
  await assert.rejects(handlers.setEnabled({ id: draft.id, revision: draft.revision, enabled: true }), /先安装/)
  session = { accountId: 'owner-b', epoch: 2 }
  assert.deepEqual((await handlers.list()).items, [])
  session = { accountId: 'owner-a', epoch: 3 }
  const own = (await handlers.list()).items[0]
  const installed = await handlers.installPersonal({ id: own.id, revision: own.revision })
  assert.equal(installed.items[0].installed, true)
  assert.equal(installed.items[0].enabled, false)
  await handlers.setEnabled({ id: own.id, revision: installed.items[0].revision, enabled: true })
  assert.equal((await handlers.list()).items[0].status, 'active')
})

test('HTTP draft check resolves environment headers, discovers tools and does not persist the connector', async t => {
  const fixture = await httpFixture(t)
  const { handlers } = await host(t)
  const variable = 'SEAL_HARNESS_CONNECTOR_HEADER_TEST'
  process.env[variable] = 'resolved-at-check-time'
  t.after(() => { delete process.env[variable] })

  const checked = await handlers.checkConnection({
    id: 'draft-http', name: 'Draft HTTP', transport: 'streamable-http', url: fixture.url,
    headers: {}, headerValues: { 'X-Static': 'visible-only-to-host' },
    headerEnvironment: { 'X-From-Environment': variable }, enabled: false,
  })

  assert.equal(checked.status, 'ready')
  assert.equal(checked.toolCount, 1)
  assert.deepEqual(checked.tools.map(tool => tool.name), ['ping'])
  assert(fixture.environmentHeaders.includes('resolved-at-check-time'))
  assert.equal((await handlers.list()).items.length, 0, 'draft checks must not save the connector')
  assert.ok(!JSON.stringify(checked).includes('visible-only-to-host'))
  assert.ok(!JSON.stringify(checked).includes('resolved-at-check-time'))
})

test('HTTP lifecycle uses DSH tools, keeps credentials Host-only, preserves them on edit and unregisters on disable', async t => {
  const fixture = await httpFixture(t)
  const { handlers, home, ctx, module } = await host(t)
  const saved = await handlers.save({ id: 'local-http', name: 'HTTP', transport: 'streamable-http', url: fixture.url, headers: { Authorization: 'Bearer local-secret' }, enabled: true })
  assert.equal(saved.items[0].status, 'active')
  assert.equal(saved.items[0].tools[0].name, 'ping')
  assert.deepEqual(saved.items[0].headers, ['Authorization'])
  assert(!JSON.stringify(saved).includes('local-secret'))
  assert(fixture.headers.includes('Bearer local-secret'))
  assert(ctx.tools.get('mcp__zz-local-http__ping'))

  const native = await ctx.tools.execute({ name: 'mcp__zz-local-http__ping', callId: 'native', arguments: {}, signal: new AbortController().signal })
  assert.equal(native.isError, false)
  ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'Native runtime policy' }))
  const denied = await ctx.tools.execute({ name: 'mcp__zz-local-http__ping', callId: 'approval-check', arguments: {}, signal: new AbortController().signal })
  assert.equal(denied.isError, true)
  assert.equal(fixture.toolCalls(), 1, 'native ask policy must remain effective')

  ctx.provide('approval', { request: async () => 'allowed-once' })
  const session = Session.create('connector-approval')
  session.append('turn/start', { turn: 1 })
  const allowed = await ctx.tools.execute({ name: 'mcp__zz-local-http__ping', callId: 'approved', arguments: {}, agent: { session }, signal: new AbortController().signal })
  assert.equal(allowed.isError, false)
  assert.equal(allowed.value.content[0].text, 'pong')
  assert.equal(fixture.toolCalls(), 2)

  const edited = await handlers.save({ id: 'local-http', revision: 0, name: 'Edited', transport: 'streamable-http', url: fixture.url, enabled: true })
  assert.equal(edited.items[0].revision, 1)
  assert.deepEqual(edited.items[0].headers, ['Authorization'])
  const persisted = await readFile(join(home, '.credentials.yaml'), 'utf8')
  assert(persisted.includes('local-secret'))
  await assert.rejects(handlers.setEnabled({ id: 'local-http', revision: 0, enabled: false }), /已被修改/)

  const disabled = await handlers.setEnabled({ id: 'local-http', revision: 1, enabled: false })
  assert.equal(disabled.items[0].status, 'disabled')
  assert.equal(ctx.tools.get('mcp__zz-local-http__ping'), undefined)
  await handlers.setEnabled({ id: 'local-http', revision: 2, enabled: true })
  assert(ctx.tools.get('mcp__zz-local-http__ping'))
  await handlers.save({ id: 'local-http', revision: 3, name: 'Restricted', transport: 'streamable-http', url: fixture.url, enabled: true, enabledTools: [] })
  const restricted = await ctx.tools.execute({ name: 'mcp__zz-local-http__ping', callId: 'blocked-tool', arguments: {}, agent: { session }, signal: new AbortController().signal })
  assert.equal(restricted.isError, true)
  assert.equal(fixture.toolCalls(), 2, 'approved calls still obey the allowlist')
  await module.dispose()
  assert.equal(ctx.tools.get('mcp__zz-local-http__ping'), undefined)
  await assert.rejects(handlers.list(), /已卸载/)
})

test('stdio runs direct arguments, restores durable configuration, and removes credentials', async t => {
  const { handlers, home, ctx, module } = await host(t)
  const fixture = join(home, 'mcp.mjs')
  await writeFile(fixture, `import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line', line => {
const message = JSON.parse(line); if(message.id === undefined) return;
let result = {};
if(message.method === 'initialize') result = {protocolVersion:message.params.protocolVersion, capabilities:{tools:{}},serverInfo:{name:'stdio-fixture',version:'1'}};
if(message.method === 'tools/list') result = {tools:[{name:'stdio_ping',description:'stdio ready',inputSchema:{type:'object',properties:{}}}]};
if(message.method === 'tools/call') result = {content:[{type:'text',text:process.env.CONNECTOR_TEST_SECRET}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
});`)
  const saved = await handlers.save({ id: 'local-stdio', name: 'Local', transport: 'stdio', command: await realpath(process.execPath), args: [fixture, '$(touch SHOULD_NOT_EXIST)'], env: { CONNECTOR_TEST_SECRET: 'private-env' }, enabled: true })
  assert.equal(saved.items[0].status, 'active')
  assert.equal(saved.items[0].tools[0].name, 'stdio_ping')
  assert(!JSON.stringify(saved).includes('private-env'))
  await module.dispose()
  const reloaded = await createModule(ctx, { home, backend: {} })
  t.after(() => reloaded.dispose())
  assert(ctx.tools.get('mcp__zz-local-stdio__stdio_ping'))
  assert.equal((await reloaded.handlers.remove({ id: 'local-stdio', revision: 0 })).items.length, 0)
  assert.equal(ctx.tools.get('mcp__zz-local-stdio__stdio_ping'), undefined)
  assert(!(await readFile(join(home, '.credentials.yaml'), 'utf8')).includes('private-env'))
})

test('local stdio package is previewed, verified and installed from a one-time token', async t => {
  assert.equal(MAX_CONNECTOR_PACKAGE_BYTES, 200 * 1024 * 1024)
  assert.equal(MAX_CONNECTOR_PACKAGE_EXPANDED_BYTES, 1024 * 1024 * 1024)
  const { handlers, home } = await host(t)
  const runtime = Buffer.from('portable runtime')
  const server = Buffer.from('portable server')
  const alternate = Buffer.from('alternate runtime')
  const payload = Buffer.alloc(65 * 1024 * 1024, 0x61)
  const descriptor = {
    schemaVersion: 'stratex.capability/v1',
    name: 'Portable MCP',
    version: '1.2.3',
    description: 'Dropped connector package',
    transport: 'stdio',
    executable: 'runtime.exe',
    args: ['server.mjs'],
    environmentVariables: [{ name: 'PACKAGE_MODE', value: 'bundled' }],
    environmentPassthrough: ['PATH'],
    environmentSlots: [{ name: 'ACCESS_TOKEN', required: true }],
    files: [
      { path: 'runtime.exe', sizeBytes: runtime.length, sha256: createHash('sha256').update(runtime).digest('hex') },
      { path: 'server.mjs', sizeBytes: server.length, sha256: createHash('sha256').update(server).digest('hex') },
      { path: 'alternate.exe', sizeBytes: alternate.length, sha256: createHash('sha256').update(alternate).digest('hex') },
      { path: 'payload.bin', sizeBytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') },
    ],
  }
  const zip = createArchive([
    { path: 'descriptor.json', bytes: Buffer.from(JSON.stringify(descriptor)), mode: 0o644 },
    { path: 'runtime.exe', bytes: runtime, mode: 0o755 },
    { path: 'server.mjs', bytes: server, mode: 0o644 },
    { path: 'alternate.exe', bytes: alternate, mode: 0o755 },
    { path: 'payload.bin', bytes: payload, mode: 0o644 },
  ])
  const preview = await handlers.inspectPackage({ fileName: 'portable-mcp.zip', zipBase64: zip.toString('base64') })
  assert.equal(preview.name, 'Portable MCP')
  assert.equal(preview.version, '1.2.3')
  assert.equal(preview.fileCount, 5)
  assert.ok(preview.byteSize > 64 * 1024 * 1024)
  assert.deepEqual(preview.requiredEnv, ['ACCESS_TOKEN'])
  assert.equal(preview.executable, 'runtime.exe')
  assert.deepEqual(preview.environmentVariables, [{ name: 'PACKAGE_MODE', value: 'bundled' }])
  assert.deepEqual(preview.environmentPassthrough, ['PATH'])

  const installed = await handlers.importPackage({ token: preview.token, name: 'Portable MCP', summary: 'Local package', category: 'development', command: 'alternate.exe', args: ['server.mjs', '--stdio'], envValues: { ACCESS_TOKEN: 'private', PACKAGE_MODE: 'custom' }, environmentPassthrough: ['PATH'], enabled: false })
  const item = installed.items[0]
  assert.equal(item.transport, 'stdio')
  assert.equal(item.summary, 'Local package')
  assert.equal(item.category, 'development')
  assert.match(item.command, /alternate\.exe$/)
  assert.deepEqual(item.args, ['server.mjs', '--stdio'])
  assert.deepEqual(item.environmentPassthrough, ['PATH'])
  assert.equal((await readFile(item.command)).toString(), alternate.toString())
  assert.equal(item.env.includes('ACCESS_TOKEN'), true)
  assert.equal(item.env.includes('PACKAGE_MODE'), true)
  assert.equal(JSON.stringify(installed).includes('private'), false)
  assert.ok(item.command.startsWith(home))
  const edited = await handlers.save({ id: item.id, revision: item.revision, name: 'Portable renamed', transport: 'stdio', command: item.command, args: item.args, cwd: item.cwd, enabled: false })
  assert.deepEqual(edited.items[0].environmentPassthrough, ['PATH'], 'older edits preserve package passthrough variables')
  await assert.rejects(handlers.importPackage({ token: preview.token, name: 'Again', category: 'office', command: 'runtime.exe', args: [], environmentPassthrough: [], enabled: false }), /预览已失效/)
})

test('local package preview rejects non-stdio packages and missing executables', async t => {
  const { handlers } = await host(t)
  const archive = descriptor => createArchive([{ path: 'descriptor.json', bytes: Buffer.from(JSON.stringify(descriptor)), mode: 0o644 }]).toString('base64')
  await assert.rejects(handlers.inspectPackage({ fileName: 'remote.zip', zipBase64: archive({ schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: 'https://example.com/mcp' }) }), /STDIO/)
  await assert.rejects(handlers.inspectPackage({ fileName: 'missing.zip', zipBase64: archive({ schemaVersion: 'stratex.capability/v1', transport: 'stdio', executable: 'missing.exe' }) }), /启动文件/)
})

test('boundaries reject bad transports, paths, embedded URL secrets, stale edits and unsupported remote descriptors', async t => {
  const { handlers } = await host(t)
  const base = { id: 'valid-id', name: 'Name', transport: 'streamable-http', url: 'https://example.com/mcp' }
  await assert.rejects(handlers.save({ ...base, id: '../escape' }), /参数无效/)
  await assert.rejects(handlers.save({ ...base, url: 'https://secret@example.com/mcp' }), /不得内嵌凭据/)
  await assert.rejects(handlers.save({ ...base, url: 'https://example.com/mcp?token=secret' }), /不得内嵌凭据/)
  await assert.rejects(handlers.save({ ...base, transport: 'invalid' }), /参数无效/)
  await assert.rejects(handlers.save({ ...base, transport: 'stdio', command: 'node', url: '' }), /绝对路径/)
  await assert.rejects(handlers.save({ ...base, headers: { Authorization: 'injected\r\nheader' } }), /参数无效/)
  await assert.rejects(handlers.remove({ id: 'missing', revision: 0 }), /已被修改/)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(handlers.save(base, aborted.signal), { name: 'AbortError' })
  assert.equal((await handlers.list()).items.length, 0)
  const remote = { id: 'f22b3e07-1ec0-4c0f-9537-cc3bd9c3c202', name: 'Remote', version: '1', accountId: 'account', descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: base.url } }
  assert.equal(fromDescriptor(remote).enabled, false)
  for (const [field, value] of [['transport', 'stdio'], ['authMode', 'token_exchange'], ['workspaceBootstrap', {}], ['authExperience', 'shared']]) {
    assert.throws(() => fromDescriptor({ ...remote, descriptor: { ...remote.descriptor, [field]: value } }))
  }
})

test('failed handshake remains an error and recovers by editing without stale tool registrations', async t => {
  const fixture = await httpFixture(t)
  const { handlers, ctx } = await host(t)
  const failed = await handlers.save({ id: 'recoverable', name: 'Retry', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', enabled: true })
  assert.equal(failed.items[0].status, 'error')
  assert.equal(failed.items[0].tools.length, 0)
  const fixed = await handlers.save({ id: 'recoverable', revision: 0, name: 'Retry', transport: 'streamable-http', url: fixture.url, enabled: true })
  assert.equal(fixed.items[0].status, 'active')
  assert(ctx.tools.get('mcp__zz-recoverable__ping'))
})

test('remote install keeps backend protocol, requires credentials, binds account and unloads on identity change', async t => {
  const fixture = await httpFixture(t)
  const id = 'f22b3e07-1ec0-4c0f-9537-cc3bd9c3c202'
  const requests = []
  const backend = {
    async detail(collection, assetId) { requests.push([collection, assetId]); return { id, assetType: 'mcp', name: 'Remote', latestVersion: { assetId: id, version: '1', status: 'published', descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: fixture.url, authMode: 'api_key', headerSlots: [{ headerName: 'Authorization', credentialSlot: 'token', required: true }] } } } },
  }
  const { ctx, home, module } = await host(t, backend)
  await module.dispose()
  let session = { accountId: 'first', epoch: 1, accessToken: 'never-forward-to-mcp' }
  const listeners = new Set()
  ctx.provide('sealHarnessIdentity')
  ctx.set('sealHarnessIdentity', { getSession: async () => session, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } })
  const active = await createModule(ctx, { home, backend })
  t.after(() => active.dispose())
  const installed = await active.handlers.install({ id })
  assert.deepEqual(requests, [['mcps', id]])
  const item = installed.items[0]
  assert.equal(item.enabled, false)
  assert.equal((await active.handlers.setEnabled({ id: item.id, revision: 0, enabled: true })).items[0].status, 'unconfigured')
  const configured = await active.handlers.save({ id: item.id, revision: 1, name: item.name, transport: item.transport, url: item.url, requiredHeaders: item.requiredHeaders, headers: { Authorization: 'Bearer connector-only' }, enabled: true })
  assert.equal(configured.items[0].status, 'active')
  assert(!fixture.headers.includes('Bearer never-forward-to-mcp'))
  session = { accountId: 'second', epoch: 2, accessToken: 'other' }
  for (const listener of listeners) listener()
  assert.equal((await active.handlers.list()).items.length, 0)
  assert.equal(ctx.tools.get(`mcp__zz-${item.id}__ping`), undefined)
  await assert.rejects(active.handlers.remove({ id: item.id, revision: 2 }), /无法修改/)
})

test('MCP Center install re-reads trusted endpoint and exports selected credentials through Host only', async t => {
  const fixture = await httpFixture(t)
  const center = new URL(fixture.url.replace('/mcp', '/'))
  const { handlers, ctx, module } = await host(t, { center, listCenter: async () => ({ data: [{ connectorId: 'demo', name: 'Center Demo', version: '1.0.0', mcpEndpoint: new URL('mcp/apps/demo', center).href, clientAuthMode: 'none' }] }) })
  ctx.provide('sealHarnessIdentity', { getSession: async () => ({ accountId: 'alice', epoch: 1 }), subscribe: () => () => {} })
  const installed = await handlers.installCenter({ connectorId: 'demo' })
  const item = installed.items[0]
  assert.equal(item.source.centerId, 'demo')
  assert.equal(item.enabled, false)
  await handlers.save({ id: item.id, revision: item.revision, name: item.name, transport: item.transport, url: item.url, headers: { 'X-Static': 'static' }, headerValues: { Authorization: 'Bearer private' } })
  const { resources: [selection] } = await module.hostHandlers.workflowResources()
  assert.equal(handlers.workflowExport, undefined)
  const exported = await module.hostHandlers.workflowExport(selection)
  assert.equal(exported.credentials[0].values.Authorization, 'Bearer private')
  assert.equal(exported.credentials[0].values['X-Static'], 'static')
  assert.equal(exported.capabilities[0].descriptor.transport, 'http')
  assert(!JSON.stringify(await handlers.list()).includes('Bearer private'))
  await handlers.clearAuthorization({ id: item.id, revision: 1 })
  await assert.rejects(module.hostHandlers.workflowExport(selection), /已更新/)
})

test('OAuth uses the installed MCP SDK for discovery, PKCE callback and token storage', async t => {
  const { createOAuth } = await import('../src/oauth.js')
  let base, registration, tokenRequest
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/.well-known/oauth-protected-resource')) return response.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['tools'] }))
    if (request.url.startsWith('/.well-known/')) return response.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }))
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    if (request.url === '/register') { registration = JSON.parse(body); return response.end(JSON.stringify({ ...registration, client_id: 'test-client' })) }
    if (request.url === '/token') { tokenRequest = new URLSearchParams(body); return response.end(JSON.stringify({ access_token: 'private-oauth-token', refresh_token: 'private-refresh', token_type: 'Bearer', expires_in: 3600 })) }
    response.writeHead(404).end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`
  const oauth = createOAuth(); t.after(() => { oauth.dispose(); server.closeAllConnections(); server.close() })
  let saved
  const result = await oauth.begin({ id: 'demo', url: `${base}/mcp`, oauth: { scopes: ['tools'] } }, state => { saved = state }, error => { throw error })
  const authorize = new URL(result.url)
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(registration.client_name, 'Seal Harness MCP Connector')
  const callback = new URL(authorize.searchParams.get('redirect_uri'))
  callback.search = new URLSearchParams({ code: 'test-code', state: 'wrong' }).toString()
  assert.equal((await fetch(callback)).status, 400)
  callback.searchParams.set('state', authorize.searchParams.get('state'))
  assert.equal((await fetch(callback)).status, 200)
  assert.equal(saved.tokens.access_token, 'private-oauth-token')
  assert.equal(saved.verifier, undefined)
  assert.equal(tokenRequest.get('grant_type'), 'authorization_code')
  assert.ok(tokenRequest.get('code_verifier'))
})

test('legacy SSE uses standard MCP tool definitions and disposes its stream', async t => {
  let stream
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      stream = response
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('event: endpoint\ndata: /messages\n\n')
      return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const message = JSON.parse(Buffer.concat(chunks).toString())
    response.writeHead(202).end()
    if (message.id === undefined) return
    const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } } : message.method === 'tools/list' ? { tools: [{ name: 'hello', description: 'Hello', inputSchema: { type: 'object', properties: {} } }] } : { content: [{ type: 'text', text: 'SSE reply' }] }
    stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const { handlers, ctx } = await host(t)
  const checked = await handlers.checkConnection({ id: 'draft-sse', name: 'Draft SSE', transport: 'sse', url: `http://127.0.0.1:${server.address().port}/sse`, enabled: false })
  assert.equal(checked.status, 'ready')
  assert.deepEqual(checked.tools.map(tool => tool.name), ['hello'])
  assert.equal((await handlers.list()).items.length, 0)
  const saved = await handlers.save({ id: 'legacy-sse', name: 'SSE', transport: 'sse', url: `http://127.0.0.1:${server.address().port}/sse`, enabled: true })
  assert.equal(saved.items[0].status, 'active')
  const result = await ctx.tools.execute({ name: 'mcp__zz-legacy-sse__hello', callId: 'sse', arguments: {}, signal: new AbortController().signal })
  assert.equal(result.value.content[0].text, 'SSE reply')
  await handlers.setEnabled({ id: 'legacy-sse', revision: 0, enabled: false })
  assert.equal(ctx.tools.get('mcp__zz-legacy-sse__hello'), undefined)
})

test('portable HTTP adapter maps credentials and request fields through native DSH tools', async t => {
  let observed
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    observed = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { accepted: true } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const { module, handlers, ctx } = await host(t)
  const adapter = { schemaVersion: 'stratex.http-adapter/v1', sourceType: 'http_adapter', name: 'Adapter', tools: [{ name: 'submit', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] }, request: { method: 'POST', baseUrl: `http://127.0.0.1:${server.address().port}`, path: '/items/{id}', auth: { type: 'bearer', credentialSlot: 'token' }, parameters: { id: { location: 'path' } } }, response: { format: 'json', dataPath: 'result' } }] }
  const bytes = Buffer.from(JSON.stringify(adapter))
  const item = await module.hostHandlers.ensurePackage({ sourceId: 'adapter', version: '1.0.0', descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', files: [{ path: 'stratex-http-adapter.json', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }], credentialSlots: [{ name: 'token', required: true }] }, files: [{ path: 'stratex-http-adapter.json', bytes }] })
  assert.equal(item.status, 'unconfigured')
  const saved = await handlers.save({ id: item.id, revision: item.revision, name: item.name, transport: item.transport, url: item.url, enabled: true, credentialValues: { token: 'adapter-secret' } })
  assert.equal(saved.items[0].status, 'active')
  assert.ok(!JSON.stringify(saved).includes('adapter-secret'))
  const result = await ctx.tools.execute({ name: `mcp__zz-${item.id}__submit`, callId: 'adapter', arguments: { id: 'a b', text: 'content' }, signal: new AbortController().signal })
  assert.equal(result.isError, false)
  assert.deepEqual(JSON.parse(result.value.content[0].text), { accepted: true })
  assert.deepEqual(observed, { path: '/items/a%20b', authorization: 'Bearer adapter-secret', body: { text: 'content' } })
})

test('fixed endpoint token exchange stores the resulting access token without exposing it', async t => {
  const fixture = await httpFixture(t)
  let posted
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    posted = new URLSearchParams(Buffer.concat(chunks).toString())
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'exchanged-secret' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const { module, handlers } = await host(t)
  const item = await module.hostHandlers.ensurePackage({ sourceId: 'exchange', version: '1.0.0', descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: fixture.url, authMode: 'token_exchange', tokenExchange: { tokenEndpoint: `http://127.0.0.1:${server.address().port}/token`, audience: 'mcp' } }, files: [] })
  const result = await handlers.exchangeToken({ id: item.id, revision: item.revision, subjectToken: 'subject-secret' })
  assert.equal(result.items[0].status, 'active')
  assert.equal(posted.get('subject_token'), 'subject-secret')
  assert.ok(!JSON.stringify(result).includes('exchanged-secret'))
  assert.ok(fixture.headers.includes('Bearer exchanged-secret'))
})

test('portable stdio package initializes a selected workspace once and retains existing instructions', {
  skip: process.platform === 'win32' ? 'fixture uses a POSIX shell executable' : false,
}, async t => {
  const { module, handlers, home } = await host(t)
  const workspace = join(home, 'workspace')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(workspace)
  await writeFile(join(workspace, 'AGENTS.md'), '# My workspace\n')
  const nodeWrapper = process.platform === 'win32' ? 'node-wrapper.exe' : 'node-wrapper'
  const entry = await module.hostHandlers.ensurePackage({ sourceId: 'workspace-package', version: '1.0.0', descriptor: {
    schemaVersion: 'stratex.capability/v1', transport: 'stdio', executable: nodeWrapper, args: ['server.mjs'],
    workspaceBootstrap: { executable: nodeWrapper, entrypoint: 'init.mjs', args: [], completionMarker: 'initialized', timeoutMs: 5000, instructions: { blockId: 'example', content: 'Use the configured connector.' } },
  }, files: [
    { path: nodeWrapper, bytes: Buffer.from(`#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`) },
    { path: 'init.mjs', bytes: Buffer.from("import {writeFileSync} from 'node:fs';writeFileSync('initialized','ready');") },
    { path: 'server.mjs', bytes: Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'package',version:'1'}}:{tools:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})`) },
  ] })
  assert.equal(entry.status, 'unconfigured')
  await rm(entry.command)
  try {
    await link(process.execPath, entry.command)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await copyFile(process.execPath, entry.command)
    await chmod(entry.command, 0o755)
  }
  const prepared = await handlers.prepareWorkspace({ id: entry.id, revision: entry.revision, path: workspace })
  assert.equal(prepared.items[0].workspacePath, await realpath(workspace))
  const content = await readFile(join(workspace, 'AGENTS.md'), 'utf8')
  assert.match(content, /My workspace/)
  assert.match(content, /Use the configured connector/)
  const marker = await readFile(join(workspace, 'initialized'), 'utf8')
  assert.equal(marker, 'ready')
  const { prepareWorkspace } = await import('../src/workspace.js')
  await prepareWorkspace({ id: entry.id, bootstrap: { directory: '/not-needed', executable: 'missing', entrypoint: 'missing', args: [], completionMarker: 'initialized', timeoutMs: 1000, instructions: { content: 'Updated instructions.' } } }, workspace)
  assert.equal((await readFile(join(workspace, 'AGENTS.md'), 'utf8')).match(/SEAL_HARNESS-CONNECTOR:.*:START/g).length, 1)
})

test('workspace bootstrap accepts an existing directory completion marker', async t => {
  const root = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-marker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.codegraph'))
  const { prepareWorkspace } = await import('../src/workspace.js')
  const result = await prepareWorkspace({
    id: 'codegraph-fixture',
    bootstrap: {
      directory: join(root, 'missing-runtime'),
      executable: 'missing.exe',
      entrypoint: 'missing.cjs',
      args: [],
      completionMarker: '.codegraph',
      timeoutMs: 1000,
      instructions: { content: 'Use CodeGraph before text search.' },
    },
  }, root)
  assert.equal(result, await realpath(root))
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /Use CodeGraph before text search/)
})

test('workspace bootstrap rejects a symbolic-link completion marker', async t => {
  const root = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-marker-link-'))
  const target = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-marker-target-'))
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(target, { recursive: true, force: true }),
  ]))
  await symlink(target, join(root, '.codegraph'), 'junction')
  const { prepareWorkspace } = await import('../src/workspace.js')
  await assert.rejects(prepareWorkspace({
    id: 'codegraph-fixture',
    bootstrap: {
      directory: join(root, 'missing-runtime'),
      executable: 'missing.exe',
      entrypoint: 'missing.cjs',
      args: [],
      completionMarker: '.codegraph',
      timeoutMs: 1000,
      instructions: { content: 'Use CodeGraph before text search.' },
    },
  }, root), /工作区初始化完成标记无效/)
})

test('startup recovers an unbound connector from one initialized native workspace', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-recovery-'))
  await mkdir(join(workspace, '.codegraph'))
  const server = join(workspace, 'server.mjs')
  await writeFile(server, `import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'recovered',version:'1'}}:{tools:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})`)
  const key = credentialKey('seal-harness-capabilities', 'connectors')
  const { handlers } = await host(t, {}, async ctx => {
    ctx.provide('workspaceRegistry', { list: () => [{ path: workspace, title: 'Recovered workspace' }] })
    await ctx.get('credentials').modifyRecord(key, () => ({ kind: 'grant', payload: { version: 1, entries: [{
      id: 'codegraph-fixture', name: 'CodeGraph fixture', transport: 'stdio', command: process.execPath,
      args: [server], cwd: workspace, enabled: true, revision: 0,
      bootstrap: { directory: workspace, executable: 'missing.exe', entrypoint: 'missing.cjs', args: [], completionMarker: '.codegraph', timeoutMs: 1000, instructions: { blockId: 'fixture', content: 'Use CodeGraph before text search.' } },
    }] } }))
  })
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const first = await handlers.list()
  assert.equal(first.items[0].workspacePath, await realpath(workspace))
  assert.equal(first.items[0].status, 'active')
  assert.match(await readFile(join(workspace, 'AGENTS.md'), 'utf8'), /Use CodeGraph before text search/)
  assert.equal((await handlers.list()).items[0].workspacePath, await realpath(workspace), 'recovered binding is persisted')
})

test('startup leaves an unbound connector for explicit selection when multiple workspaces match', async t => {
  const first = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-ambiguous-a-'))
  const second = await mkdtemp(join(tmpdir(), 'seal-harness-workspace-ambiguous-b-'))
  await Promise.all([mkdir(join(first, '.codegraph')), mkdir(join(second, '.codegraph'))])
  const key = credentialKey('seal-harness-capabilities', 'connectors')
  const { handlers } = await host(t, {}, async ctx => {
    ctx.provide('workspaceRegistry', { list: () => [{ path: first }, { path: second }] })
    await ctx.get('credentials').modifyRecord(key, () => ({ kind: 'grant', payload: { version: 1, entries: [{
      id: 'codegraph-fixture', name: 'CodeGraph fixture', transport: 'stdio', command: process.execPath,
      enabled: true, revision: 0,
      bootstrap: { directory: first, executable: 'missing.exe', entrypoint: 'missing.cjs', args: [], completionMarker: '.codegraph', timeoutMs: 1000, instructions: { blockId: 'fixture', content: 'Use CodeGraph before text search.' } },
    }] } }))
  })
  t.after(() => Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]))
  const result = await handlers.list()
  assert.equal(result.items[0].workspacePath, undefined)
  assert.equal(result.items[0].status, 'unconfigured')
})

test('CodeGraph workspace runtime launches MCP with the bound project path and live watcher enabled', async () => {
  const { resolveStdioRuntime } = await import('../src/runtime.js')
  const artifact = join('C:\\packages', 'codegraph')
  const workspace = 'C:\\workspaces\\project'
  const command = join(artifact, 'server', 'codegraph', 'node.exe')
  const runtime = resolveStdioRuntime({
    command, args: ['wrapper/launch.cjs'], cwd: artifact, workspacePath: workspace,
    bootstrap: { instructions: { blockId: 'codegraph' } },
  }, { PATH: 'kept' })
  assert.equal(runtime.command, command)
  assert.deepEqual(runtime.args, [
    '--liftoff-only', join(artifact, 'server', 'codegraph', 'lib', 'dist', 'bin', 'codegraph.js'),
    'serve', '--mcp', '--path', workspace,
  ])
  assert.equal(runtime.cwd, artifact)
  assert.equal(runtime.env.CODEGRAPH_NO_DAEMON, '1')
  assert.equal(runtime.env.CODEGRAPH_NO_DOWNLOAD, '1')
  assert.equal(runtime.env.PATH, 'kept')
  assert.equal(runtime.args.includes('--no-watch'), false)
})

test('ordinary stdio runtime keeps its declared command, arguments and working directory', async () => {
  const { resolveStdioRuntime } = await import('../src/runtime.js')
  const entry = { command: 'C:\\tools\\server.exe', args: ['--stdio'], cwd: 'C:\\tools', workspacePath: 'C:\\workspace' }
  assert.deepEqual(resolveStdioRuntime(entry, { TOKEN: 'secret' }), {
    command: entry.command, args: entry.args, cwd: entry.cwd, env: { TOKEN: 'secret' },
  })
})

test('simultaneous skill and connector dependency installs finish without crossing queue locks', { timeout: 3000 }, async t => {
  const { default: SkillRegistry } = await import('@deepseek-ai/dsh-skill')
  const { createModule: createSkills } = await import('../../skills/src/module.js')
  const { openProductDatabase } = await import('../../local-data/src/index.js')
  const { createArchive } = await import('../../skills/src/package.js')
  const skillId = 'd975945d-f035-44c9-adff-a1a89e846ba8', connectorId = '3da9070b-ec02-4eb4-9dca-84de8f1e19cf'
  const bytes = createArchive([{ path: 'SKILL.md', bytes: Buffer.from('---\nname: concurrent-skill\ndescription: Concurrent dependency\n---\nUse this skill.'), mode: 0o644 }])
  const skill = { assetType: 'skill', assetId: skillId, version: '1.0.0', artifact: { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
  const connector = { assetType: 'mcp', assetId: connectorId, version: '1.0.0', descriptor: { schemaVersion: 'stratex.capability/v1', transport: 'http', endpointTemplate: 'https://example.com/mcp', authMode: 'none' } }
  let arrivals = 0, resolveBarrier
  const barrier = new Promise(resolve => { resolveBarrier = resolve })
  const account = { accountId: 'concurrent', epoch: 1 }
  const backend = {
    account: async () => account, assertAccount: async () => {}, download: async () => ({ bytes }),
    detail: async () => ({ id: connectorId, assetType: 'mcp', name: 'Concurrent connector', latestVersion: { ...connector, status: 'published', dependencies: [{ assetId: skillId, versionRange: '1.0.0' }] } }),
    request: async path => { if (path.endsWith('/result')) return { data: {} }; if (++arrivals === 2) resolveBarrier(); await barrier; return { data: { schemaVersion: 'stratex.registry-lock/v1', resolutionId: `resolution-${arrivals}`, capabilities: [skill, connector] } } },
  }
  const { ctx, home, module } = await host(t, backend)
  const database = openProductDatabase(home)
  const now = new Date().toISOString()
  database.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(account.accountId, account.accountId, account.accountId, Buffer.alloc(16), Buffer.alloc(64), 'user', 'active', now, now)
  ctx.provide('sealHarnessDatabase', database)
  ctx.provide('sealHarnessIdentity', { getSession: async () => account, subscribe: () => () => {} })
  await ctx.plugin(SkillRegistry).await()
  const skills = await createSkills(ctx, { home, backend })
  t.after(() => skills.dispose())
  ctx.provide('sealHarnessSkills', { call: (name, input, signal) => skills.hostHandlers[name](input, signal) })
  ctx.provide('sealHarnessConnectors', { call: (name, input, signal) => module.hostHandlers[name](input, signal) })
  await Promise.all([skills.handlers.install({ id: skillId, version: '1.0.0' }), module.handlers.install({ id: connectorId })])
  assert.equal((await skills.handlers.list()).skills.length, 1)
  assert.equal((await module.handlers.list()).items.length, 1)
  await skills.dispose()
  database.close()
})

test('source metadata survives legacy edits and the tool workbench uses native policy and allowlists', async t => {
  const fixture = await httpFixture(t)
  const { handlers, ctx, home } = await host(t)
  const initial = await handlers.save({ id: 'workbench', name: 'Workbench', summary: '查询团队资料', category: 'development', transport: 'streamable-http', url: fixture.url, enabled: true })
  assert.equal(initial.items[0].summary, '查询团队资料')
  assert.equal(initial.items[0].category, 'development')
  const oauth = await handlers.save({ id: 'oauth-new', name: 'OAuth', transport: 'streamable-http', url: fixture.url, authMode: 'oauth_authorization_code_pkce', enabled: true })
  assert.equal(oauth.items.find(item => item.id === 'oauth-new').status, 'unconfigured')
  assert.equal(oauth.items.find(item => item.id === 'oauth-new').authorization.configured, false)
  const edited = await handlers.save({ id: 'workbench', revision: 0, name: 'Renamed', transport: 'streamable-http', url: fixture.url, enabled: true })
  assert.equal(edited.items.find(item => item.id === 'workbench').summary, '查询团队资料', 'older clients do not erase metadata')
  assert.equal(edited.items.find(item => item.id === 'workbench').category, 'development')
  const payload = { id: 'workbench', revision: 1, tool: 'ping', arguments: {} }
  assert.equal((await handlers.testTool(payload)).isError, false)
  assert.equal(fixture.toolCalls(), 1)
  await assert.rejects(handlers.testTool({ ...payload, tool: 'other' }), /未启用/)
  await assert.rejects(handlers.testTool({ ...payload, revision: 0 }), /先启用/)
  await assert.rejects(handlers.testTool({ ...payload, arguments: [] }), /参数无效/)
  const release = ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'Native approval' }))
  assert.equal((await handlers.testTool(payload)).isError, true)
  assert.equal(fixture.toolCalls(), 1, 'workbench must not bypass native approval')
  release()
  await handlers.save({ id: 'workbench', revision: 1, name: 'Renamed', transport: 'streamable-http', url: fixture.url, enabled: true, enabledTools: [] })
  await assert.rejects(handlers.testTool({ ...payload, revision: 2 }), /未启用/)
  assert.equal(fixture.toolCalls(), 1)
  await handlers.save({ id: 'workbench', revision: 2, name: 'Renamed', transport: 'streamable-http', url: fixture.url, enabled: true, workspacePath: home })
  await assert.rejects(handlers.testTool({ ...payload, revision: 3 }), /限定了工作区/)
})


test('connector save and discovery ignore unrelated native schemas that cannot be projected', async t => {
  const { ctx, handlers, home } = await host(t)
  ctx.tools.register({ name: 'unrelated_native', description: 'Unrelated native tool', parameters: { type: 'object', extra: undefined }, output: { schema: {}, render: () => [] }, execute: async () => ({}) })
  assert.throws(() => ctx.tools.schemas(), /lossless JSON/)
  const payload = { id: 'local-12345678', name: '界面对齐验收连接器', summary: '仅在隔离 Home 保存，保持停用。', category: 'office', transport: 'streamable-http', command: '', args: [], cwd: '', url: 'http://127.0.0.1:9/mcp', toolCallTimeoutMs: 60000, enabledTools: null, enabled: false, authMode: 'none' }
  const saved = await handlers.save(payload)
  assert.equal(saved.items[0].status, 'disabled')
  assert.deepEqual(saved.items[0].tools, [])
  assert((await readFile(join(home, '.credentials.yaml'), 'utf8')).includes(payload.name))
  assert.deepEqual((await handlers.list()).items, saved.items)
  ctx.provide('sealHarnessConnectors', { call: action => handlers[action]() })
  assert.equal((await capabilityOptions(ctx)).items[0].sourceId, payload.id)
  const fixture = await httpFixture(t)
  const enabled = await handlers.save({ ...payload, revision: 0, url: fixture.url, enabled: true })
  assert.equal(enabled.items[0].status, 'active')
  assert.deepEqual(enabled.items[0].tools.map(tool => tool.name), ['ping'])
  assert.equal((await ctx.tools.execute({ name: 'mcp__zz-local-12345678__ping', callId: 'own-tool', arguments: {}, signal: new AbortController().signal })).isError, false)
  await handlers.setEnabled({ id: payload.id, revision: 1, enabled: false })
  assert.deepEqual((await handlers.list()).items[0].tools, [])
})
