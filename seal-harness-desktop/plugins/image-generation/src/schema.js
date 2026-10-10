// parameterSchemaSpecToJsonSchema 把这个对象编译为 JSON Schema object 根。
// 每个属性值的 required: true 等价于把该字段加入 required 数组。

export const ImageGenSchema = {
  prompt: {
    type: 'string',
    required: true,
    description: 'Complete art-direction prompt. Be specific about subject, style, composition, lighting, and constraints.',
  },
  count: {
    type: 'number',
    description: 'Number of image variations to generate (1–4). Use only for variations of the same prompt.',
  },
  size: {
    type: 'string',
    enum: ['auto', '1024x1024', '1792x1024', '1024x1792'],
    description: 'Output dimensions. "auto" infers from aspect_ratio.',
  },
  aspect_ratio: {
    type: 'string',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Aspect ratio hint when size is "auto".',
  },
  quality: {
    type: 'string',
    enum: ['standard', 'hd'],
    description: '"hd" produces finer details.',
  },
  output_format: {
    type: 'string',
    enum: ['png', 'jpeg', 'webp'],
    description: 'Output format (default png).',
  },
}

export const ImageEditSchema = {
  prompt: {
    type: 'string',
    required: true,
    description: 'Description of the desired edit or transformation.',
  },
  referenced_image_paths: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'Absolute file paths from [Image source: ...] attachments, @ attachments, or prior ImageGen results. Never invent paths.',
  },
  count: {
    type: 'number',
    description: 'Number of edited variants to generate (1–4).',
  },
  size: {
    type: 'string',
    enum: ['auto', '1024x1024', '1792x1024', '1024x1792'],
    description: 'Output dimensions.',
  },
  aspect_ratio: {
    type: 'string',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Aspect ratio hint when size is "auto".',
  },
  output_format: {
    type: 'string',
    enum: ['png', 'jpeg', 'webp'],
    description: 'Output format (default png).',
  },
}
