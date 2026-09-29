import { z } from 'zod'

const id = z.string().trim().min(1).max(256)
const text = z.string().trim().min(1).max(8000)
export const groupSchema = z.object({
  id, name: z.string(), description: z.string().optional(), categories: z.array(z.string()),
  visibility: z.enum(['private', 'organization']), fileCount: z.number().int().nonnegative(),
  queryableDocumentCount: z.number().int().nonnegative(), conversationReady: z.boolean(),
  revision: z.number().int().positive(), lifecycle: z.enum(['processing', 'ready', 'failed', 'stale', 'archived']),
  analysis: z.object({ status: z.string(), summary: z.string(), topics: z.array(z.string()), keywords: z.array(z.string()), relations: z.array(z.object({ title: z.string(), description: z.string() }).passthrough()), conflicts: z.array(z.object({ title: z.string(), description: z.string() }).passthrough()), gaps: z.array(z.object({ title: z.string(), description: z.string() }).passthrough()) }).passthrough().nullable(),
  installable: z.boolean(), access: z.string().nullable().optional(), updatedAt: z.string(),
}).passthrough()
export const fileSchema = z.object({ id, groupId: id, fileName: z.string(), sizeBytes: z.number().nonnegative(), status: z.enum(['queued', 'processing', 'ready', 'failed']), updatedAt: z.string() }).passthrough()
export const listSchema = z.object({ items: z.array(groupSchema), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative() })
export const referenceSchema = z.object({ groupId: id, fileId: id, chunkId: id, generation: id, scope: z.enum(['section', 'table', 'document']).default('section'), cursor: z.string().max(2048).optional(), maxChars: z.number().int().min(256).max(24000).default(8000) }).strict()
export const searchSchema = z.object({ groupIds: z.array(id).min(1).max(100), query: text, limit: z.number().int().min(1).max(50).default(10) }).strict()
export const navigateSchema = z.object({
  groupId: id, operation: z.enum(['files', 'search', 'outline', 'read', 'head', 'tail', 'evidence']),
  query: text.optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(10).optional(),
  fileId: id.optional(), fileName: z.string().min(1).max(512).optional(), generation: id.optional(),
  sectionId: id.optional(), tableId: id.optional(), chunkId: id.optional(), scope: z.enum(['section', 'table', 'document']).optional(),
  page: z.number().int().positive().optional(), slide: z.number().int().positive().optional(), sheet: id.optional(),
  rowStart: z.number().int().positive().optional(), rowEnd: z.number().int().positive().optional(), cell: z.string().regex(/^[A-Za-z]+[1-9]\d*$/).optional(),
  maxChars: z.number().int().min(1).max(8000).optional(), cursor: z.string().max(2048).optional(),
}).strict()
const group = z.object({ groupId: id }).strict()
const file = z.object({ groupId: id, fileId: id }).strict()
const principal = z.object({ issuer: id, subject: id, displayName: z.string().trim().min(1).max(256).optional() }).strict()
export const schemas = {
  configuration: z.object({}).strict(), saveService: z.object({ id: id.optional(), name: z.string().trim().min(1).max(80), baseUrl: z.string().url(), targetType: z.enum(['platform', 'standalone']) }).strict(), activateService: z.object({ serviceId: id }).strict(), deleteService: z.object({ serviceId: id }).strict(),
  status: z.object({}).strict(), list: z.object({ scope: z.enum(['catalog', 'owned', 'granted', 'public', 'installed']).default('catalog') }).strict(),
  detail: group, archive: group, install: group, uninstall: group, grants: group,
  save: z.object({ groupId: id.optional(), name: z.string().trim().min(1).max(256), description: z.string().max(8000).default(''), categories: z.array(z.enum(['office', 'development'])).min(1).max(2), visibility: z.enum(['private', 'organization']) }).strict(),
  grant: z.object({ groupId: id, principal, role: z.enum(['viewer', 'editor']) }).strict(), revokeGrant: z.object({ groupId: id, principal }).strict(),
  shareUsers: z.object({ query: z.string().trim().min(2).max(256) }).strict(),
  preview: file, deleteFile: file, retry: file, download: file,
  uploadStart: z.object({ groupId: id, fileName: z.string().min(1).max(512), mimeType: z.string().max(200), sizeBytes: z.number().int().positive().max(1024 ** 3) }).strict(),
  uploadChunk: z.object({ uploadId: id, offset: z.number().int().nonnegative(), base64: z.string().min(1).max(12 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),
  uploadComplete: z.object({ uploadId: id }).strict(), uploadCancel: z.object({ uploadId: id }).strict(),
  search: searchSchema, read: referenceSchema, navigate: navigateSchema,
  share: z.object({ collectionIds: z.array(id).min(1).max(100) }).strict(), shares: z.object({}).strict(), redeem: z.object({ code: z.string().trim().min(20).max(200) }).strict(), revokeShare: z.object({ shareId: id }).strict(),
}
