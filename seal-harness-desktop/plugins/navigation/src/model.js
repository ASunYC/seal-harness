export function createNavigationState() {
  const entries = new Map()
  const listeners = new Set()
  let selectedId = null
  let decisionSessionId = null
  let decisionActive = false
  let snapshot = Object.freeze({ entries: Object.freeze([]), selectedId, decisionSessionId, decisionActive })
  const publish = () => {
    snapshot = Object.freeze({
      entries: Object.freeze([...entries.values()].sort((a, b) => a.order - b.order)),
      selectedId,
      decisionSessionId,
      decisionActive,
    })
    for (const listener of listeners) listener()
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    register(entry) {
      if (!entry?.id || !entry?.label || typeof entry.Panel !== 'function' || entries.has(entry.id))
        throw new Error('首页资源注册无效或重复。')
      const stored = Object.freeze({ ...entry })
      entries.set(entry.id, stored)
      publish()
      return () => {
        if (entries.get(entry.id) !== stored) return
        entries.delete(entry.id)
        if (selectedId === entry.id) selectedId = null
        publish()
      }
    },
    select(id) {
      if (id !== null && !entries.has(id)) throw new Error(`首页资源 ${id} 未加载。`)
      if (selectedId === id) return
      selectedId = id
      publish()
    },
    markDecisionSession(id) {
      if (typeof id !== 'string' || !id) throw new Error('决策会话 ID 无效。')
      decisionSessionId = id
      decisionActive = true
      publish()
    },
    leaveDecision() {
      if (!decisionActive) return
      decisionActive = false
      publish()
    },
    dispose() { entries.clear(); listeners.clear(); selectedId = null; decisionSessionId = null; decisionActive = false },
  })
}
