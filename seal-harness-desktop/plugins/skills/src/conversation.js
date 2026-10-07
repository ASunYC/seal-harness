export const conversationServices = ['sessions', 'uiWorkspace', 'workspaces', 'conversation']

export const skillCreationTemplate = `请帮我创建一个技能，保存到「技能 > 个人」，暂时不要安装。\n\n技能名称：<填写英文小写标识，例如 research-summary>\n技能用途：<一句话说明什么情况下使用>\n执行步骤：<逐条写出技能应该怎么做>\n输出要求：<格式、质量标准和限制>\n其他要求：<可选>\n\n请先根据我的要求完善技能内容；若关键信息缺失，先向我提问。确认后使用应用提供的 create_skill 工具保存。只有保存成功，才告诉我“技能已创建完成”，并提醒我可在「技能 > 个人」安装。`

export async function createSkillDraftConversation(ctx, workspaceId) {
  if (!workspaceId) {
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const sessions = ctx.sessions.list.getSnapshot().byId
    const current = Object.values(sessions).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    workspaceId = workspaces.find(item => item.sessionIds.includes(current))?.workspaceId ?? workspaces[0]?.workspaceId
  }
  if (!workspaceId) throw new Error('请先选择或创建对话工作区。')
  const sessionId = await ctx.sessions.create({ workspaceId })
  const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessSkillCreation' })
  try {
    const binding = await reference.ready
    ctx.conversation.input.for(binding.ctx).setDraft(skillCreationTemplate)
    ctx.uiWorkspace.openSession(sessionId)
  } finally { reference.release() }
}
