import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loginStyles } from './login-styles.js'

const brandIcon = typeof __SEAL_HARNESS_ICON__ === 'string' ? __SEAL_HARNESS_ICON__ : ''

export const inject = ['slots', 'connection', 'layout']

export function IdentityPanel({ auth, embedded = true }) {
  const status = useSyncExternalStore(auth.subscribe, auth.getStatus, auth.getStatus)
  const [error, setError] = useState('')
  const [workingLocally, setBusy] = useState(false)
  const busy = workingLocally || Boolean(status?.restoring)
  const [remember, setRemember] = useState(true)
  const [mode, setMode] = useState('account')
  const [wecomMode, setWecomMode] = useState(false)
  const mounted = useRef(false), working = useRef(false)
  useEffect(() => {
    mounted.current = true
    void auth.recover()
    return () => { mounted.current = false; auth.closeLogin() }
  }, [auth])
  const run = async (endpoint, payload = {}) => {
    if (working.current) return false
    working.current = true; setBusy(true); setError('')
    try {
      if (endpoint === 'skip') await auth.skipLogin()
      else await auth.call(endpoint, payload)
      return true
    } catch (failure) { if (mounted.current) setError(failure.message); return false }
    finally { working.current = false; if (mounted.current) setBusy(false) }
  }
  const submit = event => {
    event.preventDefault()
    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form))
    payload.remember = remember
    void run('login', payload)
    form.querySelectorAll('input[type=password]').forEach(input => { input.value = '' })
  }
  const switchWecom = async next => {
    if (next) { setWecomMode(true); await run('wecom/start', { remember, embedded }) }
    else { await run('wecom/cancel'); setWecomMode(false) }
  }
  const changeRemember = async next => {
    if (wecomMode && status?.wecom?.phase === 'waiting') {
      if (!await run('wecom/remember', { remember: next })) return
    }
    if (status?.sso?.phase === 'waiting') {
      if (!await run('sso/remember', { remember: next })) return
    }
    setRemember(next)
  }
  const ssoPending = ['starting', 'waiting', 'completing'].includes(status?.sso?.phase)
  const switchingHome = status?.switchingHome === true
  const rememberOption = <div>
    <label className="seal-harness-login-remember"><input type="checkbox" checked={remember && Boolean(status?.persistenceAvailable)} disabled={busy || ['starting', 'completing'].includes(status?.sso?.phase) || status?.wecom?.phase === 'completing' || !status?.persistenceAvailable} onChange={event => void changeRemember(event.target.checked)} />记住登录</label>
    {status && !status.persistenceAvailable && <p role="status">本地登录存储不可用，本次登录仅在运行期间有效。</p>}
  </div>
  return <main className="seal-harness-login-shell" aria-busy={busy}>
    <header className="seal-harness-login-top">
      <div className="seal-harness-login-brand"><strong>Seal Harness·开发者平台</strong><span className="seal-harness-login-brand-en">ENTERPRISE AGENT WORKSPACE</span></div>
      <span className="seal-harness-login-top-note">安全登录</span>
    </header>
    <section className="seal-harness-login-visual" aria-label="Seal Harness身份形象">
      <div className="seal-harness-login-grid" aria-hidden="true" />
      <p className="seal-harness-login-kicker">VECTOR / ACCOUNTABLE AGENT</p>
      <img className="seal-harness-login-mark" src={brandIcon} alt="Seal Harness 小海豹" />
      <h2 className="seal-harness-login-visual-title">连接团队，也能独立工作。</h2>
      <p className="seal-harness-login-caption">登录只确认身份 · 高风险操作不会因登录而自动获得授权</p>
    </section>
    <section className={`seal-harness-login-auth${wecomMode ? ' seal-harness-wecom-mode' : ''}`} aria-label="登录">
      {status?.wecom?.enabled && <button className="seal-harness-login-corner" type="button" aria-label={wecomMode ? '返回账号登录' : '企业微信扫码登录'} disabled={busy} onClick={() => void switchWecom(!wecomMode)}>
        {wecomMode
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20v-1.6a6.5 6.5 0 0 1 13 0V20" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2.5 2.5h7v7h-7zm12 0h7v7h-7zm-12 12h7v7h-7z" /><path d="M5 5h2v2H5zm12 0h2v2h-2zM5 17h2v2H5zm9.5-2.5h2v2h-2zm5 0h2v2h-2zm-5 5h2v2h-2zm5 0h2v2h-2z" /></svg>}
      </button>}
      {wecomMode ? <>
        <button className="seal-harness-wecom-back" type="button" disabled={busy} onClick={() => void switchWecom(false)}>← 返回账号登录</button>
        <div className="seal-harness-wecom-panel">
          <div className="seal-harness-wecom-card">
            <div className="seal-harness-wecom-content">
              <h1>企业微信扫码登录</h1>
              <div className="seal-harness-wecom-window">{switchingHome ? '认证已完成，正在打开此账号的独立工作区…' : status?.wecom?.phase === 'failed' ? '二维码加载失败，请刷新后重试' : embedded ? '正在加载企业微信二维码…' : '请在企业微信登录窗口完成扫码'}</div>
              <p>{switchingHome ? '请稍候，Seal Harness将自动进入工作台。' : '请使用企业微信扫码并在手机上确认'}</p>
            </div>
            <button className="seal-harness-wecom-refresh" type="button" disabled={busy || switchingHome || status?.wecom?.phase === 'completing'} onClick={() => void run('wecom/start', { remember, embedded })}>刷新二维码</button>
          </div>
          {rememberOption}
          <p className="seal-harness-wecom-foot" role="status">登录完成后将自动进入工作台。</p>
          {error && <p className="seal-harness-login-error" role="alert">{error}</p>}
        </div>
      </> : <div className="seal-harness-login-frame">
        {switchingHome && <p className="seal-harness-login-status" role="status">正在打开此账号的独立工作区…</p>}
        {status?.homeSwitchError && <p className="seal-harness-login-error" role="alert">{status.homeSwitchError}</p>}
        {status?.needsAccountLogin && <p className="seal-harness-login-status" role="status">请在独立工作区重新登录，原账号的会话不会在此显示。</p>}
        <p className="seal-harness-login-step">01 企业账号验证 — 02 安全登录</p>
        <div className="seal-harness-login-head"><h1 className="seal-harness-login-title">登录Seal Harness·开发者平台</h1><p className="seal-harness-login-lead">使用企业账号或集团统一认证进入。</p></div>
        <div className="seal-harness-login-seg" role="group" aria-label="登录方式">
          <button type="button" aria-pressed={mode === 'account'} disabled={busy || ssoPending} onClick={() => { setMode('account'); setError('') }}>企业账号</button>
          <button type="button" aria-pressed={mode === 'sso'} disabled={busy || ssoPending} onClick={() => { setMode('sso'); setError('') }}>集团 SSO</button>
        </div>
        {mode === 'sso' && rememberOption}
        {mode === 'account' ? <form className="seal-harness-login-form" onSubmit={submit}>
          <div className="seal-harness-login-field"><label htmlFor="seal-harness-username">账号</label><input id="seal-harness-username" name="username" autoComplete="username" placeholder="工号或企业邮箱" required maxLength={64} disabled={busy} /></div>
          <div className="seal-harness-login-field"><label htmlFor="seal-harness-password">密码</label><input id="seal-harness-password" name="password" type="password" autoComplete="current-password" placeholder="输入登录密码" required maxLength={256} disabled={busy} /></div>
          {rememberOption}
          <div className="seal-harness-login-error-slot" role="alert" aria-live="polite">{error && <p className="seal-harness-login-error">{error}</p>}</div>
          <button className="seal-harness-login-submit" type="submit" disabled={busy || !status?.services?.entries?.find(entry => entry.key === 'identityBaseUrl')?.configured}>{busy ? '正在连接…' : '使用账号继续'}</button>
          <p className="seal-harness-login-help">遇到问题请联系企业 IT 管理员</p>
        </form> : <div className="seal-harness-login-form">
          <p className="seal-harness-login-sso-note">{ssoPending ? '请在系统浏览器中完成认证。完成后将自动返回Seal Harness。' : '点击后将在系统浏览器中完成统一认证，本窗口会自动继续。'}</p>
          <div className="seal-harness-login-error-slot" role="alert" aria-live="polite">{error && <p className="seal-harness-login-error">{error}</p>}</div>
          {ssoPending ? <button className="seal-harness-login-submit seal-harness-login-submit--ghost" type="button" disabled={busy} onClick={() => void run('sso/cancel')}>取消统一认证</button>
            : <button className="seal-harness-login-submit" type="button" disabled={busy || !status?.sso?.enabled} onClick={() => void run('sso/start', { remember })}>使用统一认证继续</button>}
          <p className="seal-harness-login-help">遇到问题请联系企业 IT 管理员</p>
        </div>}
        <div className="seal-harness-login-extra">
          {status?.restoring && <p role="status">正在自动登录…</p>}
          {status?.offlineSwitching && <p role="status">正在切换到离线工作区，请稍候…</p>}
          {status?.server === 'checking' && <p role="status">正在检查登录服务连接…</p>}
          {status?.server === 'unreachable' && <><p role="status">无法连接登录服务，可跳过登录使用本地功能。项目和商店等功能需要登录。</p><button type="button" disabled={busy || ssoPending || status?.offlineSwitching} onClick={() => void run('skip')}>跳过登录</button></>}
          {status?.server === 'notConfigured' && <><p role="status">尚未配置身份服务，可先使用本地工作台；需要在线项目和商店时再填写服务地址。</p><button type="button" disabled={busy || ssoPending || status?.offlineSwitching} onClick={() => void run('skip')}>进入本地工作台</button></>}
          {status?.statusError && <p role="alert">{status.statusError}</p>}
          {status?.availabilityError && <p role="alert">{status.availabilityError}</p>}
          <button type="button" disabled={busy || status?.server === 'checking'} onClick={() => void auth.recover()}>重新检查连接</button>
          {status?.saved && <button type="button" disabled={busy} onClick={() => void run('restore')}>重试自动登录</button>}</div>
        {status?.restoreError && !status?.restoring && <p className="seal-harness-login-error" role="alert">{status.restoreError}</p>}
        {status?.warning && <p className="seal-harness-login-error" role="alert">本地登录存储不可用，请检查凭据文件。</p>}
        <details className="seal-harness-login-services"><summary>服务连接信息</summary><p>修改配置后请重启Seal Harness。</p><small>{status?.services?.file}</small><dl>{status?.services?.entries?.map(entry => <React.Fragment key={entry.key}><dt>{entry.key}</dt><dd>{entry.value || '未配置'}</dd></React.Fragment>)}</dl></details>
      </div>}
    </section>
  </main>
}

export function apply(ctx) {
  const lifetime = new AbortController()
  const request = async (endpoint, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-identity/${endpoint}`, payload, lifetime.signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  let status = null, revision = 0, mutating = false, closed = false, releaseGate = null
  let startup = true, availabilityFlight = null, operation = 0, autoRestore = true
  const listeners = new Set()
  const publish = next => {
    if (closed) return
    const signedIn = next?.user && !status?.user
    if (signedIn) { operation++; next = { ...next, server: 'reachable', availabilityError: null } }
    status = next
    if (next?.user) startup = false
    if (startup && !releaseGate) releaseGate = ctx.slots.register({ name: 'root', priority: -100 }, LoginPage)
    if (!startup && releaseGate) { releaseGate(); releaseGate = null }
    for (const listener of listeners) listener()
    if (signedIn) ctx.layout.selectPanel(null)
  }
  const auth = {
    getStatus: () => status,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    openLogin: () => ctx.layout.selectPanel('seal-harness-identity'),
    closeLogin() {
      if (status?.user || !['waiting', 'completing'].includes(status?.wecom?.phase)) return
      void auth.call('wecom/cancel').catch(error => publish({ ...status, statusError: error.message }))
    },
    checkAvailability() {
      if (mutating || closed) return Promise.resolve({ server: 'unknown' })
      if (availabilityFlight) return availabilityFlight
      const current = operation
      publish({ ...status, server: 'checking', availabilityError: null })
      availabilityFlight = request('availability').then(next => {
        if (closed || current !== operation) return { server: 'unknown' }
        publish({ ...status, ...next, sso: { ...status?.sso, enabled: next.sso.enabled, reason: next.sso.reason }, wecom: { ...status?.wecom, enabled: next.wecom.enabled } })
        return next
      }).catch(error => {
        if (closed || current !== operation) return { server: 'unknown' }
        publish({ ...status, server: 'unknown', availabilityError: error.message })
        return { server: 'unknown' }
      }).finally(() => { availabilityFlight = null })
      return availabilityFlight
    },
    async recover() {
      if (closed || mutating || status?.user) return
      const current = operation
      const available = await auth.checkAvailability()
      if (closed || current !== operation || mutating || !startup || !autoRestore || status?.user || !status?.saved
        || available.server !== 'reachable' || !['unreachable', 'timeout', 'serviceError'].includes(status?.restoreErrorCode)
        || [status?.sso?.phase, status?.wecom?.phase].some(phase => ['starting', 'waiting', 'completing'].includes(phase))) return
      try { await auth.call('restore') }
      catch { /* 恢复错误由 Host 状态展示，下个检查周期再试。 */ }
    },
    async skipLogin() {
      const availability = await auth.checkAvailability()
      if (!['unreachable', 'notConfigured'].includes(availability.server)) throw new Error('登录服务可达或尚未确认离线状态，请先登录或重新检查连接。')
      autoRestore = false; operation++
      const offline = await request('offline')
      if (offline.switchingHome) {
        publish({ ...status, offlineSwitching: true })
        return
      }
      startup = false
      publish(status)
      ctx.layout.selectPanel(null)
    },
    async refresh() {
      if (mutating) return status
      const current = ++revision
      const next = await request('status')
      if (current === revision) publish({ ...status, ...next, statusError: null })
      return next
    },
    async call(endpoint, payload = {}) {
      if (endpoint === 'status') return auth.refresh()
      if (mutating) throw new Error('正在处理登录，请稍候。')
      mutating = true; revision++; operation++
      if (['login', 'logout', 'sso/start', 'wecom/start'].includes(endpoint)) autoRestore = false
      publish({ ...status, server: 'unknown', availabilityError: null, restoring: endpoint === 'restore' })
      try {
        const result = await request(endpoint, payload)
        if (endpoint === 'logout') publish({ ...status, user: null, accountId: null })
        else if (result && Object.hasOwn(result, 'user')) publish({ ...status, ...result })
        return result
      } finally {
        try {
          const next = await request('status')
          publish({ ...status, ...next, statusError: null })
        } catch (error) { publish({ ...status, statusError: error.message }) }
        finally { mutating = false; publish({ ...status, restoring: false }) }
      }
    },
  }
  function LoginPage() { return <IdentityPanel auth={auth} /> }
  function AccountPage() { return <IdentityPanel auth={auth} embedded={false} /> }
  ctx.provide('sealHarnessAuthClient', auth)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-identity' }, AccountPage))
  ctx.effect(() => {
    const element = document.createElement('style'); element.textContent = loginStyles; document.head.append(element)
    publish(null)
    const refresh = async () => {
      try {
        await auth.refresh()
        if (startup && !status?.user) await auth.recover()
      } catch (error) { publish({ ...status, statusError: error.message }) }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { closed = true; lifetime.abort(); clearInterval(timer); releaseGate?.(); releaseGate = null; listeners.clear(); element.remove() }
  }, 'seal-harness-identity: client')
}
