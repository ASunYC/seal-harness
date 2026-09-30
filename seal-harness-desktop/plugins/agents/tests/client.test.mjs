import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

test('client registers and releases panel, opens DSH session, submits native create and reports service errors', async t => {
  const output = await mkdtemp(join(tmpdir(), 'seal-harness-agents-client-'))
  const cwd = resolve(import.meta.dirname, '..')
  await build({ config: false, cwd, entry: { client: 'src/client.jsx' }, outDir: output, dts: false, format: 'cjs', platform: 'browser', deps: { neverBundle: ['react'] }, outputOptions: { entryFileNames: 'client.cjs' } })
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const timers = new Set()
  const module = { exports: {} }
  runInNewContext(await readFile(join(output, 'client.cjs'), 'utf8'), { module, exports: module.exports, require: createRequire(import.meta.url), document: dom.window.document, URL, navigator: dom.window.navigator, AbortController, setInterval, clearInterval, setTimeout: callback => { timers.add(callback); return callback }, clearTimeout: callback => timers.delete(callback), crypto })
  const slots = [], cleanups = [], calls = [], opened = []
  let failed = false, remoteState = 'running', resourceFailure = false, optionsGate
  const instances = [
    { id: 'native-1', name: '本机助理', native: true, kind: 'autonomous', target: 'local', status: 'running', cwd: '/workspace' },
    { id: 'flow-1', name: '资料流程', kind: 'flow', target: 'local', status: 'ready', port: 43100, access: 'lan', adminUrl: 'http://127.0.0.1:43100/admin/', apiUrl: 'http://127.0.0.1:43100/api/v1/instance', shareUrls: ['http://10.0.0.1:43100'] },
  ]
  const resources = Array.from({ length: 33 }, (_, index) => ({ kind: 'wiki', sourceId: 'same-source', collectionId: `collection-${index}`, version: 'v1', name: `资料 ${index}` }))
  resources.push({ kind: 'skill', sourceId: 'broken', version: 'v1', name: '失效技能', unavailableReason: '文件缺失' })
  const remoteOperation = () => ({ id: 'remote-operation', target: 'remote', state: remoteState, stage: '准备容器', error: remoteState === 'failed' ? '主机空间不足' : null, progress: [{ stage: 'connect', message: '主机连接成功', state: 'succeeded' }, { stage: 'environment', message: '准备容器', state: 'running' }] })
  module.exports.apply({
    sessions: { binding: () => undefined, retain: () => ({ ready: Promise.resolve(), release() {} }) },
    effect: callback => cleanups.push(callback()), uiWorkspace: { openSession: id => opened.push(id) },
    slots: { inject: (_, callback) => callback(), register: (slot, component) => slots.push({ slot, component }) },
    connection: { rpc: { call: async (_, endpoint, payload) => {
      calls.push({ endpoint, payload })
      if (failed) return { ok: false, error: { message: '连接失败，请重试。', code: 'unavailable' } }
      let value = { instances: [] }
      if (endpoint.endsWith('/catalog')) value = { instances, operations: [], notices: [], services: {} }
      if (endpoint.endsWith('/models')) value = [{ connectionId: 'provider-1', remoteModelId: 'model-1', label: '模型一' }]
      if (endpoint.endsWith('/open')) value = { sessionId: 'native-1' }
      if (endpoint.endsWith('/request')) {
        const request = payload.request
        if (request.action === 'options') {
          if (optionsGate) await optionsGate
          value = { available: true, packAvailable: true, dockerInstalled: true }
        }
        if (request.action === 'check-port') value = { available: true }
        if (request.action === 'remote-create' || request.action === 'remote-catalog') value = { operation: remoteOperation() }
        if (request.action === 'resource-options') {
          if (resourceFailure) return { ok: false, error: { message: '资料服务暂不可用' } }
          value = { resources, warnings: [] }
        }
      }
      return { ok: true, value }
    } } },
  })
  const root = createRoot(document.querySelector('main'))
  t.after(async () => { await act(async () => root.unmount()); cleanups.forEach(dispose => dispose?.()); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; await rm(output, { recursive: true, force: true }) })
  const click = async label => { const button = [...document.querySelectorAll('button')].find(item => !item.closest('[hidden]') && (item.getAttribute('aria-label') === label || item.textContent === label)); assert(button, label); await act(async () => button.click()) }
  const fill = async (input, value) => act(async () => {
    const prototype = input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  const submit = async () => act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const choose = async (selector, text) => act(async () => [...document.querySelectorAll(selector)].find(item => item.textContent.includes(text)).click())
  const tick = async () => { const callback = [...timers][0]; assert(callback); timers.delete(callback); await act(callback) }
  assert.equal(slots[1].slot.id, 'seal-harness-agents')
  await act(async () => root.render(React.createElement(slots[0].component)))
  assert.match(document.body.textContent, /本机助理/)
  assert.match(document.querySelector('.resource-sync-state').textContent, /已同步/)
  assert(document.querySelector('button[aria-label="刷新智能体状态"] [data-icon-name="refresh"]'))
  assert.equal(document.querySelectorAll('.overview-stat').length, 4)
  const icon = (selector, name, size) => {
    const svg = document.querySelector(`${selector} svg[data-icon-name="${name}"]`)
    assert(svg, `${selector}: ${name}`)
    assert.equal(svg.getAttribute('width'), String(size))
    assert.equal(svg.getAttribute('stroke-width'), '1.55')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    return svg
  }
  icon('.overview-icon.total', 'agents', 24)
  icon('.type-icon.autonomous', 'thinking', 20)
  assert.equal(icon('[aria-label="停止"]', 'stop', 16).querySelector('rect').getAttribute('fill'), 'currentColor')
  icon('.center-card-name-edit', 'edit', 14)
  assert.equal(document.querySelectorAll('.center-group').length, 2)
  assert.equal(document.querySelector('.center-search'), null)
  await click('打开对话'); assert.deepEqual(opened, ['native-1'])
  await click('新建智能体')
  const choice = [...document.querySelectorAll('.create-types button')].find(item => item.textContent.includes('自主型智能体'))
  await act(async () => choice.click())
  await click('继续')
  const target = [...document.querySelectorAll('.target-choices button')].find(item => item.textContent.includes('发布到本机'))
  icon('.creation-close', 'close', 18)
  icon('.target-choices button:nth-child(2)', 'server', 22)
  await act(async () => target.click())
  icon('.creation-steps .done', 'check', 15)
  assert.equal(document.querySelector('input[type=number]'), null)
  const nameInput = document.querySelector('input[maxlength="80"]')
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(nameInput, '新助理'); nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  const form = document.querySelector('form')
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const create = calls.find(call => call.endpoint.endsWith('/request') && call.payload.request.action === 'create')
  assert.equal(create.payload.target, 'local'); assert.equal(create.payload.kind, 'autonomous'); assert.equal(create.payload.request.input.cwd, ''); assert.equal(create.payload.request.input.name, '新助理')
  assert.equal('port' in create.payload.request.input, false)
  await t.test('rename is inline and returns the native RPC payload', async () => {
    await click('修改本机助理的名称')
    await fill(document.querySelector('.center-card-name-editor input'), '工作助理')
    await click('保存实例名称')
    const rename = calls.find(call => call.payload.request?.action === 'rename')
    assert.equal(rename.payload.request.name, '工作助理')
    assert.equal(document.querySelector('.center-card-name-editor'), null)
  })
  await t.test('flow manager keeps addresses, resource errors and 32-item selection separate from the center', async () => {
    await click('管理实例')
    assert.match(document.querySelector('.za-detail').textContent, /内网共享/)
    icon('.instance-overview .actions button:nth-child(2)', 'external', 16)
    await click('开始对话')
    assert(calls.some(call => call.payload.request?.action === 'open' && call.payload.request.target === 'chat'))
    resourceFailure = true
    await click('选择工作台资源')
    assert.match(document.querySelector('.resource-error').textContent, /资料服务暂不可用/)
    assert.doesNotMatch(document.querySelector('.workflow-resources').textContent, /暂无可添加资源/)
    resourceFailure = false
    await click('重试')
    const choices = [...document.querySelectorAll('.resource-list input')]
    assert.equal(choices.length, 34)
    assert(choices[33].disabled)
    for (const checkbox of choices.slice(0, 32)) await act(async () => checkbox.click())
    assert(choices[32].disabled)
    await click('添加所选资源')
    const install = calls.find(call => call.payload.request?.action === 'install-resources')
    assert.equal(install.payload.request.resources.length, 32)
    assert.equal(install.payload.request.resources[0].collectionId, 'collection-0')
    assert.equal(install.payload.request.resources[31].collectionId, 'collection-31')
    assert.match(document.querySelector('.workflow-resources').textContent, /已添加到流程草稿/)
    await click('返回智能体')
  })
  await t.test('local flow checks its environment before publishing and rechecks the port', async () => {
    await click('新建智能体'); await choose('.create-types button', '流程型'); await click('继续')
    await choose('.target-choices button', '发布到本机')
    assert.match(document.querySelector('.creation-body').textContent, /本机环境已就绪/)
    assert.equal(document.querySelector('input[maxlength="80"]'), null)
    await click('继续')
    const dialog = document.querySelector('[role="dialog"]')
    await fill(dialog.querySelector('select'), JSON.stringify({ connectionId: 'provider-1', remoteModelId: 'model-1' }))
    await submit()
    const flow = calls.find(call => call.payload.kind === 'flow' && call.payload.request?.action === 'create')
    assert.equal(flow.payload.request.input.port, 43101)
    assert.equal(flow.payload.request.input.model.remoteModelId, 'model-1')
    assert(calls.some(call => call.payload.request?.action === 'check-port' && call.payload.request.port === 43101))
    assert.equal(document.querySelector('[role="dialog"]'), null)
  })
  await t.test('platform configuration omits host fields and the type dialog supports Escape', async () => {
    await click('新建智能体')
    assert.equal(document.activeElement, document.querySelector('.create-types button'))
    await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="dialog"]'), null)
    await click('新建智能体'); await choose('.create-types button', '流程型'); await click('继续')
    await choose('.target-choices button', '发布到智枢')
    assert.equal(document.querySelectorAll('.creation-steps li').length, 2)
    assert.equal(document.querySelector('[role="dialog"] select'), null)
    assert.equal(document.querySelector('[role="dialog"] input[type="number"]'), null)
    await submit()
    const platform = calls.find(call => call.payload.request?.action === 'platform-create')
    assert.deepEqual(Object.keys(platform.payload.request.input).sort(), ['name', 'requestId'])
  })
  await t.test('remote publish keeps the wizard open until its operation succeeds', async () => {
    await click('新建智能体'); await choose('.create-types button', '自主型'); await click('继续')
    await choose('.target-choices button', '发布到固定主机')
    const inputs = [...document.querySelectorAll('.creation-body input')]
    for (const [input, value] of inputs.map((input, index) => [input, ['10.0.0.2', '22', 'developer', 'test-only-password'][index]])) await fill(input, value)
    await submit()
    assert.match(document.querySelector('.target-summary').textContent, /10.0.0.2:22/)
    await submit()
    assert.match(document.querySelector('[role="dialog"]').textContent, /真实|准备容器/)
    assert(document.querySelector('[aria-label="关闭新建智能体"]').disabled)
    remoteState = 'failed'; await tick()
    assert.match(document.querySelector('[role="alert"]').textContent, /主机空间不足/)
    assert(document.querySelector('input[maxlength="80"]'))
    remoteState = 'running'; await submit()
    remoteState = 'succeeded'; await tick()
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(timers.size, 0)
  })
  await t.test('local environment check retains dialog focus while busy and Escape closes after it settles', async () => {
    let releaseOptions
    optionsGate = new Promise(resolve => { releaseOptions = resolve })
    await click('新建智能体'); await choose('.create-types button', '流程型'); await click('继续')
    await choose('.target-choices button', '发布到本机')
    const dialog = document.querySelector('[role="dialog"]')
    const escape = async () => act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.activeElement === dialog, true, 'disabled controls must fall back to the dialog itself')
    await escape()
    assert.equal(document.querySelector('[role="dialog"]') === dialog, true, 'busy check cannot close')
    await act(async () => releaseOptions())
    optionsGate = undefined
    assert.match(dialog.textContent, /本机环境已就绪/)
    assert.equal(document.activeElement === dialog, true, 'async completion must not move focus')
    await escape()
    assert.equal(document.querySelector('[role="dialog"]'), null)
  })
  failed = true; await click('刷新智能体状态'); assert.match(document.querySelector('[role="alert"]').textContent, /连接失败/)
  assert.match(document.querySelector('.resource-sync-state').textContent, /未连接/)
})
