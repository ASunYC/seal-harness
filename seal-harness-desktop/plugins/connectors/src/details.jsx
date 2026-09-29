import React, { useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { ToolRunner } from './tool-runner.jsx'
import { Dialog } from './dialog.jsx'
import { connectorDraft, connectorPayload, SecretFields } from './editor.jsx'

export const statusLabels = { disabled: '已停用', active: '可用', inactive: '尚未连接', unconfigured: '需要配置', error: '需修复' }
export const statusTone = status => status === 'active' ? 'success' : status === 'error' ? 'danger' : status === 'unconfigured' ? 'warning' : 'neutral'

// 来源 McpRuntimePanel，操作仍使用连接器已提供的 revision 和初始化检查。
export function ConnectorRuntime({ item, busy, error, run, open, close, confirmRemove = false }) {
  const [remove, setRemove] = useState(confirmRemove)
  return <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title={item.name} className="mcp-runtime" busy={busy} close={close} renderHeader={titleId => <header className="mcp-runtime__header"><span className="mcp-runtime__icon" aria-hidden="true">{item.name.slice(0, 1)}</span><h2 id={titleId}>{item.name}</h2><span className="mcp-status" data-tone={statusTone(item.status)}>{statusLabels[item.status]}</span><button className="btn btn--ghost" type="button" disabled={busy} aria-label="关闭连接器管理" onClick={close}><Icon name="mcp-close-small" size={18} strokeWidth={1.6} /></button></header>}>
    <div className="mcp-runtime__body">
      {error && <p className="mcp-alert" role="alert">{error}</p>}
      <section className="mcp-runtime-summary" data-tone={statusTone(item.status)}><div><h3>{statusLabels[item.status]}</h3><p>{item.issue || (item.enabled ? '连接器已启用，工具执行沿用会话审批设置。' : '启用连接器后可在会话中使用。')}</p></div><button className="btn btn--primary" disabled={busy} onClick={() => item.status === 'unconfigured' ? open('credentials') : run(item.enabled ? 'reconnect' : 'setEnabled', item.enabled ? { id: item.id } : { id: item.id, revision: item.revision, enabled: true })}>{item.status === 'unconfigured' ? '配置访问凭据' : item.enabled ? '重新检查连接' : '启用连接器'}</button></section>
      <section className="mcp-runtime-row"><div><h3>连接设置</h3><p>敏感信息不会显示在页面中。</p></div><button className="btn btn--secondary" onClick={() => open('credentials')}>配置访问凭据</button></section>
      <section className="mcp-runtime-row"><div><h3>工具</h3><p>{item.tools.length ? `已发现 ${item.tools.length} 个工具。` : '连接检查后会显示服务提供的工具。'}</p><ul className="mcp-runtime-tools-summary__list">{item.tools.slice(0, 3).map(tool => <li key={tool.name}>{tool.name}</li>)}</ul></div><button className="btn btn--secondary" onClick={() => open('tools')}>查看工具</button></section>
      <details className="mcp-runtime-disclosure"><summary><strong>连接配置与版本</strong></summary><div className="mcp-runtime-disclosure__content mcp-stack"><p>{item.transport} · {item.source ? `v${item.source.version}` : '本地连接器'}</p><code>{item.transport === 'stdio' ? item.command : item.url}</code><button className="btn btn--secondary" onClick={() => open('edit')}>编辑连接配置</button></div></details>
      <details className="mcp-runtime-disclosure"><summary><strong>连接有问题？</strong></summary><div className="mcp-runtime-disclosure__content mcp-stack"><p>最近检查：{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : '尚未检查'}</p>{item.issue && <p role="status">{item.issue}</p>}<div className="mcp-inline-actions"><button className="btn btn--secondary" disabled={busy || !item.enabled} onClick={() => run('reconnect', { id: item.id })}>重新连接</button><button className="btn btn--secondary" disabled={busy} onClick={() => run('setEnabled', { id: item.id, revision: item.revision, enabled: !item.enabled })}>{item.enabled ? '停用' : '启用'}</button></div></div></details>
    </div><footer className="mcp-runtime__footer"><span className="mcp-muted">不再需要这个连接器？</span><button className="btn btn--danger" disabled={busy} onClick={() => setRemove(true)}>删除连接器</button></footer>
    {remove && <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title="删除连接器" className="mcp-dialog mcp-dialog--narrow" busy={busy} close={() => setRemove(false)}><div className="mcp-dialog__body"><p>删除「{item.name}」及其已保存的凭据？</p>{error && <p role="alert">{error}</p>}</div><footer className="mcp-dialog__footer"><button className="btn btn--secondary" disabled={busy} onClick={() => setRemove(false)}>取消</button><button className="btn btn--danger" disabled={busy} onClick={async () => { if (await run('remove', { id: item.id, revision: item.revision })) close() }}>确认删除</button></footer></Dialog>}
  </Dialog>
}

export function ConnectorCredentials({ item, busy, error, run, authorize, close }) {
  const [headers, setHeaders] = useState([...new Set([...item.headers, ...item.requiredHeaders])].map(name => ({ name, value: '' })))
  const [env, setEnv] = useState([...new Set([...item.env, ...(item.requiredEnv ?? [])])].map(name => ({ name, value: '' })))
  const [credentialValues, setCredentialValues] = useState({}), [subjectToken, setSubjectToken] = useState('')
  const [workspacePath, setWorkspacePath] = useState(item.workspacePath ?? ''), [authorization, setAuthorization] = useState(null), [clear, setClear] = useState(false)
  return <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title={`${item.name} · 访问凭据`} className="mcp-dialog mcp-dialog--narrow" busy={busy} close={close}>
    <form onSubmit={async event => { event.preventDefault(); if (await run('save', { ...connectorPayload(connectorDraft(item), headers, env), credentialValues: Object.fromEntries(Object.entries(credentialValues).filter(([, value]) => value)) })) close() }}>
      <div className="mcp-dialog__body mcp-stack"><fieldset className="zz-reset-fieldset mcp-stack" disabled={busy}>
        {error && <p role="alert" className="mcp-alert">{error}</p>}<p className="mcp-muted">仅更新你填写的值；留空保留已保存的凭据。</p>
        {item.authorization ? <section className="mcp-stack"><h3>浏览器授权</h3><p>{item.authorization.configured ? '已保存授权，可以重新授权。' : '在浏览器完成授权后返回此处。'}</p><button type="button" className="btn btn--primary" onClick={async () => { const result = await authorize(item); if (result) setAuthorization(result) }}>{item.authorization.configured ? '重新授权' : '浏览器授权'}</button>{authorization && <div role="status"><a href={authorization.url} target="_blank" rel="noreferrer">打开授权页面</a><button type="button" className="btn btn--secondary" onClick={async () => { if (await run('list')) close() }}>我已完成，刷新连接</button></div>}</section> : <SecretFields title={item.transport === 'stdio' ? '环境变量' : '请求头'} rows={item.transport === 'stdio' ? env : headers} change={item.transport === 'stdio' ? setEnv : setHeaders} />}
        {(item.credentialSlots ?? []).map(slot => <label className="mcp-field" key={slot.name}><span>{slot.name}{slot.required ? '（必填）' : ''}</span><input type="password" autoComplete="off" value={credentialValues[slot.name] ?? ''} onChange={event => setCredentialValues(current => ({ ...current, [slot.name]: event.target.value }))} /></label>)}
        {item.tokenExchange && <section className="mcp-stack"><label className="mcp-field"><span>用于交换的访问令牌</span><input type="password" autoComplete="off" value={subjectToken} onChange={event => setSubjectToken(event.target.value)} /></label><button type="button" className="btn btn--secondary" disabled={!subjectToken} onClick={async () => { if (await run('exchangeToken', { id: item.id, revision: item.revision, subjectToken })) { setSubjectToken(''); close() } }}>交换令牌</button></section>}
        <details><summary>工作区绑定</summary><div className="mcp-stack"><label className="mcp-field"><span>限定工作区</span><input value={workspacePath} onChange={event => setWorkspacePath(event.target.value)} placeholder="工作区绝对路径" /></label><button type="button" className="btn btn--secondary" disabled={!workspacePath} onClick={async () => { if (await run('prepareWorkspace', { id: item.id, revision: item.revision, path: workspacePath })) close() }}>{item.workspaceBootstrap ? '初始化并绑定工作区' : '绑定工作区'}</button></div></details>
        {(item.authorization?.configured || item.headers.length > 0) && <button type="button" className="btn btn--danger" onClick={() => setClear(true)}><Icon name="mcp-trash" size={15} strokeWidth={1.7} />清除认证并停用</button>}
      </fieldset></div><footer className="mcp-dialog__footer"><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>返回管理</button><button className="btn btn--primary" disabled={busy}>保存凭据</button></footer>
    </form>
    {clear && <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title="清除认证" className="mcp-dialog mcp-dialog--narrow" busy={busy} close={() => setClear(false)}><div className="mcp-dialog__body"><p>清除已保存的认证并停用此连接器？</p></div><footer className="mcp-dialog__footer"><button className="btn btn--secondary" disabled={busy} onClick={() => setClear(false)}>取消</button><button className="btn btn--danger" disabled={busy} onClick={async () => { if (await run('clearAuthorization', { id: item.id, revision: item.revision })) close() }}>确认清除</button></footer></Dialog>}
  </Dialog>
}

export function ConnectorTools({ item, busy, error, run, api, close }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(item.tools[0]?.name ?? '')
  const [enabled, setEnabled] = useState(item.enabledTools ?? item.tools.map(tool => tool.name))
  const tools = item.tools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const tool = item.tools.find(tool => tool.name === selected)
  return <Dialog closeIconName="mcp-close-small" closeIconStrokeWidth={1.6} title={`${item.name} · 工具`} className="mcp-dialog zz-tools-dialog" busy={busy} close={close}>
    {error && <p role="alert" className="mcp-alert">{error}</p>}<div className="zz-tools-layout"><aside className="zz-tools-list"><label className="mcp-field"><span>搜索工具</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>{tools.map(tool => <button className="zz-tool-option" aria-pressed={selected === tool.name} key={tool.name} onClick={() => setSelected(tool.name)}><strong>{tool.name}</strong><small>{tool.description}</small></button>)}{!tools.length && <p className="mcp-muted">{item.tools.length ? '没有匹配的工具。' : '连接检查后会显示服务提供的工具。'}</p>}</aside>
      <section className="zz-tool-detail">{tool ? <><h3>{tool.name}</h3><p>{tool.description}</p><label className="mcp-create-inline-check"><input type="checkbox" checked={enabled.includes(tool.name)} disabled={busy} onChange={event => setEnabled(event.target.checked ? [...enabled, tool.name] : enabled.filter(name => name !== tool.name))} />在会话中启用此工具</label><ToolRunner key={tool.name} item={item} tool={tool} api={api} busy={busy} /><details><summary>输入参数定义</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details></> : <p>选择一个工具查看参数。</p>}</section></div>
    <footer className="mcp-dialog__footer"><button className="btn btn--secondary" disabled={busy} onClick={close}>返回管理</button><button className="btn btn--primary" disabled={busy || !item.tools.length} onClick={async () => { if (await run('save', { ...connectorPayload(connectorDraft(item), [], []), enabledTools: enabled })) close() }}>保存工具选择</button></footer>
  </Dialog>
}
