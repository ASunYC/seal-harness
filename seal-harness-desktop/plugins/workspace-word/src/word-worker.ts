import { parseDocx } from './vendor/office/docx-engine/parse.ts'
import { saveDocx, type ParsedDocFull, type SaveBlock } from './vendor/office/docx-engine/patch.ts'

const endpoint = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

type WorkerRequest = { id: number; kind: 'parse'; bytes: Uint8Array }
  | { id: number; kind: 'serialize'; blocks: SaveBlock[] }
type WorkerResponse = { id: number; kind: 'parsed'; document: object }
  | { id: number; kind: 'serialized'; bytes: Uint8Array }
  | { id: number; kind: 'error'; message: string }

let source: ParsedDocFull | undefined
let busy = false
endpoint.onmessage = event => {
  const request = event.data
  if (!request || !Number.isSafeInteger(request.id) || busy) {
    endpoint.postMessage({ id: request?.id ?? 0, kind: 'error', message: '编辑器正忙，请稍后重试。' })
    return
  }
  busy = true
  void (async () => {
    try {
      if (request.kind === 'parse') {
        source = undefined
        if (!(request.bytes instanceof Uint8Array) || !request.bytes.length || request.bytes.length > 64 * 1024 * 1024)
          throw new Error('文档超过 64 MiB 或格式无效。')
        source = await parseDocx(request.bytes)
        const { internal: _internal, extras: _extras, ...document } = source
        endpoint.postMessage({ id: request.id, kind: 'parsed', document })
      } else if (request.kind === 'serialize') {
        if (!source || source.protection?.enforced || source.writeProtection?.hash)
          throw new Error('此文档已设置编辑保护。')
        if (!Array.isArray(request.blocks) || request.blocks.length > 20000)
          throw new Error('文档修改结构无效。')
        const bytes = await saveDocx(source, request.blocks, {})
        if (bytes.length > 64 * 1024 * 1024) throw new Error('保存后的文档超过 64 MiB。')
        await parseDocx(bytes)
        endpoint.postMessage({ id: request.id, kind: 'serialized', bytes })
      } else throw new Error('未知文档操作。')
    } catch (error) {
      endpoint.postMessage({ id: request.id, kind: 'error', message: error instanceof Error ? error.message : '文档处理失败。' })
    } finally { busy = false }
  })()
}
