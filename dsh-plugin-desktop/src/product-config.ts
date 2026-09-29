/** Build-time distribution settings shared by Node and browser bundles. */
export interface DesktopProductConfig {
  readonly name: string
  readonly appId: string
  readonly homeDirectoryName: string
  readonly assetDirectory: string
  readonly updatesEnabled: boolean
  readonly bundle: string | null
  readonly protocolScheme?: string
  readonly identityHomeModule?: string
  readonly setupWizardEnabled?: boolean
}

declare const __DSH_DESKTOP_PRODUCT__: DesktopProductConfig | undefined

export const DESKTOP_PRODUCT_IS_CUSTOM = typeof __DSH_DESKTOP_PRODUCT__ !== 'undefined'

export const DESKTOP_PRODUCT: DesktopProductConfig = Object.freeze(
  typeof __DSH_DESKTOP_PRODUCT__ === 'undefined' ? {
    name: 'DSH Desktop',
    appId: 'ai.deepseek.dsh.desktop',
    homeDirectoryName: '.dsh',
    assetDirectory: '../build/',
    updatesEnabled: true,
    bundle: null,
  } : __DSH_DESKTOP_PRODUCT__,
)

/** Native accessibility title, preserving the original upstream default. */
export const DESKTOP_WINDOW_TITLE = typeof __DSH_DESKTOP_PRODUCT__ === 'undefined'
  ? 'DeepSeek Harness Desktop' : DESKTOP_PRODUCT.name
