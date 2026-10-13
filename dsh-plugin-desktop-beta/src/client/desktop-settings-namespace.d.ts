import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

/** Desktop settings copy shared with consumers that import only the section. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop.settings': DesktopSettingsLocaleKey
  }
}
