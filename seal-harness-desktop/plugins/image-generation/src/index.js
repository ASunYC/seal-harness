import { defineTool } from '@deepseek-ai/dsh-tools'
import { generateImages, editImages } from './backend.js'
import { ImageGenSchema, ImageEditSchema } from './schema.js'

export const name = '@seal-harness/image-generation'
export const inject = ['tools', 'credentials']

export function apply(ctx) {
  const creds = ctx.get('credentials')
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'seal-harness-image-generation: requests')

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
