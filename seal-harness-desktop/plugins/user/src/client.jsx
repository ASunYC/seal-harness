import React, { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

export const inject = ['slots', 'layout', 'sealHarnessAuthClient']

const styles = `
.seal-harness-user-footer-seat{display:flex;flex:none;width:100%;min-width:0}
.seal-harness-user-footer-seat[data-wide=false]{width:36px}
.seal-harness-user-footer{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.seal-harness-user-footer:hover{background:var(--dsw-alias-interactive-bg-hover,#4446)}
.seal-harness-user-footer:focus-visible{outline:2px solid var(--color-primary,#4d89e8);outline-offset:-2px}
.seal-harness-user-footer[data-wide=false]{justify-content:center;width:36px;height:36px;margin:0;padding:0}
.seal-harness-user-footer svg{flex:none}.seal-harness-user-footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seal-harness-user-detail{height:100%;box-sizing:border-box;padding:32px;overflow:auto;color:var(--text-primary,inherit)}
.seal-harness-user-detail h1{font-size:24px;margin:0 0 24px}.seal-harness-user-detail dl{display:grid;grid-template-columns:max-content 1fr;gap:12px 20px;max-width:600px}
.seal-harness-user-detail dd{margin:0;overflow-wrap:anywhere}.seal-harness-user-detail button{min-height:38px;margin-top:24px;padding:8px 16px;border:1px solid var(--border-color,#888);border-radius:8px;background:var(--bg-secondary,transparent);color:inherit;cursor:pointer}
.seal-harness-user-detail [role=alert]{color:#c43}
`

function UserIcon({ wide }) { const size = wide ? 16 : 18; return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></svg> }

function useAuth(auth) { return useSyncExternalStore(auth.subscribe.bind(auth), auth.getStatus, auth.getStatus) }

export function apply(ctx) {
  const auth = ctx.sealHarnessAuthClient ?? ctx.get('sealHarnessAuthClient')
  if (!auth) throw new Error('Seal Harness用户插件缺少身份状态服务')
  function Footer({ wide = true }) {
    const status = useAuth(auth)
    const [seat, setSeat] = useState(null)
    useLayoutEffect(() => {
      // 官方 footer action 位于设置行之前；只将用户入口移到设置之后，保留市场等入口的原布局。
      const settings = document.querySelector('[data-slot="sidebar.settings"]')?.parentElement
      const footer = document.querySelector('[data-slot="sidebar.footer.action"]')
      if (!settings?.parentElement || !footer || !settings.parentElement.contains(footer)) return
      const node = document.createElement('div')
      node.className = 'seal-harness-user-footer-seat'
      node.dataset.wide = String(wide)
      settings.after(node)
      setSeat(node)
      return () => node.remove()
    }, [wide])
    const label = status?.user ? status.user.displayName || status.user.username : '未登录'
    const button = <button className="seal-harness-user-footer" data-wide={wide} title={`用户：${label}`} aria-label={`用户：${label}`} onClick={() => status?.user ? ctx.layout.selectPanel('seal-harness-user') : auth.openLogin()}><UserIcon wide={wide} />{wide && <span>{label}</span>}</button>
    return seat?.isConnected ? createPortal(button, seat) : button
  }
  function Detail() {
    const status = useAuth(auth), [error, setError] = useState(''), [busy, setBusy] = useState(false)
    if (!status?.user) return <section className="seal-harness-user-detail"><h1>未登录</h1><p>登录本机账号后可使用项目、专家和技能。</p><button onClick={() => auth.openLogin()}>去登录</button></section>
    const user = status.user
    const logout = async () => {
      setBusy(true); setError('')
      try { await auth.call('logout'); ctx.layout.selectPanel(null) }
      catch (cause) { setError(cause.message) }
      finally { setBusy(false) }
    }
    return <section className="seal-harness-user-detail"><h1>用户详情</h1><dl>
      <dt>姓名</dt><dd>{user.displayName || user.username}</dd>
      <dt>账号</dt><dd>{user.username}</dd>
      <dt>用户 ID</dt><dd>{user.id}</dd>
      <dt>角色</dt><dd>{user.role}</dd>
      <dt>存储方式</dt><dd>本机 SQLite</dd>
      <dt>登录状态</dt><dd>仅本次运行</dd>
    </dl>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={logout}>退出登录</button></section>
  }
  ctx.effect(() => {
    const element = document.createElement('style'); element.textContent = styles; document.head.append(element)
    return () => element.remove()
  }, 'seal-harness-user: styles')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seal-harness-user' }, Detail))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'seal-harness-user', order: 100, label: () => '用户' }, Footer))
}
