import React, { useEffect, useState } from 'react'
import { configurableModels, reasoningLevels, reasoningUpdate } from './model-reasoning.js'

const css = `
.seal-reasoning-settings{margin:24px 0;padding:20px;border:1px solid var(--line,#454545);border-radius:14px;background:var(--panel,#242424);color:var(--ink,inherit)}
.seal-reasoning-settings h3{margin:0 0 8px;font-size:17px}.seal-reasoning-settings p{margin:0 0 16px;color:var(--muted2,#aaa);font-size:13px;line-height:1.6}
.seal-reasoning-settings label{display:grid;gap:7px;font-size:13px}.seal-reasoning-settings select,.seal-reasoning-settings input[type=text]{box-sizing:border-box;min-height:34px;padding:6px 9px;border:1px solid var(--line-strong,#555);border-radius:8px;background:var(--sunken,#181818);color:var(--ink,inherit);font:inherit}
.seal-reasoning-settings__fields{display:grid;gap:12px;max-width:660px}.seal-reasoning-settings__level{display:grid;grid-template-columns:22px 90px minmax(0,1fr);align-items:center;gap:8px}.seal-reasoning-settings__level input[type=text]{width:100%}
.seal-reasoning-settings button{min-height:34px;margin-top:12px;padding:6px 14px;border:1px solid var(--line-strong,#555);border-radius:8px;background:var(--raised,#333);color:var(--ink,inherit);cursor:pointer}.seal-reasoning-settings button:disabled{opacity:.55;cursor:default}
.seal-reasoning-settings [role=alert]{color:var(--danger-text,#ff8e8e)}.seal-reasoning-settings [role=status]{color:var(--ok,#78d99a)}
@media(max-width:600px){.seal-reasoning-settings__level{grid-template-columns:22px 75px minmax(0,1fr)}}
`

function initial(model) {
  if (model.reasoningEfforts === false) return { mode: 'disabled', values: {} }
  if (model.reasoningEfforts && typeof model.reasoningEfforts === 'object') {
    return { mode: 'custom', values: Object.fromEntries(Object.entries(model.reasoningEfforts).map(([key, value]) => [key, value ?? ''])) }
  }
  return { mode: 'inherit', values: {} }
}

function ModelEditor({ model, namespace, writable, save }) {
  const [draft, setDraft] = useState(() => initial(model))
  const [revision, setRevision] = useState(namespace.revision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const apply = async () => {
    setError(''); setNotice('')
    if (namespace.revision !== revision) { setError('模型设置已变化，请刷新后重试。'); return }
    let update
    try { update = reasoningUpdate(namespace, model.provider, model.id, { kind: draft.mode, values: draft.values }) }
    catch (cause) { setError(cause.message); return }
    setBusy(true)
    try {
      const result = await save(update)
      if (!result.ok) { setError(result.error.code === 'settings/conflict' ? '模型设置已变化，请刷新后重试。' : result.error.message); return }
      setRevision(result.value.revision)
      setNotice('推理档位已保存。')
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  return <div className="seal-reasoning-settings__fields">
    <label>推理能力
      <select value={draft.mode} disabled={!writable || busy} onChange={event => { setDraft(current => ({ ...current, mode: event.target.value })); setNotice('') }}>
        <option value="inherit">沿用模型目录（未声明则不显示）</option>
        <option value="disabled">不提供推理档位</option>
        <option value="custom">自定义支持的档位</option>
      </select>
    </label>
    {draft.mode === 'custom' && <><p>勾选模型实际支持的档位，并填写接口要求的请求值。Off 留空表示不发送参数；若接口要求关闭思考，请填写其真实值（如 none）。</p>{reasoningLevels.map(level => <label className="seal-reasoning-settings__level" key={level}><input type="checkbox" checked={Object.hasOwn(draft.values, level)} disabled={!writable || busy} onChange={event => setDraft(current => {
      const values = { ...current.values }
      if (event.target.checked) values[level] = ''
      else delete values[level]
      return { ...current, values }
    })} /><span>{level.toUpperCase()}</span><input type="text" aria-label={`${level} 请求值`} placeholder={level === 'off' ? '可留空' : '必填'} disabled={!writable || busy || !Object.hasOwn(draft.values, level)} value={draft.values[level] ?? ''} onChange={event => setDraft(current => ({ ...current, values: { ...current.values, [level]: event.target.value } }))} /></label>)}</>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div><button type="button" disabled={!writable || busy} onClick={apply}>{busy ? '正在保存…' : '保存推理档位'}</button></div>
  </div>
}

export function registerModelReasoningSettings(ctx) {
  function ReasoningSettings() {
    const [view, setView] = useState({ loading: true, namespace: null, writable: false, error: '' })
    const [choice, setChoice] = useState('')
    const load = async () => {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) { setView(current => ({ ...current, loading: false, error: result.error.message })); return }
      const namespace = result.value.namespaces.find(item => item.ns === 'llm-pi-ai')
      setView({ loading: false, namespace: namespace ?? null, writable: result.value.writable, error: namespace ? '' : '当前没有 pi-ai 模型配置。' })
    }
    useEffect(() => {
      let active = true
      const refresh = () => { void load().catch(error => { if (active) setView(current => ({ ...current, loading: false, error: error.message })) }) }
      refresh()
      const release = ctx.remote.$on('settings/document-updated', refresh)
      return () => { active = false; release() }
    }, [])
    const models = configurableModels(view.namespace)
    const selected = models.find(item => `${item.provider}\0${item.id}` === choice) ?? models[0]
    return <section className="seal-reasoning-settings" aria-label="自定义模型推理档位"><style>{css}</style><h3>自定义模型推理档位</h3><p>手动添加的模型需要按服务商文档声明支持的档位。配置后，对话中的模型菜单才会显示对应选项。</p>
      {view.loading ? <p role="status">正在读取模型配置…</p> : view.error ? <p role="alert">{view.error}</p> : models.length === 0 ? <p>暂无手动配置的模型。先在上方添加供应商和模型。</p> : <>
        <div className="seal-reasoning-settings__fields"><label>模型
          <select aria-label="配置推理档位的模型" value={`${selected.provider}\0${selected.id}`} onChange={event => setChoice(event.target.value)}>{models.map(item => <option key={`${item.provider}\0${item.id}`} value={`${item.provider}\0${item.id}`}>{item.provider} / {item.name}</option>)}</select>
        </label></div>
        <ModelEditor key={`${selected.provider}\0${selected.id}`} model={selected} namespace={view.namespace} writable={view.writable} save={async update => {
          const result = await ctx.remote.settings.mutate(update.namespace, update.operations, update.revision)
          if (result.ok) setView(current => ({ ...current, namespace: result.value }))
          return result
        }} />
      </>}
    </section>
  }
  return ctx.slots.inject('settings.models.footer', () => ctx.slots.register({ name: 'settings.models.footer', id: 'seal-harness-model-reasoning', order: 20 }, ReasoningSettings))
}
