export const PANEL_URL = 'http://127.0.0.1:3082/'

export function createSuperagentService({ request = fetch, openExternal }) {
  return {
    async status(signal) {
      let response
      try {
        response = await request(new URL('orchestrator/api/state', PANEL_URL), {
          headers: { 'x-orchestrator-request': '1' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        })
      } catch {
        return { online: false, message: 'Superagent 服务未启动或暂时无法连接。' }
      }
      if (!response.ok) return { online: false, message: `Superagent 返回 HTTP ${response.status}。` }
      const state = await response.json()
      return {
        online: true,
        setup: state.setup?.problem?.code === 'repositoryUnset' ? '尚未设置 GitHub 仓库。' : state.setup?.problem?.detail ?? null,
        runtime: state.health?.runtime?.state ?? 'unknown',
        running: state.load?.running ?? 0,
        queued: state.load?.queued ?? 0,
        paused: state.paused === true,
      }
    },
    async open() {
      await openExternal(PANEL_URL)
      return { url: PANEL_URL }
    },
  }
}
