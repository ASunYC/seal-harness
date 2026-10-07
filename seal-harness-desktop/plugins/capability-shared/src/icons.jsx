import React from 'react'
import { icons } from './icon-data.js'

export function Icon({ name, size = 18, strokeWidth = 1.55, className = '', style, ...props }) {
  const icon = icons[name]
  if (!icon) throw new Error(`未知资源图标：${name}`)
  return <svg className={`app-icon ${className}`.trim()} width={size} height={size} viewBox={icon.viewBox || '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon-name={name} style={{ display: 'block', flex: '0 0 auto', ...style }} {...props}>
    {icon.nodes.map(([tag, attributes], index) => React.createElement(tag, { ...attributes, key: index }))}
  </svg>
}
