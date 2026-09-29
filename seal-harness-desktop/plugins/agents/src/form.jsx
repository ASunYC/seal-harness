// 来源：Stratex WorkflowCreationModal.vue / LocalAutonomousPanel.vue。
import React, { useEffect, useRef, useState } from 'react'
import { Dialog } from './dialog.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { kinds, targets, targetIcon } from './instance-card.jsx'
import { RuntimeProgress } from './progress.jsx'

export function AgentForm({ api, initialKind, instances = [], onClose, onCreated }) {
  const kind = initialKind
  const [target, setTarget] = useState('local'), [step, setStep] = useState('target')
  const [form, setForm] = useState({ name: '', port: 43100, viewerPort: 19100, host: '', sshPort: 22, username: '', password: '', model: '', access: 'lan', adminUser: '', adminPassword: '', cwd: '' })
  const [models, setModels] = useState([]), [modelState, setModelState] = useState('loading'), [modelError, setModelError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [environment, setEnvironment] = useState(null), [portState, setPortState] = useState('idle')
  const [operation, setOperation] = useState(null), [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const content = useRef(null)
  useEffect(() => {
    const dialog = content.current
    const control = dialog?.querySelector('.creation-body input:not(:disabled), .creation-body select:not(:disabled), .creation-body button:not(:disabled)')
    ;(control ?? dialog)?.focus()
  }, [step])
  const onCreatedRef = useRef(onCreated); onCreatedRef.current = onCreated
  const native = target === 'local' && kind === 'autonomous'
  const waiting = busy || operation?.state === 'running'
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); if (key === 'port') setPortState('idle') }
  const request = input => api('request', { kind, target, request: input })
  useEffect(() => {
    const lifetime = new AbortController()
    api('models', {}, lifetime.signal).then(value => { if (!lifetime.signal.aborted) { setModels(value); setModelState('ready') } }).catch(cause => { if (!lifetime.signal.aborted) { setModelError(cause.message); setModelState('error') } })
    return () => lifetime.abort()
  }, [])
  useEffect(() => {
    if (operation?.state !== 'running' || target === 'local') return
    const lifetime = new AbortController()
    let timer
    const poll = async () => {
      try {
        const result = await api('request', { kind, target, request: { action: `${target}-catalog` } }, lifetime.signal)
        if (lifetime.signal.aborted) return
        if (result.operation?.id !== operation.id) throw new Error('发布任务已变化，请返回实例中心刷新状态。')
        setOperation(result.operation); setError('')
        if (result.operation.state === 'succeeded') { onCreatedRef.current(); return }
        if (result.operation.state === 'failed') { setError(result.operation.error ?? result.operation.stage); return }
      } catch (cause) { if (!lifetime.signal.aborted) setError(cause.message) }
      if (!lifetime.signal.aborted) timer = setTimeout(poll, 1500)
    }
    timer = setTimeout(poll, 1000)
    return () => { lifetime.abort(); clearTimeout(timer) }
  }, [operation?.id, operation?.state, target, kind])
  const work = async task => { if (waiting) return; setBusy(true); setError(''); try { await task() } catch (cause) { setError(cause.message) } finally { setBusy(false) } }
  const chooseTarget = value => {
    setTarget(value); setError(''); setEnvironment(null); setOperation(null); setPortState('idle'); setRequestId(crypto.randomUUID())
    let port = kind === 'flow' ? 43100 : 26106
    const used = instances.filter(item => item.kind === kind && item.target === value)
    while (used.some(item => item.port === port)) port += kind === 'flow' ? 1 : 10
    setForm(current => ({ ...current, name: `${kinds[kind]}智能体 ${instances.filter(item => item.kind === kind).length + 1}`, port, password: '', model: '' }))
    setStep(value === 'platform' || value === 'local' && kind === 'autonomous' ? 'config' : 'prepare')
    if (value === 'local' && kind === 'flow') {
      setBusy(true)
      api('request', { kind, target: value, request: { action: 'options' } }).then(setEnvironment).catch(cause => setError(cause.message)).finally(() => setBusy(false))
    }
  }
  const previous = () => { setError(''); setStep(step === 'config' && target !== 'platform' && !native ? 'prepare' : 'target') }
  const hostValid = form.host.trim().split('.').length === 4 && form.host.trim().split('.').every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  const host = { host: form.host.trim(), sshPort: Number(form.sshPort), username: form.username.trim(), password: form.password }
  const checkPort = async () => {
    setPortState('checking')
    try {
      const result = await request({ action: 'check-port', port: Number(form.port) })
      const available = result.available ?? result.portCheck?.available
      setPortState(available ? 'available' : 'unavailable')
      if (!available) throw new Error('本机端口已被占用，请更换端口后再试。')
    } catch (cause) { setPortState('error'); throw cause }
  }
  const connect = event => { event.preventDefault(); void work(async () => { await request({ action: 'remote-connect', input: host }); setStep('config') }) }
  const create = event => {
    event.preventDefault()
    if (!form.name.trim()) { setError('请输入智能体名称。'); return }
    void work(async () => {
      if (target === 'local' && kind === 'flow') await checkPort()
      const common = { requestId, name: form.name.trim() }, model = form.model ? JSON.parse(form.model) : null
      let input
      if (target === 'platform') input = common
      else if (native) input = { ...common, cwd: form.cwd, model }
      else {
        input = { ...common, port: Number(form.port), model }
        if (kind === 'autonomous') input.viewerPort = Number(form.viewerPort)
        else {
          input.access = form.access
          if (form.adminUser || form.adminPassword) input.administrator = { username: form.adminUser, password: form.adminPassword }
        }
        if (target === 'remote') Object.assign(input, host)
      }
      const result = await request({ action: `${target === 'local' ? '' : `${target}-`}create`, input })
      setOperation(result.operation ?? null)
      if (result.operation?.state === 'failed') throw new Error(result.operation.error ?? result.operation.stage)
      if (result.operation?.state !== 'running') onCreated()
    })
  }
  const steps = target === 'platform' || native ? ['发布位置', '配置并发布'] : ['发布位置', target === 'remote' ? '连接主机' : '检查本机', '配置并发布']
  const stepIndex = step === 'target' ? 0 : step === 'prepare' ? 1 : steps.length - 1
  const title = step === 'target' ? '选择发布位置' : step === 'prepare' ? target === 'remote' ? '连接固定主机' : '检查本机运行环境' : '配置并发布'
  return <Dialog onClose={onClose} busy={waiting}><div className="agent-local-ui"><section ref={content} className="creation-flow" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="za-create-title">
    <header className="creation-header"><div><h3 id="za-create-title">新建{kinds[kind]}智能体</h3><p className="creation-context"><strong>{title}</strong><span>{step === 'target' ? '先决定智能体在哪里运行，后续只显示相关设置。' : step === 'prepare' ? target === 'remote' ? '验证连接后再配置实例。' : '确认流程运行组件和容器环境已经就绪。' : native ? '设置名称、工作目录和模型，使用原生对话执行任务。' : '确认实例配置后开始发布。'}</span></p></div><button className="creation-close" type="button" aria-label="关闭新建智能体" disabled={waiting} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <ol className="creation-steps" aria-label="发布步骤">{steps.map((label, index) => <li key={label} className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''} aria-current={index === stepIndex ? 'step' : undefined}><span>{index < stepIndex ? <Icon name="check" size={15} /> : index + 1}</span>{label}</li>)}</ol>
    <div className="creation-body">
      {error && <p className="error creation-error" role="alert">{error}</p>}
      {operation?.state === 'running' ? <><RuntimeProgress operation={operation} name={form.name} title={`正在发布到${targets[target]}`} />{error && <div className="creation-actions"><button type="button" onClick={onClose}>返回实例列表</button></div>}</> : <>
      {step === 'target' && <><p className="creation-copy">本机适合个人使用；固定主机适合局域网共享；智枢适合统一云端发布与管理。</p><div className="target-choices">{[['local', '发布到本机', kind === 'autonomous' ? '使用原生对话，适合个人任务和调试。' : '适合个人试用和调试，需要本机运行组件。'], ['remote', '发布到固定主机', '连接 Linux 服务器，供可信局域网设备访问。'], ['platform', '发布到智枢', '由智枢统一分配云端运行环境，使用平台默认模型。']].map(([value, label, description]) => <button type="button" key={value} disabled={waiting} onClick={() => chooseTarget(value)}><Icon name={kind === 'flow' && value === 'platform' ? 'platform' : targetIcon(value)} size={22} /><strong>{label}</strong><span>{description}</span></button>)}</div><div className="creation-actions"><button onClick={onClose}>取消</button></div></>}
      {step === 'prepare' && target === 'local' && <><section className={environment?.available ? 'environment-ready' : 'environment-card'} role="status"><h4>{busy ? '正在检查本机运行环境…' : environment?.available ? '本机环境已就绪' : '本机运行环境需要处理'}</h4><p>{environment?.available ? '流程运行组件和容器环境已通过检查。' : environment?.dockerInstalled === false ? '未检测到 Docker 环境，请安装并启动 Docker Desktop 后重新检测。' : environment?.packAvailable === false ? '安装包未包含流程运行组件，请安装完整版。' : '首次使用需要准备本机运行环境。'}</p><div className="actions">{!environment?.available && environment?.packAvailable && environment?.dockerInstalled && <button disabled={waiting} onClick={() => void work(async () => { await request({ action: 'prepare' }); setEnvironment(await request({ action: 'options' })) })}>准备本机运行环境</button>}<button disabled={waiting} onClick={() => void work(async () => setEnvironment(await request({ action: 'options' })))}>重新检测</button></div></section><ul className="environment-checks"><li><span>流程运行组件</span><strong>{environment?.packAvailable ? '已包含' : '需要处理'}</strong></li><li><span>容器环境</span><strong>{environment?.dockerInstalled ? '运行正常' : '需要处理'}</strong></li></ul><div className="creation-actions split"><button disabled={waiting} onClick={previous}>上一步</button><button className="primary" disabled={waiting || !environment?.available} onClick={() => setStep('config')}>继续</button></div></>}
      {step === 'prepare' && target === 'remote' && <form onSubmit={connect}><div className="form-grid"><label>主机地址（IP）<input required disabled={waiting} value={form.host} onChange={event => update('host', event.target.value)} placeholder="例如 10.1.2.3" />{form.host && !hostValid && <span className="field-error">请输入合法的 IPv4 地址。</span>}</label><label>SSH 端口<input required disabled={waiting} type="number" min="1" max="65535" value={form.sshPort} onChange={event => update('sshPort', event.target.value)} /></label><label>SSH 用户名<input required disabled={waiting} autoComplete="username" value={form.username} onChange={event => update('username', event.target.value)} /></label><label>SSH 密码<input required disabled={waiting} type="password" autoComplete="current-password" value={form.password} onChange={event => update('password', event.target.value)} /></label></div><p className="help">密码由工作台安全保存，不写入界面日志或部署记录。</p><div className="creation-actions split"><button type="button" disabled={waiting} onClick={previous}>上一步</button><button type="submit" className="primary remote-connect-button" aria-busy={busy} disabled={waiting || !hostValid || !form.username.trim() || !form.password}>{busy && <Icon name="refresh" size={15} className="remote-connect-spinner" />}{busy ? '正在验证…' : '验证连接'}</button></div></form>}
      {step === 'config' && <form onSubmit={create}><div className="target-summary"><div><span className={`instance-kind ${target}`}><Icon name={kind === 'flow' && target === 'platform' ? 'platform' : targetIcon(target)} size={14} />{targets[target]}</span><strong>{target === 'platform' ? '由平台自动分配资源' : target === 'remote' ? `${form.host}:${form.sshPort}` : '当前设备'}</strong></div><button className="text-button" type="button" disabled={waiting} onClick={previous}>修改</button></div><div className="form-grid">
        <label>智能体名称<input autoFocus required maxLength={80} disabled={waiting} value={form.name} onChange={event => update('name', event.target.value)} /></label>
        {target !== 'platform' && <label>模型<select required={kind === 'flow'} disabled={waiting || modelState !== 'ready'} value={form.model} onChange={event => update('model', event.target.value)}><option value="">{kind === 'flow' ? '选择已配置的模型' : native ? '使用默认模型' : '稍后在管理页面配置'}</option>{models.map(item => <option key={`${item.connectionId}/${item.remoteModelId}`} value={JSON.stringify({ connectionId: item.connectionId, remoteModelId: item.remoteModelId })}>{item.label}</option>)}</select></label>}
        {native && <label className="za-wide">工作目录<input disabled={waiting} value={form.cwd} placeholder="留空使用用户目录" onChange={event => update('cwd', event.target.value)} /><span className="help">原生对话使用当前模型、技能和连接器。</span></label>}
        {target !== 'platform' && !native && <label>服务端口<input required disabled={waiting} type="number" min="1024" max={kind === 'autonomous' ? 65531 : 65535} value={form.port} onChange={event => update('port', event.target.value)} /><span className="help">通常无需修改，已避开同类实例端口。</span></label>}
        {target === 'remote' && kind === 'autonomous' && <label>地图服务端口<input required disabled={waiting} type="number" min="1024" max="65535" value={form.viewerPort} onChange={event => update('viewerPort', event.target.value)} /><span className="help">仅在使用地图能力时需要。</span></label>}
      </div>
      {target !== 'platform' && modelState !== 'ready' && <p className={modelError ? 'error' : 'help'} role={modelError ? 'alert' : 'status'}>{modelError || '正在读取模型配置…'}{modelState === 'error' && <button type="button" disabled={waiting} onClick={() => void work(async () => { setModels(await api('models')); setModelState('ready'); setModelError('') })}>重新读取模型</button>}</p>}
      {target !== 'platform' && modelState === 'ready' && !models.length && <p className="help">尚无可用模型，可在工作台模型设置中添加连接。</p>}
      {target === 'platform' && <p className="help platform-publish-note">智枢使用平台默认模型和云主机规格，提交后显示真实任务阶段，完成后可打开管理页面。</p>}
      {target !== 'platform' && kind === 'flow' && <details><summary>管理员与访问范围</summary><div className="form-grid"><label>管理员用户名<input minLength={3} disabled={waiting} value={form.adminUser} onChange={event => update('adminUser', event.target.value)} /></label><label>管理员密码<input type="password" minLength={12} autoComplete="new-password" disabled={waiting} value={form.adminPassword} onChange={event => update('adminPassword', event.target.value)} /></label></div>{target === 'local' && <label>访问范围<select value={form.access} disabled={waiting} onChange={event => update('access', event.target.value)}><option value="lan">局域网</option><option value="local">仅本机</option></select></label>}</details>}
      {target === 'local' && kind === 'flow' && <div className="actions"><button type="button" disabled={waiting} onClick={() => void work(checkPort)}>检查端口</button><span className="help" role="status">{{ idle: '发布前会再次检查端口。', checking: '正在检查端口…', available: '端口可用。', unavailable: '端口已被占用。', error: '端口检查未通过，请重试。' }[portState]}</span></div>}
      <div className="creation-actions split"><button type="button" disabled={waiting} onClick={previous}>上一步</button><button className="primary" disabled={waiting || !form.name.trim() || kind === 'flow' && target !== 'platform' && !form.model} type="submit">{busy ? '正在发布…' : operation?.state === 'failed' ? '重试发布' : '开始发布'}</button></div></form>}
      </>}
    </div>
  </section></div></Dialog>
}
