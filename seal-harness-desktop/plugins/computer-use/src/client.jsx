import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'sealHarnessAuthClient']
const modeName = mode => mode === 'vm' ? '虚拟机' : '本机'
const statusName = status => ({ running: '运行中', starting: '正在连接', error: '连接失败', stopped: '已停止', ready: '已连接' })[status] ?? status
const blankProfile = () => ({ name: '', mode: 'vm', driverPath: '', guestOS: 'linux', host: '', port: 22, username: '', identityFile: '', socket: '' })
const copyProfile = profile => ({ ...blankProfile(), ...profile })
const backgroundNote = '请先打开需要操作的应用。仅后台操作已打开窗口，不抢鼠标、不切换前台焦点；不支持后台的动作会拒绝执行。'

function useComputerApi(api, sessionId) {
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState('snapshot'), [error, setError] = useState('')
  const lifetime = useRef(null), pending = useRef(false)
  const request = async (action, payload = {}) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) throw new Error('页面已关闭。')
    const result = await api(action, payload, controller.signal)
    controller.signal.throwIfAborted()
    return result
  }
  const run = async (key, operation) => {
    if (pending.current) return
    const controller = lifetime.current
    pending.current = true; setBusy(key); setError('')
    try { return await operation() }
    catch (cause) { if (!controller?.signal.aborted) setError(cause.message || '操作未完成，请重试。') }
    finally { if (!controller?.signal.aborted) { pending.current = false; setBusy('') } }
  }
  const refresh = () => run('snapshot', async () => setSnapshot(await request('snapshot', sessionId ? { sessionId } : {})))
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; pending.current = false
    setSnapshot(null); void refresh()
    return () => controller.abort()
  }, [api, sessionId])
  return { snapshot, setSnapshot, busy, error, setError, run, request, refresh }
}

function ProfileForm({ draft, setDraft, busy, save, close, error }) {
  const root = useRef(null), local = draft.mode === 'local'
  useEffect(() => { const previous = document.activeElement; root.current.querySelector('input')?.focus(); return () => previous?.isConnected && previous.focus() }, [])
  const field = key => ({ value: draft[key] ?? '', disabled: busy, onChange: event => setDraft(previous => ({ ...previous, [key]: event.target.value })) })
  const keyDown = event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); close() }
    if (event.key !== 'Tab') return
    const fields = [...root.current.querySelectorAll('button,input,select')].filter(item => !item.disabled)
    const first = fields[0], last = fields.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="seal-computer-backdrop"><section className="seal-computer-dialog" ref={root} role="dialog" aria-modal="true" aria-label={local ? '本机设置' : draft.id ? '编辑虚拟机' : '添加虚拟机'} onKeyDown={keyDown}>
    <h2>{local ? '本机设置' : draft.id ? '编辑虚拟机' : '添加虚拟机'}</h2>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      {!local && <>
        <label>名称<input aria-label="目标名称" required maxLength={100} placeholder="例如：开发桌面" {...field('name')} /></label>
        <div className="seal-computer-form-grid"><label>来宾系统<select aria-label="来宾系统" value={draft.guestOS} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, guestOS: event.target.value, socket: event.target.value === 'win32' ? '\\\\.\\pipe\\cua-driver' : '' }))}><option value="linux">Linux</option><option value="win32">Windows</option><option value="darwin">macOS</option></select></label><label>SSH 端口<input aria-label="SSH 端口" type="number" min={1} max={65535} required {...field('port')} /></label></div>
        <label>SSH 地址<input aria-label="SSH 地址" required maxLength={253} placeholder="虚拟机 IP 或主机名，不含协议和端口" {...field('host')} /></label>
        <label>SSH 用户名<span className="seal-computer-optional">可选</span><input aria-label="SSH 用户名" maxLength={128} placeholder="留空使用 SSH 默认用户" {...field('username')} /></label>
        <label>SSH 私钥<span className="seal-computer-optional">可选</span><input aria-label="SSH 私钥" placeholder="本机私钥绝对路径，留空使用 SSH Agent 或默认密钥" {...field('identityFile')} /></label>
      </>}
      <label>{local ? '驱动程序' : '来宾驱动程序'}<span className="seal-computer-optional">可选</span><input aria-label="驱动程序" placeholder={local ? '留空使用 Seal 内置驱动' : '留空使用来宾 PATH 中的 cua-driver'} {...field('driverPath')} /></label>
      {!local && <><label>桌面服务端点<span className="seal-computer-optional">可选</span><input aria-label="桌面服务端点" placeholder={draft.guestOS === 'win32' ? '\\\\.\\pipe\\cua-driver' : '已登录来宾桌面的 Driver socket 路径'} {...field('socket')} /></label>
        <p className="seal-computer-help">虚拟机须先安装 Cua Driver、启用 SSH 密钥登录并确认主机指纹。Seal 不创建虚拟机，也不保存 SSH 密码。</p>
        <p className="seal-computer-help">{draft.guestOS === 'win32' ? 'Windows 来宾需先登录图形桌面并启动 Driver 服务；SSH 与桌面使用同一 Windows 账号，通过命名管道连接，不能使用 Session 0 桌面。' : draft.guestOS === 'darwin' ? 'macOS 来宾需在图形桌面授予 CuaDriver 辅助功能及屏幕录制权限，并保持已授权的应用服务运行。' : 'Linux 来宾需有已登录的图形桌面及 Driver 服务；填写该桌面的服务端点，避免 SSH 会话缺少显示环境。'}</p>
      </>}
      <p className="seal-computer-help">{backgroundNote}</p>
      {error && <p role="alert" className="seal-computer-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="seal-computer-primary" disabled={busy}>{busy ? '正在保存…' : '保存目标'}</button></footer>
    </form>
  </section></div>
}

function RuntimeStatus({ runtime }) {
  return <div className="seal-computer-runtime" role="status">{runtime ? <><strong>{runtime.targetName} · {statusName(runtime.status)}</strong><p>{modeName(runtime.mode)} · 仅后台{runtime.sessionId ? ` · 当前会话` : ''}</p>{runtime.issue && <p className="seal-computer-error">{runtime.issue}</p>}</> : <><strong>电脑操作未启用</strong><p>默认目标为本机，开启后仅允许后台操作。</p></>}</div>
}

export function ComputerUsePanel({ api, sessionId, sessionTitle }) {
  const state = useComputerApi(api, sessionId)
  const { snapshot, setSnapshot, busy, error, setError, run, request, refresh } = state
  const [selectedId, setSelectedId] = useState('local'), [draft, setDraft] = useState(null), [deleting, setDeleting] = useState(null), [diagnostic, setDiagnostic] = useState(null)
  const profiles = snapshot?.profiles ?? [], selected = profiles.find(profile => profile.id === selectedId) ?? profiles.find(profile => profile.id === 'local')
  useEffect(() => { setDiagnostic(null) }, [snapshot?.profiles])
  const save = () => run('save', async () => {
    const { profile } = await request('save', { profile: { ...draft, port: Number(draft.port) } })
    setSnapshot(previous => ({ ...previous, profiles: [...previous.profiles.filter(item => item.id !== profile.id), profile] }))
    setSelectedId(profile.id); setDiagnostic(null); setDraft(null)
  })
  const remove = () => run('delete', async () => {
    await request('delete', { id: deleting.id })
    setSnapshot(previous => ({ ...previous, profiles: previous.profiles.filter(item => item.id !== deleting.id) }))
    setDeleting(null); setSelectedId('local'); setDiagnostic(null)
  })
  const check = () => run('check', async () => { setDiagnostic(null); setDiagnostic({ id: selected.id, value: await request('check', { id: selected.id }) }) })
  const start = () => run('start', async () => { const result = await request('start', { sessionId, id: selected.id }); setSnapshot(previous => ({ ...previous, runtime: result.runtime })) })
  const stop = () => run('stop', async () => { await request('stop', { sessionId }); setSnapshot(previous => ({ ...previous, runtime: null })) })
  return <main className="seal-computer-page">
    <header className="seal-computer-header"><div><h1>电脑操作</h1><p>让当前智能体在本机或虚拟机桌面中完成任务。</p></div><div className="seal-computer-actions"><button type="button" aria-label="刷新电脑操作" disabled={Boolean(busy)} onClick={() => void refresh()}>刷新</button><button type="button" className="seal-computer-primary" disabled={Boolean(busy) || !snapshot} onClick={() => { setError(''); setDraft(blankProfile()) }}>添加虚拟机</button></div></header>
    <p className="seal-computer-background">{backgroundNote}</p>
    {!draft && !deleting && error && <p role="alert" className="seal-computer-error">{error}</p>}
    <div className="seal-computer-layout"><aside className="seal-computer-targets" aria-label="电脑操作目标">{profiles.map(profile => <button type="button" key={profile.id} data-target-id={profile.id} aria-label={`选择 ${profile.name}`} disabled={Boolean(busy)} aria-current={profile.id === selected?.id ? 'page' : undefined} onClick={() => { setSelectedId(profile.id); setDiagnostic(null); setError('') }}><strong>{profile.name}</strong><small>{modeName(profile.mode)}{profile.mode === 'local' ? ' · 默认' : ` · ${profile.host}`}</small></button>)}</aside>
      <section className="seal-computer-detail" aria-label="电脑操作详情">{!snapshot ? <p>{busy ? '正在读取目标…' : '读取失败，请重试。'}</p> : selected && <>
        <div className="seal-computer-detail-heading"><h2>{selected.name}</h2><span>{modeName(selected.mode)} · 仅后台</span></div>
        <p>{selected.mode === 'local' ? '使用当前电脑的桌面应用；不会切换到前台操作。' : `通过 SSH 连接 ${selected.host}:${selected.port}，操作虚拟机内已登录的桌面。`}</p>
        <div className="seal-computer-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void check()}>{busy === 'check' ? '正在检查…' : '检查连接'}</button><button type="button" disabled={Boolean(busy)} onClick={() => { setError(''); setDraft(copyProfile(selected)) }}>{selected.mode === 'local' ? '本机设置' : '编辑目标'}</button>{selected.mode !== 'local' && <button type="button" disabled={Boolean(busy)} onClick={() => { setError(''); setDeleting(selected) }}>删除目标</button>}</div>
        {diagnostic?.id === selected.id && <div className="seal-computer-diagnostic" role="status"><strong>{diagnostic.value.available ? '驱动检查通过' : '尚不可用'}</strong><p>{diagnostic.value.reason || (diagnostic.value.available ? '驱动可用；尚未开始操作，具体应用的后台能力以实际执行结果为准。' : '请检查驱动和桌面会话。')}</p>{diagnostic.value.version && <p>驱动版本：{diagnostic.value.version}</p>}</div>}
      </>}
      {sessionId && <p className="seal-computer-help">当前会话：{sessionTitle || '新会话'}</p>}
      <RuntimeStatus runtime={snapshot?.runtime} />
      {sessionId ? <div className="seal-computer-actions">{snapshot?.runtime ? <button type="button" disabled={Boolean(busy)} onClick={() => void stop()}>停止电脑操作</button> : <button type="button" className="seal-computer-primary" disabled={Boolean(busy) || !selected} onClick={() => void start()}>启用电脑操作</button>}</div> : <p className="seal-computer-help">请先打开一个会话，再到本设置页启用电脑操作。配置和检查不会开始操作电脑。</p>}
      </section>
    </div>
    {draft && <ProfileForm draft={draft} setDraft={setDraft} busy={Boolean(busy)} error={error} save={save} close={() => { setDraft(null); setError('') }} />}
    {deleting && <div className="seal-computer-backdrop"><section className="seal-computer-dialog" role="dialog" aria-modal="true" aria-label="删除电脑操作目标"><h2>删除目标</h2><p>确认删除“{deleting.name}”的连接配置？</p>{error && <p role="alert" className="seal-computer-error">{error}</p>}<footer><button type="button" disabled={Boolean(busy)} onClick={() => { setDeleting(null); setError('') }}>取消</button><button type="button" disabled={Boolean(busy)} onClick={() => void remove()}>确认删除</button></footer></section></div>}
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-computer-use/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = styles; document.head.append(element); return () => element.remove() }, 'seal-harness computer use styles')
  function SettingsPanel({ useSessions }) {
    const auth = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    const current = useSessions(value => Object.values(value.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0))
    return auth?.user ? <ComputerUsePanel key={`${auth.accountId}:${auth.epoch}:${current?.id ?? ''}`} api={api} sessionId={current?.id} sessionTitle={current?.title} /> : <main className="seal-computer-page"><h1>电脑操作</h1><p>请先登录本地账号。</p></main>
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'computer-use', order: 57, label: () => '电脑操作',
  }, SettingsPanel))
}
