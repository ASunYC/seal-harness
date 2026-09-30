import test from 'node:test'
import assert from 'node:assert/strict'
import { createNavigationState } from '../src/model.js'

test('home resource registry preserves order and falls back when selected plugin unloads', () => {
  const navigation = createNavigationState()
  let changes = 0
  const unsubscribe = navigation.subscribe(() => changes++)
  const offSkills = navigation.register({ id: 'skills', label: '技能', order: 30, icon: 'skills', Panel() {} })
  const offExperts = navigation.register({ id: 'experts', label: '专家', order: 20, icon: 'experts', Panel() {} })
  assert.deepEqual(navigation.getSnapshot().entries.map(entry => entry.id), ['experts', 'skills'])
  navigation.select('skills')
  assert.equal(navigation.getSnapshot().selectedId, 'skills')
  assert.throws(() => navigation.select('missing'), /未加载/)
  offSkills()
  assert.equal(navigation.getSnapshot().selectedId, null)
  offExperts()
  assert.deepEqual(navigation.getSnapshot().entries, [])
  assert.equal(changes, 5)
  unsubscribe()
  navigation.dispose()
})
