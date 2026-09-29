import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-user-approval'
import '@deepseek-ai/dsh-agent-default-model'
import '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PROJECT_FUNCTION_TOOLS, PROJECT_SESSION_GUIDANCE } from './tool-definitions.js'
import { PROJECT_REFERENCE_FUNCTION_TOOLS } from '../stratex/main/kernel/codex/project-reference-tools.js'
import { ProjectCollabToolExecutor, type ProjectCollabToolBinding } from '../stratex/main/services/collab/projectCollabToolExecutor.js'
import { ProjectPlanningDraftStaging } from '../stratex/main/services/collab/projectPlanningDraftStaging.js'
import { narrowProjectPlanningToolPorts } from '../stratex/main/services/collab/projectCollabToolContract.js'
import { ProjectLinkedDirectoryToolExecutor } from '../stratex/main/services/collab/projectLinkedDirectoryToolExecutor.js'
import { ProjectLinkedDirectoryReadAccess } from '../stratex/main/services/collab/projectLinkedDirectoryReadAccess.js'
import type { ProjectLinkedDirectoryService } from '../stratex/main/services/projectWorkspacePreferenceLinkedDirectories.js'
import { ProjectAgentError, type Account, type ProjectsPort } from './contracts.js'
import { ProjectAgentStore, type ProjectSession } from './store.js'

type LiveBinding = { agent: Agent; record: ProjectSession; account: Account; abort: AbortController; remove: (() => void)[] }

export class ProjectAgentRuntime {
  readonly drafts = new ProjectPlanningDraftStaging()
  private readonly live = new Map<string, LiveBinding>()
  private readonly handles = new Map<string, AgentHandle>()
  private readonly pending = new Map<string, Promise<Agent>>()
  private readonly draining = new Set<Promise<void>>()
  private stopped = false
  constructor(readonly ctx: Context, readonly projects: ProjectsPort, readonly store: ProjectAgentStore, readonly references: ProjectLinkedDirectoryService, readonly home: string) {}

  account(): Account {
    const account = this.projects.getAccount()
    if (!account || this.stopped) throw new ProjectAgentError('authentication', '请先登录。')
    return account
  }
  current(account: Account) {
    const now = this.projects.getAccount()
    return !this.stopped && now?.accountKey === account.accountKey && now.authEpoch === account.authEpoch
  }
  assertCurrent(account: Account, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (!this.current(account)) throw new ProjectAgentError('contextChanged', '账号或项目上下文已变化，请重试。')
  }
  async membership(account: Account, projectId: string, signal?: AbortSignal) {
    this.assertCurrent(account, signal)
    const token = await this.projects.accessToken()
    this.assertCurrent(account, signal)
    if (!token) throw new ProjectAgentError('authentication', '请重新登录。')
    const detail = await this.projects.clients.client.readProjectDetail(token, { projectId })
    this.assertCurrent(account, signal)
    if (!detail.ok) throw new ProjectAgentError(detail.code, '无法读取项目，请检查连接和成员身份。')
    if (!detail.value.members.some(member => member.subject === account.subject && member.state === 'active')) throw new ProjectAgentError('forbidden', '当前账号不属于此项目。')
    return detail.value
  }
  async create(projectId: string, text?: string, signal?: AbortSignal) {
    const account = this.account()
    await this.membership(account, projectId, signal)
    const workspace = this.store.workspace(account.accountKey, projectId)
    if (!workspace) throw new ProjectAgentError('workspaceRequired', '请先为项目选择工作目录。')
    const record: ProjectSession = { accountKey: account.accountKey, projectId, sessionId: randomUUID(), cwd: workspace.cwd, bindingId: randomUUID(), revision: 1 }
    this.store.saveSession(record)
    try {
      const agent = await this.activate(record, account, false, signal)
      this.assertCurrent(account, signal)
      if (text) agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      return record.sessionId
    } catch (error) { this.store.removeSession(record.sessionId); throw error }
  }
  async open(projectId: string, sessionId: string, signal?: AbortSignal) {
    const account = this.account(), record = this.owned(account, projectId, sessionId)
    await this.membership(account, projectId, signal)
    await this.activate(record, account, true, signal)
    this.assertCurrent(account, signal)
    return sessionId
  }
  owned(account: Account, projectId: string, sessionId: string) {
    const row = this.store.session(sessionId)
    if (!row || row.accountKey !== account.accountKey || row.projectId !== projectId) throw new ProjectAgentError('notFound', '项目会话不存在。')
    return row
  }
  private async activate(record: ProjectSession, account: Account, resume: boolean, signal?: AbortSignal): Promise<Agent> {
    this.assertCurrent(account, signal)
    const live = this.live.get(record.sessionId)
    if (live && this.current(live.account) && !live.abort.signal.aborted) return live.agent
    const pending = this.pending.get(record.sessionId)
    if (pending) return pending
    const operation = (async () => {
      await Promise.all(this.draining)
      this.assertCurrent(account, signal)
      const attached = this.ctx.agents.get(SessionId(record.sessionId))
      if (attached) {
        await this.attach(attached.ctx, attached, record, account, signal)
        return attached
      }
      const setup = async (agentCtx: Context, agent: Agent) => {
        await this.attach(agentCtx, agent, record, account, signal)
        return { commit: () => this.assertCurrent(account, signal) }
      }
      const options = this.ctx.get('agentDefaultModel')?.currentSelection()
      const handle = resume
        ? await this.ctx.agents.resume({ resumeSessionId: SessionId(record.sessionId), setup, agentOptions: options, signal })
        : await this.ctx.agents.create({ sessionId: SessionId(record.sessionId), meta: { cwd: record.cwd }, setup, agentOptions: options, signal })
      if (!this.current(account) || signal?.aborted) { await handle.dispose(); this.assertCurrent(account, signal) }
      this.handles.set(record.sessionId, handle)
      try {
        const workspace = await this.ctx.workspaceRegistry.resolveByPath(record.cwd)
        if (workspace) await workspace.attachSession(handle.agent.id)
        this.assertCurrent(account, signal)
        return handle.agent
      } catch (error) {
        this.handles.delete(record.sessionId)
        await handle.dispose()
        throw error
      }
    })()
    this.pending.set(record.sessionId, operation)
    try { return await operation } finally { this.pending.delete(record.sessionId) }
  }
  /** Also called for a project session resumed by the native DSH session controller. */
  async onCreated(agent: Agent) {
    if (this.live.get(agent.id)?.agent === agent) return
    const record = this.store.session(agent.id)
    if (record) await this.attach(agent.ctx, agent, record, this.account())
  }
  private async attach(agentCtx: Context, agent: Agent, record: ProjectSession, account: Account, signal?: AbortSignal) {
    this.owned(account, record.projectId, agent.id)
    const detail = await this.membership(account, record.projectId, signal)
    const cwd = await realpath(record.cwd)
    if (cwd !== record.cwd || !(await stat(cwd)).isDirectory() || agent.session.header.cwd !== cwd) throw new ProjectAgentError('workspaceChanged', '会话工作目录已变化，请重新选择。')
    this.assertCurrent(account, signal)
    const token = await this.projects.accessToken()
    this.assertCurrent(account, signal)
    const conventions = token ? await this.projects.clients.client.readConventions(token, { projectId: record.projectId }) : null
    this.assertCurrent(account, signal)
    const entry: LiveBinding = { agent, record, account, abort: new AbortController(), remove: [] }
    this.live.set(agent.id, entry)
    agentCtx.effect(() => () => { entry.abort.abort(); if (this.live.get(agent.id) === entry) this.live.delete(agent.id) }, 'project-agent binding')
    const member = detail.members.find(member => member.subject === account.subject)
    const currentUser = JSON.stringify({ subject: account.subject, displayName: member?.displayName, projectRole: detail.myRole })
    const text = `当前登录用户（本项目会话的提问者）：${currentUser}\n用户说“我”时指此人；分配给自己时使用这个 subject，其他成员通过 project_list_members 查询。\n\n${PROJECT_SESSION_GUIDANCE}\n\n项目：${detail.name}\n项目说明：\n${detail.instructionsText}\n\n${conventions?.ok && conventions.value.ruleVersion > 0 ? `已发布 AI 规则（版本 ${conventions.value.ruleVersion}）：\n${conventions.value.aiEntryRules}` : '当前没有可读取的已发布 AI 规则。'}`
    entry.remove.push(agentCtx.systemPrompt.section({ name: 'seal-harness-project', order: 60, text, interpolate: false }))
    for (const tool of [...PROJECT_FUNCTION_TOOLS, ...PROJECT_REFERENCE_FUNCTION_TOOLS]) {
      entry.remove.push(agentCtx.tools.register({
        name: tool.name, description: tool.description, parameters: tool.inputSchema,
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: (args, exec) => this.execute(entry, tool.name, args, exec),
      }))
    }
  }
  private async execute(entry: LiveBinding, tool: string, args: unknown, exec: ToolRunContext) {
    // Child scopes can inherit schemas. Only the exact bound caller can use the authority.
    if (exec.agent !== entry.agent || this.live.get(exec.agent.id) !== entry) throw new ProjectAgentError('unbound', '当前 Agent 未绑定此项目。')
    const signal = AbortSignal.any([exec.signal, entry.abort.signal])
    return this.projects.withSignal(signal, async () => {
      await this.membership(entry.account, entry.record.projectId, signal)
      const binding: ProjectCollabToolBinding = {
        projectId: entry.record.projectId, sessionId: entry.agent.id, workspaceRoot: entry.record.cwd, accountKey: entry.account.accountKey,
        isCurrentContext: () => !signal.aborted && this.current(entry.account) && this.live.get(entry.agent.id) === entry,
        accessTokenProvider: async () => { this.assertCurrent(entry.account, signal); const token = await this.projects.accessToken(); this.assertCurrent(entry.account, signal); return token },
      }
      const response = tool.includes('_reference_')
        ? await new ProjectLinkedDirectoryToolExecutor({ service: this.references, readAccess: new ProjectLinkedDirectoryReadAccess(this.references), isAuthorized: async () => { await this.membership(entry.account, entry.record.projectId, signal); return binding.isCurrentContext() } }).execute({ accountKey: entry.account.accountKey, sessionId: entry.agent.id, binding: { bindingId: entry.record.bindingId, revision: entry.record.revision }, workspaceRoot: entry.record.cwd, projectBinding: binding, signal, assertCurrent: () => this.assertCurrent(entry.account, signal), tool, arguments: args })
        : await new ProjectCollabToolExecutor({ client: this.projects.clients.client, ...narrowProjectPlanningToolPorts(this.projects.clients.planning, this.drafts), tempDirectory: () => join(this.home, 'tmp') }).execute(binding, { namespace: 'stratex_project', tool, arguments: args }, {
          writeAccess: true,
          requestApproval: async input => {
            this.assertCurrent(entry.account, signal)
            const decision = await this.ctx.approval.request({ agent: entry.agent, toolName: tool, callId: exec.callId, signal, reason: (input.details ?? []).map(detail => `${detail.label}: ${detail.value}`).join('\n') })
            this.assertCurrent(entry.account, signal)
            return decision === 'allowed-once' ? 'accept' : decision === 'cancelled' ? 'cancel' : 'decline'
          },
        })
      this.assertCurrent(entry.account, signal)
      if (!response.success) throw new Error(response.contentItems[0].text)
      this.projects.emit('project:agent-changed', { projectId: entry.record.projectId, sessionId: entry.agent.id, tool })
      return response.contentItems[0].text
    })
  }
  invalidate() {
    this.drafts.clearAll()
    for (const entry of this.live.values()) this.retire(entry)
  }
  private retire(entry: LiveBinding) {
    entry.abort.abort()
    for (const remove of entry.remove.splice(0)) remove()
    this.live.delete(entry.agent.id)
    entry.agent.cancel({ kind: 'hook', reason: 'Project context changed' })
    const handle = this.handles.get(entry.agent.id)
    this.handles.delete(entry.agent.id)
    if (handle) {
      const promise = handle.dispose().finally(() => this.draining.delete(promise))
      this.draining.add(promise)
    }
  }
  async dispose() {
    this.stopped = true
    this.invalidate()
    await Promise.allSettled(this.pending.values())
    await Promise.all(this.draining)
    this.references.stop()
  }
}
