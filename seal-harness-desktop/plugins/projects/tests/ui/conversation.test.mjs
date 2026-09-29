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

test('原生会话使用公开嵌入接口，投射样式、预填及取消释放隔离', async () => {
  const output = await mkdtemp(join(tmpdir(), 'seal-harness-conversation-'))
  const dom = new JSDOM('<!doctype html><main></main>')
  try {
    await build({ config: false, entry: [fileURLToPath(new URL('../../src/conversation.tsx', import.meta.url))], outDir: output,
      format: 'cjs', platform: 'browser', dts: false, deps: { neverBundle: [/^react(?:\/|$)/] }, outputOptions: { entryFileNames: 'conversation.cjs' },
    })
    const module = { exports: {} }
    runInNewContext(await readFile(join(output, 'conversation.cjs'), 'utf8'), {
      module, exports: module.exports, require: createRequire(import.meta.url), document: dom.window.document, ShadowRoot: dom.window.ShadowRoot,
    })
    const { mountProjectConversation, ProjectConversationContent } = module.exports
    let factory
    ProjectConversationContent({ sessionId: 'first', useSessions: select => select({ byId: { first: { cwd: '/workspace/actual' } } }), renderFactorySlot: (...args) => { factory = args } })
    assert.equal(factory[0], 'conversation.content')
    assert.equal(factory[1].variant, 'embedded')
    assert.equal(factory[1].hero, false, '项目工作空间由项目绑定控制')
    const ChatView = factory[2].slots.views
    for (const content of [null, '首条消息']) {
      const view = ChatView({ renderSlot: (name, props) => {
        assert.equal(name, 'conversation.session')
        assert.equal(props.view, 'chat')
        return content
      } })
      assert.equal(view.type, 'div', '空会话也保留消息布局容器')
      assert.equal(view.props.style.flex, '1 0 auto', '消息区域填满空白且长消息不收缩')
      assert.equal(view.props.children, content)
    }
    let draft = '已有草稿', focus = 0, releases = 0, mounted = null, rejectReady
    const bindings = { ctx: { bail: (event, { text, span }) => {
      assert.equal(event, 'slash/input-insert-text')
      assert.equal(span.start, draft.length)
      assert.equal(span.end, draft.length)
      assert.equal(span.draftRev, 7)
      draft += text
      return true
    } } }
    const ctx = {
      sessions: {
        refresh: async () => {},
        retain: (sessionId, { source }) => {
          assert.equal(source, 'sealHarnessProject')
          return { sessionId, ready: sessionId === 'late' ? new Promise((_, reject) => { rejectReady = reject }) : Promise.resolve(bindings), release: () => { releases++ } }
        },
      },
      conversation: { input: { for: context => {
        assert.equal(context, bindings.ctx)
        return { state: { getSnapshot: () => ({ draft, draftRev: 7 }) }, focus: () => { focus++ } }
      } } },
    }
    const shadowHost = dom.window.document.querySelector('main')
    const shadow = shadowHost.attachShadow({ mode: 'open' })
    const seat = dom.window.document.createElement('div')
    shadow.append(seat)
    const publish = mount => { mounted = mount; return () => { if (mounted === mount) mounted = null } }
    const abort = new AbortController()
    const chat = await mountProjectConversation(ctx, seat, 'first', abort.signal, publish)
    assert.equal(mounted.target.getRootNode(), dom.window.document, 'DSH 原生样式必须位于 light DOM')
    assert.equal(seat.querySelector('slot').assignedElements()[0], mounted.target)
    chat.prefill('拆解需求')
    assert.equal(draft, '已有草稿\n\n拆解需求')
    assert.equal(focus, 1)
    bindings.ctx.bail = () => undefined
    assert.throws(() => chat.prefill('被拒绝的预填'), /输入框正在提交/)
    assert.equal(draft, '已有草稿\n\n拆解需求', '忙碌输入不能覆盖旧草稿')
    abort.abort()
    chat.dispose()
    assert.equal(releases, 1)
    assert.equal(mounted, null)
    assert.equal(seat.children.length, 0)
    assert.equal(shadowHost.children.length, 0)
    const lateAbort = new AbortController()
    const late = mountProjectConversation(ctx, seat, 'late', lateAbort.signal, publish)
    await new Promise(setImmediate)
    lateAbort.abort()
    const current = await mountProjectConversation(ctx, seat, 'current', new AbortController().signal, publish)
    rejectReady(new Error('old request failed'))
    await assert.rejects(late, /old request failed/)
    assert.equal(mounted.reference.sessionId, 'current', '旧会话失败不能清空新会话')
    current.dispose()
    assert.equal(releases, 3)
  } finally {
    dom.window.close()
    await rm(output, { recursive: true, force: true })
  }
})
