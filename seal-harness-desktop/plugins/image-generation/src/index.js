import { defineTool } from '@deepseek-ai/dsh-tools'
import { generateImages, editImages, CRED_KEY, getConfig } from './backend.js'
import { ImageGenSchema, ImageEditSchema } from './schema.js'

export const name = '@seal-harness/image-generation'
export const inject = ['tools', 'credentials', 'connection']

function clientMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== 'client-request' || typeof value.rpcId !== 'string' || !value.rpcId
    || typeof value.method !== 'string') throw new Error('Invalid RPC request')
  return value
}

export function apply(ctx) {
  const creds = ctx.get('credentials')
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'seal-harness-image-generation: requests')

  // Settings RPC endpoints for Client to read/write API config
  const rpcHandlers = {
    'image-generation/status': async () => {
      const config = await getConfig(creds)
      return {
        configured: Boolean(config?.apiKey),
        baseURL: config?.baseURL ?? 'https://api.openai.com/v1',
        model: config?.model ?? 'dall-e-3',
      }
    },
    'image-generation/configure': async (payload) => {
      if (!payload || typeof payload !== 'object') throw new Error('Invalid configuration payload')
      await creds.modifyRecord(CRED_KEY, record => {
        const prev = record?.kind === 'grant' ? record.payload : {}
        const next = {
          version: 1,
          baseURL: typeof payload.baseURL === 'string' ? payload.baseURL.trim() : (prev.baseURL ?? 'https://api.openai.com/v1'),
          model: typeof payload.model === 'string' ? payload.model.trim() : (prev.model ?? 'dall-e-3'),
        }
        if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) next.apiKey = payload.apiKey.trim()
        else if (prev.apiKey) next.apiKey = prev.apiKey
        if (payload.clearKey === true) delete next.apiKey
        return { kind: 'grant', payload: next }
      })
      const config = await getConfig(creds)
      return { configured: Boolean(config?.apiKey), baseURL: config?.baseURL, model: config?.model }
    },
  }

  for (const [endpoint, handler] of Object.entries(rpcHandlers)) {
    ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
          return new Response('Expected JSON', { status: 415 })
        let message
        try { message = clientMessage(await request.json()) }
        catch { return new Response('Invalid RPC request', { status: 400 }) }
        if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
        let result
        try { result = { ok: true, value: await handler(message.payload ?? {}) } }
        catch (error) { result = { ok: false, error: { code: 'operationFailed', message: error?.message ?? '操作失败', details: {} } } }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
      },
    })
  }

  ctx.tools.register(defineTool({
    name: 'ImageGen',
    description: 'Generate original images, artwork, product visuals, diagrams, or other raster assets with the configured image provider. Use whenever the user asks to create or generate an image.',
    parameters: ImageGenSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          operation: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                mimeType: { type: 'string' },
                revisedPrompt: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value?.images?.length) return [{ type: 'text', text: '(no images generated)' }]
        return [{ type: 'text', text: value.images.map((img, i) =>
          `Image ${i + 1}: ${img.path}${img.revisedPrompt ? ` (revised: ${img.revisedPrompt})` : ''}`
        ).join('\n') }]
      },
    },
    async execute(args, exec) {
      return generateImages(args, {
        credentials: creds,
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ImageEdit',
    description: 'Edit or transform existing images. Use for requests that modify a visual the user already has. Requires referenced_image_paths from [Image source: ...] attachments, @-attached files, or prior ImageGen results.',
    parameters: ImageEditSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          operation: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                mimeType: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value?.images?.length) return [{ type: 'text', text: '(no edited images)' }]
        return [{ type: 'text', text: value.images.map((img, i) => `Edited image ${i + 1}: ${img.path}`).join('\n') }]
      },
    },
    async execute(args, exec) {
      return editImages(args, {
        credentials: creds,
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
    },
  }))
}
