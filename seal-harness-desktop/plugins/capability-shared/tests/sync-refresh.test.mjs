import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)

test('需要目录同步的资源页共用知识库同步状态与刷新控件', async () => {
  const panels = { knowledge: 'panel.jsx', store: 'panel.jsx', skills: 'panel.jsx', experts: 'panel.jsx', connectors: 'panel.jsx', agents: 'client.jsx' }
  for (const [name, file] of Object.entries(panels)) {
    const source = await readFile(new URL(`${name}/src/${file}`, root), 'utf8')
    assert.match(source, /<SyncRefresh\b/, `${name} 应使用共享同步刷新控件`)
  }

  const component = await readFile(new URL('../src/sync-refresh.jsx', import.meta.url), 'utf8')
  assert.match(component, /<Icon name="refresh"/)
  assert.doesNotMatch(component, /name=\{[^}]*check/)

  const styles = await readFile(new URL('../src/resource-styles.js', import.meta.url), 'utf8')
  assert.match(styles, /\.resource-sync-state/)
  assert.match(styles, /\.resource-sync-button/)
  assert.match(styles, /resource-sync-button\[data-loading='true'\][^{]*svg/s)
})
