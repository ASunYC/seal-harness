/** Build-time distribution settings shared by Node and browser bundles. */
export interface DesktopProductConfig {
  readonly name: string
  readonly version?: string
  readonly appId: string
  readonly homeDirectoryName: string
  readonly assetDirectory: string
  readonly updatesEnabled: boolean
  readonly bundle: string | null
  readonly protocolScheme?: string
  readonly identityHomeModule?: string
  readonly setupWizardEnabled?: boolean
  readonly isolatedHost?: boolean
  readonly rendererBootTimeoutMs?: number
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

/** 产品冷启动包含首次页面与插件加载；普通 Desktop 保持原来的截止时间。 */
export const DESKTOP_RENDERER_BOOT_TIMEOUT_MS = DESKTOP_PRODUCT.rendererBootTimeoutMs ?? 30_000
