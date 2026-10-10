const CRED_KEY = 'seal-harness-image-generation/settings'

async function getConfig(credentials) {
  const record = await credentials.readRecord(CRED_KEY)
  const payload = record?.kind === 'grant' ? record.payload : null
  if (!payload?.apiKey) return null
  return {
    apiKey: payload.apiKey,
    baseURL: payload.baseURL ?? 'https://api.openai.com/v1',
    model: payload.model ?? 'dall-e-3',
  }
}

export { CRED_KEY, getConfig }

function inferSize(aspectRatio) {
  switch (aspectRatio) {
    case '1:1': return '1024x1024'
    case '16:9': return '1792x1024'
    case '9:16': return '1024x1792'
    case '4:3': return '1792x1024'
    case '3:4': return '1024x1792'
    default: return '1024x1024'
  }
}

export async function generateImages(args, { credentials, signal }) {
  const config = await getConfig(credentials)
  if (!config) {
    throw new Error(
      '请先配置图片生成 API Key。在设置页面找到 Image Generation 配置项，填写 API Key 和 Base URL。',
    )
  }

  const size =
    args.size && args.size !== 'auto'
      ? args.size
      : inferSize(args.aspect_ratio ?? 'auto')

  const body = {
    model: config.model,
    prompt: args.prompt,
    n: Math.min(Math.max(1, args.count ?? 1), 4),
    size,
    quality: args.quality === 'hd' ? 'hd' : 'standard',
    response_format: 'url',
  }

  const response = await fetch(`${config.baseURL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    let message = `图片生成失败 (HTTP ${response.status})`
    try {
      const json = JSON.parse(text)
      if (json.error?.message) message += `: ${json.error.message}`
    } catch {
      if (text) message += `: ${text.slice(0, 200)}`
    }
    throw new Error(message)
  }

  const json = await response.json()
  return {
    type: 'image_generation_result',
    operation: 'generate',
    model: config.model,
    prompt: args.prompt,
    images: json.data.map(item => ({
      path: item.url,
      mimeType: 'image/png',
      revisedPrompt: item.revised_prompt,
    })),
  }
}

export async function editImages(args, { credentials, signal }) {
  const config = await getConfig(credentials)
  if (!config) {
    throw new Error('请先配置图片生成 API Key。')
  }

  if (!args.referenced_image_paths?.length) {
    throw new Error('referenced_image_paths 不能为空。')
  }

  const { readFile } = await import('node:fs/promises')
  const firstPath = args.referenced_image_paths[0]
  let imageBytes
  try {
    imageBytes = await readFile(firstPath)
  } catch (err) {
    throw new Error(`无法读取图片文件 ${firstPath}: ${err.message}`)
  }

  const size =
    args.size && args.size !== 'auto' ? args.size : inferSize(args.aspect_ratio ?? '1:1')

  const ext = firstPath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeType =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'

  const form = new FormData()
  form.set('model', config.model)
  form.set('prompt', args.prompt)
  form.set('size', size)
  form.set('n', String(Math.min(Math.max(1, args.count ?? 1), 4)))
  form.set('response_format', 'url')
  form.set('image', new Blob([imageBytes], { type: mimeType }), `image.${ext}`)

  const response = await fetch(`${config.baseURL}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    let message = `图片编辑失败 (HTTP ${response.status})`
    try {
      const json = JSON.parse(text)
      if (json.error?.message) message += `: ${json.error.message}`
    } catch {
      if (text) message += `: ${text.slice(0, 200)}`
    }
    throw new Error(message)
  }

  const json = await response.json()
  return {
    type: 'image_generation_result',
    operation: 'edit',
    model: config.model,
    prompt: args.prompt,
    images: json.data.map(item => ({
      path: item.url,
      mimeType: 'image/png',
    })),
  }
}
