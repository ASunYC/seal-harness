import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { createWordModel, wordSaveBlocks } from './vendor/office/docs/word-model.ts'
import { wordExtensions } from './vendor/office/docs/word-schema.ts'
import { WordRibbon } from './vendor/office/docs/WordRibbon.tsx'
import { createSaveSerializer } from './vendor/office/docs/save-until-persisted.ts'
import { WordWorkerClient } from './word-worker-client.js'
import { DocumentHeader } from './document-header.jsx'

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
const fromBase64 = data => Uint8Array.from(atob(data), character => character.charCodeAt(0))
const twips = (value, fallback) => `${(Number.isFinite(value) && value >= 0 && value <= 40000 ? value : fallback) / 20}pt`
function toBase64(bytes) {
  let text = ''
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(text)
}

export function WordEditor({ target, api, setDirty, close }) {
  const [title, setTitle] = useState('Word 文档')
  const [status, setStatus] = useState('正在读取文档…')
  const [pageSettings, setPageSettings] = useState(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [dirty, setLocalDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const imageInput = useRef(null)
  const worker = useRef(null)
  const model = useRef(null)
  const leaseId = useRef(null)
  const revision = useRef(0)
  const persisted = useRef(0)
  const loaded = useRef(false)
  const serializer = useRef(createSaveSerializer())

  const editor = useEditor({
    extensions: wordExtensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: false,
    onUpdate: () => {
      if (!loaded.current) return
      revision.current += 1
      setLocalDirty(true)
      setDirty(true)
    },
  })

  useEffect(() => {
    if (!editor) return
    const controller = new AbortController()
    let runtime
    try { runtime = new WordWorkerClient() }
    catch (cause) { setError(cause.message); setStatus('引擎不可用'); return }
    worker.current = runtime
    loaded.current = false
    editor.setEditable(false, false)
    void (async () => {
      const opened = await api('open', target, controller.signal)
      if (controller.signal.aborted) return
      leaseId.current = opened.leaseId
      setTitle(opened.displayName)
      setStatus('正在解析 Word 文档…')
      const document = await runtime.parse(fromBase64(opened.data))
      if (controller.signal.aborted) return
      setPageSettings(document.pageSettings ?? null)
      if (document.protection?.enforced || document.writeProtection?.hash)
        throw new Error('此文档设置了编辑保护，请使用外部 Office 打开。')
      const nextModel = createWordModel(document.blocks)
      const blocks = nextModel.document.content ?? []
      const first = blocks.length > 192 ? 64 : blocks.length
      const initial = editor.schema.nodeFromJSON({ type: 'doc', content: blocks.slice(0, first) })
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, initial.content)
        .setMeta('officeLoad', true).setMeta('addToHistory', false))
      for (let start = first; start < blocks.length; start += 128) {
        await nextFrame()
        if (controller.signal.aborted) return
        const nodes = blocks.slice(start, start + 128).map(node => editor.schema.nodeFromJSON(node))
        editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, Fragment.fromArray(nodes))
          .setMeta('officeLoad', true).setMeta('addToHistory', false))
        setStatus(`正在装载 ${Math.min(start + 128, blocks.length)} / ${blocks.length}`)
      }
      if (controller.signal.aborted) return
      model.current = nextModel
      loaded.current = true
      editor.setEditable(true, false)
      setReady(true)
      setStatus('已完整装载 · 修改仅保存在本机工作区')
    })().catch(cause => {
      if (!controller.signal.aborted) { setError(cause.message); setStatus('装载失败') }
    })
    return () => {
      controller.abort()
      loaded.current = false
      runtime.dispose()
      worker.current = null
      const lease = leaseId.current
      leaseId.current = null
      if (lease) void api('close', { leaseId: lease }).catch(() => {})
    }
  }, [editor, target.sessionId, target.path, api])

  const save = useCallback(() => serializer.current(async () => {
    if (!editor || !loaded.current || !model.current || !worker.current || !leaseId.current) return false
    if (revision.current === persisted.current) return true
    const savingRevision = revision.current
    setSaving(true)
    setError('')
    try {
      const blocks = wordSaveBlocks(editor.getJSON(), model.current)
      const bytes = await worker.current.serialize(blocks)
      await api('save', { leaseId: leaseId.current, data: toBase64(bytes) })
      persisted.current = savingRevision
      const incomplete = revision.current !== persisted.current
      setLocalDirty(incomplete)
      setDirty(incomplete)
      setStatus(incomplete ? '此版本已保存，仍有后续修改' : '已保存到工作区')
      return true
    } catch (cause) {
      setError(cause.message)
      return false
    } finally { setSaving(false) }
  }, () => revision.current === persisted.current), [editor, api, setDirty])

  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    const onUnload = event => {
      if (revision.current !== persisted.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload) }
  }, [save])

  const leave = () => {
    if (dirty && !window.confirm('当前 Word 文档尚未保存。要放弃修改并关闭吗？')) return
    close()
  }
  const download = async () => {
    if (!leaseId.current || dirty) return
    setError('')
    try {
      const result = await api('download', { leaseId: leaseId.current })
      const url = URL.createObjectURL(new Blob([fromBase64(result.base64)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
      const link = document.createElement('a')
      link.href = url
      link.download = result.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError(cause.message) }
  }
  const insertImage = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editor) return
    if (file.size > 2 * 1024 * 1024 || !/^image\/(?:png|jpeg|gif)$/u.test(file.type)) {
      setError('图片须为 PNG、JPEG 或 GIF，且不超过 2 MiB。')
      return
    }
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('图片读取失败。'))
      reader.readAsDataURL(file)
    })
    editor.chain().focus().insertContent({ type: 'image', attrs: { src: source, alt: file.name } }).run()
  }

  const pageStyle = {
    '--page-width': twips(pageSettings?.pageWidth, 11906),
    '--page-height': twips(pageSettings?.pageHeight, 16838),
    '--margin-top': twips(pageSettings?.marginTop, 1440),
    '--margin-right': twips(pageSettings?.marginRight, 1440),
    '--margin-bottom': twips(pageSettings?.marginBottom, 1440),
    '--margin-left': twips(pageSettings?.marginLeft, 1440),
  }

  return <div className="seal-workspace-word-editor">
    <DocumentHeader title={title} path={target.path} format="docx" status={status} dirty={dirty} saving={saving}
      canSave={ready && dirty && !saving} canExport={ready && !dirty && !saving}
      onSave={() => void save()} onExport={() => void download()} onClose={leave} />
    {editor && <details className="seal-workspace-word-tools"><summary>格式与插入</summary>
      <WordRibbon editor={editor} disabled={!ready || saving} onImage={() => imageInput.current?.click()} onError={setError} />
    </details>}
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={event => void insertImage(event)} />
    {error && <p className="seal-workspace-word-error" role="alert">{error}</p>}
    <div className="seal-workspace-word-paper-scroll"><div className="seal-workspace-word-paper" style={pageStyle}><EditorContent editor={editor} /></div></div>
  </div>
}
