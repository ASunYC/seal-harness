import { defineTool } from '@deepseek-ai/dsh-tools'
import { generateImages, editImages } from './backend.js'
import { ImageGenSchema, ImageEditSchema } from './schema.js'

const DESCRIPTION_GEN = 'Generate original images, artwork, product visuals, diagrams, or other raster assets with the configured image provider. Use whenever the user asks to create or generate an image.'

const DESCRIPTION_EDIT = 'Edit or transform existing images. Use for requests that preserve, combine, or modify a visual the user already provided. Requires referenced_image_paths: exact paths from [Image source: ...] attachments, @-attached files, or prior ImageGen results.'

function renderImageResult(_args, value) {
  if (!value?.images?.length) return [{ type: 'text', text: '(no images generated)' }]
  return [
    {
      type: 'text',
      text: value.images.map((img, i) =>
        `Image ${i + 1}: ${img.path}${img.revisedPrompt ? `\nRevised prompt: ${img.revisedPrompt}` : ''}`
      ).join('\n'),
    },
    ...value.images.map(img => ({
      type: 'image',
      source: { type: 'path', path: img.path },
      mediaType: img.mimeType,
    })),
  ]
}

export function registerImageTools(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'seal-harness-image-generation: pending requests')

  const creds = () => ctx.get('credentials')

  ctx.tools.register(defineTool({
    name: 'ImageGen',
    description: DESCRIPTION_GEN,
    parameters: ImageGenSchema,
    output: {
      schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          operation: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                mimeType: { type: 'string' },
                revisedPrompt: { type: 'string' },
              },
            },
          },
        },
      },
      render: renderImageResult,
    },
    async execute(args, exec) {
      return generateImages(args, {
        credentials: creds(),
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ImageEdit',
    description: DESCRIPTION_EDIT,
    parameters: ImageEditSchema,
    output: {
      schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          operation: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                mimeType: { type: 'string' },
                revisedPrompt: { type: 'string' },
              },
            },
          },
        },
      },
      render: renderImageResult,
    },
    async execute(args, exec) {
      return editImages(args, {
        credentials: creds(),
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
    },
  }))

  return () => lifetime.abort()
}
