import React, { useEffect, useRef, useState } from 'react'

const categories = { office: '办公', development: '开发', dev: '开发', search: '搜索', maps: '地图', data: '数据', design: '设计', productivity: '效率', finance: '财务', legal: '法律', agent: '智能体', coding: '编码', research: '研究', content: '内容', automation: '自动化', tools: '工具', media: '设计与多媒体', marketing: '营销电商', professional: '行业专业', life: '生活', security: '安全运维' }
const sources = { bundle: '固定技能包', clawhub: 'ClawHub', skillhub: 'SkillHub' }
function CatalogImage({ item }) {
  const [failed, setFailed] = useState(false)
  const url = item.icon ?? (/^https:\/\//.test(item.iconUrl ?? '') ? item.iconUrl : null)
  return url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : '◇'
}
const styles = `
.cap-catalog__filters { display:flex; flex-wrap:wrap; gap:10px; margin:18px 0; }
.cap-catalog__filters input { flex:1; min-width:180px; } .cap-catalog__filters input,.cap-catalog__filters select { border:1px solid var(--dsw-alias-border-l1,#dce0e6); background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; border-radius:8px; padding:10px; font:inherit; }
.cap-catalog__grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:14px; }
.cap-catalog__card { border:1px solid var(--dsw-alias-border-l1,#dce0e6); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px; background:var(--dsw-alias-bg-layer-1,#fff); }
.cap-catalog__identity { display:flex; align-items:flex-start; gap:12px; border:0; padding:0; color:inherit; background:none; cursor:pointer; text-align:left; }
.cap-catalog__icon { display:flex; width:40px; height:40px; flex:none; align-items:center; justify-content:center; font-size:22px; border-radius:9px; background:var(--dsw-alias-interactive-bg-hover,#f1f3f6); }
.cap-catalog__icon img { width:36px; height:36px; object-fit:contain; }
.cap-catalog__identity strong { display:block; font-size:14px; margin-bottom:7px; } .cap-catalog__identity small { color:var(--dsw-alias-label-secondary,#66707d); line-height:1.6; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.cap-catalog__card footer { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:auto; font-size:12px; color:var(--dsw-alias-label-secondary,#66707d); }
.cap-catalog__card button,.cap-catalog__dialog button { font:inherit; border:1px solid var(--dsw-alias-border-l1,#dce0e6); border-radius:7px; padding:6px 10px; color:inherit; background:var(--dsw-alias-bg-layer-1,#fff); cursor:pointer; }
.cap-catalog__card button:disabled { opacity:.55; cursor:default; }
.cap-catalog__card .cap-catalog__identity { padding:0; border:0; background:none; }
.cap-catalog__dialog::backdrop { background:#0007; }
.cap-catalog__dialog { width:min(620px,100%); max-height:85vh; overflow:auto; padding:24px; border-radius:14px; background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#20232a); box-shadow:0 20px 70px #0003; }
.cap-catalog__dialog header,.cap-catalog__dialog footer { display:flex; justify-content:space-between; gap:12px; align-items:center; } .cap-catalog__dialog p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; } .cap-catalog__dialog dt { font-weight:600; margin-top:14px; } .cap-catalog__dialog dd { margin:5px 0; color:var(--dsw-alias-label-secondary,#66707d); overflow-wrap:anywhere; } .cap-catalog__dialog a { color:var(--dsw-alias-brand-primary,#4176e6); }
`

function Details({ item, busy, install, close }) {
  const first = useRef(null), dialog = useRef(null)
  useEffect(() => {
    const previous = document.activeElement, node = dialog.current
    node.showModal(); first.current?.focus()
    return () => { if (node.open) node.close(); previous?.focus?.() }
  }, [])
  const name = item.displayName ?? item.name
  return <dialog ref={dialog} role="dialog" aria-label={name} className="cap-catalog__dialog" onCancel={event => { event.preventDefault(); if (!busy) close() }}><header><h2>{name}</h2><button ref={first} disabled={busy} aria-label={`关闭 ${name}`} onClick={close}>关闭</button></header>
      <p>{item.description ?? item.summary}</p><dl><dt>来源</dt><dd>{sources[item.source] ?? '官方服务'}{item.owner ? ` · ${item.owner}` : ''}</dd><dt>版本</dt><dd>{item.version || '由供应商提供'}</dd>
        {item.license && <><dt>许可</dt><dd>{item.license}</dd></>}{item.requirements && <><dt>使用要求</dt><dd>{item.requirements}</dd></>}
        {item.transport === 'cli' && <><dt>授权方式</dt><dd>安装固定版本的官方 CLI，再到“访问凭据”完成授权。{item.credentialMode === 'shared' ? '官方 CLI 的本机授权可能与其他应用共享。' : '使用此账号独立的配置目录。'}</dd></>}
        {item.source && item.source !== 'bundle' && <><dt>在线技能</dt><dd>安装时读取技能源的当前版本及完整文件清单；运行可能需要额外依赖或 API Key。目录中的安全状态为来源快照。</dd></>}
        {item.requiresApiKey && <><dt>API Key</dt><dd>此技能需要配置其声明的第三方 API Key。</dd></>}
        {item.security && <><dt>来源安全状态</dt><dd>{item.security}{item.securityNote ? ` · ${item.securityNote}` : ''}</dd></>}
      </dl>{item.example && <><h3>使用示例</h3><p>{item.example}</p></>}
      {item.homepage && <p><a href={item.homepage} target="_blank" rel="noreferrer">查看原始来源</a></p>}
      <footer><span>{item.skillCount ? `包含 ${item.skillCount} 项技能` : item.transport === 'skills' ? '技能工具包' : ''}</span><button disabled={busy || item.installed || item.supported === false} onClick={() => install(item)}>{item.installed ? '已安装' : busy ? '安装中…' : '安装'}</button></footer>
  </dialog>
}

export function CatalogGrid({ items = [], busy, install, manage, label = '系统目录', empty }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [source, setSource] = useState('all'), [selected, setSelected] = useState(null)
  const filtered = items.filter(item => `${item.displayName ?? item.name} ${item.description ?? item.summary} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
    && (category === 'all' || item.category === category) && (source === 'all' || (item.source ?? item.transport) === source))
  const detail = items.find(item => item.id === selected)
  const installItem = async item => { const ok = await install(item); if (ok !== false) setSelected(null) }
  if (!items.length) return empty ?? <p>暂无系统内容。</p>
  return <section aria-label={label}><style>{styles}</style><div className="cap-catalog__filters"><input type="search" aria-label={`搜索${label}`} placeholder="搜索名称、用途或标签" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="筛选分类" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option>{[...new Set(items.map(item => item.category))].filter(Boolean).sort().map(value => <option key={value} value={value}>{categories[value] ?? value}</option>)}</select>
      <select aria-label="筛选来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部来源</option>{[...new Set(items.map(item => item.source ?? item.transport))].filter(Boolean).map(value => <option key={value} value={value}>{sources[value] ?? { mcp: '远程 MCP', cli: '办公 CLI', skills: '技能工具包' }[value] ?? value}</option>)}</select></div>
    <p>{filtered.length} / {items.length} 项</p><div className="cap-catalog__grid">{filtered.map(item => <article className="cap-catalog__card" key={item.id}>
      <button className="cap-catalog__identity" onClick={() => setSelected(item.id)} aria-label={`查看 ${item.displayName ?? item.name}`}><span className="cap-catalog__icon"><CatalogImage item={item} /></span><span><strong>{item.displayName ?? item.name}</strong><small>{item.description ?? item.summary ?? '官方办公服务'}</small></span></button>
      <footer><span>{item.supported === false ? '当前平台不支持' : item.installed ? `已安装${item.installedCount ? ` ${item.installedCount} 项` : ''}` : categories[item.category] ?? sources[item.source] ?? '系统'}</span>
        <button disabled={busy || item.supported === false || item.installed && !manage} aria-label={`${item.installed && manage ? '管理' : '安装'} ${item.displayName ?? item.name}`} onClick={() => item.installed && manage ? manage(item) : setSelected(item.id)}>{item.installed ? manage ? '管理' : '已安装' : '＋'}</button></footer>
    </article>)}</div>{!filtered.length && <p>没有匹配的内容，请调整搜索或筛选。</p>}
    {detail && <Details item={detail} busy={busy} install={installItem} close={() => setSelected(null)} />}
  </section>
}
