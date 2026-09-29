import React, { useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { Dialog } from '../../connectors/src/dialog.jsx'
import { downloadZip } from '../../capability-shared/src/files.js'

import { categoryForExpert } from './catalog-view.js'

export const expertIdentity = detail => ({ name: detail.manifest.name, version: detail.manifest.version, expectedDigest: detail.digest })

export function ExpertDetail({ detail, busy, error, workspaceId, workspaces, setWorkspaceId, summon, close, manage }) {
  const manifest = detail.manifest
  return <Dialog title={manifest.displayName.zh} className="expert-detail__panel" busy={busy} close={close}>
    <div className="expert-detail__body"><p className="expert-detail__hint">{manifest.profession.zh} · v{manifest.version} · {detail.enabled ? '已启用' : '尚未启用'}</p><p className="expert-detail__desc">{manifest.description.zh}</p><div className="expert-detail__tags">{manifest.tags?.map((tag, index) => <span key={index}>{tag.zh}</span>)}</div>
      {error && <p role="alert" className="editor-page__error">{error}</p>}{!!detail.problems.length && <p className="editor-page__error">{detail.problems.join(' ')}</p>}
      <label className="zz-expert-field"><span>对话工作区</span><select value={workspaceId || workspaces[0]?.workspaceId || ''} onChange={event => setWorkspaceId(event.target.value)}>{!workspaces.length && <option value="">请先在侧栏创建或选择工作区</option>}{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title || item.path}</option>)}</select></label>
      <section className="expert-detail__prompts"><h3>可以这样问</h3><div className="expert-detail__prompt-list">{manifest.quickPrompts?.map((prompt, index) => <button className="expert-detail__prompt" disabled={busy || !!detail.problems.length || !workspaces.length} key={index} onClick={() => summon(detail, prompt.zh)}>{prompt.zh}</button>)}</div>{!manifest.quickPrompts?.length && <p className="expert-detail__hint">这个专家没有配置快捷提问。</p>}</section>
      <details><summary>工作方式</summary><pre>{manifest.personaInstructions}</pre></details>
    </div><footer className="expert-detail__foot"><button className="btn btn--secondary" disabled={busy} onClick={manage}>管理专家</button><span className="expert-detail__foot-spacer" /><button className="btn btn--primary" disabled={busy || !!detail.problems.length || !workspaces.length} onClick={() => summon(detail, manifest.initPrompt?.zh ?? '')}>开始对话</button></footer>
  </Dialog>
}

export function PublicExpertDetail({ asset, busy, error, install, close }) {
  const [selectedVersion, setSelectedVersion] = useState('')
  const category = categoryForExpert(asset)
  const versions = (asset.versions ?? []).filter(version => ['published', 'private'].includes(version.status))
  const selected = versions.find(version => version.version === selectedVersion) ?? versions.find(version => version.packageReady !== false)
  return <Dialog title={asset.name || '公开专家详情'} className="expert-detail__panel" busy={busy} close={close} renderHeader={titleId => <header className="expert-detail__head">
    <span className="expert-detail__avatar" aria-hidden="true">{asset.name?.slice(0, 1)}</span><div className="expert-detail__identity"><h2 id={titleId}>{asset.name || '公开专家详情'}</h2><p>公开 · {category}</p></div><button className="expert-detail__close" type="button" aria-label="关闭详情" disabled={busy} onClick={close}><Icon name="close" size={18} /></button>
  </header>}>
    <div className="expert-detail__body">{asset.state === 'loading' ? <p role="status">正在读取详情…</p> : asset.state === 'error' ? <p role="alert">{asset.error}</p> : <>
      <p className="expert-detail__desc">{asset.summary || '为你的工作提供专业建议与执行支持。'}</p><div className="expert-detail__tags" aria-label="能力标签">{(asset.tags?.length ? asset.tags : [category]).map((tag, index) => <span key={index}>{tag}</span>)}</div>
      <section className="expert-detail__prompts"><h3>可以这样问</h3><p className="expert-detail__hint">安装该专家后可查看它的快捷提问。</p></section>
      <label className="zz-expert-field"><span>可安装版本</span>{versions.length ? <select disabled={busy} value={selected?.version || ''} onChange={event => setSelectedVersion(event.target.value)}>{versions.map(version => <option key={version.version} value={version.version} disabled={version.packageReady === false}>{version.version}{version.packageReady === false ? ' · 安装包未就绪' : ''}</option>)}</select> : <p className="expert-detail__hint">暂无可安装版本。</p>}</label>
      {error && <p role="alert" className="editor-page__error">{error}</p>}
    </>}</div><footer className="expert-detail__foot"><button className="btn btn--secondary" disabled={busy} onClick={close}>关闭</button><span className="expert-detail__foot-spacer" /><button className="btn btn--primary" disabled={busy || asset.state !== 'ready' || !selected} onClick={() => install(selected.version)}>安装到本机</button></footer>
  </Dialog>
}

export function ExpertManage({ detail, busy, error, notice, request, run, refresh, reload, edit, versions, close, view, removed }) {
  const [provider, setProvider] = useState(''), [cloud, setCloud] = useState(null), [visibility, setVisibility] = useState('private'), [confirm, setConfirm] = useState(null)
  const identity = expertIdentity(detail)
  async function loadCloud() {
    const value = await request('cloud', identity)
    setCloud(value); setVisibility(value.visibility)
  }
  return <Dialog title={`管理 ${detail.manifest.displayName.zh}`} className="expert-manage-modal" busy={busy} close={close}>
    <div className="expert-manage-modal__body"><p className="expert-manage-modal__description">{detail.manifest.description.zh}</p><dl className="expert-manage-modal__metadata"><div><dt>本机状态</dt><dd>{detail.enabled ? '已启用' : '未启用'}</dd></div><div><dt>当前版本</dt><dd>{detail.manifest.version}</dd></div><div><dt>模型</dt><dd>{detail.manifest.model}</dd></div></dl>
      {error && <p role="alert" className="expert-manage-modal__error">{error}</p>}{notice && <p role="status" className="expert-manage-modal__notice">{notice}</p>}
      <div className="zz-expert-stack"><button className="btn btn--secondary" disabled={busy} onClick={versions}>版本历史</button><label className="zz-expert-field"><span>模型提供方</span><input value={provider} onChange={event => setProvider(event.target.value)} placeholder="留空使用默认提供方" /></label><button className="btn btn--secondary" disabled={busy || (!detail.enabled && !!detail.problems.length)} onClick={() => run(async () => { await request(detail.enabled ? 'deactivate' : 'activate', { ...identity, ...(provider ? { provider } : {}) }); await refresh(); await reload() })}>{detail.enabled ? '停用' : '启用到新对话'}</button></div>
      <section className="zz-expert-cloud"><h3>专家包与云端</h3><div className="zz-expert-actions"><button className="btn btn--secondary" disabled={busy} onClick={() => run(async () => { downloadZip(await request('export', identity)) })}>导出 ZIP</button><button className="btn btn--secondary" disabled={busy} onClick={() => run(async () => { await request('upload', identity); await loadCloud() })}>上传云端</button><button className="btn btn--secondary" disabled={busy} onClick={() => run(loadCloud)}>云端可见性</button></div>
        {cloud && <div className="zz-expert-stack"><p>当前可见性：{({ private: '仅自己', company: '组织', public: '公开' })[cloud.visibility] || cloud.visibility}。上传不会自动公开。</p><label className="zz-expert-field"><span>可见性</span><select disabled={busy} value={visibility} onChange={event => setVisibility(event.target.value)}><option value="private">仅自己</option><option value="company">组织</option><option value="public">公开</option></select></label><button className="btn btn--secondary" disabled={busy} onClick={() => setConfirm('visibility')}>更新可见性</button></div>}
      </section><details><summary>包内文件与兼容字段</summary><p>{detail.files.join(' · ')}</p><pre>{JSON.stringify({ skills: detail.manifest.skills, capabilities: detail.manifest.capabilities, reasoningEffort: detail.manifest.reasoningEffort, personality: detail.manifest.personality, webSearch: detail.manifest.toolPolicy?.webSearch }, null, 2)}</pre></details>
    </div><footer className="expert-manage-modal__footer"><div className="expert-manage-modal__secondary-actions"><button className="btn btn--ghost" disabled={busy} onClick={edit}>修改配置</button><button className="btn btn--danger" disabled={busy} onClick={() => setConfirm('remove')}>移除专家</button></div><button className="btn btn--primary" disabled={busy} onClick={view}>查看与对话</button></footer>
    {confirm && <Dialog title={confirm === 'remove' ? '移除专家' : '更新可见性'} className="zz-expert-modal" busy={busy} close={() => setConfirm(null)}><div className="zz-expert-dialog-body"><p>{confirm === 'remove' ? '移除此专家及所有本地版本？已上传的云端版本将保留。' : `将云端专家改为${({ private: '仅自己', company: '组织内可见', public: '公开' })[visibility]}${visibility === 'public' ? `，发布版本 ${detail.manifest.version}` : ''}？`}</p>{error && <p role="alert">{error}</p>}</div><footer className="zz-expert-dialog-footer"><button className="btn btn--secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="btn btn--primary" disabled={busy} onClick={() => run(async () => {
      if (confirm === 'remove') { await request('remove', identity); await refresh(); removed() }
      else { await request('visibility', { assetId: cloud.assetId, scope: visibility, expectedEtag: cloud.etag, ...(visibility === 'public' ? { version: detail.manifest.version, expectedPublicVersion: cloud.publicVersion } : {}) }); await loadCloud(); setConfirm(null) }
    })}>确认</button></footer></Dialog>}
  </Dialog>
}

export function ExpertVersions({ detail, busy, error, load, activate, edit, close }) {
  return <Dialog title={`${detail.manifest.displayName.zh} · 版本历史`} className="expert-versions" busy={busy} close={close}><div className="expert-versions__body"><p className="expert-versions__draft">每次编辑保存一个新版本。切换启用版本用于之后的新对话。</p><button className="btn btn--primary" disabled={busy} onClick={edit}>编辑为新版本</button>{error && <p role="alert" className="expert-versions__error">{error}</p>}<ul className="expert-versions__items">{detail.versions.map(version => <li key={version.version} className="expert-versions__item"><div className="expert-versions__item-main"><p className="expert-versions__item-label">{version.version}{version.active && <span className="expert-versions__current">已启用</span>}</p><p className="expert-versions__item-time">{version.createdAt ? new Date(version.createdAt).toLocaleString() : ''}</p></div><button className="btn btn--ghost" disabled={busy} onClick={() => load(version.version)}>查看</button><button className="btn btn--secondary" disabled={busy || version.active} onClick={() => activate(version.version)}>{version.active ? '当前版本' : '使用此版本'}</button></li>)}</ul></div></Dialog>
}
