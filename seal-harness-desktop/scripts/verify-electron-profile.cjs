const { pathToFileURL } = require('node:url')
const { mkdtempSync, realpathSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')

if (!process.versions.electron) throw new Error('Profile 验证必须由 Electron 的 Node 模式启动')
// 产品数据库按基础 Home 打开；临时 Profile 本身不足以隔离真实账号数据。
const temporaryRoot = realpathSync(tmpdir())
const home = mkdtempSync(join(temporaryRoot, 'seal-electron-profile-'))
process.env.DSH_HOME = home
// 模拟真实主进程：不把父进程的启动标志泄漏给 MCP，验证 provider 自己设置子进程环境。
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete process.env[key]
}
import(pathToFileURL(process.argv[2]).href).catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  const target = realpathSync(home)
  if (dirname(target) !== temporaryRoot) throw new Error('临时 Home 路径超出验证目录')
  rmSync(target, { recursive: true, force: true })
})
