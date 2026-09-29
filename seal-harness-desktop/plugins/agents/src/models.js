import { credentialKey } from '@deepseek-ai/dsh-credentials'

export function deploymentModels(ctx) {
  const profiles = () => ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.value?.providers ?? {}
  const resolveModel = async ({ connectionId, remoteModelId }) => {
    const profile = profiles()[connectionId]
    if (!profile) throw new Error('modelUnavailable')
    await ctx.llm.resolveModelInfo(connectionId, remoteModelId)
    const override = profile.models?.find(item => item.id === remoteModelId) ?? profile.modelOverrides?.[remoteModelId]
    let baseUrl = override?.baseURL ?? profile.baseURL, api = override?.api ?? profile.api
    if (!baseUrl || !api) {
      const { getBuiltinModel } = await import('@earendil-works/pi-ai/providers/all')
      const model = getBuiltinModel(connectionId, remoteModelId)
      baseUrl ??= model?.baseUrl
      api ??= model?.api
    }
    if (!baseUrl || !['openai-completions', 'openai-responses'].includes(api)) throw new Error('请在模型设置中为此连接明确配置 API 地址及 OpenAI Chat Completions 或 Responses 协议，再部署独立运行环境。')
    let apiKey
    if (profile.apiKeyEnv) apiKey = (await ctx.credentials.resolve(profile.apiKeyEnv))?.value
    else {
      const stored = await ctx.credentials.readRecord(credentialKey('llm-pi-ai', connectionId))
      if (stored?.kind === 'api-key') apiKey = stored.key
      if (stored?.kind === 'grant') throw new Error('此模型使用会话授权，无法导出到独立运行环境。请选择 API Key 模型。')
    }
    return { provider: connectionId, model: remoteModelId, baseUrl, protocol: api === 'openai-responses' ? 'responses' : 'chat-completions', ...(apiKey ? { apiKey } : {}) }
  }
  return {
    resolveModel,
    async models() {
      const items = []
      for (const [provider, profile] of Object.entries(profiles())) {
        for (const model of await ctx.llm.listModels(provider)) {
          items.push({ connectionId: provider, remoteModelId: model.id, label: `${profile.displayName ?? provider} · ${model.name ?? model.id}` })
        }
      }
      return items
    },
    async defaultModel() {
      const current = ctx.get('agentDefaultModel')?.currentSelection()
      return current ? { connectionId: current.provider, remoteModelId: current.model } : null
    },
  }
}
