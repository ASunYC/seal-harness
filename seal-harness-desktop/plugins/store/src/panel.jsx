import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { ArtifactFiles } from './files.jsx'
import { Catalog, Overlay, Tabs } from './catalog.jsx'
import { styles } from './styles.js'
import { HttpAdapterEditor } from './adapter-editor.jsx'
import { AssetEditor, VersionEditor } from './editor.jsx'
import { readZip, downloadZip } from '../../capability-shared/src/files.js'

const sections = { skills: '技能', mcps: '连接器', experts: '专家', center: 'MCP Center' }
const states = { draft: '草稿', private: '私有版本', published: '已发布', yanked: '已下架' }

export function StorePanel({ api, collection: fixedCollection, scope: fixedScope, navigation, signedIn = true, openLogin, onBack, onCreateSkill, onImportSkill }) {
  const [selectedCollection, setCollection] = useState('skills')
  const [selectedScope, setScope] = useState('published')
  const collection = fixedCollection ?? selectedCollection
  const scope = fixedScope ?? selectedScope
  const title = fixedCollection ? sections[collection] : '能力商店'
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [refresh, setRefresh] = useState(0)
  const [catalog, setCatalog] = useState({ status: 'loading' })
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [editor, setEditor] = useState(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [discardEditor, setDiscardEditor] = useState(false)
  useEffect(() => { setEditorDirty(false); setDiscardEditor(false) }, [editor])
  const closeEditor = () => editorDirty ? setDiscardEditor(true) : setEditor(null)
  const [upload, setUpload] = useState(null)
  const [validation, setValidation] = useState(null)
  const [sort, setSort] = useState('name')
  const [installationFilter, setInstallationFilter] = useState('all')
  const [detailTab, setDetailTab] = useState('overview')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [installed, setInstalled] = useState([])
  const detailRequest = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    detailRequest.current?.abort()
    setDetail(null)
    setConfirm(null)
    setEditor(null)
    setUpload(null)
    setValidation(null)
    if (!signedIn) { setCatalog({ status: 'signedOut' }); return () => controller.abort() }
    setCatalog({ status: 'loading' })
    const localModule = collection === 'mcps' || collection === 'center' ? 'connectors' : collection
    api(`${localModule}/list`, {}, controller.signal).then(result => {
      if (!controller.signal.aborted) setInstalled((result.skills ?? result.items ?? []).map(item => item.origin ?? item.source).filter(Boolean))
    }).catch(() => { if (!controller.signal.aborted) setInstalled([]) })
    const endpoint = collection === 'center' ? 'store/center' : 'store/list'
    api(endpoint, collection === 'center' ? {} : { collection, scope }, controller.signal)
      .then(items => { if (!controller.signal.aborted) setCatalog({ status: 'ready', items }) })
      .catch(error => { if (!controller.signal.aborted) setCatalog({ status: 'error', message: error.message }) })
    return () => controller.abort()
  }, [api, collection, scope, refresh, signedIn])
  useEffect(() => () => detailRequest.current?.abort(), [])

  async function open(item) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setDetailTab('overview')
    setSelectedVersion('')
    if (collection === 'center') { setDetail({ status: 'ready', asset: item }); return }
    setDetail({ status: 'loading', id: item.id })
    setConfirm(null)
    try {
      const asset = await api('store/detail', { collection, id: item.id }, controller.signal)
      if (!controller.signal.aborted) setDetail({ status: 'ready', asset })
    } catch (error) {
      if (!controller.signal.aborted) setDetail({ status: 'error', message: error.message })
    }
  }

  async function run(endpoint, payload, success) {
    setBusy(true)
    setNotice('')
    try {
      const result = await api(endpoint, payload)
      if (result.validation) { setValidation(result.validation); return }
      setNotice(success)
      setConfirm(null)
      setRefresh(value => value + 1)
    } catch (error) { setNotice(error.message) }
    finally { setBusy(false) }
  }

  async function prepareUpload(version, file) {
    if (!file) return
    setBusy(true); setNotice('')
    try {
      const contentBase64 = await readZip(file)
      const payload = { collection, id: asset.id, version: version.version, contentBase64 }
      const inspection = await api('store/inspectArtifact', payload)
      setUpload({ ...payload, ...inspection })
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }

  const items = catalog.status === 'ready' ? catalog.items.filter(item =>
    (category === 'all' || item.category === category) && (installationFilter === 'all' || (installationFilter === 'installed') === installed.some(local => local.assetId === item.id || local.id === item.id || collection === 'center' && local.centerId === item.connectorId)) && `${item.name} ${item.summary} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => sort === 'updated' ? (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') : a.name.localeCompare(b.name, 'zh-CN')) : []
  const asset = detail?.status === 'ready' ? detail.asset : null
  const version = asset?.versions?.find(item => item.version === selectedVersion) ?? asset?.versions?.[0]
  const closeDetail = () => { detailRequest.current?.abort(); setDetail(null); setConfirm(null) }
  const install = item => collection === 'center'
    ? run('connectors/installCenter', { connectorId: item.connectorId }, '连接器已安装，请在连接器页面授权或启用。')
    : run(`${collection === 'mcps' ? 'connectors' : collection}/install`, { id: item.id, version: item.latestVersion.version }, '已安装。请到对应模块查看或启用。')
  return <section className="zz-resource-page zz-store skill-catalog-page resource-page-shell" aria-label={title}>
    <style>{styles}</style>
    <header className="resource-page-nav"><div className="resource-page-nav__path">{onBack && <button type="button" className="resource-page-nav__back" aria-label={`返回会话，离开${title}页`} title={`返回会话，离开${title}页`} onClick={onBack}><Icon name="back" size={17} /></button>}<strong>{title}</strong><span className="resource-page-nav__badge">RESOURCE</span></div><div className="header-actions">{onCreateSkill && <button className="primary" disabled={busy} onClick={onCreateSkill}>创建 Skill</button>}{onImportSkill && <button disabled={busy} onClick={onImportSkill}>导入 Skill 包</button>}{signedIn && <span className="sync-state"><span className="sync-dot" aria-hidden="true" />{catalog.status === 'loading' ? '正在同步' : catalog.status === 'error' ? '同步失败' : '已同步'}</span>}<button disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新</button>{signedIn && scope === 'mine' && ['skills', 'mcps'].includes(collection) && <button className="primary" disabled={busy} onClick={() => setEditor({ kind: 'asset', asset: null })}>新建能力</button>}</div></header>
    <div className="skill-catalog-page__content">
    <section className="skill-catalog-hero"><h1>{title}</h1><p>{fixedCollection ? `发现、管理并使用你的${title}。` : '发现、管理并使用你的技能、连接器和专家。'}</p></section>
    {navigation ? navigation(busy) : <>{!fixedCollection && <Tabs label="能力类型" items={sections} value={collection} disabled={busy} onChange={value => { setCollection(value); setScope('published'); setNotice(''); setCategory('all') }} />}
    {collection !== 'center' && <Tabs label="目录范围" items={{ published: '公开', mine: '个人' }} value={scope} disabled={busy} className="skill-catalog-secondary-tabs" onChange={setScope} />}</>}
    <div className="skill-catalog-toolbar">
      <label className="skill-catalog-search"><Icon name="search" size={15} /><input aria-label="搜索能力" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称、描述或标签" />{search && <button className="search-clear" aria-label="清除搜索" onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}</label>
      <label className="skill-installation-filter"><Icon name="filter" size={15} /><select aria-label="安装状态筛选" value={installationFilter} onChange={event => setInstallationFilter(event.target.value)}><option value="all">全部安装状态</option><option value="installed">已安装</option><option value="uninstalled">未安装</option></select></label>
      <label className="skill-installation-filter"><select aria-label="分类筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option><option value="office">办公类</option><option value="development">开发类</option></select></label>
      <label className="skill-installation-filter"><select aria-label="目录排序" value={sort} onChange={event => setSort(event.target.value)}><option value="name">名称</option><option value="updated">最近更新</option></select></label>
    </div>
    {editor?.kind === 'asset' && <Overlay title={editor.asset ? '编辑能力信息' : '新建云端能力'} busy={busy} close={closeEditor} onChange={() => setEditorDirty(true)}>{notice && <p role="status" className="state-banner">{notice}</p>}<AssetEditor key={editor.asset?.id ?? 'new'} asset={editor.asset} collection={collection} busy={busy} close={closeEditor} save={fields => run(editor.asset ? 'store/updateAsset' : 'store/createAsset', { collection, fields, ...(editor.asset ? { id: editor.asset.id, etag: editor.asset.etag } : {}) }, '能力信息已保存。')} /></Overlay>}
    {editor?.kind === 'adapter' && <Overlay title="HTTP 工具工作台" close={closeEditor} onChange={() => setEditorDirty(true)}><HttpAdapterEditor asset={asset} version={editor.version} api={api} close={closeEditor} saved={() => { setEditor(null); setRefresh(value => value + 1); open(asset) }} /></Overlay>}
    {editor?.kind === 'version' && <Overlay title="版本工作台" busy={busy} close={closeEditor} onChange={() => setEditorDirty(true)}>{notice && <p role="status" className="state-banner">{notice}</p>}<VersionEditor httpAdapter={asset.sourceType === 'http_adapter' || asset.metadata?.sourceType === 'http_adapter'} api={api} key={editor.value?.version ?? 'new'} value={editor.value} collection={collection} busy={busy} close={closeEditor} save={value => run(editor.value ? 'store/updateVersion' : 'store/createVersion', { collection, id: asset.id, version: value.version, descriptor: value.descriptor, dependencies: value.dependencies, ...(editor.value ? { etag: value.etag } : {}) }, '草稿已保存。')} /></Overlay>}
    {discardEditor && <Overlay title="未保存的修改" close={() => setDiscardEditor(false)}><div className="state-banner"><p>当前编辑尚未保存，离开将丢弃这些修改。</p><button onClick={() => setDiscardEditor(false)}>继续编辑</button><button onClick={() => { setEditor(null); setDiscardEditor(false) }}>放弃修改</button></div></Overlay>}
    {validation && <Overlay title="版本校验结果" close={() => setValidation(null)}><div role="status" className="state-banner"><h2>{validation.valid ? '版本校验通过' : '版本校验未通过'}</h2>{[...validation.errors, ...validation.warnings].map((issue, index) => <p key={index}>{issue.path ? `${issue.path}：` : ''}{issue.message}</p>)}<button onClick={() => setValidation(null)}>关闭校验结果</button></div></Overlay>}
    {upload && <Overlay title="上传能力包" busy={busy} close={() => setUpload(null)}><div className="state-banner"><h2>确认上传版本 {upload.version}</h2>{notice && <p role="status">{notice}</p>}{upload.warnings.length ? upload.warnings.map((warning, index) => <p key={index}>{warning.message}</p>) : <p>工件检查通过。</p>}<button disabled={busy} onClick={() => run('store/uploadArtifact', { collection: upload.collection, id: upload.id, version: upload.version, contentBase64: upload.contentBase64, expectedSha256: upload.artifactSha256 }, '版本工件已上传。')}>确认上传</button><button disabled={busy} onClick={() => setUpload(null)}>取消</button></div></Overlay>}
    {notice && <p role="status" className="state-banner">{notice}</p>}
    {catalog.status === 'signedOut' && <div className="empty-state"><h2>登录后访问云端{fixedCollection ? title : '能力商店'}</h2><p>本地能力可继续使用。</p><button type="button" onClick={openLogin}>去登录</button></div>}
    {catalog.status === 'loading' && <p role="status">正在读取{sections[collection]}目录…</p>}
    {catalog.status === 'error' && <div role="alert" className="empty-state"><h2>暂时无法读取目录</h2><p>{catalog.message}</p><button onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
    {catalog.status === 'ready' && !items.length && <div className="empty-state"><h2>{search || installationFilter !== 'all' || category !== 'all' ? '没有匹配的能力' : '这里还没有能力'}</h2><p>{search || installationFilter !== 'all' || category !== 'all' ? '试试其他关键词，或清除筛选。' : '团队发布能力后会出现在这里。本地能力可在左侧对应模块管理。'}</p>{(search || installationFilter !== 'all' || category !== 'all') && <button onClick={() => { setSearch(''); setInstallationFilter('all'); setCategory('all') }}>清除筛选</button>}</div>}
    <Catalog items={items} collection={collection} scope={scope} installed={installed} busy={busy} open={open} install={install} />
    {detail && <Overlay drawer title="能力详情" close={closeDetail} busy={busy}>
      {notice && <p role="status" className="state-banner">{notice}</p>}
      {detail.status === 'loading' && <p role="status">正在读取详情…</p>}{detail.status === 'error' && <p role="alert">{detail.message}</p>}
      {asset && <><div className="store-detail-heading"><span className="skill-detail-icon" aria-hidden="true"><Icon name="skill-detail" size={34} strokeWidth={1.8} /></span><h2>{asset.name}</h2></div><p>{asset.summary}</p><p className="zz-cap-muted">{asset.publisherTeam || '团队能力'} · {asset.visibility === 'private' ? '私有' : asset.visibility === 'public' ? '公开' : '组织内'}</p>{scope === 'mine' && collection !== 'experts' && <div className="zz-cap-toolbar"><button disabled={busy} onClick={() => setEditor({ kind: 'asset', asset })}>编辑信息</button><button disabled={busy} onClick={() => setEditor({ kind: 'version', value: null })}>创建版本</button><button disabled={busy} onClick={() => setConfirm({ kind: 'deleteAsset' })}>删除能力</button></div>}{collection !== 'center' && <><label className="store-version-select">版本<select aria-label="详情版本" value={version?.version ?? ''} onChange={event => setSelectedVersion(event.target.value)}>{asset.versions?.map(item => <option key={item.version}>{item.version}</option>)}</select></label><Tabs label="能力详情页签" items={{ overview: '概览', ...(collection === 'skills' ? { files: '文件' } : {}), releases: '版本记录' }} value={detailTab} onChange={setDetailTab} className="skill-catalog-secondary-tabs" /></>}
        {detailTab === 'overview' && <section className="store-overview"><h3>用途简介</h3><p>{asset.summary || '暂无描述'}</p><dl><div><dt>分类</dt><dd>{asset.category === 'office' ? '办公类' : asset.category === 'development' ? '开发类' : '其他'}</dd></div><div><dt>来源</dt><dd>{asset.publisherTeam || (collection === 'center' ? 'MCP Center' : '团队能力')}</dd></div></dl>{collection === 'center' ? <><p>{asset.toolCount ?? '未知数量'} 个工具 · {asset.clientAuthMode === 'oauth' ? '浏览器授权' : '无需授权'}</p><button disabled={busy || installed.some(local => local.centerId === asset.connectorId)} onClick={() => install(asset)}>安装连接器</button></> : <p>{version?.artifact ? `${Math.ceil(version.artifact.sizeBytes / 1024)} KB · 可导出完整能力包` : '此版本暂无文件信息'}</p>}</section>}
        {detailTab === 'files' && version && <ArtifactFiles key={`${asset.id}/${version.version}`} api={api} id={asset.id} version={version.version} />}
        {(detailTab !== 'releases' ? (version ? [version] : []) : asset.versions ?? []).map(version => <div key={version.version} className={`zz-cap-version ${detailTab !== 'releases' ? 'is-current' : ''}`}><strong>{version.version}</strong><span>{states[version.status]}</span>
          {version.artifact && <small>{Math.ceil(version.artifact.sizeBytes / 1024)} KB</small>}
          {['published', 'private'].includes(version.status) && <button disabled={busy || (collection === 'experts' && version.packageReady === false)} onClick={() => run(`${collection === 'mcps' ? 'connectors' : collection}/install`, { id: asset.id, version: version.version }, '已安装。请到对应模块查看或启用。')}>安装此版本</button>}
          {collection !== 'experts' && <button disabled={busy} onClick={async () => { setBusy(true); setNotice(''); try { downloadZip(await api('store/exportVersion', { collection, id: asset.id, version: version.version })) } catch (error) { setNotice(error.message) } finally { setBusy(false) } }}>导出版本</button>}
          {scope === 'mine' && collection !== 'experts' && version.status === 'draft' && <>{collection === 'mcps' && (asset.sourceType === 'http_adapter' || asset.metadata?.sourceType === 'http_adapter') && <button disabled={busy} onClick={() => setEditor({ kind: 'adapter', version })}>编辑与测试 HTTP 工具</button>}<button disabled={busy} onClick={async () => { setBusy(true); try { setEditor({ kind: 'version', value: await api('store/version', { collection, id: asset.id, version: version.version }) }) } catch (error) { setNotice(error.message) } finally { setBusy(false) } }}>编辑草稿</button><label>上传 ZIP<input type="file" accept=".zip" disabled={busy} onChange={event => { prepareUpload(version, event.target.files?.[0]); event.target.value = '' }} /></label><button disabled={busy} onClick={() => run('store/transition', { collection, id: asset.id, version: version.version, etag: version.etag, action: 'validate' }, '')}>校验</button><button disabled={busy} onClick={() => setConfirm({ kind: 'release', version })}>保存私有版本</button></>}
          {scope === 'mine' && collection !== 'experts' && ['draft', 'private', 'yanked'].includes(version.status) && <button disabled={busy} onClick={() => setConfirm({ kind: 'deleteVersion', version })}>删除版本</button>}
          {scope === 'mine' && ['draft', 'private', 'yanked'].includes(version.status) && <button disabled={busy} onClick={() => setConfirm({ kind: 'publish', version })}>发布版本</button>}
          {scope === 'mine' && version.status === 'published' && <button disabled={busy} onClick={() => setConfirm({ kind: 'yank', version })}>下架版本</button>}
        </div>)}
        {collection !== 'center' && !asset.versions?.length && <p>暂无可用版本。</p>}
        {confirm && <Overlay title="确认操作" busy={busy} close={() => setConfirm(null)}><p>{confirm.kind === 'publish' ? '确认发布此版本？此操作会提交到团队后端。' : confirm.kind === 'yank' ? '确认下架此版本？下架后其他用户不能再安装此版本。' : confirm.kind === 'release' ? '确认保存为仅自己可用的版本？' : '确认删除？已删除的云端内容无法恢复。'}</p><button disabled={busy} onClick={() => {
          if (confirm.kind === 'deleteAsset') run('store/deleteAsset', { collection, id: asset.id, etag: asset.etag }, '能力已删除。')
          else if (confirm.kind === 'deleteVersion') run('store/deleteVersion', { collection, id: asset.id, version: confirm.version.version, etag: confirm.version.etag }, '版本已删除。')
          else run('store/transition', { collection, id: asset.id, version: confirm.version.version, etag: confirm.version.etag, action: confirm.kind }, '操作已完成。')
        }}>{busy ? '正在处理…' : '确认'}</button><button disabled={busy} onClick={() => setConfirm(null)}>取消</button></Overlay>}
      </>}
    </Overlay>}
    </div>
  </section>
}
