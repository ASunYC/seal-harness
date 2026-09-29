import React, { useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { readZip } from '../../capability-shared/src/files.js'
import { Dialog } from './dialog.jsx'

export function connectorDraft(item) {
  return item ? {
    id: item.id, name: item.name, summary: item.summary ?? '', category: item.category ?? 'office', transport: item.transport, command: item.command, args: item.args.join('\n'), cwd: item.cwd,
    url: item.url, toolCallTimeoutMs: item.toolCallTimeoutMs, enabled: item.enabled, revision: item.revision,
    enabledTools: item.enabledTools, requiredHeaders: item.requiredHeaders, requiredEnv: item.requiredEnv,
  } : { id: `local-${crypto.randomUUID().slice(0, 8)}`, name: '', summary: '', category: 'office', transport: 'streamable-http', command: '', args: '', cwd: '', url: '', toolCallTimeoutMs: 60000, enabledTools: null, enabled: false }
}

export function connectorPayload(draft, headers, env) {
  return {
    ...draft, args: draft.transport === 'stdio' ? draft.args.split('\n').filter(Boolean) : [],
    command: draft.transport === 'stdio' ? draft.command : '', cwd: draft.transport === 'stdio' ? draft.cwd : '', url: draft.transport === 'stdio' ? '' : draft.url,
    ...(draft.transport !== 'stdio' && headers.some(row => row.value) ? { headerValues: Object.fromEntries(headers.filter(row => row.value).map(row => [row.name, row.value])) } : {}),
    ...(draft.transport === 'stdio' && env.some(row => row.value) ? { envValues: Object.fromEntries(env.filter(row => row.value).map(row => [row.name, row.value])) } : {}),
  }
}

export function SecretFields({ title, rows, change }) {
  return <div className="mcp-config-list"><span className="mcp-config-list__label">{title}</span>{rows.map((row, index) => <div className="mcp-config-row" key={index}>
    <input aria-label={`${title}名称 ${index + 1}`} required value={row.name} placeholder="名称" onChange={event => change(rows.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} />
    <input aria-label={`${title}值 ${index + 1}`} type="password" autoComplete="off" value={row.value} placeholder="留空保留已保存的值" onChange={event => change(rows.map((value, i) => i === index ? { ...value, value: event.target.value } : value))} />
    <button type="button" className="mcp-config-row__remove" aria-label={`移除${title}字段 ${index + 1}`} onClick={() => change(rows.filter((_, i) => i !== index))}><Icon name="mcp-field-trash" size={16} strokeWidth={1.6} /></button>
  </div>)}<button type="button" className="mcp-config-list__add" onClick={() => change([...rows, { name: '', value: '' }])}><Icon name="plus" size={16} />添加{title}</button></div>
}

// Stratex McpCreateWizard / McpCreateConnectionStep 的 React 移植，保留本地 Host 契约。
export function ConnectorEditor({ item, busy, error, inspectPackage, savePackage, save, close }) {
  const [draft, setDraft] = useState(() => connectorDraft(item))
  const [headers, setHeaders] = useState(() => [...new Set([...(item?.headers ?? []), ...(item?.requiredHeaders ?? [])])].map(name => ({ name, value: '' })))
  const [env, setEnv] = useState(() => [...new Set([...(item?.env ?? []), ...(item?.requiredEnv ?? [])])].map(name => ({ name, value: '' })))
  const [authMode, setAuthMode] = useState(item?.authorization ? 'oauth_authorization_code_pkce' : item?.headers?.length || item?.requiredHeaders?.length ? 'api_key' : 'none')
  const [packagePreview, setPackagePreview] = useState(null), [packageError, setPackageError] = useState('')
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  const field = (key, value) => { setDirty(true); setDraft(current => ({ ...current, [key]: value })) }
  const requestClose = () => dirty ? setDiscard(true) : close()
  const inspectFile = async file => {
    setPackageError('')
    try {
      const preview = await inspectPackage({ fileName: file.name, zipBase64: await readZip(file, 200) })
      setPackagePreview(preview)
      setDirty(true)
      setDraft(current => ({ ...current, name: current.name || preview.name, summary: current.summary || preview.summary }))
      setEnv(current => [...new Set([...preview.requiredEnv, ...current.map(row => row.name)])].map(name => current.find(row => row.name === name) ?? { name, value: '' }))
    } catch (failure) { setPackageError(failure.message) }
  }
  return <>
    <Dialog closeIconName="mcp-close" closeIconStrokeWidth={1.6} title={item ? `编辑 ${item.name}` : '添加 MCP 连接器'} className="mcp-dialog mcp-create-dialog" busy={busy} close={requestClose}>
      <form onSubmit={event => {
        event.preventDefault()
        const enabled = event.nativeEvent.submitter?.value === 'enable'
        if (packagePreview) savePackage({ token: packagePreview.token, name: draft.name, summary: draft.summary, category: draft.category, envValues: Object.fromEntries(env.filter(row => row.name && row.value).map(row => [row.name, row.value])), enabled })
        else save({ ...connectorPayload({ ...draft, enabled }, authMode === 'api_key' ? headers : [], env), ...(!item && draft.transport !== 'stdio' ? { authMode } : {}) })
      }}>
        <div className="mcp-create-body"><fieldset disabled={busy} className="zz-reset-fieldset"><div className="mcp-create-single-page">
          {(packageError || error) && <p className="mcp-alert" role="alert">{packageError || error}</p>}
          <section className="mcp-create-section mcp-create-identity"><div className="mcp-create-basics-row">
            <label className="mcp-field"><span>名称</span><input required maxLength={160} value={draft.name} onChange={event => field('name', event.target.value)} placeholder="例如：企业数据查询" /></label>
            <label className="mcp-field"><span>分类</span><select value={draft.category} onChange={event => field('category', event.target.value)}><option value="office">办公类</option><option value="development">开发类</option></select></label></div><label className="mcp-field"><span>描述</span><textarea rows={2} maxLength={300} value={draft.summary} placeholder="告诉模型和使用者这个连接器能做什么" onChange={event => field('summary', event.target.value)} /></label></section>
          <section className="mcp-create-section"><fieldset className="mcp-create-transport"><legend>类型</legend><div role="radiogroup" aria-label="MCP 传输类型">
            {Object.entries({ 'streamable-http': '流式 HTTP', sse: 'SSE', stdio: 'STDIO' }).map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={draft.transport === id} disabled={!!item} onClick={() => { field('transport', id); if (id !== 'stdio') setPackagePreview(null) }}>{label}</button>)}
          </div></fieldset>
          {draft.transport !== 'stdio' ? <>
            <label className="mcp-field"><span>URL</span><input required type="url" value={draft.url} placeholder="https://mcp.example.com/mcp" onChange={event => field('url', event.target.value)} /></label>
            <fieldset className="mcp-create-transport"><legend>认证方式</legend><div role="radiogroup" aria-label="认证方式">{[['none', '无需认证'], ['api_key', '请求头认证'], ['oauth_authorization_code_pkce', '浏览器 OAuth']].map(([value, label]) => <button type="button" role="radio" aria-checked={authMode === value} disabled={!!item} key={value} onClick={() => { setAuthMode(value); setDirty(true) }}>{label}</button>)}</div></fieldset>
            {authMode === 'oauth_authorization_code_pkce' && <p className="mcp-muted">保存后在管理页完成浏览器授权。授权服务将从 MCP 地址自动发现。</p>}
            {authMode === 'api_key' && <SecretFields title="请求头" rows={headers} change={rows => { setDirty(true); setHeaders(rows) }} />}
          </> : <>
            {!item && !packagePreview && <label className="mcp-package-drop" aria-label="拖入 STDIO 连接器包" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void inspectFile(file) }}>
              <span className="mcp-package-drop__icon" aria-hidden="true"><Icon name="upload" size={28} /></span><strong>拖入 STDIO 连接器包</strong><small>或点击选择 ZIP 文件，最大 200 MiB</small><input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void inspectFile(file); event.target.value = '' }} />
            </label>}
            {!item && packagePreview && <section className="mcp-package-preview" aria-label="STDIO 连接器包预览"><span className="mcp-package-preview__icon"><Icon name="check" size={20} /></span><div><strong>{packagePreview.name}</strong><p>{packagePreview.summary || '本地 STDIO 连接器包'}</p><small>v{packagePreview.version} · {packagePreview.fileCount} 个文件 · {Math.ceil(packagePreview.byteSize / 1024)} KiB</small><code>{packagePreview.executable}{packagePreview.args.length ? ` ${packagePreview.args.join(' ')}` : ''}</code></div><button type="button" className="btn btn--secondary" onClick={() => { setPackagePreview(null); setPackageError('') }}>重新选择</button></section>}
            {!packagePreview && <><div className="mcp-create-divider"><span>或手动配置</span></div><label className="mcp-field"><span>启动命令</span><input required value={draft.command} onChange={event => field('command', event.target.value)} placeholder="可执行程序绝对路径" /></label>
            <label className="mcp-field"><span>参数，每行一个</span><textarea rows={3} value={draft.args} onChange={event => field('args', event.target.value)} /></label>
            <label className="mcp-field"><span>工作目录</span><input value={draft.cwd} onChange={event => field('cwd', event.target.value)} placeholder="留空使用应用工作目录" /></label></>}
            <SecretFields title="环境变量" rows={env} change={rows => { setDirty(true); setEnv(rows) }} />
          </>}
          <p className="mcp-muted">敏感信息保存在本机，留空保留已保存的值。切换类型保留尚未保存的内容。</p>
          </section>
          <details className="mcp-create-secondary"><summary>高级设置</summary><label className="mcp-field"><span>标识</span><input required pattern="[a-z][a-z0-9-]{1,27}" maxLength={28} disabled={!!item} value={draft.id} onChange={event => field('id', event.target.value)} /></label><label className="mcp-field"><span>工具调用超时，毫秒</span><input type="number" min={1000} max={300000} step={1000} value={draft.toolCallTimeoutMs} onChange={event => field('toolCallTimeoutMs', Number(event.target.value))} /></label></details>
        </div></fieldset></div>
        <footer className="mcp-dialog__footer"><button type="button" className="btn btn--secondary" disabled={busy} onClick={requestClose}>取消</button><button className="btn btn--secondary" disabled={busy} type="submit" value="save">保存</button><button className="btn btn--primary" disabled={busy} type="submit" value="enable">{busy ? '正在保存…' : '保存并启用'}</button></footer>
      </form>
    </Dialog>
    {discard && <Dialog closeIconName="mcp-close" closeIconStrokeWidth={1.6} title="有未保存的修改" className="mcp-dialog mcp-dialog--narrow" close={() => setDiscard(false)}><div className="mcp-dialog__body"><p>退出后这些修改将丢失。</p></div><footer className="mcp-dialog__footer"><button className="btn btn--secondary" onClick={() => setDiscard(false)}>继续编辑</button><button className="btn btn--danger" onClick={close}>放弃修改</button></footer></Dialog>}
  </>
}
