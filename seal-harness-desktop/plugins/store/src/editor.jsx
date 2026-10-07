import React, { useEffect, useState } from 'react'
import { Tabs } from './catalog.jsx'

export function AssetEditor({ asset, collection, busy, save, close }) {
  const [fields, setFields] = useState(() => Object.fromEntries(Object.entries({ name: '', slug: '', summary: '', kind: collection === 'skills' ? 'skill' : 'tool', category: 'office', publisherTeam: '', tags: [], ...(collection === 'mcps' ? { metadata: { sourceType: 'external_mcp' } } : {}) }).map(([key, value]) => [key, key === 'metadata' ? { ...value, ...asset?.metadata } : asset?.[key] ?? value])))
  const [tab, setTab] = useState('basic')
  const change = (key, value) => setFields(current => ({ ...current, [key]: value }))
  return <form className="zz-cap-card" aria-label="能力信息编辑" onSubmit={event => { event.preventDefault(); save(fields) }}>
    <Tabs label="能力信息" items={{ basic: '基本信息', advanced: '高级设置' }} value={tab} onChange={setTab} className="skill-catalog-secondary-tabs" />
    <fieldset disabled={busy}>
      <div className="zz-cap-form-grid" hidden={tab !== 'basic'}>
        {collection === 'mcps' && <label>连接器类型<select disabled={!!asset} value={fields.metadata?.sourceType ?? 'external_mcp'} onChange={event => change('metadata', { sourceType: event.target.value })}><option value="external_mcp">MCP 服务</option><option value="http_adapter">HTTP 工具</option></select></label>}
        <label>名称<input required maxLength={160} value={fields.name} onInvalid={() => setTab('basic')} onChange={event => change('name', event.target.value)} /></label>
        <label>分类<select value={fields.category} onChange={event => change('category', event.target.value)}><option value="office">办公类</option><option value="development">开发类</option></select></label>
        <label className="span-all">用途简介<textarea required maxLength={2000} value={fields.summary} onInvalid={() => setTab('basic')} onChange={event => change('summary', event.target.value)} /></label>
        <label className="span-all">标签，逗号分隔<input value={fields.tags.join(',')} onChange={event => change('tags', event.target.value.split(',').filter(Boolean))} /></label>
      </div>
      <div className="zz-cap-form-grid" hidden={tab !== 'advanced'}>
        <label>技术标识<input required maxLength={160} value={fields.slug} onInvalid={() => setTab('advanced')} onChange={event => change('slug', event.target.value)} placeholder="report-helper" /></label>
        <label>发布团队<input maxLength={160} value={fields.publisherTeam} onChange={event => change('publisherTeam', event.target.value)} /></label>
      </div>
    </fieldset><div><button disabled={busy}>保存</button><button disabled={busy} type="button" onClick={close}>取消</button></div>
  </form>
}

export function VersionEditor({ value, collection, busy, save, close, api, httpAdapter = false }) {
  const [draft, setDraft] = useState(value ?? { version: '0.1.0', descriptor: { description: '', releaseNotes: '', ...(collection === 'mcps' ? { transport: 'http', ...(httpAdapter ? {} : { endpointTemplate: '' }), authMode: 'none' } : { entrypoint: 'SKILL.md' }) }, dependencies: [] })
  const [resources, setResources] = useState([])
  const [tab, setTab] = useState('overview')
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(['skills', 'mcps'].flatMap(collection => ['mine', 'published'].map(scope => api('store/list', { collection, scope }, controller.signal))))
      .then(lists => { if (!controller.signal.aborted) setResources([...new Map(lists.flat().map(item => [item.id, item])).values()]) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [api])
  const dependency = (index, patch) => setDraft(current => ({ ...current, dependencies: current.dependencies.map((item, position) => index === position ? { ...item, ...patch } : item) }))
  const [error, setError] = useState('')
  const change = (key, value) => setDraft(current => ({ ...current, descriptor: { ...current.descriptor, [key]: value } }))
  return <form className="zz-cap-card" aria-label="版本编辑" onSubmit={event => {
    event.preventDefault()
    save(draft)
  }}><p className="zz-cap-muted">{value ? `编辑草稿 ${value.version}` : '创建草稿版本'}</p><Tabs label="版本编辑页签" items={{ overview: '基本信息', advanced: '技术配置', dependencies: '依赖能力' }} value={tab} onChange={setTab} className="skill-catalog-secondary-tabs" />
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy}><div className="zz-cap-form-grid" hidden={tab !== 'overview'}>
      <label>版本<input required onInvalid={() => setTab('overview')} maxLength={64} disabled={!!value} value={draft.version} onChange={event => setDraft(current => ({ ...current, version: event.target.value }))} /></label>
      <label className="span-all">使用说明<textarea onInvalid={() => setTab('overview')} required maxLength={10000} value={draft.descriptor.description} onChange={event => change('description', event.target.value)} /></label>
      <label className="span-all">版本说明<textarea maxLength={10000} value={draft.descriptor.releaseNotes} onChange={event => change('releaseNotes', event.target.value)} /></label>
      </div><div className="zz-cap-form-grid" hidden={tab !== 'advanced'}>
      {collection === 'skills' && <label>技能入口<input value={draft.descriptor.entrypoint ?? ''} onChange={event => change('entrypoint', event.target.value)} /></label>}
      {collection === 'mcps' && !httpAdapter && <><label>传输<select value={draft.descriptor.transport ?? 'http'} onChange={event => change('transport', event.target.value)}><option value="http">Streamable HTTP</option><option value="stdio">本地程序 stdio</option><option value="sse">SSE</option></select></label><label>MCP 地址<input value={draft.descriptor.endpointTemplate ?? ''} onChange={event => change('endpointTemplate', event.target.value)} /></label><label>认证方式<select value={draft.descriptor.authMode ?? 'none'} onChange={event => change('authMode', event.target.value)}><option value="none">无需认证</option><option value="api_key">API Key</option><option value="oauth_authorization_code_pkce">OAuth</option><option value="token_exchange">令牌交换</option></select></label></>}
      </div>
      <section hidden={tab !== 'dependencies'} aria-label="版本依赖" onInvalid={() => setTab('dependencies')}><h3>依赖能力</h3>{draft.dependencies.map((item, index) => <div className="zz-cap-toolbar" key={index}><label>技能或连接器<select required value={item.assetId} onChange={event => { const asset = resources.find(asset => asset.id === event.target.value); dependency(index, { assetId: event.target.value, versionRange: asset?.latestVersion?.version ?? asset?.draftVersion?.version ?? '*' }) }}><option value="">选择能力</option>{item.assetId && !resources.some(asset => asset.id === item.assetId) && <option value={item.assetId}>原依赖 {item.assetId}</option>}{resources.filter(asset => asset.id === item.assetId || !draft.dependencies.some(other => other.assetId === asset.id)).map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.collection === 'mcps' ? '连接器' : '技能'}</option>)}</select></label><label>版本范围<input required maxLength={128} value={item.versionRange} onChange={event => dependency(index, { versionRange: event.target.value })} placeholder="例如 ^1.0.0" /></label><label><input type="checkbox" checked={item.optional} onChange={event => dependency(index, { optional: event.target.checked })} />可选依赖</label><button type="button" onClick={() => setDraft(current => ({ ...current, dependencies: current.dependencies.filter((_, position) => position !== index) }))}>移除依赖</button></div>)}<button type="button" onClick={() => setDraft(current => ({ ...current, dependencies: [...current.dependencies, { assetId: '', versionRange: '*', optional: false }] }))}>添加依赖</button></section>
    </fieldset><p>包内文件与高级连接配置通过 ZIP 上传。已有认证凭据会保留在服务端。</p><div><button disabled={busy}>保存草稿</button><button type="button" disabled={busy} onClick={close}>取消</button></div>
  </form>
}
