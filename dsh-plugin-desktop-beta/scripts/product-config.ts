import { readFileSync } from 'node:fs'
import type { DesktopProductConfig } from '../src/product-config.ts'

/** Validate the distribution file once, before any build writes its output. */
export function readDesktopProduct(path = process.env.DSH_DESKTOP_PRODUCT): DesktopProductConfig | undefined {
  if (path === undefined) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !('name' in value) || typeof value.name !== 'string' || !value.name.trim()
    || !('appId' in value) || typeof value.appId !== 'string' || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value.appId)
    || !('homeDirectoryName' in value) || typeof value.homeDirectoryName !== 'string'
    || !/^\.[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.homeDirectoryName)
    || !('assetDirectory' in value) || typeof value.assetDirectory !== 'string'
    || !/^(?:\.\/|\.\.\/)[a-zA-Z0-9_/-]+\/$/.test(value.assetDirectory)
    || !('updatesEnabled' in value) || typeof value.updatesEnabled !== 'boolean'
    || ('setupWizardEnabled' in value && typeof value.setupWizardEnabled !== 'boolean')
    || ('protocolScheme' in value && (typeof value.protocolScheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(value.protocolScheme)))
    || ('identityHomeModule' in value && (typeof value.identityHomeModule !== 'string'
      || !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value.identityHomeModule)))
    || !('bundle' in value) || (value.bundle !== null && (typeof value.bundle !== 'string'
      || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value.bundle)))) {
    throw new Error(`Invalid Desktop product configuration: ${path}`)
  }
  return {
    name: value.name, appId: value.appId, homeDirectoryName: value.homeDirectoryName,
    assetDirectory: value.assetDirectory, updatesEnabled: value.updatesEnabled, bundle: value.bundle,
    ...('protocolScheme' in value ? { protocolScheme: value.protocolScheme as string } : {}),
    ...('identityHomeModule' in value ? { identityHomeModule: value.identityHomeModule as string } : {}),
    ...('setupWizardEnabled' in value ? { setupWizardEnabled: value.setupWizardEnabled as boolean } : {}),
  }
}

export const desktopProduct = readDesktopProduct()
export const desktopProductDefine = desktopProduct === undefined
  ? {} : { __DSH_DESKTOP_PRODUCT__: JSON.stringify(desktopProduct) }
