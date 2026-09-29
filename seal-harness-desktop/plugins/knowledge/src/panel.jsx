import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Catalog, scopes } from './catalog.jsx'
import { CollectionDetail, UploadDialog } from './detail.jsx'
import { ShareDialog } from './sharing.jsx'
import { ServiceSelector } from './services.jsx'
import { collectionCategory, Modal } from './ui.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'
export { Modal } from './ui.jsx'

const referenceText = (group) =>
  `请使用知识库资料集「${group.name}」（groupId: ${group.id}，revision: ${group.revision}）。先调用 knowledge_search 或 knowledge_navigate 读取原文，回答时标明文件名和位置。`

export function KnowledgePanel({ api, sessions, attach, refreshSessions, back }) {
  const [groups, setGroups] = useState([]),
    [installations, setInstallations] = useState([]),
    [detail, setDetail] = useState(null)
  const [activeId, setActiveId] = useState(null),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [listError, setListError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState(null),
    [targetType, setTargetType] = useState('')
  const [query, setQuery] = useState(''),
    [citations, setCitations] = useState(null),
    [upload, setUpload] = useState(null),
    [serviceEpoch, setServiceEpoch] = useState(0)
  const activeRef = useRef(null),
    lifetime = useRef(new AbortController()),
    uploadAbort = useRef(null),
    requestSeq = useRef(0),
    detailSeq = useRef(0),
    overlaySeq = useRef(0)
  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController()
    const signal = lifetime.current.signal
    api('status', {}, signal)
      .then((value) => {
        if (!signal.aborted) setTargetType(value.targetType)
      })
      .catch((error) => { if (!signal.aborted) fail(error) })
    return () => {
      lifetime.current.abort()
      uploadAbort.current?.abort()
    }
  }, [api])
  const call = useCallback(
    async (action, payload = {}, signal) => {
      const combined = signal ? AbortSignal.any([signal, lifetime.current.signal]) : lifetime.current.signal
      const value = await api(action, payload, combined)
      combined.throwIfAborted()
      return value
    },
    [api]
  )
  function fail(error) {
    if (!lifetime.current?.signal.aborted && error.name !== 'AbortError') setError(error.message)
  }
  const refresh = useCallback(
    async (showLoading = true) => {
      const sequence = ++requestSeq.current
      if (showLoading) setLoading(true)
      try {
        const listScopes = [...scopes.map(([scope]) => scope), 'installed', 'catalog']
        const values = await Promise.all(listScopes.map((scope) => call('list', { scope })))
        if (sequence !== requestSeq.current) return
        const merged = new Map()
        values.forEach((value, index) =>
          value.items.forEach((group) => {
            const previous = merged.get(group.id),
              scope = listScopes[index]
            const access =
              group.access !== undefined
                ? (group.access ?? 'viewer')
                : previous?.access || (scope === 'owned' ? 'owner' : 'viewer')
            merged.set(group.id, {
              ...group,
              access,
              catalogVisible: previous?.catalogVisible || scope === 'catalog',
              scopes: [...(previous?.scopes || []), scope]
            })
          })
        )
        setGroups([...merged.values()])
        setInstallations(values[0].installations)
        setListError('')
      } catch (error) {
        if (sequence === requestSeq.current && error.name !== 'AbortError') setListError(error.message)
      } finally {
        if (sequence === requestSeq.current) setLoading(false)
      }
    },
    [call]
  )
  useEffect(() => {
    void refresh()
    return () => {
      requestSeq.current++
    }
  }, [refresh])
  const loadDetail = useCallback(
    async (showLoading = false) => {
      if (!activeId || activeRef.current !== activeId) return
      const sequence = ++detailSeq.current
      if (showLoading) setDetailLoading(true)
      try {
        const value = await call('detail', { groupId: activeId })
        if (sequence === detailSeq.current && activeRef.current === activeId) setDetail(value)
      } catch (error) {
        if (sequence === detailSeq.current) fail(error)
      } finally {
        if (sequence === detailSeq.current) setDetailLoading(false)
      }
    },
    [activeId, call]
  )
  useEffect(() => {
    setDetail(null)
    setCitations(null)
    setQuery('')
    void loadDetail(true)
    return () => {
      detailSeq.current++
    }
  }, [loadDetail])
  useEffect(() => {
    if (
      !groups.some(
        (group) => group.lifecycle === 'processing' || ['pending', 'running'].includes(group.analysis?.status)
      ) &&
      !detail?.files.some((file) => ['queued', 'processing'].includes(file.status))
    )
      return
    const timer = setTimeout(() => {
      void loadDetail()
      void refresh(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [groups, detail, loadDetail, refresh])
  function openCollection(id) {
    overlaySeq.current++
    activeRef.current = id
    setActiveId(id)
    setModal(null)
    setError('')
  }
  function closeModal() {
    overlaySeq.current++
    setModal(null)
  }
  async function run(operation) {
    const signal = lifetime.current.signal
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      signal.throwIfAborted()
      return true
    } catch (error) {
      if (!signal.aborted) fail(error)
      return false
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  async function mutate(action, payload, message) {
    await call(action, payload)
    await refresh(false)
    await loadDetail()
    setNotice(message)
  }
  async function share(ids) {
    return run(async () => {
      const result = await call('share', { collectionIds: ids })
      setModal({ kind: 'shares', ...result })
    })
  }
  async function useInConversation(text) {
    const signal = lifetime.current.signal
    const sequence = overlaySeq.current
    await refreshSessions()
    if (signal.aborted || sequence !== overlaySeq.current) return
    setModal({ kind: 'conversation', text, sessions: sessions() })
  }
  async function preview(file) {
    const id = activeId,
      sequence = ++overlaySeq.current
    await run(async () => {
      const result = await call('preview', { groupId: id, fileId: file.id })
      if (sequence === overlaySeq.current && activeRef.current === id) setModal({ kind: 'preview', ...result })
    })
  }
  function download(file) {
    const anchor = document.createElement('a')
    anchor.href = `/api/seal-harness-knowledge/file?${new URLSearchParams({ groupId: activeId, fileId: file.id })}`
    anchor.download = file.fileName
    anchor.click()
  }
  function serviceChanged(snapshot) {
    lifetime.current.abort()
    lifetime.current = new AbortController()
    uploadAbort.current?.abort()
    requestSeq.current++
    detailSeq.current++
    setServiceEpoch((value) => value + 1)
    setTargetType(snapshot.services.find((row) => row.id === snapshot.activeServiceId)?.targetType || '')
    openCollection(null)
    setDetail(null)
    setCitations(null)
    setGroups([])
    setInstallations([])
    setBusy(false)
    setNotice('')
    void refresh()
  }
  async function uploadFiles(files) {
    if (!activeId || uploadAbort.current) return
    if (files.some((file) => !file.size || file.size > 1024 ** 3 || /^(audio|video)\//.test(file.type))) {
      setError('文件须非空、小于 1 GB，且不是音频或视频。')
      return
    }
    const controller = new AbortController()
    uploadAbort.current = controller
    const signal = AbortSignal.any([lifetime.current.signal, controller.signal])
    setError('')
    setNotice('')
    try {
      for (const file of files) {
        let uploadId
        try {
          signal.throwIfAborted()
          setUpload({ name: file.name, percent: 0, phase: '上传中' })
          const session = await api(
            'uploadStart',
            {
              groupId: activeId,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              sizeBytes: file.size
            },
            signal
          )
          uploadId = session.id
          signal.throwIfAborted()
          let offset = session.receivedBytes
          while (offset < file.size) {
            signal.throwIfAborted()
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result)
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(file.slice(offset, offset + 4 * 1024 * 1024))
            })
            const result = await call(
              'uploadChunk',
              { uploadId, offset, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) },
              signal
            )
            offset = result.receivedBytes
            setUpload({ name: file.name, percent: Math.floor((offset / file.size) * 100), phase: '上传中' })
          }
          setUpload({ name: file.name, percent: 100, phase: '提交索引' })
          await call('uploadComplete', { uploadId }, signal)
          uploadId = null
          await loadDetail()
          await refresh()
        } catch (error) {
          if (uploadId) {
            try {
              await api('uploadCancel', { uploadId })
            } catch (cancelError) {
              throw new Error(`${error.message}；服务端取消上传失败：${cancelError.message}`)
            }
          }
          throw error
        }
      }
      setModal(null)
      setNotice('资料已上传，正在建立索引。')
    } catch (error) {
      if (controller.signal.aborted && error.name === 'AbortError') setNotice('上传已取消。')
      else fail(error)
    } finally {
      uploadAbort.current = null
      if (!lifetime.current.signal.aborted) setUpload(null)
    }
  }
  const installed = (id) =>
    installations.find((row) => row.groupId === id && ['active', 'updating'].includes(row.status))
  const listed = groups.find((group) => group.id === activeId)
  const active =
    detail?.group.id === activeId
      ? { ...detail.group, access: detail.group.access === undefined ? listed?.access : detail.group.access }
      : listed
  const install = (group) => void run(() => mutate('install', { groupId: group.id }, '资料集已安装。'))
  const uninstall = (group) => void run(() => mutate('uninstall', { groupId: group.id }, '已卸载，原始文件保留。'))
  const use = (group) => void run(() => useInConversation(referenceText(group)))
  const confirm = (title, message, action) => setModal({ kind: 'confirm', title, message, action })
  const search = (
    <>
      <form
        className="zz-knowledge-search"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            const result = await call('search', { groupIds: [active.id], query, limit: 10 })
            if (activeRef.current === active.id) setCitations(result.citations)
          })
        }}
      >
        <label>
          检索当前资料集
          <input
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入问题或关键词"
          />
        </label>
        <button className="btn btn--primary" disabled={busy || !active?.conversationReady}>
          检索
        </button>
      </form>
      {citations && (
        <section aria-label="检索结果">
          <h3>{citations.length} 条引用</h3>
          {!citations.length && <p>未找到匹配片段，可调整问题或关键词。</p>}
          {citations.map((citation, index) => (
            <article className="zz-knowledge-citation" key={`${citation.chunkId}-${index}`}>
              <h4>
                {citation.fileName}
                {citation.page ? ` · 第 ${citation.page} 页` : ''}
              </h4>
              <p className="zz-knowledge-text">{citation.excerpt}</p>
              {citation.locator && (
                <small>
                  {citation.locator.title ||
                    citation.locator.sectionId ||
                    citation.locator.sheet ||
                    citation.locator.type}
                </small>
              )}
              <div className="zz-knowledge-actions">
                <button
                  className="btn btn--ghost"
                  disabled={!citation.generation || busy}
                  onClick={() =>
                    void run(async () => {
                      const id = active.id
                      const request = {
                        groupId: citation.groupId,
                        fileId: citation.fileId,
                        chunkId: citation.chunkId,
                        generation: citation.generation,
                        scope: 'section',
                        maxChars: 8000
                      }
                      const result = await call('read', request)
                      if (activeRef.current === id) setModal({ kind: 'evidence', request, result })
                    })
                  }
                >
                  读取原文
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() =>
                    void run(() => useInConversation(`${referenceText(active)}\n引用来源：${JSON.stringify(citation)}`))
                  }
                >
                  引用到会话
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  )
  return (
    <main className="zz-knowledge zz-resource-page library-page resource-page-shell" aria-label="知识库">
      <header className="resource-page-nav">
        <div className="resource-page-nav__path">
          {back && (
            <button className="resource-page-nav__back" aria-label="返回会话" onClick={back}>
              <Icon name="back" size={17} />
            </button>
          )}
          <strong>知识库</strong>
          <span className="resource-page-nav__badge">RESOURCE</span>
        </div>
        <div className="library-nav-actions">
          <span className="library-sync-state">
            <span className={listError ? 'is-offline' : ''} />
            {loading ? '同步中' : listError ? '未连接' : '已同步'}
          </span>
          <button
            className="library-refresh"
            aria-label="刷新资料集"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={() => setModal({ kind: 'editor' })}>
            新建资料集
          </button>
        </div>
      </header>
      <div className="library-page__content">
        <section className="resource-page-hero">
          <div className="resource-page-hero__copy">
            <p className="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p>
            <h1>知识库</h1>
            <p className="resource-page-hero__subtitle">
              发现、创建并安装资料集；安装后的知识库可在原生对话中引用和检索。
            </p>
          </div>
        </section>
        <div className="library-service-bar">
          <div>
            <strong>知识库服务</strong>
            <span>切换服务后同步刷新资料、权限和安装状态。</span>
          </div>
          <ServiceSelector api={api} disabled={!!upload || busy} changed={serviceChanged} />
        </div>
        {targetType === 'standalone' && (
          <form
            className="library-share-redeem"
            onSubmit={(event) => {
              event.preventDefault()
              const form = event.currentTarget,
                code = new FormData(form).get('code')
              void run(async () => {
                await call('redeem', { code })
                form.reset()
                await refresh(false)
                setNotice('共享资料集已添加。')
              })
            }}
          >
            <div>
              <strong>收到资料集授权码？</strong>
              <span>同一服务内粘贴即可获得只读权限。</span>
            </div>
            <input name="code" aria-label="授权码" placeholder="粘贴授权码" required minLength={20} maxLength={200} />
            <button className="btn btn--ghost" disabled={busy}>
              加入共享资料集
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              disabled={busy}
              onClick={() => setModal({ kind: 'shares' })}
            >
              已发出的分享
            </button>
          </form>
        )}
        {error && !activeId && !modal && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="knowledge-notice" role="status">
            {notice}
          </p>
        )}
        {listError ? (
          <div className="library-state">
            <span aria-hidden="true">↻</span>
            <strong>知识库服务暂未连接</strong>
            <p role="alert">{listError}</p>
            <button className="btn btn--primary" onClick={() => void refresh()}>
              重新连接
            </button>
          </div>
        ) : loading && !groups.length ? (
          <div className="library-state" role="status">
            <strong>正在读取资料集…</strong>
          </div>
        ) : (
          <Catalog
            key={serviceEpoch}
            collections={groups}
            installed={installed}
            busy={busy}
            sharingEnabled={targetType === 'standalone'}
            open={openCollection}
            create={() => setModal({ kind: 'editor' })}
            install={install}
            uninstall={uninstall}
            use={use}
            share={share}
          />
        )}
      </div>
      {active && (
        <CollectionDetail
          key={`${serviceEpoch}:${active.id}`}
          group={active}
          detail={detail}
          loading={detailLoading}
          error={error}
          busy={busy || !!upload}
          installed={installed(active.id)}
          targetType={targetType}
          api={call}
          close={() => openCollection(null)}
          edit={() => setModal({ kind: 'editor', group: active })}
          archive={() =>
            confirm(
              '删除资料集',
              '此操作会归档资料集，之后不能继续安装或检索。保留原始文件和审计记录，不会永久删除文件。',
              async () => {
                await call('archive', { groupId: active.id })
                openCollection(null)
                await refresh(false)
              }
            )
          }
          install={() => install(active)}
          uninstall={() => uninstall(active)}
          use={() => use(active)}
          share={() => void share([active.id])}
          upload={(files) => setModal({ kind: 'upload', files })}
          preview={preview}
          download={download}
          retry={(file) => void run(() => mutate('retry', { groupId: active.id, fileId: file.id }, '已重新提交索引。'))}
          remove={(file) =>
            confirm('永久删除资料？', `「${file.fileName}」及其解析内容将被永久删除，删除后无法恢复。`, () =>
              mutate('deleteFile', { groupId: active.id, fileId: file.id }, '文件已删除。')
            )
          }
          search={search}
        />
      )}
      {modal?.kind === 'upload' && active && (
        <UploadDialog
          group={active}
          initialFiles={modal.files}
          progress={upload}
          error={error}
          start={(files) => void uploadFiles(files)}
          cancel={() => uploadAbort.current?.abort()}
          close={() => {
            uploadAbort.current?.abort()
            closeModal()
          }}
        />
      )}
      {modal?.kind === 'shares' && (
        <ShareDialog api={call} code={modal.code} expiresAt={modal.expiresAt} close={closeModal} />
      )}
      {modal && !['upload', 'shares'].includes(modal.kind) && (
        <Modal
          title={
            modal.title ||
            {
              editor: modal.group ? '配置资料集' : '新建资料集',
              preview: modal.fileName,
              evidence: '引用原文',
              conversation: '加入原生会话'
            }[modal.kind]
          }
          description={modal.kind === 'editor' ? '资料集是导入、分享、安装和会话引用的最小单元。' : undefined}
          drawer={modal.kind === 'preview'}
          close={closeModal}
        >
          {modal.kind === 'editor' && (
            <CollectionForm
              group={modal.group}
              busy={busy}
              close={closeModal}
              save={(value) =>
                void run(async () => {
                  const result = await call('save', value)
                  closeModal()
                  await refresh(false)
                  openCollection(result.id)
                  if (activeId === result.id) await loadDetail()
                })
              }
            />
          )}
          {modal.kind === 'confirm' && (
            <>
              <div className="danger-box">{modal.message}</div>
              <div className="dialog-actions">
                <button className="btn btn--ghost" autoFocus onClick={closeModal}>
                  取消
                </button>
                <button
                  className="btn btn--danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await modal.action()
                      closeModal()
                    })
                  }
                >
                  确认
                </button>
              </div>
            </>
          )}
          {modal.kind === 'preview' && <pre>{modal.content}</pre>}
          {modal.kind === 'evidence' && (
            <>
              <h3>{modal.result.fileName}</h3>
              {modal.result.sections?.map((section) => (
                <section key={section.sectionId}>
                  <h4>{section.header || section.sectionId}</h4>
                  <pre>{section.text}</pre>
                </section>
              ))}
              <p>{modal.result.complete ? '此范围已读完' : '仍有后续原文'}</p>
              {modal.result.coverage?.warnings?.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
              {modal.result.nextCursor && (
                <button
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const request = { ...modal.request, cursor: modal.result.nextCursor }
                      const next = await call('read', request)
                      setModal({
                        ...modal,
                        request,
                        result: { ...next, sections: [...modal.result.sections, ...next.sections] }
                      })
                    })
                  }
                >
                  继续读取
                </button>
              )}
            </>
          )}
          {modal.kind === 'conversation' && (
            <>
              <p>引用将追加到所选会话的草稿；由你确认后发送。</p>
              {modal.sessions.length ? (
                <form
                  className="collection-dialog"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const id = new FormData(event.currentTarget).get('sessionId')
                    void run(async () => {
                      await attach(id, modal.text)
                      closeModal()
                    })
                  }}
                >
                  <label>
                    目标会话
                    <select name="sessionId" required>
                      {modal.sessions.map((session) => (
                        <option value={session.id} key={session.id}>
                          {session.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn--primary" disabled={busy}>
                    加入会话
                  </button>
                </form>
              ) : (
                <p>请先从工作空间创建一个原生会话，再来添加资料引用。</p>
              )}
            </>
          )}
          {busy && <p role="status">正在处理…</p>}
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </main>
  )
}
function CollectionForm({ group, busy, save, close }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        save({
          ...(group ? { groupId: group.id } : {}),
          name: data.get('name'),
          description: data.get('description'),
          categories: [data.get('category')],
          visibility: data.get('visibility')
        })
      }}
    >
      <div className="collection-dialog">
        <label>
          资料集名称
          <input name="name" defaultValue={group?.name || ''} required maxLength={256} autoFocus />
        </label>
        <label>
          说明
          <textarea name="description" defaultValue={group?.description || ''} maxLength={8000} rows={4} />
        </label>
        <label>
          类别
          <select name="category" defaultValue={group ? collectionCategory(group) : 'office'}>
            <option value="office">办公类</option>
            <option value="development">开发类</option>
          </select>
        </label>
        <label>
          访问范围
          <select name="visibility" defaultValue={group?.visibility || 'private'}>
            <option value="private">私有（仅所有者和被授权用户）</option>
            <option value="organization">公开（组织内登录用户可发现）</option>
          </select>
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={close}>
          取消
        </button>
        <button className="btn btn--primary" disabled={busy}>
          保存
        </button>
      </div>
    </form>
  )
}
