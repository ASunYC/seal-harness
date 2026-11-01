import React, { useEffect, useState } from 'react'
import { styles } from './styles.js'

export const inject = ['slots', 'connection']

export function apply(ctx) {
  const call = async action => {
    const result = await ctx.connection.rpc.call('/api', `seal-harness-superagent/${action}`, {})
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  function Panel() {
    const [status, setStatus] = useState(null)
    const [error, setError] = useState('')
    const refresh = async () => {
      try { setStatus(await call('status')); setError('') }
      catch (cause) { setError(cause.message) }
    }
    useEffect(() => {
      void refresh()
      const timer = setInterval(() => { void refresh() }, 15000)
      return () => clearInterval(timer)
    }, [])
    const open = async () => {
      try { await call('open'); setError('') }
      catch (cause) { setError(cause.message) }
    }
    return <main className="seal-superagent-page"><header><div><h1>Superagent</h1><p>管理 GitHub 仓库的自动化开发任务</p></div><button type="button" onClick={() => void refresh()}>刷新</button></header>
      <section><h2>服务状态</h2>{!status ? <p>正在检查…</p> : status.online ? <>
        <p>服务已连接 · {status.setup ? '等待配置' : status.paused ? '已暂停' : '运行中'}</p>
        {status.setup && <p role="status">{status.setup}</p>}
        <p>执行中 {status.running} · 排队中 {status.queued}</p>
      </> : <p role="status">{status.message}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => void open()}>打开 Superagent 面板</button></section>
      <p className="seal-superagent-note">首次访问请运行 <code>docker logs seal-superagent</code>，打开日志中的本机登录链接；登录后可使用上方按钮。账号、授权规则和执行设置在独立面板中管理。</p>
    </main>
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = '@seal-harness/superagent'
    element.textContent = styles
    document.head.append(element)
    return () => element.remove()
  }, 'superagent: styles')
  ctx.inject(['sealHarnessNavigation'], navigation => navigation.effect(() => navigation.sealHarnessNavigation.register({
    id: 'superagent', label: 'Superagent', icon: 'superagent', order: 140, primary: true, Panel,
  }), 'superagent: primary navigation'))
}
