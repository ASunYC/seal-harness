import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'sealHarnessAuthClient']
const protocols = { ssh: { name: 'SSH', port: 22 }, rdp: { name: 'RDP', port: 3389 }, vnc: { name: 'VNC', port: 5900 } }
const blankHost = () => ({ name: '', config: { protocol: 'ssh', host: '', port: 22, username: '', identityFile: '', clientPath: '' } })
const endpoint = config => `${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`

function Dialog({ title, onClose, busy, children }) {
  const root = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    root.current.querySelector('input,button,select')?.focus()
    return () => previous?.isConnected && previous.focus()
  }, [])
  const key = event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const fields = [...root.current.querySelectorAll('button,input,select')].filter(field => !field.disabled)
    const first = fields[0], last = fields.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="seal-remote-backdrop"><section className="seal-remote-dialog" ref={root} role="dialog" aria-modal="true" aria-label={title} onKeyDown={key}><h2>{title}</h2>{children}</section></div>
}

function HostForm({ draft, setDraft, busy, save, close, error, platform }) {
  const set = (key, value) => setDraft(previous => ({ ...previous, config: { ...previous.config, [key]: value } }))
  const protocol = draft.config.protocol
  return <Dialog title={draft.id ? '编辑主机' : '添加主机'} busy={busy} onClose={close}>
    <form className="seal-remote-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>名称<input aria-label="主机名称" required maxLength={100} value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：开发服务器" /></label>
      <div className="seal-remote-form-grid"><label>协议<select aria-label="连接协议" value={protocol} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, config: { ...previous.config, protocol: event.target.value, port: protocols[event.target.value].port, identityFile: '', username: '', clientPath: '' } }))}>{Object.entries(protocols).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label>
        <label>端口<input aria-label="端口" type="number" min={1} max={65535} required value={draft.config.port} disabled={busy} onChange={event => set('port', event.target.value)} /></label></div>
      <label>服务器地址<input aria-label="服务器地址" required maxLength={253} value={draft.config.host} disabled={busy} onChange={event => set('host', event.target.value)} placeholder="IP 或主机名，不含协议和端口" /></label>
      {(protocol === 'ssh' || (protocol === 'rdp' && platform !== 'win32')) && <label>用户名<span className="seal-remote-optional">可选</span><input aria-label="用户名" maxLength={128} value={draft.config.username} disabled={busy} onChange={event => set('username', event.target.value)} placeholder={protocol === 'ssh' ? '留空使用 SSH 客户端默认用户' : '例如：Administrator 或 DOMAIN\\user'} /></label>}
      {protocol === 'rdp' && platform === 'win32' && <p className="seal-remote-note">Windows 远程桌面会在客户端登录窗口中询问用户名和密码。</p>}
      {protocol === 'ssh' && <label>私钥文件<span className="seal-remote-optional">可选</span><input aria-label="私钥文件" value={draft.config.identityFile} disabled={busy} onChange={event => set('identityFile', event.target.value)} placeholder="本机私钥文件的绝对路径，留空使用客户端默认配置" /></label>}
      <details><summary>客户端设置</summary><label>客户端程序<span className="seal-remote-optional">可选</span><input aria-label="客户端程序" value={draft.config.clientPath} disabled={busy} onChange={event => set('clientPath', event.target.value)} placeholder="程序的绝对路径，留空自动查找" /></label><p>SSH 使用 OpenSSH，RDP 使用系统远程桌面或 FreeRDP，VNC 使用 TigerVNC。此处不接受命令或附加参数。</p></details>
      <p className="seal-remote-note">密码、私钥口令和主机身份确认在客户端窗口中完成，Seal 不保存密码。</p>
      {error && <p role="alert" className="seal-remote-error">{error}</p>}
      <footer className="seal-remote-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="seal-remote-primary" disabled={busy}>{busy ? '正在保存…' : '保存主机'}</button></footer>
    </form>
  </Dialog>
}

function CheckResult({ result }) {
  if (!result) return null
  return <div className="seal-remote-check" role="status"><span data-ok={result.client.available}>客户端：{result.client.available ? '可用' : '不可用'}</span><span data-ok={result.network.reachable}>网络：{result.network.reachable ? '端口可达' : '端口不可达'}</span>
    {!result.client.available && <p>{result.client.reason}</p>}{!result.network.reachable && <p>{result.network.reason}</p>}
    <p>端口可达不代表协议、账号或登录已验证。</p></div>
}

export function RemoteDesktopPanel({ api }) {
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState('snapshot')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState(''), [protocol, setProtocol] = useState('all')
  const [draft, setDraft] = useState(null), [deleting, setDeleting] = useState(null), [checks, setChecks] = useState({})
  const lifetime = useRef(null), inFlight = useRef(false)
  const request = async (action, payload = {}) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) throw new Error('页面已关闭。')
    const value = await api(action, payload, controller.signal)
    // 原生客户端一旦交给用户，页面关闭不结束其会话；只丢弃旧页面的结果。
    controller.signal.throwIfAborted()
    return value
  }
  const run = async (key, operation) => {
    if (inFlight.current) return
    const controller = lifetime.current
    inFlight.current = true; setBusy(key); setError(''); setNotice('')
    try { await operation() }
    catch (cause) { if (!controller?.signal.aborted) setError(cause.message || '操作未完成，请重试。') }
    finally { if (!controller?.signal.aborted) { inFlight.current = false; setBusy('') } }
  }
  const refresh = () => run('snapshot', async () => { setSnapshot(await request('snapshot')); setChecks({}) })
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; inFlight.current = false
    void refresh()
    return () => controller.abort()
  }, [api])
  const save = () => run('save', async () => {
    const payload = { ...(draft.id ? { id: draft.id } : {}), name: draft.name, config: { ...draft.config, port: Number(draft.config.port), ...(snapshot.platform === 'win32' && draft.config.protocol === 'rdp' ? { username: '' } : {}) } }
    const { host } = await request('save', payload)
    setSnapshot(previous => ({ ...previous, hosts: [...previous.hosts.filter(item => item.id !== host.id), host] }))
    setChecks(previous => { const next = { ...previous }; delete next[host.id]; return next })
    setDraft(null); setNotice('主机配置已保存。')
  })
  const remove = () => run('delete', async () => {
    const id = deleting.id; await request('delete', { id })
    setSnapshot(previous => ({ ...previous, hosts: previous.hosts.filter(item => item.id !== id) }))
    setChecks(previous => { const next = { ...previous }; delete next[id]; return next })
    setDeleting(null); setNotice('主机配置已删除，已打开的客户端窗口不受影响。')
  })
  const check = host => run(`check:${host.id}`, async () => {
    const result = await request('check', { id: host.id })
    setChecks(previous => ({ ...previous, [host.id]: result }))
  })
  const connect = host => run(`connect:${host.id}`, async () => {
    const result = await request('connect', { id: host.id })
    setNotice(`${host.name}：${result.message || `${result.client} 客户端已启动，请在客户端窗口完成登录。`}`)
  })
  const needle = query.trim().toLocaleLowerCase()
  const visible = (snapshot?.hosts ?? []).filter(host => (protocol === 'all' || host.config.protocol === protocol) && `${host.name} ${host.config.host} ${host.config.username}`.toLocaleLowerCase().includes(needle))
  return <main className="seal-remote-page" data-seal-remote-desktop>
    <header className="seal-remote-header"><div><h1>远程主机</h1><p>管理服务器，通过 SSH、RDP 或 VNC 打开远程连接。</p></div><div className="seal-remote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void refresh()} aria-label="刷新主机列表">刷新</button><button type="button" className="seal-remote-primary" disabled={Boolean(busy) || !snapshot} onClick={() => { setError(''); setDraft(blankHost()) }}>添加主机</button></div></header>
    {!draft && !deleting && error && <p role="alert" className="seal-remote-error">{error}</p>}
    {notice && <p role="status" className="seal-remote-notice">{notice}</p>}
    <section className="seal-remote-clients" aria-label="本机连接客户端">{Object.entries(protocols).map(([id, item]) => {
      const client = snapshot?.clients[id]
      return <div key={id}><strong>{item.name}</strong><span data-available={Boolean(client?.available)}>{!snapshot ? (busy ? '正在检查…' : '未检查') : client?.available ? '客户端可用' : '未找到客户端'}</span>{client && !client.available && <p>{client.reason || '请安装客户端，或在主机配置中指定程序路径。'}</p>}</div>
    })}</section>
    <div className="seal-remote-toolbar"><input aria-label="搜索主机" placeholder="搜索名称、地址或用户名" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="筛选协议" value={protocol} onChange={event => setProtocol(event.target.value)}><option value="all">全部协议</option>{Object.entries(protocols).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><span>{visible.length} 台主机</span></div>
    {!snapshot && !error ? <p role="status">正在读取主机配置…</p> : visible.length ? <div className="seal-remote-hosts">{visible.map(host => <article className="seal-remote-host" key={host.id} data-host-id={host.id}>
      <div className="seal-remote-host-heading"><h2>{host.name}</h2><span className="seal-remote-protocol">{protocols[host.config.protocol].name}</span></div><p className="seal-remote-address">{endpoint(host.config)}</p>{host.config.username && <p>用户：{host.config.username}</p>}
      {host.config.clientPath && <p className="seal-remote-client-path" title={host.config.clientPath}>指定客户端：{host.config.clientPath}</p>}
      <CheckResult result={checks[host.id]} />
      <div className="seal-remote-actions"><button type="button" aria-label={`连接 ${host.name}`} className="seal-remote-primary" disabled={Boolean(busy)} onClick={() => void connect(host)}>{busy === `connect:${host.id}` ? '正在启动…' : '连接'}</button><button type="button" aria-label={`检查 ${host.name}`} disabled={Boolean(busy)} onClick={() => void check(host)}>{busy === `check:${host.id}` ? '正在检查…' : '检查'}</button><button type="button" aria-label={`编辑 ${host.name}`} disabled={Boolean(busy)} onClick={() => { setError(''); setDraft({ id: host.id, name: host.name, config: { ...host.config } }) }}>编辑</button><button type="button" aria-label={`删除 ${host.name}`} disabled={Boolean(busy)} onClick={() => { setError(''); setDeleting(host) }}>删除</button></div>
    </article>)}</div> : snapshot && <section className="seal-remote-empty"><strong>{snapshot.hosts.length ? '没有匹配的主机' : '添加第一台远程主机'}</strong><p>{snapshot.hosts.length ? '试试其他关键词或协议。' : '保存服务器地址和连接方式，随后使用客户端登录。'}</p></section>}
    <p className="seal-remote-note">连接会打开独立客户端窗口；登录、证书和主机身份确认在客户端完成。Seal 只报告客户端已启动，不判断远程登录状态。关闭此页面不会断开已打开的客户端。</p>
    {draft && <HostForm draft={draft} setDraft={setDraft} busy={Boolean(busy)} save={save} platform={snapshot.platform} close={() => { setDraft(null); setError('') }} error={error} />}
    {deleting && <Dialog title="删除主机配置" busy={Boolean(busy)} onClose={() => { setDeleting(null); setError('') }}><p>删除“{deleting.name}”的连接配置？已打开的客户端窗口不会关闭。</p>{error && <p role="alert" className="seal-remote-error">{error}</p>}<footer className="seal-remote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => { setDeleting(null); setError('') }}>取消</button><button type="button" disabled={Boolean(busy)} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</button></footer></Dialog>}
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-remote-desktop/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  ctx.effect(() => {
    const element = document.createElement('style'); element.textContent = styles; document.head.append(element)
    return () => element.remove()
  }, 'seal-harness remote host styles')
  function Panel() {
    const auth = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    return auth?.user ? <RemoteDesktopPanel key={`${auth.accountId}:${auth.epoch}`} api={api} /> : <main className="seal-remote-page"><header className="seal-remote-header"><div><h1>远程主机</h1><p>请先登录本地账号。</p></div></header></main>
  }
  ctx.inject(['sealHarnessNavigation'], inner => inner.effect(() => inner.sealHarnessNavigation.register({ id: 'remote-desktop', label: '远程主机', icon: 'desktop', order: 120, primary: true, Panel }), 'seal-harness remote host navigation'))
}
