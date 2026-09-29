import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { readDesktopProduct } from '../scripts/product-config.ts'

const homes: string[] = []
const product = {
  name: 'Seal Harness', appId: 'com.seal-harness.desktop', homeDirectoryName: '.seal-harness',
  assetDirectory: './product-assets/', updatesEnabled: false, bundle: 'seal-harness-desktop',
  protocolScheme: 'seal-harness',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

it('validates the build file and rejects unsafe identity and resource paths', () => {
  const home = mkdtempSync(join(tmpdir(), 'desktop-product-'))
  homes.push(home)
  const path = join(home, 'product.json')
  writeFileSync(path, JSON.stringify(product))
  expect(readDesktopProduct(path)).toEqual(product)
  for (const invalid of [
    { name: '' }, { appId: 'invalid/id' }, { homeDirectoryName: '..' },
    { homeDirectoryName: '.data/other' }, { assetDirectory: 'https://example.com/' },
    { bundle: '../another-package' }, { updatesEnabled: 'false' }, { setupWizardEnabled: 'false' },
  ]) {
    writeFileSync(path, JSON.stringify({ ...product, ...invalid }))
    expect(() => readDesktopProduct(path)).toThrow('Invalid Desktop product configuration')
  }
})

it.each([undefined, true, false])('keeps setup wizard policy %s independent of the account Home module', setupWizardEnabled => {
  const home = mkdtempSync(join(tmpdir(), 'desktop-product-'))
  homes.push(home)
  const path = join(home, 'product.json')
  for (const identityHomeModule of [undefined, '@example/identity/account-home']) {
    writeFileSync(path, JSON.stringify({ ...product, identityHomeModule, setupWizardEnabled }))
    const config = readDesktopProduct(path)
    expect(config?.setupWizardEnabled).toBe(setupWizardEnabled)
    expect(config?.identityHomeModule).toBe(identityHomeModule)
  }
})

it('keeps the upstream identities and update policy without a distribution define', async () => {
  const { DESKTOP_PRODUCT } = await import('../src/product-config.ts')
  const { DESKTOP_RELEASE_IDENTITIES } = await import('../src/product-identity.ts')
  expect(DESKTOP_PRODUCT.updatesEnabled).toBe(true)
  expect(DESKTOP_PRODUCT.bundle).toBeNull()
  expect(DESKTOP_PRODUCT.setupWizardEnabled).not.toBe(false)
  expect(DESKTOP_RELEASE_IDENTITIES.stable).toMatchObject({
    productName: 'DSH Desktop', appId: 'ai.deepseek.dsh.desktop', homeDirectoryName: '.dsh',
  })
  expect(DESKTOP_RELEASE_IDENTITIES.beta).toMatchObject({
    productName: 'DSH Desktop Beta', appId: 'ai.deepseek.dsh.desktop.beta', homeDirectoryName: '.dsh-beta',
  })
})

it('preserves explicit product identity across runtime editions and rejects even a direct update check before any request', async () => {
  vi.stubGlobal('__DSH_DESKTOP_PRODUCT__', product)
  vi.resetModules()
  const { DESKTOP_WINDOW_TITLE } = await import('../src/product-config.ts')
  expect(DESKTOP_WINDOW_TITLE).toBe(product.name)
  const { DESKTOP_RELEASE_IDENTITIES } = await import('../src/product-identity.ts')
  const { desktopRecoveryCopy } = await import('../src/recovery-copy.ts')
  const { desktopSetupWizardCopy } = await import('../src/setup-wizard-copy.ts')
  const { checkForDesktopUpdate, checkForStableUpdate } = await import('../src/update-checker.ts')
  expect(DESKTOP_RELEASE_IDENTITIES.stable).toMatchObject({
    productName: product.name, appId: product.appId, homeDirectoryName: product.homeDirectoryName,
  })
  expect(DESKTOP_RELEASE_IDENTITIES.beta).toMatchObject({
    productName: product.name, appId: product.appId, homeDirectoryName: product.homeDirectoryName,
  })
  expect(desktopRecoveryCopy('zh').title).toContain(product.name)
  expect(desktopSetupWizardCopy('en').title).toContain(product.name)
  const request = vi.fn()
  await expect(checkForDesktopUpdate({ currentVersion: '2.0.14', channel: 'stable', request })).rejects.toThrow('updates are disabled')
  await expect(checkForStableUpdate({ currentVersion: '2.0.14-beta.1', request })).rejects.toThrow('updates are disabled')
  expect(request).not.toHaveBeenCalled()
})

it('replays the installed product bundle without adding it to the user profile manifest', async () => {
  const bundle = `desktop-product-test-${randomUUID()}`
  const installed = fileURLToPath(new URL(`../node_modules/${bundle}`, import.meta.url))
  mkdirSync(installed)
  homes.push(installed)
  writeFileSync(join(installed, 'package.json'), JSON.stringify({
    name: bundle, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(installed, 'cordis.patch.yml'), '- id: desktop-updates\n  disabled: true\n- insert:\n    - id: product-brand\n      name: product-brand\n')
  vi.stubGlobal('__DSH_DESKTOP_PRODUCT__', { ...product, bundle })
  vi.resetModules()
  const { ensureDesktopProfile, prepareDesktopProfile } = await import('../src/profile.ts')
  const { composeEntries } = await import('@deepseek-ai/dsh-app-boot')
  const home = mkdtempSync(join(tmpdir(), 'desktop-product-profile-'))
  homes.push(home)
  const dir = ensureDesktopProfile(home)
  const manifest = readFileSync(join(dir, 'package.json'), 'utf8')
  for (let reload = 0; reload < 2; reload++) {
    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])
    expect(rows.find(row => row.id === 'desktop-updates')?.disabled).toBe(true)
    expect(rows.filter(row => row.id === 'product-brand')).toHaveLength(1)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest)
  }
})
