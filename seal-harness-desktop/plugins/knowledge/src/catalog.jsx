// 移植自 Stratex VaultLibraryCollections / CapabilityFeaturedScenes / CapabilityCatalogSection。
import React, { useRef, useState } from 'react'
import { canShare, collectionCategory, description, stateNames } from './ui.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'

export const scopes = [
  [
    'public',
    '公开',
    '浏览平台目录中可用的资料集，了解内容后即可安装。',
    '暂时没有公开资料集',
    '可用的公开资料集会显示在这里。'
  ],
  [
    'owned',
    '个人',
    '管理你创建的资料集；文件导入、分享与发布都在资料集详情中完成。',
    '还没有个人资料集',
    '创建资料集后再向其中导入文件。'
  ],
  [
    'granted',
    '被授权',
    '查看其他用户按资料集分享给你的内容。',
    '暂时没有被授权的资料集',
    '获得资料集权限后会显示在这里。'
  ]
]
export function Catalog({
  collections,
  installed,
  busy,
  sharingEnabled,
  open,
  create,
  install,
  uninstall,
  use,
  share
}) {
  const [scope, setScope] = useState('public'),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [installation, setInstallation] = useState('all'),
    [selected, setSelected] = useState(null)
  const input = useRef(null)
  const query = search.trim().toLocaleLowerCase()
  const filtered = collections.filter(
    (group) =>
      (installation === 'all' || Boolean(installed(group.id)) === (installation === 'installed')) &&
      [
        group.name,
        group.description,
        group.analysis?.summary,
        ...(group.analysis?.topics || []),
        ...(group.analysis?.keywords || [])
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
  )
  const inScope = (group, scope) =>
    group.scopes.includes(scope) &&
    (scope === 'owned' || group.lifecycle !== 'archived') &&
    (scope !== 'public' || group.catalogVisible)
  const visible = filtered
    .filter((group) => inScope(group, scope) && (category === 'all' || collectionCategory(group) === category))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const current = scopes.find(([id]) => id === scope)
  const options = [
    ['all', '全部安装状态'],
    ['installed', '已安装'],
    ['uninstalled', '未安装']
  ]
  const eligibleIds = (selected || []).filter((id) => collections.some((group) => group.id === id && canShare(group)))
  return (
    <div
      className="collection-catalog"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          input.current.focus()
        }
      }}
    >
      <nav className="collection-scope-tabs" aria-label="知识库目录" role="tablist">
        {scopes.map(([id, name]) => (
          <button
            className={`collection-scope-tab ${scope === id ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scope === id}
            key={id}
            onClick={() => {
              setScope(id)
              setSelected(null)
            }}
          >
            {name}
            <span className="tab-count">
              {
                filtered.filter(
                  (group) => inScope(group, id) && (category === 'all' || collectionCategory(group) === category)
                ).length
              }
            </span>
          </button>
        ))}
      </nav>
      <div className="collection-catalog-toolbar">
        <label className="collection-catalog-search" role="search">
          <Icon name="search" size={15} />
          <input
            ref={input}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索知识库名称、说明或主题"
            aria-label="搜索知识库"
          />
          {search ? (
            <button
              className="collection-search-clear"
              type="button"
              aria-label="清除搜索"
              onClick={() => setSearch('')}
            >
              <Icon name="close" size={15} />
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
        </label>
        <details
          className="collection-installation-filter"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.open = false
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }}
        >
          <summary aria-label="安装状态筛选">
            <Icon name="filter" size={15} />
            <span>{options.find(([id]) => id === installation)[1]}</span>
            <Icon className="collection-installation-filter__chevron" name="chevron-down" size={13} />
          </summary>
          <div className="collection-installation-filter__menu" role="listbox" aria-label="安装状态">
            {options.map(([id, name]) => (
              <button
                type="button"
                role="option"
                aria-selected={installation === id}
                className={installation === id ? 'is-selected' : ''}
                key={id}
                onClick={(event) => {
                  setInstallation(id)
                  event.currentTarget.closest('details').open = false
                }}
              >
                {name}
                {installation === id && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </details>
      </div>
      <section className="capability-featured-scenes" aria-label="精选场景">
        <header className="capability-featured-scenes__header">
          <h2>精选场景</h2>
          <p>从工作方式出发，快速找到合适的能力。</p>
        </header>
        <div className="capability-featured-scenes__grid">
          {[
            ['office', '办公类', '文档、表格、演示与日常协作'],
            ['development', '开发类', '编码、调试、评审与自动化']
          ].map(([id, title, text]) => (
            <button
              className={`capability-featured-scene ${category === id ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={category === id}
              key={id}
              onClick={() => setCategory(category === id ? 'all' : id)}
            >
              <span className="capability-featured-scene__icon">
                <Icon name={`scene-${id}`} size={22} />
              </span>
              <span className="capability-featured-scene__copy">
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
              <span className="capability-featured-scene__count">
                {collections.filter((group) => collectionCategory(group) === id).length}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="capability-catalog-section" aria-label={current[1]}>
        <header className="capability-catalog-section__header">
          <div className="capability-catalog-section__title">
            <h2>{current[1]}</h2>
            <span className="capability-catalog-section__count">{visible.length}</span>
            <span className="capability-catalog-section__divider" />
          </div>
          <p>{current[2]}</p>
          {scope === 'owned' && (
            <div className="capability-catalog-section__tools">
              {sharingEnabled &&
                (selected ? (
                  <>
                    <span className="collection-share-selection__count">已选 {eligibleIds.length} 个</span>
                    <button type="button" className="collection-section-action" onClick={() => setSelected(null)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="collection-section-action is-primary"
                      disabled={busy || !eligibleIds.length}
                      onClick={async () => {
                        if (await share(eligibleIds)) setSelected(null)
                      }}
                    >
                      生成授权码
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="collection-section-action"
                    disabled={!collections.some(canShare)}
                    onClick={() => setSelected([])}
                  >
                    分享资料集
                  </button>
                ))}
              <button type="button" className="collection-section-action" onClick={create}>
                新建资料集
              </button>
            </div>
          )}
        </header>
        <div className="capability-catalog-section__content">
          {visible.length ? (
            <div className="collection-grid">
              {visible.map((group) => (
                <article className={`collection-card ${selected ? 'is-share-selecting' : ''}`} key={group.id}>
                  {selected && canShare(group) && (
                    <label className="collection-card__selector">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${group.name}`}
                        checked={eligibleIds.includes(group.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...eligibleIds, group.id]
                              : eligibleIds.filter((id) => id !== group.id)
                          )
                        }
                      />
                    </label>
                  )}
                  <button className="collection-card__main" type="button" onClick={() => open(group.id)}>
                    <span className="collection-card__icon">
                      <Icon name="grid-3x3" size={18} />
                    </span>
                    <span className="collection-card__copy">
                      <span className="collection-card__heading">
                        <strong title={group.name}>{group.name}</strong>
                        <small>
                          {group.scopes.includes('owned')
                            ? '我的'
                            : group.scopes.includes('granted')
                              ? '被授权'
                              : '公开'}
                        </small>
                      </span>
                      <span className="collection-card__summary">{description(group)}</span>
                      <span className="collection-card__meta">
                        <small>{collectionCategory(group) === 'development' ? '开发类' : '办公类'}</small>
                        <small>{group.fileCount} 份资料</small>
                        <small>版本 {group.revision}</small>
                        {(installed(group.id) || group.lifecycle !== 'ready') && (
                          <small className="is-state">
                            {stateNames[installed(group.id)?.status || group.lifecycle]}
                          </small>
                        )}
                      </span>
                    </span>
                  </button>
                  <footer className="collection-card__footer">
                    <span>
                      更新于{' '}
                      {group.updatedAt
                        ? new Date(group.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
                        : '—'}
                    </span>
                    <div>
                      {installed(group.id) ? (
                        <>
                          {group.conversationReady && (
                            <button type="button" disabled={busy} onClick={() => use(group)}>
                              添加至会话
                            </button>
                          )}
                          <button type="button" disabled={busy} onClick={() => uninstall(group)}>
                            卸载
                          </button>
                        </>
                      ) : (
                        group.installable && (
                          <button className="is-primary" type="button" disabled={busy} onClick={() => install(group)}>
                            安装
                          </button>
                        )
                      )}
                      <button type="button" onClick={() => open(group.id)}>
                        详情
                      </button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="collection-empty">
              <strong>
                {search || category !== 'all' || installation !== 'all' ? '没有匹配的资料集' : current[3]}
              </strong>
              <p>
                {search || category !== 'all' || installation !== 'all' ? '调整搜索条件或筛选后再试。' : current[4]}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
