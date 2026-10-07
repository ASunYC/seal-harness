/** 与 pi-ai 的 ModelThinkingLevel 标识保持一致；请求值由用户逐项声明。 */
export const reasoningLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function modelsOf(namespace, provider) {
  const providers = namespace?.value?.providers
  const profile = providers && typeof providers === 'object' ? providers[provider] : undefined
  return Array.isArray(profile?.models) ? profile.models : undefined
}

export function configurableModels(namespace) {
  const providers = namespace?.value?.providers
  if (!providers || typeof providers !== 'object') return []
  return Object.keys(providers).flatMap(provider => (modelsOf(namespace, provider) ?? []).flatMap(model =>
    typeof model?.id === 'string' && model.id.length > 0
      ? [{ provider, id: model.id, name: typeof model.name === 'string' ? model.name : model.id, reasoningEfforts: model.reasoningEfforts }]
      : []))
}

/** 只写目标模型所在数组；其余模型和未知模型字段原样保留。 */
export function reasoningUpdate(namespace, provider, modelId, declaration) {
  if (namespace?.ns !== 'llm-pi-ai' || !Number.isSafeInteger(namespace.revision)) throw new Error('模型设置尚未就绪，请刷新。')
  const models = modelsOf(namespace, provider)
  if (!models) throw new Error('此提供商没有手动配置的模型列表。')
  const matches = models.filter(model => model?.id === modelId)
  if (matches.length !== 1) throw new Error('模型不存在或名称不唯一，请刷新。')
  let efforts
  if (declaration.kind === 'custom') {
    if (!declaration.values || typeof declaration.values !== 'object') throw new Error('请选择模型支持的推理档位。')
    const selected = Object.entries(declaration.values)
    if (!selected.some(([level]) => level !== 'off')) throw new Error('至少选择一个非 Off 的推理档位。')
    efforts = {}
    for (const [level, raw] of selected) {
      if (!reasoningLevels.includes(level) || typeof raw !== 'string') throw new Error('推理档位配置无效。')
      const value = raw.trim()
      if (!value && level !== 'off') throw new Error(`${level} 的请求值不能为空。`)
      if (value.length > 80) throw new Error(`${level} 的请求值过长。`)
      efforts[level] = value || null
    }
  } else if (declaration.kind === 'disabled') efforts = false
  else if (declaration.kind !== 'inherit') throw new Error('推理档位模式无效。')
  const next = models.map(model => {
    if (model.id !== modelId) return { ...model }
    const updated = { ...model }
    if (declaration.kind === 'inherit') delete updated.reasoningEfforts
    else updated.reasoningEfforts = efforts
    return updated
  })
  return { namespace: 'llm-pi-ai', revision: namespace.revision, operations: [{ op: 'set', path: ['providers', provider, 'models'], value: next }] }
}
