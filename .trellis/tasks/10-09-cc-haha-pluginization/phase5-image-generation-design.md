# Phase 5a: Image Generation Plugin - Design Document

## 背景与范围

cc-haha 的 Image Generation 是使用频率最高的能力之一（2340 行工具代码），支持 OpenAI OAuth、Grok OAuth、ApiSmart 等多种 provider。完整移植依赖链深（OAuth、session env 注入、provider 预设）。

本方案采用**务实 MVP 路径**：用 DSH 工具体系注册 `ImageGen` + `ImageEdit`，凭据通过 DSH `credentials` 服务管理，先支持 OpenAI Images API 兼容接口，后续扩展。

## 架构设计

### 插件结构

```
seal-harness-desktop/plugins/image-generation/
├── src/
│   ├── index.js          # Cordis 插件入口（注册工具）
│   ├── tools.js          # ImageGen + ImageEdit 工具定义
│   ├── backend.js        # API 调用、图片下载、存储
│   ├── credentials.js    # 凭据管理（读/写 DSH credentials）
│   └── schema.js         # 工具 schema（复用 cc-haha 的参数设计）
├── tests/
│   ├── tools.test.mjs
│   ├── backend.test.mjs
│   └── credentials.test.mjs
└── package.json          # （不需要，产品插件内联构建）
```

### 工具注册模式

参考 `@deepseek-ai/dsh-tool-ask-user`，用 `defineTool` 注册两个工具：

```js
// src/index.js
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImageGenSchema, ImageEditSchema } from './schema.js'
import { generateImages, editImages } from './backend.js'

export const name = 'seal-harness-image-generation'
export const inject = ['tools', 'credentials']

export function apply(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'image-generation: pending requests')

  ctx.tools.register(defineTool({
    name: 'ImageGen',
    description: 'Generate original images, artwork, visuals, or diagrams with the configured image provider.',
    parameters: ImageGenSchema,
    async execute(args, exec) {
      const result = await generateImages(args, {
        credentials: ctx.get('credentials'),
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ImageEdit',
    description: 'Edit existing images by modifying, combining, or transforming referenced visuals.',
    parameters: ImageEditSchema,
    async execute(args, exec) {
      const result = await editImages(args, {
        credentials: ctx.get('credentials'),
        signal: AbortSignal.any([exec.signal, lifetime.signal]),
      })
      return result
    },
  }))
}
```

### 凭据管理

复用 `dsh-credentials` 的 `modifyRecord` / `readRecord` API，与 `dsh-plugin-ask-jev` 一致：

```js
// src/credentials.js
const KEY = 'seal-harness-image-generation/settings'

export async function getImageGenConfig(credentials) {
  const record = await credentials.readRecord(KEY)
  if (record?.kind === 'grant' && record.payload?.version === 1) {
    return {
      provider: record.payload.provider || 'openai',
      baseUrl: record.payload.baseUrl || 'https://api.openai.com',
      apiKey: record.payload.apiKey || '',
      model: record.payload.model || 'dall-e-3',
    }
  }
  return { provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: '', model: 'dall-e-3' }
}

export async function saveImageGenConfig(credentials, updates) {
  return credentials.modifyRecord(KEY, record => {
    const prev = record?.payload || {}
    return {
      kind: 'grant',
      payload: {
        version: 1,
        provider: updates.provider ?? prev.provider ?? 'openai',
        baseUrl: updates.baseUrl ?? prev.baseUrl ?? 'https://api.openai.com',
        apiKey: updates.apiKey ?? prev.apiKey,
        model: updates.model ?? prev.model ?? 'dall-e-3',
      },
    }
  })
}
```

### 后端实现（OpenAI Images API 兼容）

```js
// src/backend.js
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { getImageGenConfig } from './credentials.js'

export async function generateImages(args, { credentials, signal }) {
  const config = await getImageGenConfig(credentials)
  if (!config.apiKey) throw new Error('请先配置 Image Generation API Key。')

  const response = await fetch(`${config.baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      prompt: args.prompt,
      n: args.count || 1,
      size: args.size || 'auto',
      quality: args.quality || 'auto',
      response_format: 'url',
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Image generation failed: ${response.status} ${text}`)
  }

  const json = await response.json()
  const images = await Promise.all(
    json.data.map(async item => {
      const imageUrl = item.url
      const imageBytes = await fetch(imageUrl, { signal }).then(r => r.arrayBuffer())
      const imagePath = await saveImage(Buffer.from(imageBytes), 'png')
      return {
        path: imagePath,
        mimeType: 'image/png',
        revisedPrompt: item.revised_prompt,
      }
    })
  )

  return {
    type: 'image_generation_result',
    operation: 'generate',
    providerId: config.provider,
    model: config.model,
    prompt: args.prompt,
    images,
  }
}

async function saveImage(buffer, format) {
  const home = resolveDshHome(process.env.DSH_HOME)
  const dir = join(home, 'images', new Date().toISOString().split('T')[0])
  await mkdir(dir, { recursive: true })
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`
  const path = join(dir, fileName)
  await writeFile(path, buffer)
  return path
}
```

### Schema 定义

复用 cc-haha 的参数设计：

```js
// src/schema.js
export const ImageGenSchema = {
  prompt: { type: 'string', required: true, description: 'Complete art-direction prompt for the image.' },
  count: { type: 'number', description: 'Number of variations (default 1).' },
  aspect_ratio: { type: 'string', description: 'Aspect ratio like "16:9", "1:1", "9:16".' },
  size: { type: 'string', enum: ['auto', '1024x1024', '1024x1536', '1536x1024'], description: 'Output size.' },
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: 'Quality preset.' },
  output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Output format (default png).' },
}

export const ImageEditSchema = {
  ...ImageGenSchema,
  referenced_image_paths: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'Ordered paths to images the user supplied in this conversation.',
  },
}
```

## Skill 文档

复用 cc-haha 的 `imagegen/SKILL.md`，放置在 `seal-harness-desktop/skills/bundled/imagegen/SKILL.md`，内容不变（工具名 `ImageGen` / `ImageEdit` 已对齐）。

## 集成清单

1. **新建插件目录**：`seal-harness-desktop/plugins/image-generation/src/`
2. **Cordis 装配**：在 `seal-harness-desktop/cordis.patch.yml` 添加 insert 行
3. **Skill 文档**：复制 `cc-haha/src/skills/bundled/imagegen/SKILL.md` 到产品 skills 目录
4. **依赖声明**（如果需要）：确认 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-credentials` 已安装
5. **测试**：真实窗口验证模型能调用 `ImageGen` 工具并返回本地图片路径

## MVP 范围

- ✅ 支持 OpenAI Images API 兼容接口（`/v1/images/generations` + `/v1/images/edits`）
- ✅ 凭据通过 DSH credentials 管理（BaseURL + API Key + Model）
- ✅ 图片保存到 `~/.seal-harness/images/<YYYY-MM-DD>/`
- ✅ 工具结果返回本地路径（DSH 会话自动附加为 context）
- ❌ 不支持 OAuth（ChatGPT / Grok）
- ❌ 不支持 ApiSmart 特殊逻辑（2K 分辨率、URL response）
- ❌ 不支持 input image multipart upload（`ImageEdit` 暂时只接受本地路径）

## 后续扩展路径

1. **Provider 扩展**：增加 Grok、ApiSmart、本地 Stable Diffusion
2. **OAuth 支持**：接入产品自有的 OAuth 凭据系统
3. **配置 UI**：提供设置面板管理 provider / model / API Key
4. **ImageEdit multipart**：支持 `referenced_image_paths` 上传到 `/v1/images/edits`

## 风险与限制

- OpenAI Images API 有 rate limit，需要用户自备有效 API Key
- 图片存储在本地，未实现云端同步或清理策略
- 工具结果中的本地路径在跨设备会话中不可用（需要后续设计附件同步）
