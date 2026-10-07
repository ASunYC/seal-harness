export const conversationServices = ['sessions', 'uiWorkspace', 'workspaces', 'conversation']

export const connectorCreationTemplate = `请帮我创建一个连接器，保存到「连接器 > 个人」，暂时不要安装或启用。\n\n连接器名称：<填写名称>\n用途：<这个连接器提供什么数据或工具>\n连接方式：<流式 HTTP / SSE / 本机 stdio>\n服务地址或本机可执行文件绝对路径：<填写真实地址或路径>\n本机程序参数：<仅 stdio 需要，可选>\n认证方式：<无 / 请求头 / OAuth；请不要在对话中填写密钥>\n其他要求：<可选>\n\n先核对地址、路径和连接方式，不要编造端点或程序。信息不足时先提问。确认后使用应用提供的 create_connector 工具保存配置；只有工具保存成功才告诉我“连接器已创建完成”。提醒我在「连接器 > 个人」安装，并在本机管理面板配置凭据和启用。`

export async function createConnectorDraftConversation(ctx, workspaceId) {
  if (!workspaceId) {
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const sessions = ctx.sessions.list.getSnapshot().byId
    const current = Object.values(sessions).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    workspaceId = workspaces.find(item => item.sessionIds.includes(current))?.workspaceId ?? workspaces[0]?.workspaceId
  }
  if (!workspaceId) throw new Error('请先选择或创建对话工作区。')
  const sessionId = await ctx.sessions.create({ workspaceId })
  const reference = ctx.sessions.retain(sessionId, { source: 'sealHarnessConnectorCreation' })
  try {
    const binding = await reference.ready
    ctx.conversation.input.for(binding.ctx).setDraft(connectorCreationTemplate)
    ctx.uiWorkspace.openSession(sessionId)
  } finally { reference.release() }
}
