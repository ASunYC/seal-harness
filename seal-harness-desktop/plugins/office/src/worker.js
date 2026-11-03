import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'

// 此处理器没有网络或 AI 提供商；导入文件中的 URL 不会被主动访问。
globalThis.fetch = () => { throw new Error('Network is unavailable in local Office processing') }
const core = createRequire(import.meta.url)('../lib/genoffice-core.cjs')
try {
  const { action, kind, bytes, content, updates } = workerData
  if (!['create','inspect','edit'].includes(action)) throw new Error('Unknown operation')
  const output = action === 'create' ? await core.create(kind, content)
    : action === 'edit' ? await core.edit(kind, bytes, updates) : bytes
  const view = await core.inspect(kind, output)
  parentPort.postMessage({ ok: true, bytes: action === 'inspect' ? undefined : output, view })
} catch (error) {
  if (error.code === 'readOnlyDocument') parentPort.postMessage({ ok: false, code: 'readOnlyDocument', message: '文档包含编辑保护，当前只读；没有更改文件。' })
  else parentPort.postMessage({ ok: false, message: '无法处理该文档：格式、内容或资源限制不符合当前本地引擎要求。' })
}
