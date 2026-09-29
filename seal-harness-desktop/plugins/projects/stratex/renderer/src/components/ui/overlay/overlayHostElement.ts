import { projectRuntime } from '../../../../../../src/ui/runtime'

export function overlayHostElement(): HTMLElement {
  return projectRuntime().overlays
}
