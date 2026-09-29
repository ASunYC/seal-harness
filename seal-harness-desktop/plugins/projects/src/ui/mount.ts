import { createApp, h, watch } from 'vue'
import { createPinia, disposePinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import ProjectsView from '../../stratex/renderer/src/views/ProjectsView.vue'
import ProjectDetailView from '../../stratex/renderer/src/views/ProjectDetailView.vue'
import ToastStack from '../../stratex/renderer/src/components/ui/ToastStack.vue'
import { useProjectWorkspaceStore } from '../../stratex/renderer/src/stores/projectWorkspace'
import { useProjectPlanningDraftsStore } from '../../stratex/renderer/src/stores/projectPlanningDrafts'
import { useProjectCollabStore } from '../../stratex/renderer/src/stores/projectCollab'
import { createOverlayStack } from '../../stratex/renderer/src/components/ui/overlay/overlayStack'
import { bindProjectRuntime, type ProjectApi, type ProjectUIRuntime } from './runtime'
import './project.css'

export interface ProjectMountOptions {
  api: ProjectApi
  css: string
  returnToConversation(): Promise<void>
  mountConversation: ProjectUIRuntime['mountConversation']
  accountId: string
  sidebarStates: ProjectUIRuntime['sidebarStates']
  navigation: { projectId: string | null }
  initialProjectId?: string
  signal?: AbortSignal
}

export async function mountProjects(host: HTMLElement, options: ProjectMountOptions): Promise<() => void> {
  options.signal?.throwIfAborted()
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = options.css
  const container = document.createElement('div')
  container.className = 'projects-root'
  const overlays = document.createElement('div')
  overlays.className = 'ovl-host'
  overlays.dataset.overlayHost = ''
  shadow.replaceChildren(style, container, overlays)
  host.dataset.density = 'comfortable'
  const updateTheme = () => {
    host.dataset.theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
  }
  updateTheme()
  const theme = new MutationObserver(updateTheme)
  theme.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  const overlayStack = createOverlayStack({ keyboardTarget: shadow })
  const stopInert = overlayStack.subscribe(() => { container.inert = overlayStack.isBackgroundInert() })
  const release = bindProjectRuntime({ ...options, shadow, overlays, overlayStack })
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', component: ProjectsView },
    { path: '/projects/:projectId', component: ProjectDetailView },
  ] })
  const app = createApp({ render: () => [h(RouterView), h(ToastStack, { toasts: [], regionLabel: '项目通知', closeLabel: '关闭' })] })
  app.use(pinia)
  app.use(router)
  const store = useProjectCollabStore(pinia)
  const stopRemember = watch(() => store.detail?.id, id => {
    if (id) options.navigation.projectId = id
  })
  const stopJoin = options.api.onProjectJoinLink(() => { void router.push('/projects') })
  const stopAgent = options.api.onProjectAgentChanged(({ projectId, tool }) => {
    if (projectId !== store.activeProjectId) return
    void store.loadProjects()
    if (tool.includes('milestone') || tool.includes('iteration')) void store.loadMilestones(projectId)
    else if (tool.includes('asset') || tool.includes('file')) { void store.loadFiles(projectId); void store.loadAssets(projectId) }
    else if (tool.includes('post_update')) void store.loadFeed(projectId)
    else { void store.loadTodos(projectId); if (store.requirementQueryRevision !== null) void store.loadRequirementPage(projectId); void store.loadDraftBatches(projectId) }
  })
  const stopNavigate = options.api.onProjectNotificationNavigate(({ projectId }) => {
    void router.push(`/projects/${encodeURIComponent(projectId)}`)
  })
  let mounted = false
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    store.resetForAccountChange()
    useProjectWorkspaceStore(pinia).resetForAccountChange()
    useProjectPlanningDraftsStore(pinia).reset()
    stopRemember()
    stopJoin()
    stopAgent()
    stopNavigate()
    options.signal?.removeEventListener('abort', dispose)
    if (mounted) app.unmount()
    disposePinia(pinia)
    stopInert()
    theme.disconnect()
    release()
    shadow.replaceChildren()
  }
  options.signal?.addEventListener('abort', dispose, { once: true })
  try {
    const available = await store.hydrateAvailability()
    if (disposed) return dispose
    if (!available) throw new Error('项目服务暂不可用，请稍后重新进入。')
    let projectId = options.initialProjectId ?? options.navigation.projectId
    if (projectId && !options.initialProjectId) {
      const result = await options.api.readProjectDetail({ projectId })
      if (disposed) return dispose
      if (!result.ok && (result.code === 'forbidden' || result.code === 'rejected')) {
        options.navigation.projectId = null
        projectId = null
      }
    }
    if (disposed) return dispose
    await router.push(projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects')
    await router.isReady()
    if (!disposed) {
      app.mount(container)
      mounted = true
    }
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}
