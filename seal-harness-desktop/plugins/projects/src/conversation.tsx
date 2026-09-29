import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectConversation } from './ui/runtime'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { sealHarnessProject: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'seal-harness.project.conversation': { kind: 'single'; scope: 'session' }
  }
}

export interface ConversationMount {
  target: HTMLElement
  reference: SessionReference
  retainView(): () => void
}

function ChatView({ renderSlot }: ConversationViewsProps) {
  // 原生空会话返回 null，保留伸展区域才能让输入框始终停靠底部。
  return <div style={{ display: 'flex', flexDirection: 'column', flex: '1 0 auto', minWidth: 0 }}>
    {renderSlot('conversation.session', { view: 'chat' })}
  </div>
}

export function ProjectConversationContent({ sessionId, useSessions, renderFactorySlot }: PropsRuntime<'seal-harness.project.conversation'> & PropsRenderFactories) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const directory = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? '未提供目录'
  // 项目工作空间由业务层绑定，空会话也使用停靠输入框，避免原生 Hero 改选其他空间。
  return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
    <div title={cwd} style={{ padding: '4px 16px', fontSize: 12, opacity: 0.7 }}>本会话工作空间：{directory}</div>
    {renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, {
      slots: { views: ChatView },
    })}
  </div>
}

export async function mountProjectConversation(
  ctx: Context, host: HTMLElement, sessionId: string, signal: AbortSignal,
  publish: (mount: ConversationMount) => () => void,
): Promise<ProjectConversation> {
  await ctx.sessions.refresh()
  signal.throwIfAborted()
  const reference = ctx.sessions.retain(sessionId as SessionId, { source: 'sealHarnessProject', signal })
  const target = document.createElement('div')
  target.slot = 'project-conversation'
  target.dataset.projectConversation = sessionId
  Object.assign(target.style, { display: 'flex', flex: '1', minHeight: '0', minWidth: '0', height: '100%', width: '100%' })
  // Light DOM 保留 DSH 样式；原生 slot 只负责在 Vue 的 Shadow DOM 中定位。
  const outlet = document.createElement('slot')
  outlet.name = target.slot
  outlet.style.display = 'contents'
  const shadow = host.getRootNode()
  if (!(shadow instanceof ShadowRoot)) {
    reference.release()
    throw new Error('项目对话挂载位置无效。')
  }
  let unpublish = () => {}
  let disposed = false
  // 桥接层与已提交的 React 视图共同持有引用，异步移除 portal 后才能最终释放。
  let owners = 1
  const release = () => {
    owners -= 1
    if (owners === 0) reference.release()
  }
  const retainView = () => {
    owners += 1
    return release
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', dispose)
    unpublish()
    outlet.remove()
    target.remove()
    release()
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    const binding = await reference.ready
    signal.throwIfAborted()
    const input = ctx.conversation.input.for(binding.ctx)
    host.append(outlet)
    shadow.host.append(target)
    unpublish = publish({ target, reference, retainView })
    return {
      dispose,
      prefill(text) {
        if (disposed) return
        if (text) {
          const { draft, draftRev } = input.state.getSnapshot()
          const inserted = binding.ctx.bail('slash/input-insert-text', {
            text: draft ? `\n\n${text}` : text,
            span: { start: draft.length, end: draft.length, draftRev },
          })
          if (!inserted) throw new Error('输入框正在提交，请稍后再次发起拆解。')
        }
        input.focus()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
