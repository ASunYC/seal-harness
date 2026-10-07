import type { ComponentType } from 'react'

export interface AnimatedSidebarIconProps {
  readonly name: 'projects' | 'agents' | 'store' | 'plugins' | 'connectors' | 'library'
  readonly size?: number
  readonly active?: boolean
}

export const AnimatedSidebarIcon: ComponentType<AnimatedSidebarIconProps>
