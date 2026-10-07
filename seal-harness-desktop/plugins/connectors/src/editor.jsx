import React, { useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { readZip } from '../../capability-shared/src/files.js'
import { Dialog } from './dialog.jsx'

export function connectorDraft(item) {
  return item ? {
    id: item.id, name: item.name, summary: item.summary ?? '', category: item.category ?? 'office', transport: item.transport, command: item.command, args: item.args, cwd: item.cwd,
    url: item.url, headerEnvironment: item.headerEnvironment ?? {}, toolCallTimeoutMs: item.toolCallTimeoutMs, enabled: item.enabled, revision: item.revision,
    enabledTools: item.enabledTools, requiredHeaders: item.requiredHeaders, requiredEnv: item.requiredEnv,
  } : { id: `local-${crypto.randomUUID().slice(0, 8)}`, name: '', summary: '', category: 'office', transport: 'streamable-http', command: '', args: [], cwd: '', url: '', toolCallTimeoutMs: 60000, enabledTools: null, enabled: false }
}

export function connectorPayload(draft, headers, env, environmentPassthrough = [], environmentHeaders) {
  return {
    ...draft, args: draft.transport === 'stdio' ? draft.args.filter(Boolean) : [],
    command: draft.transport === 'stdio' ? draft.command : '', cwd: draft.transport === 'stdio' ? draft.cwd : '', url: draft.transport === 'stdio' ? '' : draft.url,
    environmentPassthrough: draft.transport === 'stdio' ? environmentPassthrough.filter(Boolean) : [],
    ...(draft.transport === 'stdio' ? { headerEnvironment: {} } : environmentHeaders ? { headerEnvironment: Object.fromEntries(environmentHeaders.filter(row => row.name && row.value).map(row => [row.name, row.value])) } : draft.headerEnvironment ? { headerEnvironment: draft.headerEnvironment } : {}),
    ...(draft.transport !== 'stdio' && headers.some(row => row.value) ? { headerValues: Object.fromEntries(headers.filter(row => row.value).map(row => [row.name, row.value])) } : {}),
    ...(draft.transport === 'stdio' && env.some(row => row.value) ? { envValues: Object.fromEntries(env.filter(row => row.value).map(row => [row.name, row.value])) } : {}),
  }
}

export function SecretFields({ title, rows, change, namePlaceholder = '名称', valuePlaceholder = '留空保留已保存的值', secret = true, addLabel = `添加${title}` }) {
  return <div className="mcp-config-list"><span className="mcp-config-list__label">{title}</span>{rows.map((row, index) => <div className="mcp-config-row" key={index}>
    <input aria-label={`${title}名称 ${index + 1}`} required value={row.name} placeholder={namePlaceholder} onChange={event => change(rows.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} />
    <input aria-label={`${title}值 ${index + 1}`} type={secret ? 'password' : 'text'} autoComplete="off" value={row.value} placeholder={valuePlaceholder} onChange={event => change(rows.map((value, i) => i === index ? { ...value, value: event.target.value } : value))} />
    <button type="button" className="mcp-config-row__remove" aria-label={`移除${title}字段 ${index + 1}`} onClick={() => change(rows.filter((_, i) => i !== index))}><Icon name="mcp-field-trash" size={16} strokeWidth={1.6} /></button>
  </div>)}<button type="button" className="mcp-config-list__add" onClick={() => change([...rows, { name: '', value: '' }])}><Icon name="plus" size={16} />{addLabel}</button></div>
}

export function StringFields({ title, rows, change, placeholder, addLabel, ariaPrefix = title }) {
  return <div className="mcp-config-list mcp-string-list"><span className="mcp-config-list__label">{title}</span>{rows.map((row, index) => <div className="mcp-config-row mcp-config-row--single" key={index}>
    <input aria-label={`${ariaPrefix} ${index + 1}`} required value={row} placeholder={placeholder} onChange={event => change(rows.map((value, i) => i === index ? event.target.value : value))} />
    <button type="button" className="mcp-config-row__remove" aria-label={`移除${title} ${index + 1}`} onClick={() => change(rows.filter((_, i) => i !== index))}><Icon name="mcp-field-trash" size={16} strokeWidth={1.6} /></button>
  </div>)}<button type="button" className="mcp-config-list__add" onClick={() => change([...rows, ''])}><Icon name="plus" size={16} />{addLabel}</button></div>
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

function PackageDrop({ state, disabled, inspect }) {
  const working = state.status === 'reading' || state.status === 'inspecting'
  const ready = state.status === 'ready'
  const failed = state.status === 'error'
  return <label className="mcp-package-drop" data-status={state.status} aria-label="拖入 STDIO 连接器包" aria-busy={working} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { event.preventDefault(); if (working) return; const file = event.dataTransfer.files?.[0]; if (file) void inspect(file) }}>
    <span className="mcp-package-drop__icon" aria-hidden="true"><Icon name="upload" size={28} /></span>
    {state.status === 'idle' ? <><strong>拖放 MCP ZIP 包到这里</strong><small>STDIO 连接器必须包含一个可在本机启动的 canonical MCP ZIP 程序包。</small></> : <>
      <strong>{state.status === 'reading' ? '正在读取 ZIP 包…' : state.status === 'inspecting' ? '正在解析并校验…' : ready ? 'MCP ZIP 包已就绪' : 'MCP ZIP 包处理失败'}</strong>
      <small className="mcp-package-drop__filename" title={state.fileName}>{state.fileName}</small>
      {working && <><span className="mcp-package-progress" role="progressbar" aria-label={`正在处理 ${state.fileName}`} aria-valuetext={state.status === 'reading' ? '正在读取文件' : '正在解析并校验'}><span /></span><small>大文件解析可能需要一些时间，请勿关闭窗口。</small></>}
      {ready && <small className="mcp-package-drop__result" role="status"><strong>已就绪</strong><span>{formatBytes(state.size)} · {state.preview.fileCount} 个文件 · v{state.preview.version}</span></small>}
      {failed && <small className="mcp-package-drop__result mcp-package-drop__result--error" role="status">未能完成解析，请重新选择有效的 ZIP 包。</small>}
    </>}
    {!working && <span className="btn btn--secondary">{ready || failed ? '重新选择 MCP ZIP 包' : '选择 MCP ZIP 包'}</span>}
    <input type="file" accept=".zip,application/zip" disabled={disabled || working} onChange={event => { const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = '' }} />
  </label>
}

// Stratex McpCreateWizard / McpCreateConnectionStep 的 React 移植，保留本地 Host 契约。
export function ConnectorEditor({ item, importOnly = false, busy, error, inspectPackage, savePackage, checkConnection, save, close }) {
  const [draft, setDraft] = useState(() => importOnly ? { ...connectorDraft(), transport: 'stdio' } : connectorDraft(item))
  const [argumentsList, setArgumentsList] = useState(() => connectorDraft(item).args)
  const [headers, setHeaders] = useState(() => item ? [...new Set([...(item.headers ?? []), ...(item.requiredHeaders ?? [])])].map(name => ({ name, value: '' })) : [{ name: '', value: '' }])
  const [environmentHeaders, setEnvironmentHeaders] = useState(() => item ? Object.entries(item.headerEnvironment ?? {}).map(([name, value]) => ({ name, value })) : [{ name: '', value: '' }])
  const [env, setEnv] = useState(() => [...new Set([...(item?.env ?? []), ...(item?.requiredEnv ?? [])])].map(name => ({ name, value: '' })))
  const [environmentPassthrough, setEnvironmentPassthrough] = useState(() => item?.environmentPassthrough ?? [])
  const [authMode, setAuthMode] = useState(item?.authorization ? 'oauth_authorization_code_pkce' : item?.headers?.length || item?.requiredHeaders?.length || Object.keys(item?.headerEnvironment ?? {}).length ? 'api_key' : 'none')
  const [packagePreview, setPackagePreview] = useState(null), [packageError, setPackageError] = useState('')
  const [packageState, setPackageState] = useState({ status: 'idle' }), packageGeneration = useRef(0)
  const [connectionCheck, setConnectionCheck] = useState({ status: 'idle' })
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  const changed = () => { setDirty(true); setConnectionCheck({ status: 'idle' }) }
  const field = (key, value) => { changed(); setDraft(current => ({ ...current, [key]: value })) }
  const requestClose = () => dirty ? setDiscard(true) : close()
  const inspectFile = async file => {
    const generation = ++packageGeneration.current
    const selected = { fileName: file.name, size: file.size }
    setPackagePreview(null)
    setPackageError('')
    setPackageState({ status: 'reading', ...selected })
    try {
      const zipBase64 = await readZip(file, 200)
      if (generation !== packageGeneration.current) return
      setPackageState({ status: 'inspecting', ...selected })
      const preview = await inspectPackage({ fileName: file.name, zipBase64 })
      if (generation !== packageGeneration.current) return
      setPackagePreview(preview)
      setPackageState({ status: 'ready', ...selected, preview })
      setDirty(true)
      setDraft(current => ({ ...current, name: current.name || preview.name, summary: current.summary || preview.summary, command: preview.executable }))
      setArgumentsList(preview.args)
      setEnv([...preview.environmentVariables, ...preview.requiredEnv.filter(name => !preview.environmentVariables.some(row => row.name === name)).map(name => ({ name, value: '' }))])
      setEnvironmentPassthrough(preview.environmentPassthrough)
    } catch (failure) {
      if (generation !== packageGeneration.current) return
      setPackageState({ status: 'error', ...selected })
      setPackageError(failure.message)
    }
  }
  return <>
    <Dialog closeIconName="mcp-close" closeIconStrokeWidth={1.6} title={item ? `编辑 ${item.name}` : importOnly ? '导入连接器' : '添加 MCP 连接器'} className="mcp-dialog mcp-create-dialog" busy={busy} close={requestClose}>
      <form onSubmit={event => {
        event.preventDefault()
        const enabled = event.nativeEvent.submitter?.value === 'enable'
        if (packagePreview) savePackage({ token: packagePreview.token, name: draft.name, summary: draft.summary, category: draft.category, command: draft.command, args: argumentsList.filter(Boolean), envValues: Object.fromEntries(env.filter(row => row.name && row.value).map(row => [row.name, row.value])), environmentPassthrough: environmentPassthrough.filter(Boolean), enabled })
        else save({ ...connectorPayload({ ...draft, args: argumentsList, enabled }, headers, env, environmentPassthrough, environmentHeaders), ...(!item && draft.transport !== 'stdio' ? { authMode } : {}) })
      }}>
        <div className="mcp-create-body"><fieldset disabled={busy} className="zz-reset-fieldset"><div className="mcp-create-single-page">
          {(packageError || error) && <p className="mcp-alert" role="alert">{packageError || error}</p>}
          {(draft.transport !== 'stdio' || item) && <section className="mcp-create-section mcp-create-identity"><div className="mcp-create-basics-row">
            <label className="mcp-field"><span>名称</span><input required maxLength={160} value={draft.name} onChange={event => field('name', event.target.value)} placeholder="例如：企业数据查询" /></label>
            <label className="mcp-field"><span>分类</span><select value={draft.category} onChange={event => field('category', event.target.value)}><option value="office">办公类</option><option value="development">开发类</option></select></label></div><label className="mcp-field"><span>描述</span><textarea rows={2} maxLength={300} value={draft.summary} placeholder="告诉模型和使用者这个连接器能做什么" onChange={event => field('summary', event.target.value)} /></label></section>}
          <section className="mcp-create-section">
          {draft.transport === 'stdio' && !item && <PackageDrop state={packageState} disabled={busy} inspect={inspectFile} />}
          {!importOnly && <fieldset className="mcp-create-transport"><legend>类型</legend><div role="radiogroup" aria-label="MCP 传输类型">
            {Object.entries({ 'streamable-http': '流式 HTTP', sse: 'SSE', stdio: 'STDIO' }).map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={draft.transport === id} disabled={!!item} onClick={() => { field('transport', id); if (id !== 'stdio') { packageGeneration.current += 1; setPackagePreview(null); setPackageError(''); setPackageState({ status: 'idle' }) } }}>{label}</button>)}
          </div></fieldset>}
          {draft.transport !== 'stdio' ? <>
            <label className="mcp-field"><span>URL</span><input required type="url" value={draft.url} placeholder="https://mcp.example.com/mcp" onChange={event => field('url', event.target.value)} /></label>
            <fieldset className="mcp-create-transport"><legend>认证方式</legend><div role="radiogroup" aria-label="认证方式">{[['none', '无需认证'], ['api_key', '请求头认证'], ['oauth_authorization_code_pkce', '浏览器 OAuth']].map(([value, label]) => <button type="button" role="radio" aria-checked={authMode === value} disabled={!!item} key={value} onClick={() => { setAuthMode(value); changed() }}>{label}</button>)}</div></fieldset>
            <p className="mcp-muted">浏览器 OAuth 会自动发现授权服务，不需要填写授权地址、Client ID 或访问令牌。</p>
            {authMode === 'api_key' && <p className="mcp-muted">请在其他请求头中填写认证请求头；值只发送到本机 Host。</p>}
            <div className="mcp-create-subsection"><SecretFields title="其他请求头" rows={headers} change={rows => { changed(); setHeaders(rows) }} namePlaceholder="键" valuePlaceholder="值" secret={false} addLabel="添加标头" /></div>
            <div className="mcp-create-subsection"><SecretFields title="来自环境变量的请求头" rows={environmentHeaders} change={rows => { changed(); setEnvironmentHeaders(rows) }} namePlaceholder="键" valuePlaceholder="环境变量" secret={false} addLabel="添加变量" /></div>
            <div className="mcp-create-subsection mcp-connection-check"><div><strong>连接与工具</strong><span className="mcp-check-state" data-status={connectionCheck.status}>{connectionCheck.status === 'checking' ? '正在检查' : connectionCheck.status === 'ready' ? `已连接 · ${connectionCheck.toolCount} 个工具` : connectionCheck.status === 'error' ? '检查失败' : '尚未检查'}</span></div><button type="button" className="btn btn--secondary" disabled={busy || !draft.url} onClick={async () => {
              setConnectionCheck({ status: 'checking' })
              try {
                const result = await checkConnection({ ...connectorPayload({ ...draft, args: argumentsList, enabled: false }, headers, env, environmentPassthrough, environmentHeaders), ...(!item ? { authMode } : {}) })
                setConnectionCheck(result)
              } catch (failure) { setConnectionCheck({ status: 'error', error: failure.message }) }
            }}>检查连接</button><p>保存前先确认服务是否可连接，并查看它实际提供的工具。</p></div>
          </> : <>
            <label className="mcp-field"><span>启动命令</span><input required value={draft.command} onChange={event => field('command', event.target.value)} placeholder={packagePreview ? '包内可执行文件相对路径' : '可执行程序绝对路径'} /></label>
            <StringFields title="参数" rows={argumentsList} change={rows => { setDirty(true); setArgumentsList(rows) }} placeholder="参数" addLabel="添加参数" ariaPrefix="参数" />
            <div className="mcp-create-subsection"><SecretFields title="环境变量" rows={env} change={rows => { setDirty(true); setEnv(rows) }} namePlaceholder="键" valuePlaceholder="值" secret={false} addLabel="添加环境变量" /></div>
            <div className="mcp-create-subsection"><StringFields title="环境变量传递" rows={environmentPassthrough} change={rows => { setDirty(true); setEnvironmentPassthrough(rows) }} placeholder="变量名" addLabel="添加变量" ariaPrefix="环境变量传递" /></div>
          </>}
          {item && <p className="mcp-muted">敏感信息保存在本机，留空保留已保存的值。切换类型保留尚未保存的内容。</p>}
          </section>
          {item && <details className="mcp-create-secondary"><summary>高级设置</summary>{draft.transport === 'stdio' && <label className="mcp-field"><span>工作目录</span><input value={draft.cwd} onChange={event => field('cwd', event.target.value)} placeholder="留空使用应用工作目录" /></label>}<label className="mcp-field"><span>标识</span><input required pattern="[a-z][a-z0-9-]{1,27}" maxLength={28} disabled value={draft.id} onChange={event => field('id', event.target.value)} /></label><label className="mcp-field"><span>工具调用超时，毫秒</span><input type="number" min={1000} max={300000} step={1000} value={draft.toolCallTimeoutMs} onChange={event => field('toolCallTimeoutMs', Number(event.target.value))} /></label></details>}
        </div></fieldset></div>
        <footer className="mcp-dialog__footer">{item && <button type="button" className="btn btn--secondary" disabled={busy} onClick={requestClose}>取消</button>}<button className="btn btn--secondary" disabled={busy || !item && draft.transport === 'stdio' && !packagePreview} type="submit" value="save">保存</button><button className="btn btn--primary" disabled={busy || !item && draft.transport === 'stdio' && !packagePreview} type="submit" value="enable">{busy ? '正在保存…' : item ? '保存并启用' : '保存并安装'}</button></footer>
      </form>
    </Dialog>
    {discard && <Dialog closeIconName="mcp-close" closeIconStrokeWidth={1.6} title="有未保存的修改" className="mcp-dialog mcp-dialog--narrow" close={() => setDiscard(false)}><div className="mcp-dialog__body"><p>退出后这些修改将丢失。</p></div><footer className="mcp-dialog__footer"><button className="btn btn--secondary" onClick={() => setDiscard(false)}>继续编辑</button><button className="btn btn--danger" onClick={close}>放弃修改</button></footer></Dialog>}
  </>
}
