import { defineTool } from '@deepseek-ai/dsh-tools'

const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

export function registerSkillCreationTool(ctx, skills) {
  return ctx.tools.register(defineTool({
    name: 'create_skill',
    description: '根据用户在对话中明确给出的要求创建个人技能。先完善用途、步骤及输出要求；若信息不足先询问。保存成功后才能告知用户“技能已创建完成”。新技能先存入个人列表，尚未安装。',
    parameters: {
      name: { type: 'string', required: true, description: '英文小写短横线标识，例如 research-summary。' },
      description: { type: 'string', required: true, description: '什么时候使用此技能的一句话说明。' },
      instructions: { type: 'string', required: true, description: '完整技能指令，包含执行步骤、输出要求和边界。' },
    },
    output,
    async execute(args, execution) {
      execution.signal.throwIfAborted()
      const accountId = ctx.get('sealHarnessIdentity')?.getSession()?.accountId
      if (!accountId) throw new Error('请先登录 Seal Harness 本机账号。')
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name) || args.name.length > 64) throw new Error('技能标识须为英文小写字母、数字和短横线。')
      if (!args.description?.trim() || !args.instructions?.trim()) throw new Error('请补充技能用途和完整指令。')
      const current = await skills.call('list')
      if (current.skills.some(item => item.name === args.name)) throw new Error('当前账号已有同名技能，请换一个名称。')
      execution.signal.throwIfAborted()
      if (ctx.get('sealHarnessIdentity')?.getSession()?.accountId !== accountId) throw new Error('登录账号已变化，请重新发起创建。')
      const content = `---\nname: ${args.name}\ndescription: ${JSON.stringify(args.description.trim())}\n---\n\n${args.instructions.trim()}\n`
      const result = await skills.call('create', { content, draft: true, expectedRevision: current.revision })
      return JSON.stringify({ status: 'created', name: result.skills[0].name, installed: false, message: '技能已创建完成，前往「技能 > 个人」查看并安装。' })
    },
  }))
}
