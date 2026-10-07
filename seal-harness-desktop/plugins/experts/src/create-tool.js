import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

const output = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

function requireAccount(ctx) {
  const session = ctx.get('sealHarnessIdentity')?.getSession()
  if (!session?.accountId) throw new Error('请先登录 Seal Harness 本机账号。')
  return session.accountId
}

function resolveReferences(requested, kind, available) {
  const references = []
  for (const input of [...new Set(requested ?? [])]) {
    const matches = available.filter(item => item.kind === kind && (item.sourceId === input || item.name.toLocaleLowerCase() === input.toLocaleLowerCase()))
    if (matches.length !== 1) throw new Error(`${kind === 'skill' ? '技能' : '连接器'}“${input}”未找到或名称不唯一。请先查询可用能力并使用准确标识。`)
    references.push({ kind, sourceId: matches[0].sourceId })
  }
  return references
}

/** 模型只提交语义字段；包路径和持久化由专家 Host 统一生成。 */
export function registerExpertCreationTools(ctx, experts) {
  const releases = []
  try {
    releases.push(ctx.tools.register(defineTool({
    name: 'list_available_expert_capabilities',
    description: '列出当前本机账号可绑定到专家的技能与连接器。用户要求专家具备特定能力时，先调用此工具，使用返回的准确 sourceId；不存在的能力不要虚构。',
    parameters: {},
    output,
    async execute() {
      requireAccount(ctx)
      const { items } = await experts.call('capabilities')
      return JSON.stringify({ items: items.map(({ kind, sourceId, name, enabled, status }) => ({ kind, sourceId, name, enabled, ...(status ? { status } : {}) })) })
    },
    })))
    releases.push(ctx.tools.register(defineTool({
    name: 'create_expert',
    description: '根据用户明确发送的要求创建并保存一个个人专家。先完善角色、职责和工作方式；若用户要求技能或连接器，先调用 list_available_expert_capabilities，传准确的名称或 sourceId。保存成功后才能告诉用户“专家已创建完成”。',
    parameters: {
      displayName: { type: 'string', required: true, description: '用户看到的专家名称。' },
      profession: { type: 'string', required: true, description: '专家职业或角色。' },
      description: { type: 'string', required: true, description: '简短说明适用任务。' },
      personaInstructions: { type: 'string', required: true, description: '完整工作指令：目标、步骤、输出格式和边界。' },
      skills: { type: 'array', items: { type: 'string' }, description: '已存在技能的准确名称或 sourceId。' },
      connectors: { type: 'array', items: { type: 'string' }, description: '已存在连接器的准确名称或 sourceId。' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选的简短标签。' },
    },
    output,
    async execute(args, execution) {
      execution.signal.throwIfAborted()
      const accountId = requireAccount(ctx)
      const selection = ctx.get('agentDefaultModel')?.currentSelection()
      if (!selection?.model || !selection.provider) throw new Error('请先在设置中配置默认模型，再创建专家。')
      const current = await experts.call('list')
      if (current.items.some(item => item.displayName === args.displayName)) throw new Error('当前账号已有同名专家，请换一个名称。')
      const requested = [...(args.skills ?? []), ...(args.connectors ?? [])]
      const available = requested.length ? (await experts.call('capabilities')).items : []
      const capabilities = [
        ...resolveReferences(args.skills, 'skill', available),
        ...resolveReferences(args.connectors, 'mcp', available),
      ]
      execution.signal.throwIfAborted()
      if (requireAccount(ctx) !== accountId) throw new Error('登录账号已变化，请重新发起创建。')
      const name = `expert-${randomUUID().slice(0, 8)}`
      const manifest = {
        schemaVersion: 'stratex.expert/v1', name, version: '0.1.0', entryAgent: name,
        agents: [`agents/${name}.md`], displayName: { zh: args.displayName, en: '' },
        profession: { zh: args.profession, en: '' }, description: { zh: args.description, en: '' },
        personaInstructions: args.personaInstructions, model: selection.model,
        ...(capabilities.length ? { capabilities } : {}),
        ...(args.tags?.length ? { tags: args.tags.map(tag => ({ zh: tag, en: '' })) } : {}),
      }
      const saved = await experts.call('create', { manifest })
      return JSON.stringify({ status: 'created', name: saved.name, displayName: args.displayName, version: saved.version, message: '专家已创建完成，前往「专家 > 个人」查看。' })
    },
    })))
  } catch (error) {
    releases.forEach(release => release())
    throw error
  }
  return () => releases.forEach(release => release())
}
