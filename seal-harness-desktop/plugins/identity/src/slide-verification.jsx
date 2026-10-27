import React, { useEffect, useRef, useState } from 'react'

const THUMB_SIZE = 48
const COMPLETE_RATIO = 0.92

export function SlideVerification({ verifiedLabel, hint, onVerified, resetKey }) {
  const track = useRef(null)
  const drag = useRef(null)
  const verifiedRef = useRef(false)
  const [offset, setOffset] = useState(0)
  const [maxOffset, setMaxOffset] = useState(0)
  const [verified, setVerified] = useState(false)

  const measure = () => Math.max(0, (track.current?.getBoundingClientRect().width ?? 0) - THUMB_SIZE)
  const complete = max => {
    if (verifiedRef.current) return
    verifiedRef.current = true
    setOffset(max)
    setVerified(true)
    onVerified()
  }

  useEffect(() => {
    setOffset(0)
    setVerified(false)
    verifiedRef.current = false
  }, [resetKey])

  useEffect(() => {
    const update = () => setMaxOffset(measure())
    update()
    const ResizeObserver = document.defaultView.ResizeObserver
    if (!ResizeObserver || !track.current) return
    const observer = new ResizeObserver(update)
    observer.observe(track.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => drag.current?.cleanup(), [])

  const startDrag = event => {
    if (verifiedRef.current) return
    event.preventDefault()
    drag.current?.cleanup()
    const max = measure()
    setMaxOffset(max)
    const startX = event.clientX
    const startOffset = offset
    const pointerId = event.pointerId
    const clamp = clientX => Math.min(max, Math.max(0, startOffset + clientX - startX))
    const matches = next => next.pointerId === pointerId
    const move = next => { if (matches(next)) setOffset(clamp(next.clientX)) }
    const finish = next => {
      if (!matches(next)) return
      drag.current?.cleanup()
      if (next.type === 'pointerup' && max > 0 && clamp(next.clientX) / max >= COMPLETE_RATIO) complete(max)
      else setOffset(0)
    }
    const view = document.defaultView
    const cleanup = () => {
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', finish)
      view.removeEventListener('pointercancel', finish)
      drag.current = null
    }
    drag.current = { cleanup }
    view.addEventListener('pointermove', move)
    view.addEventListener('pointerup', finish)
    view.addEventListener('pointercancel', finish)
  }

  const keyDown = event => {
    if (verifiedRef.current) return
    const max = measure()
    if (event.key === 'End' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (max > 0) complete(max)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      const next = Math.min(max, offset + Math.max(12, max / 10))
      if (max > 0 && next / max >= COMPLETE_RATIO) complete(max)
      else setOffset(next)
    } else if (event.key === 'ArrowLeft' || event.key === 'Home') {
      event.preventDefault()
      setOffset(event.key === 'Home' ? 0 : Math.max(0, offset - Math.max(12, max / 10)))
    }
  }

  return <div ref={track} className="seal-harness-login-slider" data-verified={verified} role="slider" tabIndex={verified ? -1 : 0}
    aria-label={hint} aria-valuemin={0} aria-valuemax={100} aria-valuenow={verified ? 100 : maxOffset ? Math.round(offset / maxOffset * 100) : 0}
    aria-valuetext={verified ? verifiedLabel : hint} onKeyDown={keyDown} onPointerDown={startDrag}
    style={{ '--seal-slide-offset': `${offset}px` }}>
    <span className="seal-harness-login-slider__fill" aria-hidden="true" />
    <span className="seal-harness-login-slider__label" aria-hidden="true">{verified ? verifiedLabel : hint}</span>
    <span className="seal-harness-login-slider__thumb" aria-hidden="true">{verified ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4.5 4.5L19 7" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 5 7 7-7 7" /></svg>}</span>
  </div>
}
