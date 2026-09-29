import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import '@deepseek-ai/dsh-session-query'
import type { ProjectIdentity, ProjectService } from '../../projects/src/host/service.js'
import { PROJECT_COLLAB_REFERENCE_CODES } from '../../projects/stratex/shared/protocol/project-collab.js'
import * as Drafts from '../../projects/stratex/shared/protocol/project-planning-draft.js'
import { ProjectLinkedDirectoryService, createProjectLinkedDirectoryFileSystemDependencies } from '../stratex/main/services/projectWorkspacePreferenceLinkedDirectories.js'
import { ProjectLinkedDirectoryStore } from '../stratex/main/services/projectLinkedDirectoryStore.js'
import { ProjectAgentStore } from './store.js'
import { ProjectAgentRuntime } from './runtime.js'
import { createSessionRequest, openSessionRequest, projectRequest, failure, type ProjectsPort } from './contracts.js'
import { pickDirectory, registerWorkspaces } from './workspaces.js'
import { registerSpecAssist } from './spec-assist.js'

declare module '@deepseek-ai/cordis' { interface Context { sealHarnessProjects: ProjectService; sealHarnessIdentity: ProjectIdentity } }

export const name = 'seal-harness-project-agent'
export const inject = ['sealHarnessProjects', 'sealHarnessIdentity', 'agents', 'tools', 'systemPrompt', 'approval', 'llm', 'workspaceRegistry', 'sessionQuery']
export function apply(ctx: Context) {
  const projects = ctx.sealHarnessProjects
  const identity = ctx.sealHarnessIdentity
  const home = join(resolveDshHome(), 'seal-harness-project-agent')
  const lifetime = new AbortController()
  const references = new ProjectLinkedDirectoryService({
    ...createProjectLinkedDirectoryFileSystemDependencies(), createRefId: randomUUID,
    selectDirectory: context => pickDirectory(ctx, context.signal ?? lifetime.signal),
    store: new ProjectLinkedDirectoryStore(join(home, 'references.json'), hostname()),
  })
  const runtime = new ProjectAgentRuntime(ctx, projects, new ProjectAgentStore(join(home, 'bindings.json')), references, home)
  const spec = registerSpecAssist(runtime)
  const remove = registerWorkspaces(runtime)
  remove.push(projects.register('project:session-list', async (event, payload) => {
    try {
      const { projectId } = projectRequest.parse(payload), account = runtime.account()
      await runtime.membership(account, projectId, event.signal)
      const bound = new Set(runtime.store.sessions(account.accountKey, projectId).map(row => row.sessionId))
      const records = await ctx.sessionQuery.listSessions(event.signal)
      const titles = await ctx.sessionQuery.readTitleSnapshots(records.filter(row => bound.has(row.header.id)).map(row => row.header.id), event.signal)
      const sessions = await Promise.all(titles.filter(row => row.status === 'fulfilled').map(async row => {
        const events = await ctx.sessionQuery.listEvents(row.sessionId)
        return { sessionId: row.sessionId, title: row.value.title?.title ?? '未命名会话', updatedAt: new Date(events.at(-1)?.time ?? row.value.session.createdAt).toISOString() }
      }))
      runtime.assertCurrent(account, event.signal)
      return { ok: true, sessions: sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) }
    } catch (error) { return failure(error) }
  }))
  remove.push(projects.register('project:session-create', async (event, payload) => {
    try { const request = createSessionRequest.parse(payload); return { ok: true, sessionId: await runtime.create(request.projectId, request.text, event.signal) } }
    catch (error) { return failure(error) }
  }))
  remove.push(projects.register('project:session-open', async (event, payload) => {
    try { const request = openSessionRequest.parse(payload); return { ok: true, sessionId: await runtime.open(request.projectId, request.sessionId, event.signal) } }
    catch (error) { return failure(error) }
  }))
  for (const operation of ['list', 'discard'] as const) remove.push(projects.register(`project:planning-draft-${operation}`, async (event, payload) => {
    try {
      const request = operation === 'list' ? Drafts.ProjectPlanningDraftListRequestSchema.parse(payload) : Drafts.ProjectPlanningDraftDiscardRequestSchema.parse(payload)
      const account = runtime.account(), record = runtime.store.session(request.sessionId)
      if (!record || record.accountKey !== account.accountKey) return { ok: false, code: 'forbidden', referenceCode: PROJECT_COLLAB_REFERENCE_CODES.forbidden, message: '项目会话不存在。' }
      await runtime.membership(account, record.projectId, event.signal)
      if (operation === 'discard') {
        const request = Drafts.ProjectPlanningDraftDiscardRequestSchema.parse(payload)
        const result = runtime.drafts.discard({ accountKey: account.accountKey, sessionId: request.sessionId }, request.draftId, request.outcome)
        return result.ok ? { ok: true } : { ok: false, code: 'rejected', referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected, message: '草案已被处理。' }
      }
      return { ok: true, drafts: runtime.drafts.listForSession(account.accountKey, request.sessionId) }
    } catch { return { ok: false, code: 'unavailable', referenceCode: PROJECT_COLLAB_REFERENCE_CODES.unavailable, message: '无法读取规划草案。' } }
  }))
  let previous = projects.getAccount()
  remove.push(identity.subscribe(() => {
    const next = projects.getAccount()
    if (next?.accountKey !== previous?.accountKey || next?.authEpoch !== previous?.authEpoch) { runtime.invalidate(); spec.invalidate() }
    previous = next
  }))
  remove.push(ctx.on('agent/created', async ({ agent }) => { await runtime.onCreated(agent); return undefined }))
  ctx.effect(() => async () => {
    lifetime.abort()
    remove.forEach(dispose => dispose())
    spec.dispose()
    await runtime.dispose()
  }, 'seal-harness project agents')
}
