import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { officeSourceCommit, stageOfficeBundle, verifyOfficeBundle } from './office-bundle.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'office-bundle-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { 'dsh-univer-office': '0.3.9' } }))
  writeFileSync(join(root, 'yarn.lock'), '"dsh-univer-office@npm:0.3.9":\n  version: 0.3.9\n')
  const desktop = join(root, 'desktop')
  const product = join(desktop, 'node_modules/seal-harness-desktop')
  mkdirSync(product, { recursive: true })
  writeFileSync(join(product, 'package.json'), JSON.stringify({ dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  const source = join(root, 'node_modules/dsh-univer-office')
  const files = ['LICENSE', 'README.md', 'README.zh-CN.md', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'artifacts/gateway.cjs', 'artifacts/unit-content-worker.mjs', 'artifacts/collaboration-runtime-worker.mjs', 'artifacts/viewer/index.html', 'artifacts/render-machine/index.html', 'docs/readme.md', 'skills/SKILL.md', 'scripts/telemetry-entry.mjs']
  for (const file of files) {
    const path = join(source, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'synthetic test fixture; contains no third-party runtime or license')
  }
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'dsh-univer-office', version: '0.3.9', dependencies: { dep: '1.0.0' } }))
  writeFileSync(join(source, 'lib/build-info.json'), JSON.stringify({ commit: officeSourceCommit }))
  const dependency = join(root, 'node_modules/dep')
  mkdirSync(dependency, { recursive: true })
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }))
  writeFileSync(join(dependency, 'index.js'), 'export default 42')
  writeFileSync(join(dependency, '.npmrc'), 'synthetic private config must not be copied')
  writeFileSync(join(source, '.env'), 'synthetic private config must not be copied')
  return { root, desktop, product, source, destination: join(desktop, 'node_modules/dsh-univer-office') }
}

test('装配固定 Office 依赖、默认禁用遥测，重复装配不重复插入且保留用户数据', t => {
  const f = fixture(t)
  const userFile = join(f.root, 'user-data.sqlite')
  writeFileSync(userFile, 'existing user data')
  stageOfficeBundle(f.root, f.desktop, f.product)
  verifyOfficeBundle(f.destination)
  assert.equal(readFileSync(join(f.destination, 'node_modules/dep/index.js'), 'utf8'), 'export default 42')
  assert.equal(existsSync(join(f.destination, '.env')), false)
  assert.equal(existsSync(join(f.destination, 'node_modules/dep/.npmrc')), false)
  stageOfficeBundle(f.root, f.desktop, f.product)
  const manifest = JSON.parse(readFileSync(join(f.product, 'package.json')))
  assert.deepEqual(manifest.dsh.bundle.patch, ['./cordis.patch.yml', './office.patch.yml'])
  assert.equal(manifest.dependencies['dsh-univer-office'], '0.3.9')
  assert.match(readFileSync(join(f.product, 'office.patch.yml'), 'utf8'), /telemetry: false/)
  assert.equal(readFileSync(userFile, 'utf8'), 'existing user data')
})

test('缺失依赖时保留已有 Office 装配和产品配置', t => {
  const f = fixture(t)
  stageOfficeBundle(f.root, f.desktop, f.product)
  const before = readFileSync(join(f.product, 'package.json'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(f.source, 'package.json')))
  manifest.dependencies.missing = '1.0.0'
  writeFileSync(join(f.source, 'package.json'), JSON.stringify(manifest))
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /缺少 Office 运行依赖 missing/)
  verifyOfficeBundle(f.destination)
  assert.equal(readFileSync(join(f.product, 'package.json'), 'utf8'), before)
  assert.equal(existsSync(`${f.destination}.staging`), false)
  delete manifest.dependencies.missing
  writeFileSync(join(f.source, 'package.json'), JSON.stringify(manifest))
  stageOfficeBundle(f.root, f.desktop, f.product)
  verifyOfficeBundle(f.destination)
  assert.equal(readFileSync(join(f.product, 'package.json'), 'utf8'), before)
})

test('未准备或未锁定的Office不改产品manifest、不生成可用配置', t => {
  const f = fixture(t)
  const before = readFileSync(join(f.product, 'package.json'), 'utf8')
  writeFileSync(join(f.root, 'yarn.lock'), '')
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /Office 必须纳入根 Yarn 锁文件/)
  assert.equal(existsSync(f.destination), false)
  assert.equal(existsSync(join(f.product, 'office.patch.yml')), false)
  rmSync(f.source, { recursive: true })
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /Office 随包依赖尚未准备/)
  assert.equal(readFileSync(join(f.product, 'package.json'), 'utf8'), before)
})

test('拒绝错误版本、错误来源提交及工程之外的 profile 链接', t => {
  const f = fixture(t)
  writeFileSync(join(f.source, 'lib/build-info.json'), JSON.stringify({ commit: 'wrong' }))
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /AssertionError/)
  writeFileSync(join(f.source, 'package.json'), JSON.stringify({ name: 'dsh-univer-office', version: '0.4.0' }))
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /AssertionError/)
  const outside = mkdtempSync(join(tmpdir(), 'office-external-profile-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'package.json'), '{}')
  // 只移动本测试创建的目录；不触及真实 profile。
  rmSync(f.source, { recursive: true })
  symlinkSync(outside, f.source, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => stageOfficeBundle(f.root, f.desktop, f.product), /Office 来源必须在工程内部/)
})
