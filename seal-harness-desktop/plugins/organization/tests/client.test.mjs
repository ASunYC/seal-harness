import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { openProductDatabase } from '../../local-data/src/index.js'
import { OrganizationService } from '../src/service.js'

const require = createRequire(import.meta.url)

test('organization page manages company, department and person through the Host service', async t => {
  const home = mkdtempSync(join(tmpdir(), 'seal-organization-ui-'))
  const storage = openProductDatabase(home)
  const now = new Date().toISOString()
  storage.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'Owner', Buffer.alloc(16), Buffer.alloc(64), 'admin', 'active', now, now)
  const service = new OrganizationService({ storage, identity: { getSession: () => ({ accountId: 'owner' }) } })
  const api = async (action, value) => ({
    snapshot: () => service.snapshot(),
    'company/save': () => service.saveCompany(value),
    'department/save': () => service.saveDepartment(value),
    'department/delete': () => service.deleteDepartment(value),
    'person/save': () => service.savePerson(value),
    'person/delete': () => service.deletePerson(value),
  })[action]()
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    storage.close(); rmSync(home, { recursive: true, force: true })
  })
  const loaded = {}
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@seal-harness/organization'); Object.assign(loaded, factory(require)) } } },
    document: dom.window.document,
    AbortController,
  })
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label)
    assert(button, `missing button ${label}`)
    await act(async () => button.click())
  }
  const change = async (input, value) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      Simulate.change(input, { target: { value } })
    })
  }
  await act(async () => root.render(React.createElement(loaded.OrganizationPanel, { api })))
  assert.match(document.body.textContent, /组织架构/)
  await click('公司名称')
  await change(document.querySelector('.seal-org-editor input[required]'), '示例公司')
  await act(async () => document.querySelector('.seal-org-editor').requestSubmit())
  assert.equal(service.snapshot().companyName, '示例公司')
  await click('新建部门')
  await change(document.querySelector('.seal-org-editor input[required]'), '研发部')
  await act(async () => document.querySelector('.seal-org-editor').requestSubmit())
  assert.equal(service.snapshot().departments[0]?.name, '研发部', document.body.textContent)
  await click('新增人员')
  await change(document.querySelector('.seal-org-editor input[required]'), '张三')
  await act(async () => document.querySelector('.seal-org-editor').requestSubmit())
  assert.equal(service.snapshot().people[0].departmentId, service.snapshot().departments[0].id)
  await click('编辑')
  await change(document.querySelector('.seal-org-editor input[required]'), '李四')
  await act(async () => document.querySelector('.seal-org-editor').requestSubmit())
  assert.equal(service.snapshot().people[0].name, '李四')
  await change(document.querySelector('.seal-org-search input'), '李四')
  assert.match(document.querySelector('.seal-org-results').textContent, /李四/)
  await click('删除')
  await act(async () => document.querySelector('.seal-org-confirm .seal-org-danger').click())
  assert.equal(service.snapshot().people.length, 0)
  await change(document.querySelector('.seal-org-search input'), '')
  await click('▦ 研发部0')
  await click('删除部门')
  await act(async () => document.querySelector('.seal-org-confirm .seal-org-danger').click())
  assert.equal(service.snapshot().departments.length, 0)
})
