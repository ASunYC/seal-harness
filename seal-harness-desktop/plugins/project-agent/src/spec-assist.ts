import '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-agent-default-model'
import * as Protocol from '../../projects/stratex/shared/protocol/project-spec-assist.js'
import { buildTodoSpecAssistModelInput, parseTodoSpecAssistOutput } from '../stratex/main/services/collab/todoSpecAssistPrompt.js'
import type { ProjectAgentRuntime } from './runtime.js'
import { ProjectAgentError, type RequestContext } from './contracts.js'

export function registerSpecAssist(runtime: ProjectAgentRuntime) {
  const { projects, ctx } = runtime
  const active = new Map<RequestContext['sender'], { requestId: string; abort: AbortController }>()
  const errorResult = (code: Protocol.ProjectSpecAssistErrorCode, message: string) => ({ ok: false, code, message, referenceCode: Protocol.PROJECT_SPEC_ASSIST_REFERENCE_CODES[code] })
  const modelSelection = () => ctx.get('agentDefaultModel')?.currentSelection()
  const disposers = [
    projects.register('project:todo-spec-assist-readiness', async (_event, input) => {
      Protocol.ProjectSpecAssistReadinessRequestSchema.parse(input)
      if (!projects.getAccount()) return errorResult('authRequired', '请先登录。')
      const selection = modelSelection()
      const ready = selection && ctx.llm.listProviders().some(item => item.id === selection.provider)
      return { ok: true, state: ready ? 'ready' : 'modelUnavailable' }
    }),
    projects.register('project:todo-spec-assist-cancel', async (event, input) => {
      const { requestId } = Protocol.ProjectSpecAssistCancelRequestSchema.parse(input)
      const pending = active.get(event.sender)
      if (pending?.requestId === requestId) pending.abort.abort()
      return { ok: true }
    }),
    projects.register('project:todo-spec-assist', async (event, input) => {
      const parsed = Protocol.ProjectSpecAssistRequestSchema.safeParse(input)
      if (!parsed.success) return { ...errorResult('invalidRequest', '补全请求无效。'), requestId: null }
      const request = parsed.data
      const failed = (code: Protocol.ProjectSpecAssistErrorCode, message: string) => ({ ...errorResult(code, message), requestId: request.requestId })
      if (active.has(event.sender)) return failed('busy', '上一次补全还没结束。')
      const abort = new AbortController(), timeout = AbortSignal.timeout(120_000)
      const signal = AbortSignal.any([event.signal, abort.signal, timeout])
      active.set(event.sender, { requestId: request.requestId, abort })
      try {
        const account = runtime.account()
        const detail = await runtime.membership(account, request.projectId, signal)
        const selection = modelSelection()
        if (!selection) return failed('modelUnavailable', '请在设置中选择新会话默认模型。')
        const prompt = buildTodoSpecAssistModelInput(request, detail.name)
        let text = '', finished = false
        for await (const chunk of ctx.llm.stream({ ...selection, signal, tools: [], maxTokens: 4096, system: prompt.instructions, messages: [{ role: 'user', content: [{ type: 'text', text: prompt.messages[0].text }] }] })) {
          runtime.assertCurrent(account, signal)
          if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')) return failed('modelOutputInvalid', '助理返回了无法使用的补全内容。')
          if (chunk.type === 'text-delta') text += chunk.text
          if (chunk.type === 'finish') finished = chunk.reason.kind === 'stop'
          if (text.length > 64 * 1024) return failed('modelOutputInvalid', '补全内容超过上限，请缩小输入。')
        }
        runtime.assertCurrent(account, signal)
        const result = parseTodoSpecAssistOutput(text)
        return finished && result.ok ? { ok: true, requestId: request.requestId, suggestion: result.suggestion } : failed('modelOutputInvalid', '助理返回的内容不完整，请重试。')
      } catch (error) {
        if (error instanceof ProjectAgentError && error.code === 'authentication') return failed('authRequired', '请重新登录。')
        if (error instanceof ProjectAgentError && error.code === 'forbidden') return failed('forbidden', '当前账号不属于此项目。')
        return timeout.aborted ? failed('modelTimeout', '补全超时，请重试。') : signal.aborted ? failed('cancelled', '已取消补全。') : !projects.getAccount() ? failed('authRequired', '请重新登录。') : failed('modelFailed', '助理补全失败，请检查模型配置后重试。')
      } finally { active.delete(event.sender) }
    }),
  ]
  return {
    invalidate() { for (const value of active.values()) value.abort.abort() },
    dispose() { for (const value of active.values()) value.abort.abort(); for (const dispose of disposers) dispose() },
  }
}
