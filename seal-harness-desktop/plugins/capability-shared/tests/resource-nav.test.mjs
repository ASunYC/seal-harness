import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('资源页导航贴住内容区顶部且页面变体不重复增加顶距', async () => {
  const shared = await readFile(new URL('../src/resource-styles.js', import.meta.url), 'utf8')
  assert.match(shared, /:is\(\.zz-resource-page\.resource-page-shell,\.zz-resource-page \.resource-page-shell\)\s*\{[^}]*padding:\s*0 clamp\(/s)

  for (const name of ['experts', 'connectors']) {
    const styles = await readFile(new URL(`../../${name}/src/styles.js`, import.meta.url), 'utf8')
    assert.doesNotMatch(styles, new RegExp(`\\.zz-resource-page\\.zz-${name}\\s*\\{[^}]*padding-top`))
  }
})
