import React, { useEffect, useRef, useState } from 'react'
import { pptxAssetBase } from './pptx-asset-path.js'

const limits = { maxArchiveEntryBytes: 64 * 1024 * 1024, maxTotalInflatedBytes: 192 * 1024 * 1024 }

function decode(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function paint(canvas, bitmap) {
  if (!canvas) { bitmap.close(); return }
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const renderer = canvas.getContext('bitmaprenderer')
  if (renderer) { renderer.transferFromImageBitmap(bitmap); return }
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('当前环境无法显示幻灯片画面。') }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
}

function Thumbnail({ engine, index, ratio, selected, onSelect }) {
  const button = useRef(null)
  const canvas = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    if (button.current) observer.observe(button.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let active = true
    void engine.renderSlideToBitmap(index, { width: 180, dpr: 1 }).then(bitmap => {
      if (active) paint(canvas.current, bitmap)
      else bitmap.close()
    }).catch(() => {})
    return () => { active = false }
  }, [engine, index, visible])
  return <button ref={button} type="button" className="seal-pptx-thumbnail" aria-label={`第 ${index + 1} 页`} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(index)}>
    <span>{index + 1}</span><canvas ref={canvas} aria-hidden="true" style={{ aspectRatio: ratio }} />
  </button>
}

export function PptxPreview({ base64, index, onSelect }) {
  const [engine, setEngine] = useState(null)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(true)
  const [scale, setScale] = useState('fit')
  const canvas = useRef(null)
  const stage = useRef(null)

  useEffect(() => {
    let active = true
    let loaded = null
    setEngine(null)
    setError('')
    setRendering(true)
    const timeout = setTimeout(() => { active = false; setError('预览解析超时，请尝试用系统应用打开。') }, 30_000)
    void (async () => {
      const url = new URL(`${pptxAssetBase}pptx.mjs`, window.location.origin).href
      const { PptxPresentation } = await import(url)
      const presentation = await PptxPresentation.load(decode(base64), {
        mode: 'worker', useGoogleFonts: false, resourceLimits: limits, workerTimeoutMs: 30_000,
      })
      if (!active) { presentation.destroy(); return }
      loaded = presentation
      if (presentation.slideCount < 1) { presentation.destroy(); loaded = null; throw new Error('演示文稿没有可预览的幻灯片。') }
      if (index >= presentation.slideCount) onSelect(0)
      setEngine(presentation)
    })().catch(cause => {
      if (active) setError(cause?.message || '无法预览此演示文稿。')
    }).finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); loaded?.destroy() }
  }, [base64])

  useEffect(() => {
    if (!engine || index >= engine.slideCount) return
    let active = true
    setError('')
    setRendering(true)
    void engine.renderSlideToBitmap(index, { width: 960, dpr: Math.min(2, window.devicePixelRatio || 1) }).then(bitmap => {
      if (!active) { bitmap.close(); return }
      paint(canvas.current, bitmap)
      setRendering(false)
    }).catch(cause => { if (active) { setError(cause?.message || '幻灯片渲染失败。'); setRendering(false) } })
    return () => { active = false }
  }, [engine, index])

  const count = engine?.slideCount ?? 0
  const ratio = engine?.slideWidth && engine?.slideHeight ? `${engine.slideWidth} / ${engine.slideHeight}` : '16 / 9'
  const advance = delta => onSelect(Math.max(0, Math.min(count - 1, index + delta)))
  return <section className="seal-pptx-preview" aria-label="幻灯片预览" onKeyDown={event => {
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); advance(-1) }
    if (event.key === 'ArrowRight' && index < count - 1) { event.preventDefault(); advance(1) }
  }}>
    <div className="seal-pptx-preview-toolbar">
      <span>{count ? `${index + 1} / ${count} 页` : '正在准备预览…'}</span>
      <button type="button" className="seal-pptx-nav-button" aria-label="上一页" title="上一页" disabled={!count || index === 0} onClick={() => advance(-1)}>‹</button>
      <button type="button" className="seal-pptx-nav-button" aria-label="下一页" title="下一页" disabled={!count || index === count - 1} onClick={() => advance(1)}>›</button>
      <select aria-label="缩放" value={scale} onChange={event => setScale(event.target.value)}>
        <option value="fit">适应窗口</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option>
      </select>
      <button type="button" className="seal-pptx-play-button" aria-label="播放幻灯片" title="全屏播放" disabled={!count} onClick={() => { stage.current?.focus(); void stage.current?.requestFullscreen?.().catch(() => setError('无法进入全屏播放。')) }}>▶</button>
    </div>
    <div className="seal-pptx-preview-body">
      <nav className="seal-pptx-thumbnails" aria-label="幻灯片缩略图">
        {engine && Array.from({ length: count }, (_, slide) => <Thumbnail key={slide} engine={engine} index={slide} ratio={ratio} selected={slide === index} onSelect={onSelect} />)}
      </nav>
      <div ref={stage} tabIndex={0} className="seal-pptx-stage">
        <canvas ref={canvas} aria-label={`第 ${index + 1} 页幻灯片画面`} style={{ aspectRatio: ratio, width: scale === 'fit' ? 'min(100%, 960px)' : `${960 * Number(scale)}px` }} />
        {rendering && !error && <p role="status">正在渲染幻灯片…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </section>
}
