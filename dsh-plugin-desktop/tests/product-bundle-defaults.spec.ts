import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { selectProductBundleDefaults } from '../src/product-bundle-defaults.ts'

const addon = 'fixture-product-addon'
const defaults: PatchOptions[] = [{ insert: [{ id: 'fixture-addon', name: addon, config: { telemetry: false } }] }]
const homes: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

it('adds the default only to a profile that does not already own fixture add-on', () => {
  const profile = { layers: [], patches: [] }
  const selected = selectProductBundleDefaults(defaults, profile, new Set())
  expect(composeEntries([selected])).toEqual(defaults[0]?.insert)
  expect(defaults[0]?.insert).toHaveLength(1)
  expect(profile).toEqual({ layers: [], patches: [] })
})

it('keeps the existing user bundle, its configuration and its explicit telemetry choice', () => {
  const user = [{ insert: [{ id: 'fixture-addon', name: addon, config: { telemetry: true, tools: false } }] }]
  const profile = { layers: [{ packageName: addon }], patches: [] }
  const selected = selectProductBundleDefaults(defaults, profile, new Set())
  expect(composeEntries([selected, user])).toEqual(user[0]?.insert)
  expect(composeEntries([selectProductBundleDefaults(defaults, profile, new Set()), user])).toEqual(user[0]?.insert)
})

it('honors explicit bundle disable state without inserting a fallback', () => {
  expect(composeEntries([selectProductBundleDefaults(defaults, { layers: [], patches: [] }, new Set([addon]))])).toEqual([])
})

it('does not duplicate a manually inserted plugin and preserves its disabled state', () => {
  const user: PatchOptions[] = [{ insert: [{ id: 'custom-addon', name: addon, disabled: true, config: { telemetry: true } }] }]
  const selected = selectProductBundleDefaults(defaults, { layers: [], patches: user }, new Set())
  expect(composeEntries([selected, user])).toEqual(user[0]?.insert)
})

it('applies user disable/config patches after a new default on repeated startup', () => {
  const user: PatchOptions[] = [{ id: 'fixture-addon', disabled: true, config: { telemetry: true } }]
  const profile = { layers: [], patches: user }
  const expected = [{ id: 'fixture-addon', name: addon, disabled: true, config: { telemetry: true } }]
  for (let generation = 0; generation < 3; generation++) {
    expect(composeEntries([selectProductBundleDefaults(defaults, profile, new Set()), user])).toEqual(expected)
  }
  expect(user).toEqual([{ id: 'fixture-addon', disabled: true, config: { telemetry: true } }])
})

it('does not treat an unrelated bundle as fixture add-on and keeps other product defaults', () => {
  const patch: PatchOptions[] = [{ insert: [{ id: 'fixture-addon', name: addon }, { id: 'brand', name: 'product-brand' }] }]
  const result = selectProductBundleDefaults(patch, { layers: [{ packageName: addon }], patches: [] }, new Set())
  expect(composeEntries([result])).toEqual([{ id: 'brand', name: 'product-brand' }])
  expect(patch[0]?.insert).toHaveLength(2)
})

it('prepares an existing on-disk Profile twice without changing its data or explicit settings', async () => {
  const home = mkdtempSync(join(tmpdir(), 'product-bundle-profile-'))
  homes.push(home)
  const product = join(home, 'fixture-product')
  mkdirSync(product)
  writeFileSync(join(product, 'package.json'), JSON.stringify({ name: 'fixture-product', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(product, 'cordis.patch.yml'), JSON.stringify(defaults))
  // 用临时绝对路径替代包解析锚点；只组合假插件，不加载任何第三方插件代码。
  vi.stubGlobal('__DSH_DESKTOP_PRODUCT__', { name: 'Fixture', appId: 'test.fixture', homeDirectoryName: '.fixture', assetDirectory: './assets/', updatesEnabled: false, bundle: product })
  vi.resetModules()
  const { prepareDesktopProfile } = await import('../src/profile.ts')
  const initial = prepareDesktopProfile('1', home, 'win32')
  expect(composeEntries([initial.patches]).filter(row => row.name === addon)).toHaveLength(1)
  const manifestPath = join(initial.profile.dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles.push(addon)
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const userPackage = join(initial.profile.dir, 'node_modules', addon)
  mkdirSync(userPackage, { recursive: true })
  writeFileSync(join(userPackage, 'package.json'), JSON.stringify({ name: addon, version: '0.0.1', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(userPackage, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'fixture-addon', name: addon, config: { telemetry: true, tools: false } }] }]))
  const userPatch = JSON.stringify([{ id: 'fixture-addon', disabled: true, config: { telemetry: true } }])
  writeFileSync(initial.profile.patchPath, userPatch)
  const data = join(home, 'existing-user-data.sqlite')
  writeFileSync(data, 'unchanged sentinel; not a real database')
  const beforeManifest = readFileSync(manifestPath, 'utf8')
  for (let generation = 0; generation < 2; generation++) {
    const prepared = prepareDesktopProfile('1', home, 'win32')
    const rows = composeEntries([prepared.patches]).filter(row => row.name === addon)
    // include 的显式 config patch 替换整段配置；保持框架原有语义。
    expect(rows).toEqual([{ id: 'fixture-addon', name: addon, disabled: true, config: { telemetry: true } }])
    expect(readFileSync(manifestPath, 'utf8')).toBe(beforeManifest)
    expect(readFileSync(initial.profile.patchPath, 'utf8')).toBe(userPatch)
    expect(readFileSync(data, 'utf8')).toBe('unchanged sentinel; not a real database')
  }
  // 来源损坏必须明确失败，不用产品默认插件掩盖错误；修复后能恢复。
  const patch = join(userPackage, 'cordis.patch.yml')
  const before = readFileSync(patch, 'utf8')
  writeFileSync(patch, '{invalid')
  expect(() => prepareDesktopProfile('1', home, 'win32')).toThrow()
  expect(readFileSync(initial.profile.patchPath, 'utf8')).toBe(userPatch)
  expect(readFileSync(data, 'utf8')).toBe('unchanged sentinel; not a real database')
  writeFileSync(patch, before)
  expect(composeEntries([prepareDesktopProfile('1', home, 'win32').patches]).filter(row => row.name === addon)).toHaveLength(1)
})
