import React, { useEffect, useRef } from 'react'
export function Dialog({ children, onClose, busy = false, initialFocus }) {
  const container = useRef(null), current = useRef({ onClose, busy })
  current.current = { onClose, busy }
  useEffect(() => {
    const previous = document.activeElement
    const focusable = () => [...container.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(item => !item.closest('[hidden]') && (!item.closest('details:not([open])') || item.tagName === 'SUMMARY'))
    const initial = initialFocus ? container.current.querySelector(initialFocus) : focusable()[0]
    initial?.focus()
    const keydown = event => {
      if (event.key === 'Escape' && !current.current.busy) { event.preventDefault(); current.current.onClose() }
      if (event.key !== 'Tab') return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); container.current.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const element = container.current
    element.addEventListener('keydown', keydown)
    return () => { element.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [])
  return <div className="za-overlay" ref={container} tabIndex={-1}>{children}</div>
}
