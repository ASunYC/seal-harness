import { readFileSync } from 'node:fs'

// 原生清单与构建工具使用同一个已安装 Electron ABI，不能把旧版本数字留在打包清单中。
export const ELECTRON_MODULE_ABI = readFileSync(
  new URL('../node_modules/electron/abi_version', import.meta.url), 'utf8',
).trim()
if (!/^\d+$/u.test(ELECTRON_MODULE_ABI)) throw new Error('Installed Electron has an invalid module ABI')
