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
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

test('公开主插槽切换保留页面与草稿，账号更换和插件卸载释放', async () => {
  const output = await mkdtemp(join(tmpdir(), 'seal-harness-retention-'))
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'http://localhost' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  let stopConnection
  try {
    await build({ config: false, entry: [fileURLToPath(new URL('../../src/client.tsx', import.meta.url))], outDir: output,
      format: 'cjs', platform: 'browser', dts: false,
      deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/, /conversation$/, /bridge$/, /ui\/mount$/, /projectJoinLinkInbox$/] },
      outputOptions: { entryFileNames: 'client.cjs' },
    })
    let events, mounts = 0, releases = 0, failMount = false
    const registrations = new Map()
    const listeners = new Set()
    let activePanelId = null
    const api = { dispose() {}, onProjectNotificationNavigate: () => () => {}, onProjectJoinLink: () => () => {} }
    const require = createRequire(import.meta.url)
    const module = { exports: {} }
    runInNewContext(await readFile(join(output, 'client.cjs'), 'utf8'), {
      module, exports: module.exports, document, AbortController, URL, Error, __SEAL_HARNESS_PROJECT_CSS__: '',
      EventSource: class { constructor() { events = this } close() {} },
      require: id => {
        if (id.endsWith('/bridge')) return { createProjectBridge: () => api }
        if (id.endsWith('/ui/mount')) return { mountProjects: async (host, options) => {
          mounts++
          if (failMount) throw new Error('临时连接失败')
          const input = document.createElement('textarea')
          host.append(input)
          options.signal.addEventListener('abort', () => { releases++; host.replaceChildren() }, { once: true })
          return () => {}
        } }
        if (id.endsWith('/conversation')) return { ProjectConversationContent: () => null }
        if (id.endsWith('/projectJoinLinkInbox')) return { clearPendingJoinCode() {}, stashPendingJoinCode() {} }
        return require(id)
      },
    })
    module.exports.apply({ get: () => ({}), effect: run => { stopConnection = run() },
      slots: { inject: (_, run) => run(), register: (options, component) => registrations.set(options.name, component) },
    })
    const Retained = registrations.get('shell.overlay')
    const Seat = registrations.get('main')
    const usePanelInfo = select => React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => select({ activePanelId }))
    function Shell() {
      const active = usePanelInfo(info => info.activePanelId)
      return React.createElement(React.Fragment, null,
        React.createElement(Retained, { usePanelInfo }),
        active === 'seal-harness-projects' ? React.createElement(Seat) : React.createElement('button', null, '其他功能'))
    }
    const select = async id => act(async () => { activePanelId = id; listeners.forEach(listener => listener()) })
    const account = async id => act(async () => { events.onmessage({ data: JSON.stringify({ channel: 'project:account-changed', payload: { accountId: id, epoch: id === 'a' ? 1 : 2 } }) }) })
    root = createRoot(document.querySelector('main'))
    await act(async () => root.render(React.createElement(Shell)))
    await account('a')
    assert.equal(mounts, 0, '未进入项目不预加载页面')
    await select('seal-harness-projects')
    const input = document.querySelector('textarea')
    input.value = '未发送的草稿'
    for (let i = 0; i < 3; i++) {
      await select('other')
      assert.equal(input.isConnected, false, '隐藏页面不参与当前文档焦点与快捷键冒泡')
      assert.equal(releases, 0)
      await select('seal-harness-projects')
      assert.equal(document.querySelector('textarea'), input)
      assert.equal(input.value, '未发送的草稿')
    }
    assert.equal(mounts, 1, '反复切换不重建页面或重新取数')
    await select('other')
    await account(null)
    assert.equal(releases, 1, '隐藏时退出账号仍销毁页面')
    failMount = true
    await account('b')
    await select('seal-harness-projects')
    assert.match(document.body.textContent, /临时连接失败/)
    failMount = false
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '重新加载项目').click())
    assert.equal(mounts, 3)
    assert.equal(document.querySelector('textarea').value, '', '新账号不继承草稿')
    await act(async () => root.unmount())
    root = null
    assert.equal(releases, 2)
  } finally {
    if (root) await act(async () => root.unmount())
    stopConnection?.()
    dom.window.close()
    await rm(output, { recursive: true, force: true })
  }
})
