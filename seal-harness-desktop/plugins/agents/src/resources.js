export function workflowResources(ctx) {
  const ports = () => [ctx.get('sealHarnessSkills'), ctx.get('sealHarnessConnectors'), ctx.get('sealHarnessKnowledge')].filter(Boolean)
  const list = async () => {
    const resources = [], warnings = []
    for (const service of ports()) {
      try {
        const value = service.workflowResources ? await service.workflowResources() : await service.call('workflowResources', {})
        resources.push(...value.resources); warnings.push(...(value.warnings ?? []))
      } catch (error) { warnings.push(error.message) }
    }
    return { resources, warnings }
  }
  return {
    list,
    async export(selections) {
      const available = await list(), result = { capabilities: [], credentials: [] }
      for (const selection of selections) {
        const row = available.resources.find(item => item.kind === selection.kind && item.sourceId === selection.sourceId && item.version === selection.version && item.collectionId === selection.collectionId)
        if (!row || row.unavailableReason) throw new Error('资源已变化或不可导出，请刷新后重新选择。')
        const service = ctx.get({ skill: 'sealHarnessSkills', mcp: 'sealHarnessConnectors', wiki: 'sealHarnessKnowledge' }[selection.kind])
        const value = service.workflowExport ? await service.workflowExport(selection) : await service.call('workflowExport', selection)
        result.capabilities.push(...value.capabilities); result.credentials.push(...value.credentials)
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 1_400_000) throw new Error('本次资源超过交付容量，请减少选择。')
      return result
    },
  }
}
