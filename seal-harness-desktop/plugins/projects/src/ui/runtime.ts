import type { createProjectBridge } from '../bridge'
import { createOverlayStack } from '../../stratex/renderer/src/components/ui/overlay/overlayStack'

export type ProjectApi = ReturnType<typeof createProjectBridge>

export interface ProjectConversation {
  prefill(text: string): void
  dispose(): void
}

export interface ProjectSidebarState {
  tab: 'overview' | 'assistant'
  open: boolean
  width: number
}

export interface ProjectUIRuntime {
  api: ProjectApi
  shadow: ShadowRoot
  overlays: HTMLElement
  overlayStack: ReturnType<typeof createOverlayStack>
  returnToConversation(): Promise<void>
  mountConversation(host: HTMLElement, sessionId: string, signal: AbortSignal): Promise<ProjectConversation>
  accountId: string
  sidebarStates: Map<string, ProjectSidebarState>
}

let current: ProjectUIRuntime | null = null

export function projectRuntime(): ProjectUIRuntime {
  if (!current) throw new Error('项目界面尚未挂载')
  return current
}

export function projectApi(): ProjectApi {
  return projectRuntime().api
}

export function projectStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const prefix = `seal-harness.projects.${encodeURIComponent(projectRuntime().accountId)}.`
  return {
    getItem: key => localStorage.getItem(prefix + key),
    setItem: (key, value) => localStorage.setItem(prefix + key, value),
    removeItem: key => localStorage.removeItem(prefix + key),
  }
}

export function bindProjectRuntime(runtime: ProjectUIRuntime): () => void {
  if (current) throw new Error('项目界面不能重复挂载')
  current = runtime
  return () => { if (current === runtime) current = null }
}
