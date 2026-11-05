import React, { useEffect, useRef, useState } from 'react'

const labels = { docx: 'Word 文档', xlsx: 'Excel 表格', pptx: 'PowerPoint 演示' }
import { styles } from './styles.js'

function FileSymbol({ kind }) {
  return <span className="office-file-symbol" aria-hidden="true">{{ docx: 'W', xlsx: 'X', pptx: 'P' }[kind]}</span>
}

export function OfficePanel({ api }) {
  const [files,setFiles] = useState([]), [opened,setOpened] = useState(null), [draft,setDraft] = useState({}), [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [kind,setKind] = useState('docx'), [name,setName] = useState('新建文档'), [content,setContent] = useState('')
  const lifetime = useRef(null), pending = useRef(false), fileInput = useRef(null)
  const [creating,setCreating] = useState(false)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; void api('snapshot',{},controller.signal).then(r => { if(!controller.signal.aborted)setFiles(r.documents) }).catch(e => { if(!controller.signal.aborted)setError(e.message) }); return () => controller.abort() }, [api])
  async function run(action,payload) {
    if(pending.current)return; pending.current=true;setBusy(true);setError('')
    const signal=lifetime.current.signal
    try {
      const result=await api(action,payload,signal);signal.throwIfAborted()
      if(result.document){setOpened(result);setDraft({});setCreating(false)}
      const snapshot=await api('snapshot',{},signal);signal.throwIfAborted();setFiles(snapshot.documents)
      return result
    }catch(e){if(!signal.aborted)setError(e.message)}finally{pending.current=false;if(!signal.aborted)setBusy(false)}
  }
  async function importFile(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    if(file.size>64*1024*1024){setError('文件超过 64 MiB 限制。');return}
    const bytes=new Uint8Array(await file.arrayBuffer());if(lifetime.current.signal.aborted)return
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
    await run('import',{name:file.name,base64:btoa(binary)})
  }
  async function download() {
    const result=await run('download',{id:opened.document.id});if(!result||lifetime.current.signal.aborted)return
    const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a')
    a.href=url;a.download=result.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const changes=Object.entries(draft).map(([id,text])=>({id,text}))
  const beginCreate = (nextKind = 'docx') => { setKind(nextKind); setCreating(true); setError('') }
  const hints = { docx: '每行文字会创建一个段落。', xlsx: '使用 CSV 格式，逗号分列、换行分行。', pptx: '使用独立一行 --- 分隔幻灯片，最多 50 张。' }
  return <section className="seal-office"><style>{styles}</style>
    <header className="office-header"><div><h2>办公文档</h2><p>管理账号文档库；工作区的 Word、Excel 和演示文档可在文件预览中打开编辑。</p></div>
      <div className="office-actions"><input ref={fileInput} className="office-file-input" aria-label="导入 Office 文档" type="file" accept=".docx,.xlsx,.pptx" disabled={busy} onChange={event=>void importFile(event)} />
        <button disabled={busy} onClick={()=>fileInput.current.click()}>导入文档</button><button className="office-primary" disabled={busy} onClick={()=>beginCreate()}>新建文档</button></div></header>
    {error&&<p className="office-alert" role="alert">{error}</p>}
    <main className={`office-layout${!files.length ? ' office-layout--empty' : ''}`}>
      {!!files.length&&<aside className="office-list" aria-label="文档列表"><div className="office-list-heading"><span>我的文档</span><span>{files.length} 个</span></div><ul>{files.map(file=><li key={file.id}><button disabled={busy} aria-current={opened?.document.id===file.id&&!creating ? 'true' : undefined} onClick={()=>void run('inspect',{id:file.id})}><FileSymbol kind={file.kind}/><span><strong>{file.name}</strong><small>{labels[file.kind]} · 版本 {file.revision}</small></span></button></li>)}</ul></aside>}
      <article className="office-content">
        {creating ? <section className="office-card" aria-label="新建文档"><header className="office-card-header"><div><h3>新建文档</h3><p>选择格式，填写内容后即可创建。</p></div></header>
          <form className="office-form" onSubmit={event=>{event.preventDefault();void run('create',{kind,name,content})}}>
            <div className="office-form-grid"><label><span>文件名</span><input required aria-label="新文档名称" maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
              <label><span>文档类型</span><select aria-label="文档类型" value={kind} onChange={e=>setKind(e.target.value)} disabled={busy}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
            <label><span>初始内容 <small>（选填）</small></span><textarea aria-label="新文档内容" placeholder={hints[kind]} maxLength={64000} rows={6} value={content} disabled={busy} onChange={e=>setContent(e.target.value)}/></label>
            <p className="notice">{hints[kind]}</p><footer className="office-form-footer"><span className="notice">文件保存到当前账号的本地文档库。</span><div className="office-actions"><button type="button" disabled={busy} onClick={()=>setCreating(false)}>取消</button><button className="office-primary" disabled={busy||!name.trim()}>新建</button></div></footer>
          </form></section> : opened ? <section className="office-card" aria-label="文档编辑器"><header className="office-card-header"><div><h3>{opened.document.name}</h3><p>{labels[opened.document.kind]} · 版本 {opened.document.revision}{changes.length ? ` · ${changes.length} 处未保存更改` : ''}</p></div><div className="office-actions"><button disabled={busy} onClick={()=>void download()}>导出文件</button><button className="office-primary" disabled={busy||!changes.length} onClick={()=>void run('edit',{id:opened.document.id,hash:opened.document.hash,updates:changes})}>保存为新版本</button></div></header>
            <div className="office-editor-body">{opened.view.readOnly&&<p role="status">{opened.view.readOnlyReason}</p>}
              {opened.view.kind==='xlsx'&&<p className="notice">公式将被保留，计算结果由兼容表格软件重算。</p>}
              <p className="notice">编辑结构化文本与单元格；保存时创建新版本，保留原件。</p>
              {opened.view.truncated&&<p role="status">仅显示前 300 个文本块，其余内容仍保留在文件中。</p>}
              {opened.view.blocks.map(block=><label key={block.id}><span>{block.label}{!block.editable?' · 只读保留':''}</span><textarea aria-label={block.label+' '+block.id} rows={opened.view.kind==='xlsx'?1:3} readOnly={!block.editable} disabled={busy} value={draft[block.id]??block.text} onChange={e=>{const value=e.target.value;setDraft(d=>{const next={...d};if(value===block.text)delete next[block.id];else next[block.id]=value;return next})}}/></label>)}
            </div></section> : <section className="office-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg><h3>{files.length ? '选择一份文档开始编辑' : '从一份新文档开始'}</h3><p>{files.length ? '打开左侧文档，或创建、导入一份新文档。' : '新建文档，或从电脑导入已有的 Office 文件。'}</p>
              <div className="office-quick-create">{Object.entries(labels).map(([type,label])=><button key={type} disabled={busy} onClick={()=>beginCreate(type)}><FileSymbol kind={type}/><span>{label}</span><small>.{type}</small></button>)}</div></section>}
        {busy&&<p className="office-processing" role="status">正在本地处理…</p>}
      </article>
    </main>
    <details className="office-help"><summary>使用说明与文件保存</summary><p>这里创建或导入的文件保存在运行 Seal Harness 的设备上，按账号隔离。每次保存生成新版本，保留导入原件。</p><p>工作区的 DOCX、XLSX、PPTX 请从文件预览点击“编辑”；修改会保存回工作区原文件，不进入上述文档库。也可在工作区文件树当前目录新建或导入。</p><p>文档库当前支持结构化文本与单元格编辑，不重现完整 Office 排版，不重算公式或生成 PDF。修改文本块会沿用该块首个文本片段的格式；复杂表格等对象保留原件。</p></details>
  </section>
}
