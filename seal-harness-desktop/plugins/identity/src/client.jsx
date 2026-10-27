import React, { useState, useSyncExternalStore } from 'react'
import { loginStyles } from './login-styles.js'
import { SlideVerification } from './slide-verification.jsx'

const brandIcon = typeof __SEAL_HARNESS_ICON__ === 'string' ? __SEAL_HARNESS_ICON__ : ''
const rememberKey = 'seal-harness.identity.remember.v1'
const credentialStore = () => document.defaultView.localStorage

export const inject = ['slots', 'connection', 'layout']

export function IdentityPanel({ auth }) {
  const status = useSyncExternalStore(auth.subscribe, auth.getStatus, auth.getStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [english, setEnglish] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [verified, setVerified] = useState(false)
  const [sliderReset, setSliderReset] = useState(0)
  const register = status?.canRegister === true
  const translate = (zh, en) => english ? en : zh

  const submit = async event => {
    event.preventDefault()
    if (busy || !verified || status?.restoring) return
    const form = event.currentTarget
    const data = { ...Object.fromEntries(new FormData(form)), remember }
    if (!data.displayName) delete data.displayName
    setBusy(true); setError('')
    try {
      if (remember && !auth.canRemember()) throw new Error(translate('无法保存登录状态，请检查应用存储后重试。', 'Cannot save your login. Check app storage and try again.'))
      await auth.call(register ? 'register' : 'login', data)
      form.reset()
    } catch (failure) {
      setError(failure.message)
      setVerified(false)
      setSliderReset(value => value + 1)
    } finally { setBusy(false) }
  }

  return <main className="seal-harness-local-login" aria-busy={busy || status?.restoring}>
    <section className="seal-harness-local-login-card" aria-label={translate('Seal Harness 本机登录', 'Seal Harness local sign in')}>
      <div className="seal-harness-local-login-language" role="group" aria-label={translate('界面语言', 'Language')}>
        <button type="button" aria-pressed={!english} onClick={() => setEnglish(false)}>中文</button>
        <button type="button" aria-pressed={english} onClick={() => setEnglish(true)}>English</button>
      </div>
      <div className="seal-harness-local-login-brand">
        <img src={brandIcon} alt="Seal Harness 小海豹" width="72" height="72" />
        <strong>Seal Harness</strong>
      </div>
      <h1>{register ? translate('创建本机管理员', 'Create local admin') : translate('账号登录', 'Sign in')}</h1>
      <p className="seal-harness-local-login-lead">{register ? translate('首次使用，请创建本机管理员。', 'Create the first account for this device.') : translate('使用本机账号登录', 'Sign in with your local account')}</p>
      {status?.restoring ? <p className="seal-harness-local-login-restoring" role="status">{translate('正在恢复登录…', 'Restoring your session…')}</p> : <form onSubmit={submit}>
        <label htmlFor="seal-login-username">{translate('账号', 'Account')}</label>
        <input id="seal-login-username" name="username" autoComplete="username" minLength={3} maxLength={64} required disabled={busy} placeholder={translate('请输入账号', 'Username')} />
        {register && <><label htmlFor="seal-login-display-name">{translate('显示名称', 'Display name')}</label><input id="seal-login-display-name" name="displayName" autoComplete="name" maxLength={128} disabled={busy} placeholder={translate('可选', 'Optional')} /></>}
        <label htmlFor="seal-login-password">{translate('密码', 'Password')}</label>
        <div className="seal-harness-local-login-password">
          <input id="seal-login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : undefined} required disabled={busy} placeholder={translate('请输入密码', 'Password')} />
          <button type="button" aria-label={showPassword ? translate('隐藏密码', 'Hide password') : translate('显示密码', 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="M3 21 21 3" />}</svg>
          </button>
        </div>
        <SlideVerification hint={translate('向右滑动完成验证', 'Slide right to continue')} verifiedLabel={translate('验证通过', 'Verified')} onVerified={() => setVerified(true)} resetKey={sliderReset} />
        <label className="seal-harness-local-login-remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={busy} />{translate('记住登录状态', 'Remember me')}</label>
        {(error || status?.error) && <p className="seal-harness-local-login-error" role="alert">{error || status.error}</p>}
        <button className="seal-harness-local-login-submit" type="submit" disabled={busy || !status || !verified}>{busy ? translate('请稍候…', 'Please wait…') : register ? translate('创建管理员并进入', 'Create admin and continue') : translate('登录', 'Sign in')}</button>
      </form>}
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
  const saveRememberToken = token => {
    if (token) credentialStore().setItem(rememberKey, token)
    else try { credentialStore().removeItem(rememberKey) } catch { /* Host 已撤销凭证，浏览器存储不可用时不阻断退出。 */ }
  }
  const auth = {
    getStatus: () => status,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    openLogin: () => ctx.layout.selectPanel('seal-harness-identity'),
    canRemember() {
      try { credentialStore().setItem(`${rememberKey}.probe`, '1'); credentialStore().removeItem(`${rememberKey}.probe`); return true }
      catch { return false }
    },
    async refresh() {
      const next = await request('status')
      let token
      try { token = credentialStore().getItem(rememberKey) } catch { /* 禁用存储时仍可手动登录。 */ }
      if (!next.user && token) {
        let resumed
        try {
          resumed = await request('resume', { token })
        } catch {
          try { if (credentialStore().getItem(rememberKey) === token) saveRememberToken(null) } catch { /* 禁用存储时忽略清理失败。 */ }
        }
        if (resumed) {
          try {
            saveRememberToken(resumed.rememberToken)
            const { rememberToken, ...rest } = resumed
            publish(rest)
            return rest
          } catch {
            // resume 已创建进程内会话，但写入换发凭证失败；清理后回到手动登录。
            await request('logout').catch(() => {})
            saveRememberToken(null)
          }
        }
      }
      publish(next)
      return next
    },
    async call(action, payload = {}) {
      const next = await request(action, payload)
      if (action === 'logout' || action === 'password/change' || ((action === 'login' || action === 'register') && !next.rememberToken)) saveRememberToken(null)
      if (next.rememberToken) {
        try { saveRememberToken(next.rememberToken) }
        catch (error) {
          await request('logout').catch(() => {})
          throw error
        }
      }
      if (next && Object.hasOwn(next, 'user')) {
        const { rememberToken, ...rest } = next
        publish(rest)
      } else if (action === 'password/change') await auth.refresh()
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
    publish({ user: null, canRegister: false, restoring: true })
    void auth.refresh().catch(error => publish({ user: null, canRegister: false, error: error.message }))
    return () => { closed = true; lifetime.abort(); releaseGate?.(); listeners.clear(); element.remove() }
  }, 'seal-harness local login client')
}
