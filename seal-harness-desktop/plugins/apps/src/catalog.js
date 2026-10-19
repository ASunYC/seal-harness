export const dbx = Object.freeze({
  id: 'dbx', name: 'DBX', description: '数据库工作台：浏览表结构、查询数据，并在会话中使用 MCP 工具。',
  version: '0.6.48', mcpVersion: '0.4.124',
  source: 'https://github.com/t8y2/dbx', license: 'Apache-2.0',
})

// 官方 release asset 摘要，固定版本；应用和 MCP 的发布标签分别管理。
export function dbxArtifacts(platform = process.platform, arch = process.arch) {
  if (platform !== 'win32' || !['x64', 'arm64'].includes(arch)) throw new Error('DBX 首版仅支持 Windows x64 / ARM64。')
  const desktop = {
    x64: 'd46609bb6918ea67c1ab5f77bedf28c1cbeb1a7e8d27cc43dc6a1b92472641e9',
    arm64: '83b9472fc9525763f0cff87a777c5533a7249806eae0ae2656f4c10c4ea6b848',
  }
  const mcp = {
    x64: 'b81d7b06a15b6bec7cdf447747435e05cef9f18c3ef72b0672aeb23f67204189',
    arm64: 'ad30871d0503d6b4227e68438a501911e397323dc4ccefee8491b68f2a3f867c',
  }
  return [
    { kind: 'desktop', url: `${dbx.source}/releases/download/v${dbx.version}/DBX_${dbx.version}_${arch}-portable.zip`, sha256: desktop[arch], executable: 'DBX.exe' },
    { kind: 'mcp', url: `${dbx.source}/releases/download/packages-v${dbx.mcpVersion}/dbx-mcp-win32-${arch}.zip`, sha256: mcp[arch], executable: 'dbx-mcp.exe' },
  ]
}
