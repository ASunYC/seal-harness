import React, { useEffect, useRef, useState } from 'react'
import { MorphIcon } from 'morphicons/react'
import { emphasizedIcons, icons } from './icon-data.js'

function reducedMotionPreference() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Stratex-style stateful icon driven by the DSH-owned navigation row. */
export function AnimatedSidebarIcon({ name, size = 20, active = false }) {
  const seat = useRef(null)
  const [interacting, setInteracting] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(reducedMotionPreference)
  const icon = icons[name]
  if (!icon) throw new Error(`未知侧栏图标：${name}`)

  useEffect(() => {
    const row = seat.current?.closest('button')
    if (!row) return
    const enter = () => setInteracting(true)
    const leave = () => setInteracting(false)
    row.addEventListener('mouseenter', enter)
    row.addEventListener('mouseleave', leave)
    row.addEventListener('focusin', enter)
    row.addEventListener('focusout', leave)
    return () => {
      row.removeEventListener('mouseenter', enter)
      row.removeEventListener('mouseleave', leave)
      row.removeEventListener('focusin', enter)
      row.removeEventListener('focusout', leave)
    }
  }, [])

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const update = () => setReducedMotion(query.matches)
    query.addEventListener?.('change', update)
    update()
    return () => query.removeEventListener?.('change', update)
  }, [])

  const emphasized = active || interacting
  const target = emphasizedIcons[name] ?? icon
  return <span
    ref={seat}
    data-sidebar-icon-name={name}
    data-sidebar-icon-state={emphasized ? 'emphasized' : 'idle'}
    data-reduced-motion={String(reducedMotion)}
    style={{
      display: 'grid', placeItems: 'center', transformOrigin: '50% 50%',
      transform: emphasized ? 'scale(1.08) rotate(-3deg)' : 'scale(1) rotate(0deg)',
      transition: reducedMotion ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.2,1)',
    }}
  >
    <MorphIcon
      icon={target.nodes}
      size={size}
      strokeWidth={1.6}
      reducedMotion="user"
      spring="snappy"
      data-icon-name={name}
      data-icon-state={emphasized ? 'emphasized' : 'idle'}
      style={{ display: 'block', overflow: 'visible' }}
    />
  </span>
}
