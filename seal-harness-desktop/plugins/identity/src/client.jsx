import React, { useState, useSyncExternalStore } from 'react'
import { loginStyles } from './login-styles.js'

const brandIcon = typeof __SEAL_HARNESS_ICON__ === 'string' ? __SEAL_HARNESS_ICON__ : ''
export const inject = ['slots', 'connection', 'layout']

export function IdentityPanel({ auth }) {
  const status = useSyncExternalStore(auth.subscribe, auth.getStatus, auth.getStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const register = status?.canRegister === true
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setBusy(true); setError('')
    try {
      await auth.call(register ? 'register' : 'login', data)
      form.reset()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <main className="seal-harness-local-login" aria-busy={busy}>
    <section className="seal-harness-local-login-card" aria-label="Seal Harness 本机登录">
      <div className="seal-harness-local-login-identity">
        <img src={brandIcon} alt="Seal Harness 小海豹" width="88" height="88" />
        <div><span>SEAL HARNESS</span><h1>欢迎回到工作台</h1></div>
      </div>
      <p className="seal-harness-local-login-lead">{register ? '首次使用，请创建本机管理员。' : '使用本机账号继续。专家和技能保存在本机。'}</p>
      <form onSubmit={submit}>
        <label>用户名<input name="username" autoComplete="username" minLength={3} maxLength={64} required disabled={busy} /></label>
        {register && <label>显示名称<input name="displayName" autoComplete="name" maxLength={128} disabled={busy} /></label>}
        <label>密码<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : undefined} required disabled={busy} /></label>
        {error && <p className="seal-harness-local-login-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !status}>{busy ? '请稍候…' : register ? '创建管理员并进入' : '登录'}</button>
      </form>
      <p className="seal-harness-local-login-note">本地登录 · 数据仅保存在当前设备的 Seal Harness 数据目录</p>
    </section>
  </main>
}

export function apply(ctx) {
  const lifetime = new AbortController()
  const listeners = new Set()
  let status = null, releaseGate = null, closed = false
  const publish = next => {
    if (closed) return
    status = next
    if (!next?.user && !releaseGate) releaseGate = ctx.slots.register({ name: 'root', priority: -100 }, LoginPage)
    if (next?.user && releaseGate) { releaseGate(); releaseGate = null; ctx.layout.selectPanel(null) }
    for (const listener of listeners) listener()
  }
  const request = async (action, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-identity/${action}`, payload, lifetime.signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const auth = {
    getStatus: () => status,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    openLogin: () => ctx.layout.selectPanel('seal-harness-identity'),
    async refresh() { const next = await request('status'); publish(next); return next },
    async call(action, payload = {}) {
      const next = await request(action, payload)
      if (next && Object.hasOwn(next, 'user')) publish(next)
      return next
    },
  }
  function LoginPage() { return <IdentityPanel auth={auth} /> }
  ctx.provide('sealHarnessAuthClient', auth)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-identity' }, LoginPage))
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = loginStyles
    document.head.append(element)
    publish({ user: null, canRegister: false })
    void auth.refresh().catch(error => publish({ user: null, canRegister: false, error: error.message }))
    return () => { closed = true; lifetime.abort(); releaseGate?.(); listeners.clear(); element.remove() }
  }, 'seal-harness local login client')
}
