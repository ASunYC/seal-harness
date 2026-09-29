import { DESKTOP_PRODUCT, DESKTOP_PRODUCT_IS_CUSTOM } from './product-config.ts'

/** Stable and Beta identities used to locate each edition's private app data. */
export const DESKTOP_RELEASE_IDENTITIES = Object.freeze({
  stable: Object.freeze({
    releaseChannel: 'stable' as const,
    packageName: 'dsh-plugin-desktop',
    productName: DESKTOP_PRODUCT.name,
    appId: DESKTOP_PRODUCT.appId,
    homeDirectoryName: DESKTOP_PRODUCT.homeDirectoryName,
  }),
  beta: Object.freeze({
    releaseChannel: 'beta' as const,
    packageName: 'dsh-plugin-desktop-beta',
    productName: DESKTOP_PRODUCT_IS_CUSTOM ? DESKTOP_PRODUCT.name : `${DESKTOP_PRODUCT.name} Beta`,
    appId: DESKTOP_PRODUCT_IS_CUSTOM ? DESKTOP_PRODUCT.appId : `${DESKTOP_PRODUCT.appId}.beta`,
    homeDirectoryName: DESKTOP_PRODUCT_IS_CUSTOM ? DESKTOP_PRODUCT.homeDirectoryName : `${DESKTOP_PRODUCT.homeDirectoryName}-beta`,
  }),
})

export type DesktopProductIdentity = typeof DESKTOP_RELEASE_IDENTITIES[keyof typeof DESKTOP_RELEASE_IDENTITIES]

/** Beta release-channel identities that must stay aligned with electron-builder. */
export const DESKTOP_PRODUCT_IDENTITY = DESKTOP_RELEASE_IDENTITIES.beta
export const OTHER_DESKTOP_PRODUCT_IDENTITY = DESKTOP_RELEASE_IDENTITIES.stable
export const DESKTOP_PACKAGE_NAME = DESKTOP_PRODUCT_IDENTITY.packageName
export const STABLE_DESKTOP_PACKAGE_NAME = OTHER_DESKTOP_PRODUCT_IDENTITY.packageName
export const DESKTOP_PRODUCT_NAME = DESKTOP_PRODUCT_IDENTITY.productName
export const DESKTOP_APP_ID = DESKTOP_PRODUCT_IDENTITY.appId
export const DESKTOP_RELEASE_CHANNEL = DESKTOP_PRODUCT_IDENTITY.releaseChannel
export const DESKTOP_HOME_DIRECTORY_NAME = DESKTOP_PRODUCT_IDENTITY.homeDirectoryName

/** Both Desktop package identities are launcher-owned, never Profile plugins. */
export const DESKTOP_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  STABLE_DESKTOP_PACKAGE_NAME,
  DESKTOP_PACKAGE_NAME,
])
