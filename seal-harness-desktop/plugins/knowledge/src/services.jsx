// 移植自 Stratex VaultKnowledgeServiceSelector；配置仍由Seal Harness services.yml 管理。
import React, { useEffect, useRef, useState } from 'react'
import { Modal } from './ui.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'

export function ServiceSelector({ api, disabled, changed }) {
  const [snapshot, setSnapshot] = useState(null),
    [editor, setEditor] = useState(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [deleting, setDeleting] = useState(false)
  const menu = useRef(null),
    controller = useRef(null)
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    api('configuration', {}, current.signal)
      .then((value) => {
        if (!current.signal.aborted) setSnapshot(value)
      })
      .catch((error) => {
        if (!current.signal.aborted) setError(error.message)
      })
    return () => current.abort()
  }, [api])
  const active = snapshot?.services.find((row) => row.id === snapshot.activeServiceId)
  function select(service) {
    setEditor(service)
    setDeleting(false)
    setError('')
    setNotice('')
  }
  async function update(action, payload) {
    const signal = controller.current.signal
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const before = snapshot?.services.find((row) => row.id === snapshot.activeServiceId)
      const value = await api(action, payload, signal)
      if (signal.aborted) return
      const after = value.services.find((row) => row.id === value.activeServiceId)
      setSnapshot(value)
      const selected =
        action === 'saveService'
          ? value.services.find((row) => row.id === payload.id) ||
            value.services.find((row) => !snapshot?.services.some((old) => old.id === row.id))
          : after
      select(selected || null)
      setNotice(
        action === 'saveService'
          ? '服务已保存。'
          : action === 'deleteService'
            ? '服务配置已移除。'
            : '已切换知识库服务。'
      )
      if (action !== 'saveService' || JSON.stringify(before) !== JSON.stringify(after)) changed(value)
    } catch (error) {
      if (!signal.aborted) setError(error.message)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <div className="knowledge-service">
      <details
        ref={menu}
        onKeyDown={(event) => {
          if (event.key === 'Escape') menu.current.open = false
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) menu.current.open = false
        }}
      >
        <summary
          className="knowledge-service__trigger"
          aria-label="选择知识库服务"
          onClick={(event) => {
            if (disabled || busy || !snapshot) event.preventDefault()
          }}
        >
          <span className="knowledge-service__identity">
            <span className={`knowledge-service__status ${!active?.baseUrl ? 'is-empty' : ''}`} />
            <span className="knowledge-service__name">{busy ? '正在切换…' : active?.name || '知识库服务'}</span>
          </span>
          <span className="knowledge-service__chevron" />
        </summary>
        <section className="knowledge-service__menu">
          <header>
            <strong>知识库服务</strong>
            <small>切换后同步刷新资料、权限和安装状态</small>
          </header>
          <div role="listbox" aria-label="已配置知识库服务">
            {snapshot?.services.map((service) => (
              <button
                className={`knowledge-service__option ${service.id === snapshot.activeServiceId ? 'is-selected' : ''}`}
                role="option"
                aria-selected={service.id === snapshot.activeServiceId}
                key={service.id}
                disabled={disabled || busy}
                onClick={() => {
                  menu.current.open = false
                  if (service.id !== snapshot.activeServiceId) void update('activateService', { serviceId: service.id })
                }}
              >
                <span>
                  <strong>{service.name}</strong>
                  <small>{service.baseUrl}</small>
                </span>
                {service.id === snapshot.activeServiceId && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          <button
            className="knowledge-service__configure"
            disabled={disabled || busy}
            onClick={() => {
              menu.current.open = false
              select(active || snapshot?.services[0] || null)
              setOpen(true)
            }}
          >
            <Icon name="settings" size={16} />管理知识库服务
          </button>
        </section>
      </details>
      {!snapshot && (
        <button className="btn btn--ghost" onClick={() => setOpen(true)}>
          管理知识库服务
        </button>
      )}
      {error && !open && (
        <p className="knowledge-service__error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <Modal
          wide
          title="配置知识库服务"
          description="填写服务名称和地址。保存后，可从服务菜单切换使用。"
          close={() => setOpen(false)}
        >
          <div className="configuration-layout">
            <aside className="configuration-list" aria-label="已配置服务">
              <button
                className={`configuration-add ${editor && !editor.id ? 'is-selected' : ''}`}
                disabled={busy}
                onClick={() => select({ name: '', baseUrl: '', targetType: 'standalone' })}
              >
                <Icon name="plus" size={16} />新增独立服务
              </button>
              {editor && !editor.id && (
                <div className="configuration-item is-draft">
                  <div className="configuration-item__main is-selected">
                    <strong>未命名独立服务</strong>
                    <small>请填写服务信息</small>
                  </div>
                </div>
              )}
              {snapshot?.services.map((service) => (
                <div className="configuration-item" key={service.id}>
                  <button
                    className={`configuration-item__main ${editor?.id === service.id ? 'is-selected' : ''}`}
                    disabled={busy}
                    onClick={() => select(service)}
                  >
                    <strong>
                      {service.name}
                      {snapshot.activeServiceId === service.id ? ' · 使用中' : ''}
                    </strong>
                    <small>{service.baseUrl}</small>
                  </button>
                </div>
              ))}
              {!snapshot?.services.length && (
                <p className="configuration-empty">尚未配置知识库服务。知识库功能暂停使用，不影响应用其他功能。</p>
              )}
            </aside>
            {editor ? (
              <form
                className="configuration-form"
                key={editor.id || 'new'}
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  void update('saveService', {
                    ...(editor.id ? { id: editor.id } : {}),
                    name: data.get('name'),
                    baseUrl: data.get('baseUrl'),
                    targetType: data.get('targetType')
                  })
                }}
              >
                <div className="configuration-form__heading">
                  <h3>{editor.id ? `编辑 ${editor.name}` : '新增独立知识库服务'}</h3>
                  <p>平台服务使用当前登录账号；独立服务自动登记本机客户端。</p>
                </div>
                <label>
                  <span>服务名称</span>
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={editor.name}
                    readOnly={editor.builtIn}
                    autoFocus={!editor.id}
                  />
                </label>
                <label>
                  <span>服务地址</span>
                  <input name="baseUrl" type="url" required defaultValue={editor.baseUrl} readOnly={editor.builtIn} />
                </label>
                <label>
                  <span>服务类型</span>
                  <select name="targetType" defaultValue={editor.targetType} disabled={editor.builtIn}>
                    <option value="standalone">独立知识库</option>
                    <option value="platform">平台知识库</option>
                  </select>
                </label>
                {editor.builtIn && (
                  <p className="configuration-form__hint">
                    这是Seal Harness默认服务，地址由统一配置提供；如需切换，请新增其他服务。
                  </p>
                )}
                {deleting && (
                  <p role="alert" className="configuration-error">
                    移除本地服务配置？远端资料与凭据保留。
                  </p>
                )}
                <div className="configuration-actions">
                  {editor.id && !editor.builtIn && (
                    <button
                      type="button"
                      className="btn btn--ghost configuration-delete"
                      disabled={busy}
                      onClick={() =>
                        deleting ? void update('deleteService', { serviceId: editor.id }) : setDeleting(true)
                      }
                    >
                      {deleting ? '确认移除' : '移除'}
                    </button>
                  )}
                  {editor.id && editor.id !== snapshot?.activeServiceId && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || disabled}
                      onClick={() => void update('activateService', { serviceId: editor.id })}
                    >
                      切换使用
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => (editor.id ? setOpen(false) : select(active || null))}
                  >
                    取消
                  </button>
                  <button className="btn btn--primary" disabled={busy || editor.builtIn}>
                    {busy ? '正在保存…' : '保存'}
                  </button>
                </div>
              </form>
            ) : (
              <section className="configuration-detail configuration-detail--empty">
                <div>
                  <span className="configuration-detail__eyebrow">知识库服务</span>
                  <h3>尚未配置知识库服务</h3>
                  <p>点击左侧“新增独立服务”完成配置。</p>
                </div>
              </section>
            )}
          </div>
          <div className="configuration-feedback">
            {error ? (
              <p className="configuration-error" role="alert">
                {error}
              </p>
            ) : (
              notice && (
                <p className="configuration-notice" role="status">
                  {notice}
                </p>
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
