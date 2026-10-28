import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'sealHarnessAuthClient']
const running = item => ['starting', 'checking', 'running', 'stopping'].includes(item.status)
const statuses = { starting: '正在启动', checking: '检查协议', running: '执行中', stopping: '正在清理', completed: '已完成', cancelled: '已取消', failed: '失败', timeout: '超时', blocked: '进程停止状态未知' }

export function AcpPanel({ api }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [editor, setEditor] = useState(null), [task, setTask] = useState(null), [prompt, setPrompt] = useState(''), [deleting, setDeleting] = useState(null)
  const alive = useRef(true), controller = useRef(null)
  const polling = data?.runs.some(running) ?? false
  const active = polling || (data?.runs.some(item => item.status === 'blocked') ?? false)
  const load = async () => {
    try { const value = await api('snapshot', {}, controller.current?.signal); if (alive.current) setData(value) }
    catch (cause) { if (alive.current && !controller.current?.signal.aborted) setError(cause.message) }
  }
  useEffect(() => {
    alive.current = true; controller.current = new AbortController(); void load()
    return () => { alive.current = false; controller.current.abort() }
  }, [api])
  useEffect(() => { if (!polling) return; const timer = setInterval(() => void load(), 1000); return () => clearInterval(timer) }, [polling, api])
  const mutate = async (action, payload) => {
    setBusy(true); setError('')
    try { const value = await api(action, payload, controller.current.signal); if (!alive.current) return false; await load(); return value }
    catch (cause) { if (alive.current) setError(cause.message); return false }
    finally { if (alive.current) setBusy(false) }
  }
  const edit = (item, enabled = item?.enabled ?? false) => {
    setError('')
    setEditor({ id: item?.id, name: item?.name ?? '', command: item?.config.command ?? '', args: JSON.stringify(item?.config.args ?? [], null, 2), cwd: item?.config.cwd ?? '',
      timeoutSeconds: item?.config.timeoutSeconds ?? 300, permission: item?.config.permission ?? 'reject', environment: '', environmentNames: item?.environmentNames ?? [], enabled })
  }
  const save = async event => {
    event.preventDefault(); setError('')
    let args, environment
    try { args = JSON.parse(editor.args); if (editor.environment.trim()) environment = JSON.parse(editor.environment) }
    catch { setError('参数和环境变量必须是有效 JSON。'); return }
    const value = await mutate('save', { ...(editor.id ? { id: editor.id } : {}), name: editor.name, enabled: editor.enabled,
      config: { command: editor.command, args, cwd: editor.cwd, timeoutSeconds: Number(editor.timeoutSeconds), permission: editor.permission }, ...(environment !== undefined ? { environment } : {}) })
    if (value) setEditor(null)
  }
  return <main className="seal-acp-page" data-seal-acp>
    <header className="seal-acp-header"><div><h1>ACP</h1><p>连接支持 Agent Client Protocol 的外部编程 Runner。</p></div><div className="seal-acp-actions"><button type="button" disabled={busy} onClick={() => void load()}>刷新</button><button type="button" className="seal-acp-primary" onClick={() => edit(null)}>添加 Runner</button></div></header>
    {error && <p role="alert" className="seal-acp-error">{error}</p>}
    <p className="seal-acp-note">{data?.note ?? '正在读取本机账号的 Runner 配置…'}</p>
    <section className="seal-acp-grid" aria-label="Runner 列表">{data?.items.map(item => <article className="seal-acp-card" key={item.id}>
      <div className="seal-acp-row"><h2>{item.name}</h2><label><input type="checkbox" role="switch" aria-label={`启用 ${item.name}`} checked={item.enabled} disabled={busy || active} onChange={event => item.configured ? void mutate('toggle', { id: item.id, enabled: event.target.checked }) : edit(item, true)} />启用</label></div>
      <p>{item.note}</p><span className="seal-acp-badge" data-ready={item.check?.ready === true}>{!item.configured ? '待配置工作目录' : item.check?.ready ? 'ACP 检查通过' : item.check ? 'ACP 检查失败' : item.discovery.found ? '程序已发现 · 待检查' : '程序未安装'}</span>
      <code>{item.config.command} {item.config.args.join(' ')}</code><p>{item.discovery.message}</p>{item.config.cwd && <code>工作目录：{item.config.cwd}</code>}
      <div className="seal-acp-actions"><button type="button" disabled={busy || active} onClick={() => edit(item)}>配置</button><button type="button" disabled={busy || active || !item.configured} onClick={() => void mutate('check', { id: item.id })}>检查 {item.name}</button><button type="button" disabled={busy || active || !item.enabled} onClick={() => { setTask(item); setPrompt(''); setError('') }}>运行 {item.name}</button>{item.configured && <button type="button" disabled={busy || active} onClick={() => setDeleting(item)}>删除配置</button>}</div>
    </article>)}</section>
    <section aria-label="最近 ACP 操作"><h2>本次运行记录</h2>{data && data.runs.length === 0 && <p>暂无操作记录。检查不会发送模型提示词；运行结果仅保留在当前 Host 内存中。</p>}{data?.runs.map(run => <article className="seal-acp-run" key={run.id}>
      <div className="seal-acp-row"><strong>{run.kind === 'check' ? '协议检查' : '编程任务'} · {run.runnerName} · {statuses[run.status] ?? run.status}</strong>{running(run) && <button type="button" disabled={busy} onClick={() => void mutate('cancel', { id: run.id })}>停止任务</button>}</div><time>{new Date(run.startedAt).toLocaleString()}</time>
      {run.output && <pre>{run.output}</pre>}{run.truncated && <p>输出已达到本页保留上限，后续内容未保留。</p>}{run.permissionDecision && <p>最近权限请求：{run.permissionDecision === 'rejected' ? '已拒绝' : '单次允许'}</p>}{run.error && <p role="status" className="seal-acp-error">{run.error}</p>}{run.stopReason && <small>停止原因：{run.stopReason}</small>}
    </article>)}</section>
    <p>预设不包含第三方 CLI 或登录凭据。Windows 的 .cmd/.bat 入口请改为 node.exe 和实际 JS 文件参数。Runner 使用当前系统权限，工作目录不是操作系统沙箱；本插件不提供文件或终端 RPC 能力。</p>
    {editor && <div className="seal-acp-modal"><form role="dialog" aria-modal="true" aria-label="Runner 配置" className="seal-acp-dialog" onSubmit={save}>
      <h2>{editor.id ? '配置 Runner' : '添加 Runner'}</h2>
      <label>名称<input aria-label="Runner 名称" required maxLength="100" value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
      <label>可执行程序<input aria-label="可执行程序" required value={editor.command} onChange={event => setEditor({ ...editor, command: event.target.value })} /><small>填写 PATH 程序名或绝对路径，不填写整条 shell 命令。</small></label>
      <label>参数（JSON 数组）<textarea aria-label="Runner 参数" value={editor.args} onChange={event => setEditor({ ...editor, args: event.target.value })} /></label>
      <label>工作目录<input aria-label="工作目录" required value={editor.cwd} onChange={event => setEditor({ ...editor, cwd: event.target.value })} /></label>
      <label>超时（秒）<input aria-label="超时秒数" type="number" min="5" max="3600" value={editor.timeoutSeconds} onChange={event => setEditor({ ...editor, timeoutSeconds: event.target.value })} /></label>
      <label>工具权限策略<select aria-label="权限策略" value={editor.permission} onChange={event => setEditor({ ...editor, permission: event.target.value })}><option value="reject">拒绝所有权限请求（默认）</option><option value="allow-once">自动选择每次请求的单次允许项</option></select></label>
      <label>环境变量（JSON 对象）<textarea aria-label="环境变量" autoComplete="off" value={editor.environment} onChange={event => setEditor({ ...editor, environment: event.target.value })} placeholder={'{"PROVIDER_API_KEY":"新密钥"}'} /><small>已配置变量：{editor.environmentNames.join('、') || '无'}。旧值不会显示。留空保留，填写对象替换全部，填写 {`{}`} 清空。</small></label>
      <label><input type="checkbox" checked={editor.enabled} onChange={event => setEditor({ ...editor, enabled: event.target.checked })} />保存后启用</label>
      {error && <p role="alert" className="seal-acp-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button type="submit" className="seal-acp-primary" disabled={busy}>保存 Runner</button></footer>
    </form></div>}
    {task && <div className="seal-acp-modal"><form role="dialog" aria-modal="true" aria-label="运行 ACP 任务" className="seal-acp-dialog" onSubmit={async event => { event.preventDefault(); const value = await mutate('run', { id: task.id, prompt }); if (value) setTask(null) }}>
      <h2>运行 {task.name}</h2><code>{task.config.cwd}</code><p>任务会发送给此 Runner 自己配置的模型服务，可能产生费用。</p><label>任务<textarea aria-label="ACP 任务" maxLength="30000" required value={prompt} onChange={event => setPrompt(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => setTask(null)}>取消</button><button type="submit" className="seal-acp-primary" disabled={busy || !prompt.trim()}>启动任务</button></footer>
    </form></div>}
    {deleting && <div className="seal-acp-modal"><section role="dialog" aria-modal="true" aria-label="删除 Runner 配置" className="seal-acp-dialog"><h2>删除 {deleting.name} 的配置？</h2><p>只移除本账号保存的配置和环境秘密，不卸载第三方 CLI。</p><footer><button type="button" onClick={() => setDeleting(null)}>取消</button><button type="button" disabled={busy} onClick={async () => { if (await mutate('delete', { id: deleting.id })) setDeleting(null) }}>确认删除</button></footer></section></div>}
  </main>
}

export function apply(ctx) {
  const api = async (action, payload = {}, signal) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-acp/${action}`, payload, signal)
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = styles; document.head.append(element); return () => element.remove() }, 'seal-harness ACP styles')
  function Panel() {
    const auth = useSyncExternalStore(ctx.sealHarnessAuthClient.subscribe, ctx.sealHarnessAuthClient.getStatus)
    return auth?.user ? <AcpPanel key={`${auth.accountId}:${auth.epoch}`} api={api} /> : <main className="seal-acp-page"><h1>ACP</h1><p>请先登录本地账号。</p></main>
  }
  ctx.inject(['sealHarnessNavigation'], inner => inner.effect(() => inner.sealHarnessNavigation.register({ id: 'acp', label: 'ACP', icon: 'acp', order: 130, primary: true, Panel }), 'seal-harness ACP navigation'))
}
