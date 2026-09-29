// 来源：Stratex WorkflowResources.vue。
import React, { useEffect, useRef, useState } from 'react'

const resourceKey = item => `${item.kind}:${item.collectionId ?? ''}:${item.sourceId}:${item.version}`
export function WorkflowResources({ api, instance }) {
  const [resources, setResources] = useState([]), [warnings, setWarnings] = useState([]), [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lifetime = useRef(null)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  const request = request => api('request', { kind: 'flow', target: 'local', request }, lifetime.current.signal)
  const refresh = async () => {
    setBusy(true); setError('')
    try { const value = await request({ action: 'resource-options' }); setResources(value.resources); setWarnings(value.warnings); setSelected([]); setLoaded(true) }
    catch (cause) { if (!lifetime.current.signal.aborted) setError(cause.message) } finally { setBusy(false) }
  }
  const install = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await request({ action: 'install-resources', id: instance.id, resources: resources.filter(item => selected.includes(resourceKey(item)) && !item.unavailableReason).map(({ kind, sourceId, version, collectionId }) => ({ kind, sourceId, version, ...(collectionId ? { collectionId } : {}) })) })
      setNotice('已添加到流程草稿。请在编排页选择对应能力，测试通过后再发布。'); setSelected([])
    } catch (cause) { if (!lifetime.current.signal.aborted) setError(cause.message) } finally { setBusy(false) }
  }
  return <section className="workflow-resources" aria-label="流程资源"><h3>工作台资源</h3><p>为当前实例添加 Skill、MCP 和资料。流程编辑与发布请前往管理页面。</p><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? '处理中…' : '选择工作台资源'}</button>
    {warnings.map((warning, index) => <p key={index} className="resource-warning" role="status">{warning}<button disabled={busy} onClick={() => void refresh()}>重试</button></p>)}
    {loaded && !resources.length && !warnings.length && <p role="status">暂无可添加资源。可先在技能页或知识库中添加，也可导入外部能力包。</p>}
    {!!resources.length && <div className="resource-list">{resources.map(resource => { const key = resourceKey(resource); return <label key={key}><input type="checkbox" disabled={busy || !!resource.unavailableReason || selected.length >= 32 && !selected.includes(key)} checked={selected.includes(key)} onChange={event => setSelected(current => event.target.checked ? [...current, key] : current.filter(item => item !== key))} /><span><strong>{resource.name}</strong> · {{ wiki: '知识库', skill: 'Skill', mcp: 'MCP' }[resource.kind]}<small>{resource.unavailableReason || resource.version}</small></span></label> })}<p>添加会将所选资源及必要的服务凭据交付到本机流程，保留已有外部导入资源。资料以当前正文快照交付。</p><button disabled={busy || instance.status !== 'ready' || !selected.length} onClick={() => void install()}>添加所选资源</button></div>}
    <p>也可在流程管理页的“能力配置”中导入外部能力包和资料。</p>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="resource-error">{error} <button disabled={busy} onClick={() => void refresh()}>重试</button></p>}
  </section>
}
