import React, { useState } from 'react'
import { apiKeySettingsUrl, modelSettingsUrl } from '../../weknora/src/model-settings-url.js'

export function BaseEditor({ item, models, modelError, busy, save, close }) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [embeddingModelId, setEmbeddingModelId] = useState('')
  return <form className="seal-kb-editor" onSubmit={event => { event.preventDefault(); void save({ ...(item?.id ? { id: item.id } : {}), name, description, ...(embeddingModelId ? { embeddingModelId } : {}) }) }}>
    <h2>{item ? '编辑知识库' : '新建知识库'}</h2>
    <label>名称<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>说明<textarea maxLength={4000} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {!item && <label>向量模型 ID<input list="seal-kb-models" value={embeddingModelId} onChange={event => setEmbeddingModelId(event.target.value)} placeholder="选择已配置模型或填写 ID" /><datalist id="seal-kb-models">{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></label>}
    {!item && <p className="seal-kb-muted">向量模型在 WeKnora 服务端配置。未选择时由服务端校验默认配置，不会自动下载模型。</p>}
    {modelError && <p role="status" className="seal-kb-muted">模型列表暂不可用，可填入服务端的模型 ID：{modelError}</p>}
    <div className="seal-kb-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy}>保存知识库</button></div>
  </form>
}

export function TextEditor({ busy, save, close }) {
  const [title, setTitle] = useState(''), [content, setContent] = useState('')
  return <form className="seal-kb-editor" onSubmit={event => { event.preventDefault(); void save({ title, content }) }}>
    <h3>导入文本</h3><label>文档标题<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Markdown 或纯文本<textarea required rows={10} maxLength={2 * 1024 * 1024} value={content} onChange={event => setContent(event.target.value)} /></label>
    <p className="seal-kb-muted">内容发送至所配置的 WeKnora 服务进行解析和索引。导入不代表索引已完成。</p>
    <div className="seal-kb-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy}>导入并索引</button></div>
  </form>
}

export function DeleteConfirmation({ label, base, busy, remove, close }) {
  return <section className="seal-kb-editor" role="alertdialog" aria-label="确认删除">
    <h2>确认删除“{label}”？</h2><p>{base ? '这会删除服务端的知识库及其中全部文档。此操作不能从 Seal 撤销。' : '这会删除服务端文档及其索引。此操作不能从 Seal 撤销。'}</p>
    <div className="seal-kb-actions"><button type="button" onClick={close} disabled={busy}>取消</button><button className="danger" type="button" onClick={remove} disabled={busy}>确认删除</button></div>
  </section>
}

export function KnowledgeSettings({ status, close, openConnection }) {
  const initial = status?.baseUrl === 'http://localhost:8080/api/v1' ? 'http://localhost' : status?.baseUrl ? new URL(status.baseUrl).origin : 'http://localhost'
  const [origin, setOrigin] = useState(initial)
  let modelUrl, keyUrl, error
  try { modelUrl = modelSettingsUrl(origin); keyUrl = apiKeySettingsUrl(origin) } catch (cause) { error = cause.message }
  return <aside className="seal-kb-settings" role="dialog" aria-modal="true" aria-label="知识库设置">
    <header><h2>知识库设置</h2><button type="button" aria-label="关闭知识库设置" onClick={close}>关闭</button></header>
    <section><h3>WeKnora 连接</h3><p>{status?.configured ? '已配置当前本地账号的 API Key' : '尚未配置访问令牌'}</p><p className="seal-kb-muted">{status?.baseUrl}</p><button type="button" onClick={openConnection}>打开连接设置</button></section>
    <section><h3>向量与问答模型</h3><p>向量模型、问答模型及 OCR 在 WeKnora 服务端管理。Seal 复用服务端能力，不在本机重复下载 ONNX 或部署向量引擎。</p>
      <label>WeKnora 管理页面地址<input type="url" value={origin} onChange={event => setOrigin(event.target.value)} /></label>
      <p className="seal-kb-muted">管理页面与 API 可能使用不同端口，请填写管理员提供的页面地址。</p>
      {error ? <p role="alert">{error}</p> : <div className="seal-kb-actions"><a href={modelUrl} target="_blank" rel="noopener noreferrer">模型与 OCR 设置</a><a href={keyUrl} target="_blank" rel="noopener noreferrer">API Key 权限管理</a></div>}
    </section>
    <section><h3>权限说明</h3><p>查询需要 retrieve；导入、重解析和删除文档需要 ingest；创建、编辑和删除知识库需要 manage_kbs。权限与知识库范围由 WeKnora 管理员授予。</p></section>
  </aside>
}
