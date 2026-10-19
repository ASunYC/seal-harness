import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { Session } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createModule } from '../../connectors/src/module.js'
import { openProductDatabase } from '../../local-data/src/index.js'
import { LocalIdentityService } from '../../identity/src/local-service.js'
import { ApplicationsService } from '../src/service.js'
import { dbxArtifacts } from '../src/catalog.js'
import { digest } from '../src/installer.js'

const archives = process.env.SEAL_DBX_TEST_ARCHIVES
test('official DBX archives install and expose real MCP tools through a selected DSH session, then unload', { skip: !archives || process.platform !== 'win32', timeout: 180000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'seal-dbx-real-')), storage = openProductDatabase(home), identity = new LocalIdentityService(storage)
  await identity.register({ username: 'dbxtest', displayName: 'DBX Test', password: 'dbx-fixture-password' })
  const ctx = new Context(), agents = new Map()
  ctx.provide('sealHarnessIdentity', identity); ctx.provide('agents', { get: id => agents.get(String(id)) })
  await ctx.plugin(SystemPrompt).await(); await ctx.plugin(ToolRuntime).await(); await ctx.plugin(LocalCredentials, { dshHome: home, watch: false }).await()
  const module = await createModule(ctx, { home, backend: {} })
  const service = new ApplicationsService({ storage, identity, connectors: { call: (action, input, signal) => (module.hostHandlers[action] ?? module.handlers[action])(input, signal) },
    download: async artifact => {
      const bytes = await readFile(join(archives, `${artifact.kind === 'desktop' ? 'desktop' : 'mcp'}.zip`))
      assert.equal(digest(bytes), dbxArtifacts().find(item => item.kind === artifact.kind).sha256)
      return bytes
    },
  })
  t.after(async () => { await service.dispose(); await module.dispose(); await ctx.fiber.dispose(); identity.dispose(); storage.close(); await rm(home, { recursive: true, force: true }) })
  service.start('install'); await service.jobs.get(identity.getSession().accountId).promise
  const app = (await service.list()).items[0]
  assert.equal(app.installed, true, app.error)
  assert.equal(app.mcpStatus, 'active', app.error)
  assert(app.toolCount > 0)
  const connector = (await module.handlers.list()).items.find(item => item.managedApplication === 'dbx')
  assert(connector.tools.some(tool => tool.name === 'dbx_execute_query'))
  const session = Session.create('dbx-tool-test'); session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session }; agent.ctx = createScope(ctx, agent).ctx; agents.set(String(agent.id), agent)
  await module.handlers.sessionList({ sessionId: String(agent.id) })
  const toolName = `mcp__zz-${connector.id}__dbx_list_connections`
  assert.equal(ctx.tools.schemas(agent).some(tool => tool.name === toolName), false)
  await module.handlers.sessionSet({ sessionId: String(agent.id), id: connector.id, revision: connector.revision, selected: true })
  assert(ctx.tools.schemas(agent).some(tool => tool.name === toolName))
  const result = await ctx.tools.execute({ name: toolName, callId: 'dbx-real-list', arguments: {}, agent, signal: new AbortController().signal })
  assert.equal(result.isError, false, 'tool reaches real DBX MCP server')
  console.log('real DBX tool response:', JSON.stringify(result).slice(0, 600))
  const data = service.paths(identity.getSession().accountId).data
  await writeFile(join(data, 'keep.txt'), 'preserved')
  service.start('uninstall'); await service.jobs.get(identity.getSession().accountId).promise
  assert.equal((await service.list()).items[0].installed, false)
  assert.equal(ctx.tools.schemas(agent).some(tool => tool.name === toolName), false)
  assert.equal(await readFile(join(data, 'keep.txt'), 'utf8'), 'preserved')
})
