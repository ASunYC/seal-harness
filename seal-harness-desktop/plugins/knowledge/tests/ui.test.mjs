import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
async function bundle(t) {
  const outDir = await mkdtemp(join(tmpdir(), 'knowledge-ui-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
  await build({ config: false, cwd: fileURLToPath(new URL('..', import.meta.url)), entry: { panel: 'src/panel.jsx', client: 'src/client.jsx' }, outDir, format: 'cjs', platform: 'browser', dts: false, deps: { neverBundle: [/^react(?:-dom)?(?:\/|$)/] }, define: { 'process.env.NODE_ENV': JSON.stringify('development') }, splitting: false })
  await symlink(dirname(dirname(require.resolve('react/package.json'))), join(outDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const load = async name => createRequire(join(outDir, 'entry.cjs'))(`./${name}.cjs`)
  return { panel: await load('panel'), client: await load('client') }
}

test('React library renders real collection/files/search/evidence/sharing/forms and native draft append preserves the existing editor', async t => {
  const { panel, client } = await bundle(t)
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const old = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT, FormData: globalThis.FormData }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const { createRoot } = await import('react-dom/client')
  const calls = [], group = { id: 'g', name: '真实资料集', categories: ['office'], fileCount: 1, queryableDocumentCount: 1, revision: 3, lifecycle: 'ready', conversationReady: true, installable: true, visibility: 'private', access: 'owner', updatedAt: '2026-09-26T00:00:00Z' }
  let grantRole = 'viewer', hasGrant = true, revoked = false
  let configuration = { activeServiceId: 'default', services: [{ id: 'default', name: 'Default service', targetType: 'standalone', baseUrl: 'http://localhost/', builtIn: true }] }
  const api = async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'configuration') return configuration
    if (action === 'saveService') { configuration = { ...configuration, services: [...configuration.services, { ...payload, id: 'second', builtIn: false }] }; return configuration }
    if (action === 'activateService') { configuration = { ...configuration, activeServiceId: payload.serviceId }; return configuration }
    if (action === 'status') return { targetType: 'standalone' }
    if (action === 'list') return { items: [group], installations: [{ groupId: 'g', status: 'active' }] }
    if (action === 'detail') return { group, files: [{ id: 'f', fileName: 'source.txt', sizeBytes: 1024, status: 'ready' }] }
    if (action === 'search') return { citations: [{ groupId: 'g', fileId: 'f', fileName: 'source.txt', chunkId: 'c', generation: 'gen', excerpt: '检索原文', score: 1 }] }
    if (action === 'read') return { fileName: 'source.txt', sections: [{ sectionId: 's', text: '完整原文' }], complete: true }
    if (action === 'grants') return { owner: { subject: 'owner', displayName: '资料所有者' }, grants: hasGrant ? [{ id: 'member', principal: { issuer: 'agent-earth-platform', subject: 'alice', displayName: 'Alice' }, role: grantRole }] : [], visibility: 'private' }
    if (action === 'grant') { grantRole = payload.role; return {} }
    if (action === 'revokeGrant') { hasGrant = false; return {} }
    if (action === 'revokeShare') { revoked = true; return {} }
    if (action === 'shares') return { items: [{ id: 'share-1', collectionIds: ['g'], expiresAt: new Date(Date.now() + 60000).toISOString(), ...(revoked ? { revokedAt: new Date().toISOString() } : {}) }] }
    if (action === 'share') return { code: 'fixture-share-code-123456', expiresAt: '2026-09-27T00:00:00Z' }
    if (action === 'save') return group
    return {}
  }
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, old); dom.window.close() })
  const click = async text => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert(button, `button ${text}: ${document.querySelector("dialog")?.textContent}`); await act(async () => button.click()) }
  await act(async () => root.render(React.createElement(panel.KnowledgePanel, { api, sessions: () => [{ id: 's1', name: '原生会话' }], refreshSessions: async () => {}, attach: async () => {} })))
  assert(document.body.textContent.includes('真实资料集'))
  const icon = (selector, name, size) => {
    const svg = document.querySelector(`${selector} svg[data-icon-name="${name}"]`)
    assert(svg, `${selector}: ${name}`)
    assert.equal(svg.getAttribute('width'), String(size))
    assert.equal(svg.getAttribute('stroke-width'), '1.55')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
  }
  icon('.collection-catalog-search', 'search', 15)
  icon('.collection-installation-filter summary', 'filter', 15)
  icon('.collection-installation-filter summary', 'chevron-down', 13)
  icon('.collection-installation-filter .is-selected', 'check', 14)
  icon('.capability-featured-scene:first-child', 'scene-office', 22)
  icon('.capability-featured-scene:nth-child(2)', 'scene-development', 22)
  icon('.collection-card__icon', 'grid-3x3', 18)
  icon('.knowledge-service__configure', 'settings', 16)
  icon('.knowledge-service__option.is-selected', 'check', 16)
  await click('详情')
  icon('.collection-detail__icon', 'library', 26)
  icon('.vault-modal__close', 'close', 18)
  await click('资料文件 1')
  icon('.collection-file__icon', 'folder', 18)
  assert(document.body.textContent.includes('source.txt')); assert(document.body.textContent.includes('已就绪'))
  await click('检索')
  const input = document.querySelector('.zz-knowledge-search input')
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '查询'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await act(async () => document.querySelector('.zz-knowledge-search').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert(document.body.textContent.includes('检索原文'))
  await click('读取原文'); assert([...document.querySelectorAll('dialog')].at(-1).textContent.includes('完整原文'))
  await act(async () => [...document.querySelectorAll('dialog button[aria-label="关闭"]')].at(-1).click())
  await click('概览'); await click('生成授权码'); assert.equal(document.querySelector('.knowledge-share__code code').textContent, 'fixture-share-code-123456')
  await click('撤销'); assert.equal(document.querySelector('.knowledge-share__code'), null); assert(document.querySelector('.knowledge-share__history').textContent.includes('已撤销'))
  await act(async () => [...document.querySelectorAll('dialog button[aria-label="关闭"]')].at(-1).click())
  await click('关闭'); await click('新建资料集'); assert(document.querySelector('dialog input[name="name"]')); assert(document.querySelector('dialog select[name="visibility"]'))
  document.querySelector('dialog input[name="name"]').value = 'New collection'
  await act(async () => document.querySelector('dialog form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert(calls.some(row => row.action === 'save' && row.payload.name === 'New collection'))
  await click('关闭'); await act(async () => document.querySelector('.knowledge-service summary').click()); await click('管理知识库服务'); await click('新增独立服务')
  document.querySelector('dialog input[name="name"]').value = 'Second service'
  document.querySelector('dialog input[name="baseUrl"]').value = 'http://second.example/'
  document.querySelector('dialog select[name="targetType"]').value = 'platform'
  await act(async () => document.querySelector('dialog form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert(calls.some(row => row.action === 'saveService' && row.payload.baseUrl === 'http://second.example/'))
  await click('切换使用')
  assert(calls.some(row => row.action === 'activateService' && row.payload.serviceId === 'second'))
  assert(calls.some(row => row.action === 'read' && row.payload.generation === 'gen'))
  await act(async () => [...document.querySelectorAll('dialog button[aria-label="关闭"]')].at(-1).click())
  await click('详情'); assert(document.querySelector('.collection-members').textContent.includes('Alice'))
  await click('改为可编辑'); assert(calls.some(row => row.action === 'grant' && row.payload.role === 'editor'))
  await click('撤销授权'); assert(document.querySelector('.collection-members').textContent.includes('暂无单独授权成员'))
  let released = 0, inserted, opened, accepted = true
  const inputState = { draft: '已有草稿与引用', draftRev: 4 }
  const ctx = { sessions: { retain: () => ({ ready: Promise.resolve({ ctx: { bail: (event, data) => { assert.equal(event, 'slash/input-insert-text'); inserted = data; return accepted } } }), release: () => released++ }) }, conversation: { input: { for: () => ({ state: { getSnapshot: () => inputState } }) } }, uiWorkspace: { openSession: id => { opened = id } } }
  await client.appendKnowledgeReference(ctx, 's1', '资料引用')
  assert.deepEqual(inserted, { text: '\n\n资料引用', span: { start: 7, end: 7, draftRev: 4 } }); assert.equal(opened, 's1'); assert.equal(released, 1)
  accepted = false
  await assert.rejects(client.appendKnowledgeReference(ctx, 's1', '不能插入'), /输入框正在提交/); assert.equal(released, 2)
})

test('source catalog filters, upload confirmation/cancel, and late preview/service results remain isolated', async t => {
  const { panel } = await bundle(t)
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const previous = Object.fromEntries(['window', 'document', 'FormData', 'FileReader', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close() })
  const group = { id: 'office', name: '办公资料集', description: '说明', categories: [], fileCount: 1, queryableDocumentCount: 1, revision: 1, lifecycle: 'ready', conversationReady: true, installable: true, visibility: 'private', access: 'owner', updatedAt: '2026-09-26T00:00:00Z' }
  const other = { ...group, id: 'development', name: '开发资料集', categories: ['office', 'development'] }
  let configuration = { activeServiceId: 'first', services: [{ id: 'first', name: '第一服务', baseUrl: 'http://first.test/', targetType: 'standalone' }, { id: 'second', name: '第二服务', baseUrl: 'http://second.test/', targetType: 'standalone' }] }
  const calls = []
  let previewResolve, uploadResolve, oldListResolve, finishUpload
  const uploadFinished = new Promise(resolve => { finishUpload = resolve })
  let delayPreview = false, delayUpload = false, delayList = false
  const api = async (action, payload, signal) => {
    calls.push({ action, payload, signal })
    if (action === 'status') return { targetType: 'standalone' }
    if (action === 'configuration') return configuration
    if (action === 'activateService') { configuration = { ...configuration, activeServiceId: payload.serviceId }; return configuration }
    if (action === 'list') {
      if (delayList && payload.scope === 'owned') return new Promise(resolve => { oldListResolve = resolve })
      return { items: configuration.activeServiceId === 'second' ? [{ ...group, id: 'new', name: '第二服务资料' }] : payload.scope === 'granted' ? [] : [group, other], installations: [{ groupId: 'office', status: 'active' }] }
    }
    if (action === 'detail') return { group: payload.groupId === 'office' ? group : other, files: [{ id: 'file', fileName: '原文.txt', sizeBytes: 3, status: 'ready' }] }
    if (action === 'preview') return delayPreview ? new Promise(resolve => { previewResolve = resolve }) : { fileName: '原文.txt', content: '预览原文' }
    if (action === 'uploadStart') return delayUpload ? new Promise(resolve => { uploadResolve = resolve }) : { id: 'upload', receivedBytes: 0 }
    if (action === 'uploadChunk') return { receivedBytes: 3 }
    if (action === 'uploadComplete') { finishUpload(); return {} }
    return {}
  }
  const click = async (text, area = document) => { const button = [...area.querySelectorAll('button')].find(node => node.textContent.trim() === text); assert(button, text); await act(async () => button.click()) }
  const closeTop = () => act(async () => [...document.querySelectorAll('dialog button[aria-label="关闭"]')].at(-1).click())
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(panel.KnowledgePanel, { api, sessions: () => [], refreshSessions: async () => {}, attach: async () => {} }))))
  assert.equal(document.querySelectorAll('.collection-card').length, 2)
  assert.deepEqual([...document.querySelectorAll('.collection-scope-tab')].map(tab => [tab.childNodes[0].textContent.trim(), tab.getAttribute('aria-selected')]), [['公开', 'true'], ['个人', 'false'], ['被授权', 'false']])
  assert(document.querySelector('.knowledge-service__name').textContent.includes('第一服务'), 'initial configuration survives strict effect replay')
  assert.deepEqual([...document.querySelectorAll('.capability-featured-scene__count')].map(node => node.textContent), ['1', '1'])
  await act(async () => document.querySelectorAll('.capability-featured-scene')[0].click())
  assert.equal(document.querySelectorAll('.collection-card').length, 1)
  assert(document.querySelector('.collection-card').textContent.includes('办公资料集'), 'empty categories remain in the office scene; development takes precedence over office')
  assert.equal(document.querySelector('.collection-scope-tab.active .tab-count').textContent, '1')
  await act(async () => document.querySelectorAll('.capability-featured-scene')[0].click())
  await act(async () => document.querySelectorAll('.capability-featured-scene')[1].click())
  assert.equal(document.querySelectorAll('.collection-card').length, 1)
  assert(document.querySelector('.collection-card').textContent.includes('开发资料集'))
  await act(async () => document.querySelectorAll('.capability-featured-scene')[1].click())
  await click('已安装')
  assert.equal(document.querySelectorAll('.collection-card').length, 1)
  await click('全部安装状态')
  await click('详情')
  assert(document.querySelector('dialog .collection-detail__facts'))
  assert.equal(document.querySelector('.library-page__content .collection-detail'), null, 'detail is not flattened into the catalog')
  await click('资料文件 1')
  await click('预览')
  assert(document.querySelector('dialog.preview-panel pre').textContent.includes('预览原文'))
  await closeTop()
  await click('导入资料')
  const file = new dom.window.File(['abc'], '新增.txt', { type: 'text/plain' })
  const fileInput = document.querySelector('dialog input[type=file]')
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
  await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
  assert(document.querySelector('.file-queue').textContent.includes('新增.txt'))
  assert.equal(document.querySelector('.upload-zone__icon svg').getAttribute('data-icon-name'), 'arrow-up')
  assert.equal(document.querySelector('.file-queue__remove svg').getAttribute('data-icon-name'), 'close')
  assert.equal(document.querySelector('.file-queue__remove').getAttribute('aria-label'), '移除 新增.txt')
  assert(!calls.some(call => call.action === 'uploadStart'), 'choosing files only stages a queue')
  await act(async () => {
    [...document.querySelectorAll('button')].find(button => button.textContent === '开始上传（1）').click()
    await uploadFinished
  })
  assert(calls.some(call => call.action === 'uploadComplete' && call.payload.uploadId === 'upload'))
  assert(calls.some(call => call.action === 'uploadChunk' && call.payload.base64 === 'YWJj'))
  assert.equal(document.querySelector('dialog[aria-label="上传资料"]'), null)
  await click('导入资料')
  const cancelInput = document.querySelector('dialog input[type=file]')
  Object.defineProperty(cancelInput, 'files', { configurable: true, value: [file] })
  await act(async () => cancelInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
  delayUpload = true
  await click('开始上传（1）')
  await click('取消上传')
  const starts = calls.filter(call => call.action === 'uploadStart')
  assert(starts.at(-1).signal.aborted)
  await act(async () => uploadResolve({ id: 'cancelled-upload', receivedBytes: 0 }))
  assert(!calls.some(call => call.action === 'uploadChunk' && call.payload.uploadId === 'cancelled-upload'))
  assert(calls.some(call => call.action === 'uploadCancel' && call.payload.uploadId === 'cancelled-upload'), 'late upload session is cleaned up after cancellation')
  await closeTop()
  delayPreview = true
  await click('预览')
  await click('关闭')
  await act(async () => previewResolve({ fileName: '迟到.txt', content: '不能重新打开已关闭预览' }))
  assert.equal(document.querySelector('dialog'), null)
  delayList = true
  await act(async () => document.querySelector('button[aria-label="刷新资料集"]').click())
  const oldRequest = calls.filter(call => call.action === 'list' && call.payload.scope === 'owned').at(-1)
  delayList = false
  await act(async () => document.querySelector('.knowledge-service summary').click())
  await act(async () => [...document.querySelectorAll('.knowledge-service__option')].find(button => button.textContent.includes('第二服务')).click())
  assert(oldRequest.signal.aborted)
  await act(async () => oldListResolve({ items: [{ ...group, name: '第一服务迟到资料' }], installations: [] }))
  assert(document.querySelector('.collection-grid').textContent.includes('第二服务资料'))
  assert(!document.body.textContent.includes('第一服务迟到资料'))
})
