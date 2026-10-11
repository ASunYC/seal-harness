import { defineTool } from '@deepseek-ai/dsh-tools'

/** 对话模型可以调用真实决策接口；工具只返回数值及来源，不伪造模型解释。 */
export function registerDecisionTool(tools, service) {
  return tools.register(defineTool({
    name: 'ask_jev_decide',
    description: '仅当用户需要作出是非判断、候选选择或行动评分时，调用已配置的 TypeSafe Jev / 阿里百炼决策模型。该接口返回结构化数值，不生成聊天解释；回复时须标明实际提供方和概率，不能把你自己的解释归于决策模型。',
    parameters: {
      question: { type: 'string', required: true, description: '要判断的具体问题。' },
      mode: { type: 'string', required: true, enum: ['yes_no', 'choice', 'score'], description: '是非判断、候选选择或行动评分。' },
      context: { type: 'string', description: '背景与限制条件。' },
      options: { type: 'array', items: { type: 'string' }, description: '候选选择模式的 2 至 12 个选项。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, execution) {
      execution.signal.throwIfAborted()
      const result = await service.decide(args, execution.signal)
      return JSON.stringify(result)
    },
  }))
}
