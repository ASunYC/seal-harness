import React from 'react'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { WordEditor } from './word-editor.jsx'
import { BlockEditor } from './block-editor.jsx'
import { WorkspaceFileActions } from './workspace-file-actions.jsx'
import { RightGuide } from './right-guide.jsx'
import { changedOfficePath, completedTurnFromChange, generatedOfficePath, workspaceOfficePath } from './generated-office.js'
import { styles } from './styles.js'
import { workspaceFileActionStyles } from './workspace-file-actions-styles.js'
import { rightGuideStyles } from './right-guide-styles.js'

export const inject = ['slots', 'connection', 'sessions', 'sidebarRight', 'sidebarRightTabs']

const tabId = '@seal-harness/workspace-office-editor'
const tabKind = 'seal-workspace-office'
const officeFile = /\.(?:docx|xlsx|pptx)$/iu

export function apply(ctx) {
  const dirtyTabs = new Map()
  const openedTurns = new Set()
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-workspace-word/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.sealWorkspaceWord = ''
    element.textContent = styles + workspaceFileActionStyles + rightGuideStyles
    document.head.append(element)
    return () => element.remove()
  }, 'seal-harness-workspace-word: styles')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: tabId, kind: tabKind, multiple: true, keepMounted: true,
    patterns: ['dsh-resource://file/[\\s\\S]+'], priority: 'extension',
    canOpen: address => {
      const file = parseFileAddress(address)
      return file?.scope === 'session' && officeFile.test(file.path)
    },
    title: address => parseFileAddress(address)?.path.split(/[\\/]/u).at(-1) ?? '办公文档',
  }), 'seal-harness-workspace-word: sidebar tab')
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(tabKind, (sessionId, tab) => {
    const key = `${sessionId}:${tab.id}`
    if (dirtyTabs.get(key) && !window.confirm('当前文档尚未保存。要放弃修改并关闭吗？'))
      throw new Error('已取消关闭未保存的文档。')
    dirtyTabs.delete(key)
  }), 'seal-harness-workspace-word: unsaved tab guard')

  function EditorTab({ useTabInfo, sessionId }) {
    const { tab } = useTabInfo()
    const target = tab.navigation.params
    const file = parseFileAddress(tab.contentId ?? '')
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    const path = file?.scope === 'session' && file.sessionId === sessionId
      ? workspaceOfficePath(file.path, cwd) : file ? undefined : target?.path
    if (typeof path !== 'string' || !officeFile.test(path))
      return <p className="seal-workspace-word-error" role="alert">文档地址不可用，请从工作区重新打开。</p>
    const key = `${sessionId}:${tab.id}`
    const setDirty = dirty => { if (dirty) dirtyTabs.set(key, true); else dirtyTabs.delete(key) }
    const close = () => { dirtyTabs.delete(key); tab.actions.close() }
    return <main className="seal-workspace-word" aria-label="办公文档编辑器">
      {path.toLowerCase().endsWith('.docx')
        ? <WordEditor key={`${sessionId}:${path}`} target={{ sessionId, path }} api={api} setDirty={setDirty} close={close} />
        : <BlockEditor key={`${sessionId}:${path}`} target={{ sessionId, path }} api={api} setDirty={setDirty} close={close} />}
    </main>
  }
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: tabId,
    inject: sessionId => ({ sessionId }),
  }, EditorTab))
  ctx.slots.inject('sidebar.right.tab.guide', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide', id: 'seal-right-workspace-guide', order: 20,
    select: () => ({}),
    inject: sessionId => ({ sessionId, tabs: ctx.sidebarRightTabs, right: ctx.sidebarRight }),
  }, RightGuide))

  function EditAction({ absolutePath, sessionId }) {
    if (!sessionId || !officeFile.test(absolutePath ?? '')) return null
    const open = () => openEditor({ sessionId, path: absolutePath })
    return <button type="button" className="seal-workspace-word-edit-action" onClick={open}>编辑</button>
  }
  function openEditor({ sessionId, path }) {
    ctx.sidebarRight.openResourceIn(sessionId, sessionFileAddress(sessionId, path))
  }
  function AutoOpenGeneratedOffice({ sessionId, turn, seq }) {
    React.useEffect(() => {
      const source = ctx.sessions.binding(sessionId)?.eventSource
      if (!source) return
      let active = true
      const onChange = () => {
        if (!completedTurnFromChange(source.getSnapshot().change, turn.turn)) return
        queueMicrotask(() => { void (async () => {
          if (!active || ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return
          const key = `${sessionId}:${turn.turn}`
          if (openedTurns.has(key)) return
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const path = generatedOfficePath(turn, seq, cwd)
            ?? await changedOfficePath(turn, sessionId, cwd)
          if (!path || !active || ctx.sidebarRight.mounted.getSnapshot() !== sessionId || openedTurns.has(key)) return
          openEditor({ sessionId, path })
          openedTurns.add(key)
        })().catch(error => console.error('工作区 Office 自动打开失败', error)) })
      }
      const unsubscribe = source.subscribe(onChange)
      onChange()
      return () => { active = false; unsubscribe() }
    }, [sessionId, turn, seq])
    return null
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'seal-workspace-office-auto-open', order: 90,
  }, AutoOpenGeneratedOffice))
  ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.document.actions', id: 'seal-workspace-word-edit', order: 20,
    inject: sessionId => ({ sessionId }),
  }, EditAction))
  ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.files.actions', id: 'seal-workspace-word-file-actions', order: 20,
    inject: sessionId => ({ sessionId, api, onOpen: openEditor, onPreview: openEditor }),
  }, WorkspaceFileActions))
}
