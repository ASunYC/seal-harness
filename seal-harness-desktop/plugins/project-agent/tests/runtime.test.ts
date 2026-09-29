import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Sessions, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Approval from '@deepseek-ai/dsh-user-approval'
import Llm, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ProjectService } from '../../projects/src/host/service.js'
import * as Plugin from '../src/index.js'

const P = '11111111-1111-4111-8111-111111111111'
const P2 = '33333333-3333-4333-8333-333333333333'
const E = '22222222-2222-4222-8222-222222222222'
const stamp = '2026-09-23T00:00:00.000Z'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

class ScriptedModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  reply = '完成'
  actions: { name: string; args: unknown }[] = []
  async *stream(request: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(request)
    const action = this.actions.shift()
    if (action) {
      const id = ToolCallId(`call-${this.requests.length}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: action.name, argumentsDelta: JSON.stringify(action.args) }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: action.name, arguments: JSON.stringify(action.args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: this.reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'seal-harness-agent-')))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const workspace = join(home, 'workspace'); await mkdir(workspace)
  const originalHome = process.env.DSH_HOME; process.env.DSH_HOME = home
  cleanup.push(async () => { if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome })
  let account: { accountId: string; epoch: number; subject: string; accessToken: string } | null = { accountId: 'account-a', epoch: 1, subject: 'user-a', accessToken: 'fixture-a' }
  const listeners = new Set<() => void>()
  const identity = { getSession: () => account, refreshSession: async () => {}, getAccessToken: async () => { if (!account) throw new Error('Not signed in'); return account.accessToken }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const received: { url: string; method: string; body: unknown }[] = []
  let holdDetail: (() => void) | undefined
  let rejected = false
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    received.push({ url: req.url!, method: req.method!, body: raw ? JSON.parse(raw) : null })
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== 'Bearer fixture-a') { res.writeHead(401); res.end('{}'); return }
    const projectId = req.url!.includes(P2) ? P2 : P
    if (holdDetail && req.url!.match(/\/projects\/[^/]+$/)) { const held = holdDetail; holdDetail = undefined; held(); return }
    if (req.url!.endsWith('/conventions')) res.end(JSON.stringify({ conventions: { ai_entry_rules: 'Published project rules {{literal}}', rule_version: 3, content_md: '', version: 1, project_id: projectId, updated_at: stamp, published_at: stamp } }))
    else if (req.url!.includes('/milestones')) res.end(JSON.stringify({ items: [], total: 0, page: 1, page_size: 100 }))
    else if (req.url!.endsWith('/feed') && req.method === 'POST') res.end(JSON.stringify({ entry: { id: E, kind: 'member_post', author_subject: 'user-a', author_display_name: '测试用户', body_md: JSON.parse(raw).body_md, refs: [], comments: [], created_at: stamp } }))
    else if (req.url!.match(/\/projects\/[^/]+$/)) res.end(JSON.stringify({ project: { id: projectId, name: '项目测试', instructions_text: 'Project instructions {{literal}}', my_role: 'owner', created_at: stamp, members: [{ subject: 'user-a', display_name: '测试用户', role: 'owner', state: 'active', joined_at: stamp }] } }))
    else { res.writeHead(404); res.end('{}') }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const projects = new ProjectService(identity, `http://127.0.0.1:${address.port}`)
  cleanup.push(async () => projects.dispose())
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  const sessionEvents: SessionEvent[] = []; ctx.on('session/event', (session, event) => { sessionEvents.push(event) })
  for (const plugin of [SystemPrompt, Projections, Sessions, Agents, Llm, Approval]) await ctx.plugin(plugin).await()
  await ctx.plugin(Tools, { mode: 'native' }).await()
  await ctx.plugin(Persistence, { root: join(home, 'sessions'), compression: 'none' }).await()
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' }).await()
  await ctx.plugin(SessionTitle, { fallbackMaxWords: 10, fallbackMaxBytes: 100, maxTitleBytes: 200 }).await()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root: join(home, 'storage') }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(Workspaces).await()
  await ctx.plugin(DefaultModel, { provider: 'fixture', model: 'fixture' }).await()
  await ctx.plugin(AgentLoop, { agents: [] }).await()
  const model = new ScriptedModel(); ctx.llm.registerAdapter(['fixture'], model)
  ctx.provide('sealHarnessIdentity', identity); ctx.provide('sealHarnessProjects', projects)
  let selectedDirectory = workspace
  ctx.provide('directoryPicker', { capability: () => ({ kind: 'native', pick: async () => selectedDirectory }) })
  const approvals: string[] = []
  ctx.on('approval/request', async request => { approvals.push(request.toolName); return rejected ? 'rejected' : 'allowed-once' })
  const events: unknown[] = []
  projects.subscribe((channel, payload) => { if (channel === 'project:agent-changed') events.push(payload) })
  const plugin = ctx.plugin(Plugin); await plugin.await()
  const invoke = (channel: string, payload: unknown) => projects.invoke(channel, payload, new AbortController().signal)
  return { ctx, projects, model, received, approvals, events, sessionEvents, invoke, home, plugin, rejectApproval() { rejected = true }, holdNextDetail() { return new Promise<void>(resolve => { holdDetail = resolve }) }, choose(path: string) { selectedDirectory = path }, switchAccount() { account = { accountId: 'account-b', epoch: 2, subject: 'user-b', accessToken: 'fixture-b' }; listeners.forEach(listener => listener()) } }
}

test('real DSH Agent discovers 20 scoped tools, reads HTTP data, requests approval and stages a reviewable draft', async () => {
  const f = await fixture()
  await f.invoke('project:workspace-select', { collabProjectId: P })
  f.model.actions.push({ name: 'project_list_members', args: {} }, { name: 'project_post_update', args: { bodyMd: 'Agent HTTP write' } }, { name: 'project_draft_milestone', args: { name: '待审阅里程碑' } })
  const created = await f.invoke('project:session-create', { projectId: P, text: '读取成员、发布进展、提出里程碑草案。' }) as { ok: true; sessionId: string }
  expect(created.ok).toBe(true)
  const agent = f.ctx.agents.get(SessionId(created.sessionId))!
  await agent.whenIdle()
  expect(f.ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('project_'))).toHaveLength(20)
  expect(f.ctx.tools.schemas().filter(tool => tool.name.startsWith('project_'))).toHaveLength(0)
  expect(f.model.requests[0].tools?.filter(tool => tool.name.startsWith('project_'))).toHaveLength(20)
  const prompt = renderPrompt(await f.ctx.systemPrompt.assemble({ scope: agent }))
  expect(prompt).toContain('当前登录用户（本项目会话的提问者）：{"subject":"user-a","displayName":"测试用户","projectRole":"owner"}')
  expect(JSON.stringify(f.model.requests[0])).toContain('当前登录用户')
  expect(prompt).toContain('Project instructions {{literal}}')
  expect(prompt).toContain('Published project rules {{literal}}')
  expect(f.approvals).toContain('project_post_update')
  expect(f.received.filter(call => call.method === 'POST').map(call => call.body)).toContainEqual({ body_md: 'Agent HTTP write' })
  const drafts = await f.invoke('project:planning-draft-list', { sessionId: created.sessionId }) as { ok: true; drafts: { kind: string; name: string }[] }
  expect(drafts.drafts).toMatchObject([{ kind: 'milestone', name: '待审阅里程碑' }])
  expect(f.received.some(call => call.method === 'POST' && call.url.includes('milestone'))).toBe(false)
  expect(f.events).toContainEqual({ projectId: P, sessionId: created.sessionId, tool: 'project_post_update' })
  expect(f.sessionEvents.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')).toHaveLength(1)
  f.switchAccount()
  expect(f.ctx.tools.schemas(agent).some(tool => tool.name.startsWith('project_'))).toBe(false)
  expect(await f.invoke('project:session-open', { projectId: P, sessionId: created.sessionId })).toMatchObject({ ok: false, code: 'notFound' })
})


test('project Agents coexist with separate HTTP bindings and native resume restores reference tools', async () => {
  const f = await fixture()
  await f.invoke('project:workspace-select', { collabProjectId: P })
  const refs = join(f.home, 'reference'); await mkdir(refs); await writeFile(join(refs, 'notes.txt'), 'reference evidence')
  f.choose(refs)
  const added = await f.invoke('project:linked-directory-add', { collabProjectId: P }) as { ok: true; directories: { refId: string }[] }
  expect(added.ok).toBe(true)
  f.model.actions.push({ name: 'project_read_reference_file', args: { refId: added.directories[0].refId, relativePath: 'notes.txt' } })
  const created = await f.invoke('project:session-create', { projectId: P, text: '读取参考资料。' }) as { ok: true; sessionId: string }
  const first = f.ctx.agents.get(SessionId(created.sessionId))!
  await first.whenIdle()
  expect(JSON.stringify(f.sessionEvents.filter(event => event.type === 'tool/result'))).toContain('reference evidence')
  await f.invoke('project:workspace-select', { collabProjectId: P2 })
  const second = await f.invoke('project:session-create', { projectId: P2, text: '另一个项目。' }) as { ok: true; sessionId: string }
  const secondAgent = f.ctx.agents.get(SessionId(second.sessionId))!
  await secondAgent.whenIdle()
  for (const [agent, projectId] of [[first, P], [secondAgent, P2], [first, P]] as const) {
    expect(f.ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('project_'))).toHaveLength(20)
    const start = f.received.length
    f.model.actions.push({ name: 'project_list_members', args: {} }, { name: 'project_post_update', args: { bodyMd: `更新项目 ${projectId}` } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取成员并发布进展。' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const requests = f.received.slice(start)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(call => call.url.includes(`/projects/${projectId}`))).toBe(true)
    expect(requests.some(call => call.method === 'POST' && call.url.endsWith('/feed'))).toBe(true)
    expect(f.events).toContainEqual({ projectId, sessionId: agent.id, tool: 'project_post_update' })
  }
  const opened = await f.invoke('project:session-open', { projectId: P, sessionId: created.sessionId })
  expect(opened).toEqual({ ok: true, sessionId: created.sessionId })
  const resumed = f.ctx.agents.get(SessionId(created.sessionId))!
  expect(resumed).toBe(first)
  expect(f.ctx.tools.schemas(resumed).filter(tool => tool.name.startsWith('project_'))).toHaveLength(20)
  expect(renderPrompt(await f.ctx.systemPrompt.assemble({ scope: resumed }))).toContain('Published project rules')
  expect(renderPrompt(await f.ctx.systemPrompt.assemble({ scope: resumed }))).toContain('当前登录用户')
  const native = await f.invoke('project:workspace-list-local', { collabProjectId: P }) as { ok: true; workspaces: { localProjectId: string }[] }
  expect(native.workspaces.map(row => row.localProjectId)).toEqual(f.ctx.workspaceRegistry.list().map(row => row.id))
  await f.plugin.dispose()
  await f.ctx.plugin(Plugin).await()
  const direct = await f.ctx.agents.resume({ resumeSessionId: SessionId(created.sessionId), agentOptions: { provider: 'fixture', model: 'fixture' } })
  expect(f.ctx.tools.schemas(direct.agent).filter(tool => tool.name.startsWith('project_'))).toHaveLength(20)
  await direct.dispose()
})

test('project session list reads native titles and activity and omits sessions absent from DSH', async () => {
  const f = await fixture()
  await f.invoke('project:workspace-select', { collabProjectId: P })
  const created = await f.invoke('project:session-create', { projectId: P, text: '初始标题' }) as { ok: true; sessionId: string }
  const agent = f.ctx.agents.get(SessionId(created.sessionId))!
  await agent.whenIdle()
  const unrelated = await f.ctx.agents.create({ sessionId: SessionId('unrelated-session'), meta: { cwd: agent.session.header.cwd } })
  const title = f.ctx.sessionTitle.rename(agent.session, '原生重命名')
  expect(await f.invoke('project:session-list', { projectId: P })).toEqual({ ok: true, sessions: [{ sessionId: created.sessionId, title: '原生重命名', updatedAt: new Date(title.updatedAt).toISOString() }] })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续对话' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const active = await f.invoke('project:session-list', { projectId: P }) as { ok: true; sessions: { sessionId: string; title: string; updatedAt: string }[] }
  expect(active.sessions).toEqual([{ sessionId: created.sessionId, title: '原生重命名', updatedAt: new Date(f.sessionEvents.at(-1)!.time).toISOString() }])
  expect(Date.parse(active.sessions[0].updatedAt)).toBeGreaterThanOrEqual(title.updatedAt)
  const bindings = JSON.parse(await readFile(join(f.home, 'seal-harness-project-agent', 'bindings.json'), 'utf8'))
  expect(Object.hasOwn(bindings.sessions[0], 'title')).toBe(false)
  expect(Object.hasOwn(bindings.sessions[0], 'updatedAt')).toBe(false)
  await unrelated.dispose()
  await f.plugin.dispose()
  await f.ctx.plugin(Plugin).await()
  const cold = await f.invoke('project:session-list', { projectId: P }) as { ok: true; sessions: { title: string }[] }
  expect(cold.sessions.map(row => row.title)).toEqual(['原生重命名'])
  await rm(join(f.home, 'sessions'), { recursive: true, force: true })
  expect(await f.invoke('project:session-list', { projectId: P })).toEqual({ ok: true, sessions: [] })
})

test('spec assistance uses the DSH model with no tools and returns the original protocol', async () => {
  const f = await fixture()
  f.model.reply = JSON.stringify({ description: '实现项目记录', acceptanceItems: ['记录可读取'], constraintsText: '' })
  expect(await f.invoke('project:todo-spec-assist-readiness', {})).toEqual({ ok: true, state: 'ready' })
  const result = await f.invoke('project:todo-spec-assist', { requestId: E, projectId: P, itemKind: 'requirement', title: '项目记录' })
  expect(result).toEqual({ ok: true, requestId: E, suggestion: JSON.parse(f.model.reply) })
  expect(f.model.requests).toHaveLength(1)
  expect(f.model.requests[0].tools).toEqual([])
  expect(f.received.some(call => call.method === 'POST')).toBe(false)
})


test('DSH reports rejected writes and cancelling a turn aborts the active project HTTP request', async () => {
  const f = await fixture()
  await f.invoke('project:workspace-select', { collabProjectId: P })
  f.rejectApproval()
  f.model.actions.push({ name: 'project_post_update', args: { bodyMd: 'Do not publish' } })
  const created = await f.invoke('project:session-create', { projectId: P, text: '发布进展' }) as { ok: true; sessionId: string }
  const agent = f.ctx.agents.get(SessionId(created.sessionId))!
  await agent.whenIdle()
  expect(f.received.some(call => call.method === 'POST')).toBe(false)
  expect(f.sessionEvents.some(event => event.type === 'tool/result' && event.data.message.isError)).toBe(true)
  const requested = f.holdNextDetail()
  f.model.actions.push({ name: 'project_list_members', args: {} })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取成员' }], source: { kind: 'user' } }))
  await requested
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
  expect(agent.status).toBe('idle')
  expect(f.events).toEqual([])
})
