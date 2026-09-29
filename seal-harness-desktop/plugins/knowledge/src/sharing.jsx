// 移植自 Stratex VaultCollectionGrantMembers / VaultKnowledgeShareDialog。
import React, { useEffect, useRef, useState } from 'react'
import { Modal } from './ui.jsx'

export function SharingUsers({ api, groupId, busy }) {
  const [query, setQuery] = useState(''),
    [users, setUsers] = useState([]),
    [members, setMembers] = useState(null),
    [error, setError] = useState(''),
    [role, setRole] = useState('viewer'),
    [pending, setPending] = useState(false),
    [revision, setRevision] = useState(0)
  const controller = useRef(null)
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    setMembers(null)
    setError('')
    api('grants', { groupId }, current.signal)
      .then((value) => {
        if (!current.signal.aborted) setMembers(value)
      })
      .catch((error) => {
        if (!current.signal.aborted) setError(error.message)
      })
    return () => current.abort()
  }, [api, groupId, revision])
  useEffect(() => {
    const current = new AbortController()
    setUsers([])
    if (query.trim().length < 2) return () => current.abort()
    const timer = setTimeout(
      () =>
        api('shareUsers', { query }, current.signal)
          .then((result) => {
            if (!current.signal.aborted) setUsers(result.users)
          })
          .catch((error) => {
            if (!current.signal.aborted) setError(error.message)
          }),
      250
    )
    return () => {
      current.abort()
      clearTimeout(timer)
    }
  }, [query, api])
  async function change(principal, role) {
    const signal = controller.current.signal
    setPending(true)
    setError('')
    try {
      await api(role ? 'grant' : 'revokeGrant', { groupId, principal, ...(role ? { role } : {}) }, signal)
      if (!signal.aborted) setRevision((value) => value + 1)
    } catch (error) {
      if (!signal.aborted) setError(error.message)
    } finally {
      if (!signal.aborted) setPending(false)
    }
  }
  return (
    <>
      <section className="collection-members" aria-label="已授权成员">
        <h4>已授权成员</h4>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button disabled={pending} onClick={() => setRevision((value) => value + 1)}>
              重新读取授权
            </button>
          </>
        )}
        {!members && !error && <p role="status">正在读取授权成员…</p>}
        {members && (
          <>
            {members.owner && <p>所有者：{members.owner.displayName || members.owner.subject}</p>}
            {members.visibility === 'organization' && (
              <p>当前资料集对组织公开；撤销个人授权后，对方仍可能通过公开范围查看。</p>
            )}
            {members.grants.length ? (
              <ul>
                {members.grants.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.principal.displayName || item.principal.subject} ·{' '}
                      {item.role === 'editor' ? '可编辑' : '可查看'}
                    </span>
                    <button
                      disabled={busy || pending}
                      onClick={() => void change(item.principal, item.role === 'editor' ? 'viewer' : 'editor')}
                    >
                      {item.role === 'editor' ? '改为可查看' : '改为可编辑'}
                    </button>
                    <button disabled={busy || pending} onClick={() => void change(item.principal, null)}>
                      撤销授权
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无单独授权成员。</p>
            )}
          </>
        )}
      </section>
      <div className="collection-share-search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索授权用户"
          placeholder="输入至少 2 个字符搜索用户"
        />
        <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="授权权限">
          <option value="viewer">可查看</option>
          <option value="editor">可编辑</option>
        </select>
      </div>
      {users.length ? (
        <ul className="collection-share-users">
          {users.map((user) => (
            <li key={user.id}>
              <span>
                <strong>{user.displayName}</strong>
                <small>@{user.username}</small>
              </span>
              <button
                disabled={busy || pending}
                onClick={() =>
                  void change({ issuer: 'agent-earth-platform', subject: user.id, displayName: user.displayName }, role)
                }
              >
                添加共享
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="collection-share-hint">
          {query.trim().length >= 2 ? '没有匹配的用户。' : '搜索工作台用户后，可按资料集授予查看或编辑权限。'}
        </p>
      )}
    </>
  )
}

export function ShareDialog({ api, code, expiresAt, close }) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [now, setNow] = useState(Date.now),
    [codeRevoked, setCodeRevoked] = useState(false)
  const controller = useRef(null)
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    setLoading(true)
    api('shares', {}, current.signal)
      .then((value) => {
        if (!current.signal.aborted) {
          setItems(value.items)
          setError('')
        }
      })
      .catch((error) => {
        if (!current.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false)
      })
    return () => current.abort()
  }, [api, revision])
  useEffect(() => {
    const deadlines = [
      expiresAt,
      ...items.filter((item) => !item.revokedAt && !item.redeemedAt).map((item) => item.expiresAt)
    ]
      .map((value) => Date.parse(value))
      .filter((value) => value > now)
    if (!deadlines.length) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...deadlines) - now, 2147483647))
    return () => clearTimeout(timer)
  }, [items, expiresAt, now])
  const expired = (value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now
  const state = (item) =>
    item.revokedAt ? '已撤销' : item.redeemedAt ? '已领取' : expired(item.expiresAt) ? '已过期' : '待领取'
  async function revoke(id) {
    const signal = controller.current.signal
    setBusy(true)
    try {
      await api('revokeShare', { shareId: id }, signal)
      if (!signal.aborted) {
        // 创建响应不含分享 ID，撤销后收起本次展示的授权码。
        setCodeRevoked(true)
        setRevision((value) => value + 1)
      }
    } catch (error) {
      if (!signal.aborted) setError(error.message)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <Modal
      title="分享资料集"
      description="分享给连接同一知识库服务的同事，领取后获得只读权限。"
      close={close}
      footer={
        <button className="btn btn--ghost" onClick={close}>
          完成
        </button>
      }
    >
      {code && !codeRevoked && (
        <section className="knowledge-share__code">
          <code>{code}</code>
          <p>
            {expired(expiresAt)
              ? '授权码已过期，无法继续领取。'
              : `一次性领取，领取截止 ${new Date(expiresAt).toLocaleString()}。领取期限不影响已获得的授权。`}
          </p>
          <button
            className="btn btn--primary"
            disabled={busy || expired(expiresAt)}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code)
                setNotice('授权码已复制。')
              } catch (error) {
                setError(error.message)
              }
            }}
          >
            复制授权码
          </button>
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
      <h3>已发出的分享</h3>
      {loading && <p role="status">正在读取分享记录…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="btn btn--ghost" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            重试
          </button>
        </div>
      )}
      {!loading && !error && !items.length && <p>暂无分享记录。</p>}
      <ul className="knowledge-share__history">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>
                {item.collectionIds.length} 个资料集 · {state(item)}
              </strong>
              <p>
                {item.revokedAt
                  ? '本次分享已撤销；若有其他授权，仍可访问。'
                  : item.redeemedAt
                    ? '本次分享授予只读权限，撤销前有效。'
                    : expired(item.expiresAt)
                      ? '未在领取期限内使用，无法继续领取。'
                      : `领取截止 ${new Date(item.expiresAt).toLocaleString()}，仅可领取一次。`}
              </p>
            </div>
            {['待领取', '已领取'].includes(state(item)) && (
              <button
                className="btn btn--ghost"
                disabled={busy || loading || !!error}
                onClick={() => void revoke(item.id)}
              >
                撤销
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
