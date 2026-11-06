import React, { useEffect, useRef, useState } from 'react'
import { pptxAssetBase as previewAssetBase } from './pptx-asset-path.js'

const timeoutMs = 30_000
const resourceLimits = { maxArchiveEntryBytes: 64 * 1024 * 1024, maxTotalInflatedBytes: 192 * 1024 * 1024 }

function mountViewer(Viewer, host, options) {
  const document = host.ownerDocument
  const descriptor = Object.getOwnPropertyDescriptor(document, 'addEventListener')
  const original = document.addEventListener
  const handlers = []
  const release = () => {
    for (const [listener, settings] of handlers.splice(0)) host.removeEventListener('keydown', listener, settings)
  }
  // XlsxViewer registers copy shortcuts at construction. Keep them within the sheet.
  Object.defineProperty(document, 'addEventListener', {
    configurable: true, writable: true, value(type, listener, settings) {
      if (type !== 'keydown') return original.call(this, type, listener, settings)
      host.addEventListener(type, listener, settings)
      handlers.push([listener, settings])
    },
  })
  try {
    return { viewer: new Viewer(host, options), release }
  } catch (error) {
    release()
    throw error
  } finally {
    if (descriptor) Object.defineProperty(document, 'addEventListener', descriptor)
    else delete document.addEventListener
  }
}

export function XlsxPreview({ base64, selectedSheet, onSheetChange }) {
  const host = useRef(null)
  const selection = useRef(selectedSheet)
  selection.current = selectedSheet
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = host.current
    const initialSheet = selection.current
    let mounted
    let active = true
    const dispose = () => {
      active = false
      clearTimeout(timer)
      mounted?.release()
      mounted?.viewer.destroy()
      mounted = undefined
    }
    const fail = message => {
      if (!active) return
      dispose()
      setError(message)
    }
    setReady(false)
    setError('')
    const timer = setTimeout(() => fail('表格预览超时，请尝试用系统应用打开。'), timeoutMs)
    void (async () => {
      const url = new URL(`${previewAssetBase}xlsx.mjs`, window.location.origin).href
      const { XlsxViewer } = await import(url)
      if (!active) return
      mounted = mountViewer(XlsxViewer, container, {
        mode: 'worker', useGoogleFonts: false, enableHyperlinks: false, hiddenSheetMode: 'skip',
        zoomMin: 0.5, zoomMax: 2, workerTimeoutMs: timeoutMs, resourceLimits,
        onError: () => fail('无法预览此工作簿，请尝试用系统应用打开。'),
        onSheetChange: index => {
          const name = mounted?.viewer.sheetNames[index]
          if (active && name !== undefined) onSheetChange(name)
        },
      })
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const viewer = mounted.viewer
      await viewer.load(bytes.buffer)
      if (!active) return
      const index = viewer.sheetNames.indexOf(initialSheet)
      if (index >= 0 && index !== viewer.sheetIndex) await viewer.goToSheet(index)
      if (!active) return
      const name = viewer.sheetNames[viewer.sheetIndex]
      if (name !== undefined) onSheetChange(name)
      clearTimeout(timer)
      setReady(true)
    })().catch(() => fail('无法预览此工作簿，请尝试用系统应用打开。'))
    return dispose
  }, [base64, onSheetChange])

  return <section className="seal-xlsx-preview" aria-label="Excel 预览" aria-busy={!ready && !error}>
    <div ref={host} className="seal-xlsx-viewer" tabIndex={0} aria-label="工作簿" onPointerDownCapture={() => {
      const container = host.current
      if (!container.contains(container.ownerDocument.activeElement)) container.focus({ preventScroll: true })
    }} />
    {!ready && !error && <p className="seal-xlsx-preview-message" role="status">正在渲染工作簿…</p>}
    {error && <p className="seal-xlsx-preview-message" role="alert">{error}</p>}
  </section>
}
