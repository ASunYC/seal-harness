import { archiveConflictingElectronLink } from './windows-shell-link.js'

export async function apply(ctx) {
  try {
    await archiveConflictingElectronLink({
      appId: 'com.seal-harness.desktop',
      productName: 'Seal Harness',
    })
  } catch {
    ctx.logger.warn('Seal Harness：无法检查 Windows 开发快捷方式冲突。')
  }
}
