import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktop, desktopRequire, product, productPlugins, productRoot } from './build.mjs'

const importDesktop = file => import(pathToFileURL(join(desktop, 'lib', file)))
const receipt = JSON.parse(readFileSync(join(desktop, 'lib/product-build.json'), 'utf8'))
assert.equal(receipt.appId, product.appId, '请先 corepack yarn seal-harness:build')
const { prepareDesktopProfile } = await importDesktop('profile.js')
assert.equal(JSON.parse(readFileSync(desktopRequire.resolve('@deepseek-ai/dsh-web-app/package.json'), 'utf8')).version, '0.1.7-alpha.2')
const { composeEntries } = await import(pathToFileURL(desktopRequire.resolve('@deepseek-ai/dsh-app-boot')))
const { checkForDesktopUpdate } = await importDesktop('update-checker.js')
let requests = 0
await assert.rejects(checkForDesktopUpdate({ currentVersion: '1.0.0', channel: 'stable', request: async () => { requests++; throw new Error('不应发送更新请求') } }), /updates are disabled/)
assert.equal(requests, 0)

const home = mkdtempSync(join(tmpdir(), 'seal-harness-product-check-'))
try {
  const first = prepareDesktopProfile('1', home)
  const rows = composeEntries([first.patches])
  assert.equal(rows.find(row => row.id === 'seal-harness-brand')?.name, 'seal-harness-desktop')
  for (const folder of productPlugins) {
    assert.equal(rows.find(row => row.id === `seal-harness-${folder}`)?.name, `@seal-harness/${folder}`)
    assert.equal(rows.filter(row => row.id === `seal-harness-${folder}`).length, 1)
    assert.ok(readFileSync(desktopRequire.resolve(`@seal-harness/${folder}`), 'utf8').length > 0)
    if (folder !== 'project-agent') {
      assert.equal(JSON.parse(readFileSync(desktopRequire.resolve(`@seal-harness/${folder}/package.json`), 'utf8')).dsh.client.platform, 'web')
      assert.ok(readFileSync(desktopRequire.resolve(`@seal-harness/${folder}/client`), 'utf8').includes(`@seal-harness/${folder}`))
    }
  }
  assert.equal(rows.filter(row => row.id === 'agent').length, 1)
  assert.equal(rows.find(row => row.id === 'agent')?.disabled, true)
  assert.equal(rows.filter(row => row.id === 'seal-harness-agent-registry').length, 1)
  assert.equal(rows.find(row => row.id === 'seal-harness-agent-registry')?.name, '@seal-harness/agents/registry')
  assert.notEqual(rows.find(row => row.id === 'seal-harness-agent-registry')?.disabled, true)
  assert.ok(readFileSync(desktopRequire.resolve('@seal-harness/agents/registry'), 'utf8').length > 0)
  assert.equal(rows.find(row => row.id === 'ui-brand-official')?.disabled, true)
  assert.equal(rows.find(row => row.id === 'desktop-updates')?.disabled, true)
  assert.equal(rows.find(row => row.id === 'ui-sidebar-browser')?.disabled, false)
  const profileManifest = join(first.profile.dir, 'package.json')
  const before = readFileSync(profileManifest, 'utf8')
  const second = prepareDesktopProfile('1', home)
  assert.equal(readFileSync(profileManifest, 'utf8'), before)
  assert.equal(composeEntries([second.patches]).filter(row => row.id === 'seal-harness-brand').length, 1)
  assert.equal(JSON.parse(before).dsh.profile.bundles.includes('seal-harness-desktop'), false)
  const installed = desktopRequire.resolve('seal-harness-desktop/package.json')
  assert.equal(JSON.parse(readFileSync(installed, 'utf8')).dsh.client.platform, 'web')
  for (const file of ['app-icon.png', 'tray-iconTemplate.png']) {
    const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
    assert.equal(hash(join(desktop, 'lib/product-assets', file)), hash(join(productRoot, 'assets', file)))
  }
  process.stdout.write(`Seal Harness验证通过：品牌及${productPlugins.length}个业务插件、重复Profile组合、资源与零更新请求。\n`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
