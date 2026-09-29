import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act, useContext, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

// 使用真实 React 提交顺序和 Lexical 单 root 契约；完整原生输入另做桌面验收。
async function bench(run, { strict = false } = {}) {
  const output = await mkdtemp(join(tmpdir(), 'seal-harness-conversation-lifecycle-'))
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'http://localhost' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) {
    globalThis[key] = dom.window[key]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const require = createRequire(import.meta.url)
  const { createEditor, $getRoot, $createParagraphNode, $createTextNode } = require('lexical')
  const editors = new Map()
  const references = []
  const events = []
  const subscribers = new Set()
  const registrations = new Map()
  const Session = React.createContext(null)
  let root, source, stopConnection, openConversation, cancelConversation, pageMounts = 0
  let activePanelId = null
  let mainSessionId = 'first'
  let pendingReady

  function editorFor(id) {
    if (!editors.has(id)) editors.set(id, createEditor({ namespace: id, onError: error => { throw error } }))
    return editors.get(id)
  }
  // 与原生 ComposerContentEditable 相同的公开 Lexical 绑定契约，故意保留其无条件解绑行为。
  function Composer({ sessionId, origin }) {
    const session = useContext(Session)
    const id = sessionId ?? session.sessionId
    const editor = editorFor(id)
    const input = useRef(null)
    useLayoutEffect(() => {
      editor.setRootElement(input.current)
      return () => editor.setRootElement(null)
    }, [editor])
    return React.createElement('section', null, React.createElement('div', { ref: input, contentEditable: true, suppressContentEditableWarning: true, 'data-editor': origin }))
  }
  function SessionProvider({ session, children }) {
    // 真实 SessionProvider 每次 render 都读取 binding；已释放引用必须报错。
    void session.binding
    useLayoutEffect(() => {
      events.push(`mount:${session.sessionId}`)
      return () => events.push(`unmount:${session.sessionId}`)
    }, [session])
    return React.createElement(Session.Provider, { value: session }, children)
  }
  const api = { dispose() {}, onProjectNotificationNavigate: () => () => {}, onProjectJoinLink: () => () => {} }
  const sessions = {
    refresh: async () => {},
    retain(sessionId) {
      let released = false
      const binding = { ctx: {}, sessionId }
      const reference = {
        sessionId,
        get binding() {
          if (released) throw new Error(`Session reference ${sessionId} is released`)
          return binding
        },
        ready: pendingReady ?? Promise.resolve(binding),
        release() {
          assert.equal(released, false, '每个引用只释放一次')
          released = true
          events.push(`release:${sessionId}`)
        },
        get released() { return released },
      }
      void reference.ready.catch(() => {})
      references.push(reference)
      return reference
    },
  }
  const ctx = {
    get: () => ({}),
    sessions,
    conversation: { input: { for: () => ({ focus() {}, state: { getSnapshot: () => ({ draft: '', draftRev: 0 }) } }) } },
    effect: run => { stopConnection = run() },
    slots: { inject: (_, run) => run(), register: (options, component) => registrations.set(options.name, component) },
  }
  try {
    await build({ config: false, entry: [fileURLToPath(new URL('../../src/client.tsx', import.meta.url))], outDir: output,
      format: 'cjs', platform: 'browser', dts: false,
      deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/, /bridge$/, /ui\/mount$/, /projectJoinLinkInbox$/] },
      outputOptions: { entryFileNames: 'client.cjs' },
    })
    const module = { exports: {} }
    runInNewContext(await readFile(join(output, 'client.cjs'), 'utf8'), {
      module, exports: module.exports, document, ShadowRoot, AbortController, URL, Error, __SEAL_HARNESS_PROJECT_CSS__: '',
      EventSource: class { constructor() { source = this } close() {} },
      require: id => {
        if (id.endsWith('/bridge')) return { createProjectBridge: () => api }
        if (id.endsWith('/projectJoinLinkInbox')) return { clearPendingJoinCode() {}, stashPendingJoinCode() {} }
        if (id.endsWith('/ui/mount')) return { mountProjects: async (host, options) => {
          pageMounts++
          const seat = document.createElement('div')
          const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
          shadow.replaceChildren(seat)
          let controller, conversation
          openConversation = async id => {
            controller?.abort()
            controller = new AbortController()
            const current = controller
            const mounted = await options.mountConversation(seat, id, current.signal)
            if (!current.signal.aborted) conversation = mounted
          }
          cancelConversation = () => controller?.abort()
          options.signal.addEventListener('abort', () => { controller?.abort(); conversation?.dispose() }, { once: true })
          await openConversation('first')
          return () => {}
        } }
        return require(id)
      },
    })
    module.exports.apply(ctx)
    const Retained = registrations.get('shell.overlay')
    const Seat = registrations.get('main')
    const usePanelInfo = select => React.useSyncExternalStore(listener => { subscribers.add(listener); return () => subscribers.delete(listener) }, () => select({ activePanelId }))
    const renderSlot = () => React.createElement(Composer, { origin: 'project' })
    function Shell() {
      const active = usePanelInfo(info => info.activePanelId)
      return React.createElement(React.Fragment, null,
        active === 'seal-harness-projects' ? React.createElement(Seat) : active === 'conversation' ? React.createElement(Composer, { sessionId: mainSessionId, origin: 'main' }) : null,
        React.createElement(Retained, { usePanelInfo, SessionProvider, renderSlot }))
    }
    const select = async (id, sessionId = mainSessionId) => {
      mainSessionId = sessionId
      await act(async () => { activePanelId = id; subscribers.forEach(listener => listener()) })
    }
    root = createRoot(document.querySelector('main'))
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Shell)) : React.createElement(Shell)))
    await act(async () => source.onmessage({ data: JSON.stringify({ channel: 'project:account-changed', payload: { accountId: 'a', epoch: 1 } }) }))
    await select('seal-harness-projects')
    await run({
      select, references, events, editors, get pageMounts() { return pageMounts },
      open: id => act(async () => openConversation(id)),
      start: id => openConversation(id),
      cancel: () => cancelConversation(),
      setPendingReady: promise => { pendingReady = promise },
      write: async (id, text) => act(async () => editorFor(id).update(() => {
        $getRoot().clear().append($createParagraphNode().append($createTextNode(text)))
      }, { discrete: true })),
      unmount: async () => { await act(async () => root.unmount()); root = null },
    })
  } finally {
    if (root) await act(async () => root.unmount())
    stopConnection?.()
    for (const editor of editors.values()) editor.setRootElement(null)
    dom.window.close()
    await rm(output, { recursive: true, force: true })
  }
}

test('同一会话在项目页与主聊天窗往返时只有可见输入框绑定原生编辑器', async () => {
  await bench(async b => {
    await b.write('first', '你帮我解释')
    const editor = b.editors.get('first')
    for (let i = 0; i < 3; i++) {
      await b.select('conversation')
      assert.ok(editor.getRootElement() === document.querySelector('[data-editor=main]'))
      assert.equal(editor.getRootElement().textContent, '你帮我解释')
      await b.select('seal-harness-projects')
      assert.ok(editor.getRootElement() === document.querySelector('[data-editor=project]'), '返回项目页重新绑定编辑器，而非留下只有 contenteditable 的旧 DOM')
      assert.equal(editor.getRootElement().textContent, '你帮我解释')
    }
    assert.equal(b.pageMounts, 1, '导航不重新加载 Vue 项目数据')
    assert.equal(b.references[0].released, false, '隐藏编辑器保留会话草稿')
    await b.unmount()
    assert.equal(b.references[0].released, true)
    assert.equal(editor.getRootElement(), null)
  })
})

test('切换会话和卸载后释放引用，隐藏期间切换也正确释放', async () => {
  await bench(async b => {
    await act(async () => {
      const pending = b.start('second')
      try {
        assert.doesNotThrow(() => b.references[0].binding, '移除旧视图的状态更新尚未提交，引用必须仍可读取')
      } finally {
        await pending
      }
    })
    assert.equal(b.references[0].released, true)
    assert.ok(b.editors.get('second').getRootElement() === document.querySelector('[data-editor=project]'))
    await b.select('other')
    await b.open('third')
    assert.equal(b.references[1].released, true, '隐藏页面切换时旧引用仍正确释放')
    await b.select('seal-harness-projects')
    assert.ok(b.editors.get('third').getRootElement() === document.querySelector('[data-editor=project]'))
    await b.unmount()
    assert.ok(b.references.every(reference => reference.released))
  })
})

test('挂载发布后首次 React 提交前取消，及 ready 迟到失败都不泄漏引用', async () => {
  await bench(async b => {
    await act(async () => {
      await b.start('transient')
      b.cancel()
    })
    assert.equal(b.references.find(reference => reference.sessionId === 'transient').released, true)
    assert.ok(!b.events.includes('mount:transient'), '取消发生在首次提交之前')
    const ready = Promise.withResolvers()
    b.setPendingReady(ready.promise)
    await act(async () => {
      const pending = b.start('late')
      while (!b.references.some(reference => reference.sessionId === 'late')) await Promise.resolve()
      b.cancel()
      ready.reject(new Error('迟到的会话打开失败'))
      await assert.rejects(pending, /迟到的会话打开失败/)
    })
    assert.ok(b.references.every(reference => reference.released))
    assert.equal(document.querySelector('[data-editor=project]'), null)
  })
})

test('StrictMode effect 重放后仍可绑定输入，最终每个引用只释放一次', async () => {
  await bench(async b => {
    await b.write('first', '保留草稿')
    await b.select('conversation')
    await b.select('seal-harness-projects')
    assert.ok(b.editors.get('first').getRootElement() === document.querySelector('[data-editor=project]'))
    assert.equal(document.querySelector('[data-editor=project]').textContent, '保留草稿')
    await b.unmount()
    assert.ok(b.references.every(reference => reference.released))
  }, { strict: true })
})
