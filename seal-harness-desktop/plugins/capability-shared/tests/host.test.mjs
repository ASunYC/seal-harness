import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as skills from '../../skills/src/index.js'
import * as connectors from '../../connectors/src/index.js'
import * as experts from '../../experts/src/index.js'
import { openProductDatabase } from '../../local-data/src/index.js'

const plugins = { skills, connectors, experts }

test('independent Host plugins preserve data across unloading and reloading without affecting their siblings', async t => {
  for (const plugin of Object.values(plugins)) assert.deepEqual(plugin.Config.parse(undefined), {})
  const home = await mkdtemp(join(tmpdir(), 'seal-harness-host-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context(), routes = new Map()
  const database = openProductDatabase(home)
  const now = new Date().toISOString()
  database.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('fixture', 'fixture', 'Fixture', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  ctx.provide('sealHarnessDatabase', database)
  ctx.provide('sealHarnessIdentity', { getSession: () => ({ accountId: 'fixture', accessToken: 'fixture', epoch: 1 }), subscribe: () => () => {} })
  ctx.provide('sealHarnessServices', { getConfig: () => ({ storeBaseUrl: 'http://127.0.0.1:1/', mcpCenterBaseUrl: '' }) })
  ctx.provide('agents', { get: () => null })
  let connection
  ctx.provide('webServer', { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } })
  const server = createServer(async (request, response) => {
    const rejection = connection.requestRejection(request)
    if (rejection) { response.writeHead(rejection).end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const result = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers: request.headers, body: Buffer.concat(chunks) }))
    response.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await ctx.fiber.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close()
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(SkillRegistry).await()
  await ctx.plugin(LocalCredentials, { dshHome: home, watch: false }).await()
  connection = new HostConnectionService(ctx, [], { isAuthenticated: request => request.headers.authorization === 'Bearer fixture' })
  const mounted = new Map()
  const rpc = async (endpoint, payload = {}, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}/api/seal-harness-capabilities/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer fixture' } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test-1', method: `seal-harness-capabilities/${endpoint}`, payload }),
  })
  const result = async (endpoint, payload = {}) => {
    const response = await rpc(endpoint, payload)
    assert.equal(response.status, 200, endpoint)
    return (await response.json()).result
  }
  const value = async (endpoint, payload = {}) => {
    const response = await result(endpoint, payload)
    assert.equal(response.ok, true, `${endpoint}: ${JSON.stringify(response.error)}`)
    return response.value
  }
  for (const [name, definition] of Object.entries(plugins)) {
    const plugin = ctx.plugin(definition)
    await plugin.await()
    mounted.set(name, plugin)
    for (const other of Object.keys(plugins)) {
      assert.equal((await rpc(`${other}/list`)).status, mounted.has(other) ? 200 : 404, other)
    }
  }
  assert.equal((await rpc('skills/list', {}, false)).status, 401)
  assert.equal((await result('connectors/save', { id: '../escape' })).ok, false)

  const source = join(home, 'source')
  await mkdir(source)
  await writeFile(join(source, 'SKILL.md'), '---\nname: persisted-skill\ndescription: Lifecycle fixture\n---\nKeep this instruction.\n')
  const preview = await value('skills/inspect', { path: source })
  await value('skills/import', { token: preview.token, enable: true })
  await value('connectors/save', { id: 'persisted-connector', name: 'Saved connector', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer saved-secret' }, enabled: false })
  await value('experts/create', { manifest: { schemaVersion: 'stratex.expert/v1', name: 'writer', version: '0.1.0', entryAgent: 'writer', agents: ['agents/writer.md'], displayName: { zh: '写作专家', en: '' }, profession: { zh: '编辑', en: '' }, description: { zh: '整理文稿', en: '' }, personaInstructions: 'Preserve the persona.', model: 'test-model' } })
  const snapshots = new Map()
  for (const name of ['skills', 'connectors', 'experts']) snapshots.set(name, await value(`${name}/list`))
  for (const [name, definition] of Object.entries(plugins)) {
    await mounted.get(name).dispose()
    assert.equal((await rpc(`${name}/list`)).status, 404, `${name} route removed`)
    if (name === 'skills') assert.equal(await ctx.skills.get('persisted-skill'), undefined)
    for (const other of Object.keys(plugins).filter(other => other !== name)) {
      const response = await result(`${other}/list`)
      assert.deepEqual(response.value, snapshots.get(other), `${other} stays usable while ${name} is unloaded`)
    }
    const reloaded = ctx.plugin(definition)
    await reloaded.await()
    mounted.set(name, reloaded)
    assert.deepEqual(await value(`${name}/list`), snapshots.get(name), `${name} restores saved data`)
  }
  assert(await ctx.skills.get('persisted-skill'))
  assert((await readFile(join(home, '.credentials.yaml'), 'utf8')).includes('saved-secret'))
})
