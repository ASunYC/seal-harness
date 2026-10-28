import { z } from 'zod'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u)
const named = z.strictObject({ id: id.optional(), name: z.string().trim().min(1).max(120), description: z.string().max(4000).default(''), embeddingModelId: id.optional() })
const baseInput = z.strictObject({ baseId: id })
const documentInput = z.strictObject({ documentId: id })
const lists = envelope => {
  const items = Array.isArray(envelope?.data) ? envelope.data : envelope?.data?.items
  if (!Array.isArray(items)) throw new Error('WeKnora 列表响应无效，请检查服务版本。')
  return items
}
const route = value => encodeURIComponent(value)
const baseFields = ['id', 'name', 'description', 'embedding_model_id']
const documentFields = ['id', 'title', 'file_name', 'parse_status', 'file_type', 'error_message']
const project = (value, fields, requiredId = true) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (requiredId && typeof value.id !== 'string')) throw new Error('WeKnora 资源响应无效，请检查服务版本。')
  return Object.fromEntries(fields.filter(key => typeof value[key] === 'string' || (typeof value[key] === 'number' && Number.isFinite(value[key]))).map(key => [key, value[key]]))
}

export function createKnowledgeService(weknora) {
  return Object.freeze({
    async status(input = {}) { z.strictObject({}).parse(input); return weknora.status() },
    async bases(input = {}, signal) { z.strictObject({}).parse(input); return { items: lists(await weknora.request('/knowledge-bases', { signal })).map(value => project(value, baseFields)) } },
    async saveBase(input, signal) {
      const data = named.parse(input)
      const body = { name: data.name, description: data.description }
      if (!data.id) { body.type = 'document'; if (data.embeddingModelId) body.embedding_model_id = data.embeddingModelId }
      const value = await weknora.request(data.id ? `/knowledge-bases/${route(data.id)}` : '/knowledge-bases', { method: data.id ? 'PUT' : 'POST', body, signal })
      return { item: value.data ? project(value.data, baseFields) : null }
    },
    async deleteBase(input, signal) { const { baseId } = baseInput.parse(input); await weknora.request(`/knowledge-bases/${route(baseId)}`, { method: 'DELETE', signal }); return { deleted: true } },
    async models(input = {}, signal) {
      z.strictObject({}).parse(input)
      return { items: lists(await weknora.request('/models', { signal })).filter(model => String(model?.type).toLowerCase().includes('embedding')).map(value => project(value, ['id', 'name', 'type'])) }
    },
    async documents(input, signal) {
      const data = baseInput.extend({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }).parse(input)
      const query = new URLSearchParams({ page: String(data.page), page_size: String(data.pageSize) })
      const value = await weknora.request(`/knowledge-bases/${route(data.baseId)}/knowledge?${query}`, { signal })
      const items = lists(value).map(item => project(item, documentFields))
      const total = Number(value.total ?? value.total_count ?? value.pagination?.total ?? value.data?.total ?? items.length)
      return { items, total: Number.isFinite(total) && total >= 0 ? total : items.length, page: data.page, pageSize: data.pageSize }
    },
    async importText(input, signal) {
      const data = baseInput.extend({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(2 * 1024 * 1024) }).parse(input)
      const value = await weknora.request(`/knowledge-bases/${route(data.baseId)}/knowledge/manual`, { method: 'POST', body: { title: data.title, content: data.content, status: 'publish' }, signal })
      return { item: value.data ? project(value.data, documentFields) : null }
    },
    async upload(input, signal) {
      const data = baseInput.extend({ fileName: z.string().trim().min(1).max(255).regex(/^[^/\\\x00]+$/u), mimeType: z.string().max(120).default('application/octet-stream'), data: z.string().min(1).max(24 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).parse(input)
      const bytes = Buffer.from(data.data, 'base64')
      if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw new Error('单文件大小须为 1 字节至 16 MiB。')
      const formData = new FormData()
      formData.append('file', new Blob([bytes], { type: data.mimeType }), data.fileName)
      const value = await weknora.request(`/knowledge-bases/${route(data.baseId)}/knowledge/file`, { method: 'POST', formData, signal })
      return { item: value.data ? project(value.data, documentFields) : null }
    },
    async readDocument(input, signal) {
      const { documentId } = documentInput.parse(input)
      const [document, chunks] = await Promise.all([
        weknora.request(`/knowledge/${route(documentId)}`, { signal }),
        weknora.request(`/chunks/${route(documentId)}?page=1&page_size=50`, { signal }),
      ])
      const items = lists(chunks).map(item => project(item, ['id', 'content', 'chunk_index'], false))
      const total = Number(chunks.total ?? items.length)
      return { item: project(document.data, documentFields), chunks: items, total: Number.isFinite(total) && total >= 0 ? total : items.length }
    },
    async deleteDocument(input, signal) { const { documentId } = documentInput.parse(input); await weknora.request(`/knowledge/${route(documentId)}`, { method: 'DELETE', signal }); return { deleted: true } },
    async reparse(input, signal) { const { documentId } = documentInput.parse(input); await weknora.request(`/knowledge/${route(documentId)}/reparse`, { method: 'POST', body: {}, signal }); return { accepted: true } },
    async search(input, signal) {
      const data = baseInput.extend({ query: z.string().trim().min(1).max(4000) }).parse(input)
      const value = await weknora.request('/knowledge-search', { method: 'POST', body: { query: data.query, knowledge_base_ids: [data.baseId] }, signal })
      return { items: lists(value).map(item => project(item, ['id', 'knowledge_id', 'knowledge_title', 'title', 'content', 'score'], false)) }
    },
  })
}
