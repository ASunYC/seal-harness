import assert from 'node:assert/strict'
import test from 'node:test'
import { connectorDirectory, directoryGroups, sessionSkillDirectory, skillDirectory } from '../src/directory.js'

test('management pages and session selectors use the same system/personal provenance', () => {
  assert.deepEqual(directoryGroups.map(group => group.title), ['系统', '个人'])
  for (const kind of ['store', 'system', 'created', 'local']) {
    const item = { name: kind, origin: { kind } }
    assert.equal(sessionSkillDirectory({ name: kind, source: 'custom' }, new Map([[kind, item]])), skillDirectory(item))
  }
  assert.equal(sessionSkillDirectory({ name: 'native', source: 'bundled' }, new Map()), 'system')
  assert.equal(sessionSkillDirectory({ name: 'dynamic', source: 'runtime' }, new Map()), 'system')
  assert.equal(sessionSkillDirectory({ name: 'workspace', source: 'project-agents' }, new Map()), 'personal')
  assert.equal(connectorDirectory({ catalogId: 'catalog' }), 'system')
  assert.equal(connectorDirectory({ source: { id: 'store-asset' } }), 'system')
  assert.equal(connectorDirectory({ source: null }), 'personal')
  assert.equal(connectorDirectory({ managedApplication: 'dbx' }), 'personal', '沿管理页规则，不因本机应用标记额外猜测来源')
})
