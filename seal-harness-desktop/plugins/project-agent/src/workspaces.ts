import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import '@deepseek-ai/dsh-host-directory-picker'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Context } from '@deepseek-ai/cordis'
import * as Protocol from '../../projects/stratex/shared/protocol/project-workspace.js'
import type { ProjectAgentRuntime } from './runtime.js'
import type { WorkspaceBinding } from './store.js'
import { ProjectAgentError } from './contracts.js'

export async function pickDirectory(ctx: Context, signal: AbortSignal) {
  const picker = ctx.get('directoryPicker')?.capability()
  if (picker?.kind !== 'native') throw new ProjectAgentError('unavailable', '当前宿主没有本地目录选择器。')
  return picker.pick(signal)
}
function snapshot(projectId: string, row?: WorkspaceBinding, available = true) {
  return row ? { status: available ? 'bound' : 'unavailable', collabProjectId: projectId, localProjectId: row.localProjectId, displayName: basename(row.cwd), binding: available ? { bindingId: row.bindingId, revision: row.revision } : null }
    : { status: 'unbound', collabProjectId: projectId, localProjectId: null, displayName: null, binding: null }
}

export function registerWorkspaces(runtime: ProjectAgentRuntime) {
  const { projects, store, ctx } = runtime
  const disposers: (() => void)[] = []
  for (const operation of ['resolve', 'select', 'select-local'] as const) {
    disposers.push(projects.register(`project:workspace-${operation}`, async (event, input) => {
      try {
        const request = operation === 'select-local' ? Protocol.ProjectWorkspaceSelectLocalRequestSchema.parse(input) : Protocol.ProjectWorkspaceRequestSchema.parse(input)
        const account = runtime.account()
        await runtime.membership(account, request.collabProjectId, event.signal)
        let row = store.workspace(account.accountKey, request.collabProjectId)
        if (operation !== 'resolve') {
          let selected: string | null
          if (operation === 'select-local') {
            const request = Protocol.ProjectWorkspaceSelectLocalRequestSchema.parse(input)
            const local = ctx.workspaceRegistry.get(WorkspaceId(request.localProjectId))
            if (!local) throw new ProjectAgentError('invalidInput', '所选工作目录不存在。')
            selected = local.path
          } else selected = await pickDirectory(ctx, event.signal)
          runtime.assertCurrent(account, event.signal)
          if (selected) {
            const cwd = await realpath(selected)
            if (!(await stat(cwd)).isDirectory()) throw new ProjectAgentError('invalidInput', '请选择目录。')
            runtime.assertCurrent(account, event.signal)
            const local = await ctx.workspaceRegistry.create(cwd)
            runtime.assertCurrent(account, event.signal)
            row = store.setWorkspace(account.accountKey, request.collabProjectId, cwd, local.id)
          }
        }
        const available = !row || await stat(row.cwd).then(value => value.isDirectory(), () => false)
        runtime.assertCurrent(account, event.signal)
        return Protocol.ProjectWorkspaceResultSchema.parse({ ok: true, snapshot: snapshot(request.collabProjectId, row, available) })
      } catch (error) {
        const code = error instanceof ProjectAgentError && error.code === 'authentication' ? 'authentication' : 'unavailable'
        return { ok: false, error: { code, referenceCode: `project-workspace:${code}` } }
      }
    }))
  }
  const operations = [
    ['project:linked-directory-list', Protocol.ProjectLinkedDirectoryListRequestSchema, 'list'],
    ['project:linked-directory-add', Protocol.ProjectLinkedDirectoryAddRequestSchema, 'add'],
    ['project:linked-directory-remove', Protocol.ProjectLinkedDirectoryRemoveRequestSchema, 'remove'],
    ['workspace:linked-directory-list', Protocol.WorkspaceLinkedDirectoryListRequestSchema, 'list'],
    ['workspace:linked-directory-add', Protocol.WorkspaceLinkedDirectoryAddRequestSchema, 'add'],
    ['workspace:linked-directory-remove', Protocol.WorkspaceLinkedDirectoryRemoveRequestSchema, 'remove'],
  ] as const
  for (const [channel, schema, operation] of operations) disposers.push(projects.register(channel, async (event, input) => {
    try {
      const request = schema.parse(input), account = runtime.account()
      const workspace = 'bindingId' in request ? store.workspaceByBinding(account.accountKey, request.bindingId) : store.workspace(account.accountKey, request.collabProjectId)
      const projectId = 'collabProjectId' in request ? request.collabProjectId : workspace?.projectId
      if (!projectId) throw new ProjectAgentError('invalidInput', '工作目录不存在。')
      await runtime.membership(account, projectId, event.signal)
      const context = { signal: event.signal, accountKey: account.accountKey, collabProjectId: projectId, workspaceRoot: workspace?.cwd, isCurrentContext: () => runtime.current(account) && !event.signal.aborted }
      const result = operation === 'remove' && 'refId' in request ? await runtime.references.remove(context, Protocol.ProjectLinkedDirectoryRemoveRequestSchema.shape.refId.parse(request.refId)) : operation === 'add' ? await runtime.references.add(context) : await runtime.references.list(context)
      runtime.assertCurrent(account, event.signal)
      return Protocol.ProjectLinkedDirectoriesResultSchema.parse(result)
    } catch {
      return { ok: false, error: { code: 'unavailable', referenceCode: 'project-linked-directory:unavailable' } }
    }
  }))
  disposers.push(projects.register('project:workspace-list-local', async (event, input) => {
    try {
      const request = Protocol.ProjectWorkspaceRequestSchema.parse(input), account = runtime.account()
      await runtime.membership(account, request.collabProjectId, event.signal)
      return { ok: true, workspaces: ctx.workspaceRegistry.list().map(row => ({ localProjectId: row.id, displayName: row.title })) }
    } catch { return { ok: false, error: { code: 'unavailable', referenceCode: 'project-workspace:unavailable' } } }
  }))
  return disposers
}
