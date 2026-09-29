import React, { useEffect, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { Dialog } from '../../connectors/src/dialog.jsx'

const bilingual = zh => ({ zh, en: '' })

function CapabilityGroup({ title, bindings, options, state, add, remove }) {
  return <div className="capability-group"><div className="capability-group__head"><h3>{title}</h3><span>{bindings.length} 项</span></div>
    {!bindings.length && <p className="capability-empty">尚未配备{title}。</p>}
    <ul className="capability-list">{bindings.map(binding => {
      const option = options.find(item => item.id === binding.id)
      return <li className={`capability-item ${state === 'ready' && !option ? 'capability-item--stale' : ''}`} key={binding.id}><div className="capability-item__body"><strong>{option?.name || binding.id}</strong>{!option && <span className="capability-item__stale">{state === 'ready' ? `本机未找到该${title}，可移除绑定` : '候选目录尚未读取，保留原绑定'}</span>}{option?.status && option.status !== 'active' && <span className="capability-item__stale">连接器尚未连接</span>}</div><button className="btn btn--ghost" type="button" onClick={() => remove(binding.id)}>移除</button></li>
    })}</ul>
    <label className="capability-add"><span>从已安装{title}中添加</span><select value="" disabled={state !== 'ready' || !options.some(option => !bindings.some(binding => binding.id === option.id))} onChange={event => add(event.target.value)}><option value="">选择要添加的{title}…</option>{options.filter(option => !bindings.some(binding => binding.id === option.id)).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
    {state === 'loading' && <p className="capability-hint" role="status">正在读取{title}…</p>}{state === 'error' && <p className="capability-hint">候选目录读取失败，当前绑定仍会保留。</p>}{state === 'ready' && !options.length && <p className="capability-hint">暂无可绑定的{title}，请先完成安装。</p>}
  </div>
}

// 来源 ExpertEditorView.vue：全页编辑、双栏表单、分组能力配备。
export function ExpertEditor({ editor, busy, error, api, save, close }) {
  const [manifest, setManifest] = useState(editor.manifest), [knowledgeIds, setKnowledgeIds] = useState(editor.knowledgeGroupIds ?? [])
  const [pools, setPools] = useState({ models: { state: 'loading', items: [] }, capabilities: { state: 'loading', items: [] }, knowledge: { state: 'loading', items: [] } })
  const [tagsText, setTagsText] = useState(editor.manifest.tags?.map(tag => tag.zh).join('，') ?? '')
  const [promptsText, setPromptsText] = useState(editor.manifest.quickPrompts?.map(prompt => prompt.zh).join('\n') ?? '')
  const [attempt, setAttempt] = useState(0), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  const change = (key, value) => { setDirty(true); setManifest(current => ({ ...current, [key]: value })) }
  useEffect(() => {
    const controller = new AbortController()
    for (const action of ['models', 'capabilities', 'knowledge']) {
      setPools(current => ({ ...current, [action]: { ...current[action], state: 'loading' } }))
      api(`experts/${action}`, {}, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setPools(current => ({ ...current, [action]: { state: 'ready', items: result.items ?? [] } }))
        if (action === 'models' && result.default?.model) setManifest(current => current.model ? current : { ...current, model: result.default.model })
      }).catch(failure => { if (!controller.signal.aborted) setPools(current => ({ ...current, [action]: { ...current[action], state: 'error', error: failure.message } })) })
    }
    return () => controller.abort()
  }, [api, attempt])
  const requestClose = () => dirty ? setDiscard(true) : close()
  const capabilities = manifest.capabilities ?? []
  return <main className="editor-page" aria-label="专家编辑器" aria-busy={busy}>
    <header className="zz-expert-editor-header"><div className="zz-expert-editor-heading"><button type="button" className="resource-page-nav__back" aria-label="返回我的专家" title="返回我的专家" disabled={busy} onClick={requestClose}><Icon name="back" size={17} /></button><div><h1>{editor.source ? '修改专家' : '创建专家'}</h1><p>{editor.source ? '保存为新版本，已有版本保持不变。' : '创建可在本地修改和上传复用的专家。'}</p></div></div><button className="btn btn--primary" type="submit" form="zz-expert-form" disabled={busy}>{busy ? '正在保存…' : editor.source ? '保存新版本' : '保存到我的专家'}</button></header>
    {error && <p role="alert" className="editor-page__error">{error}</p>}
    {editor.source && <div className="version-line"><span className="version-line__label">当前版本：{editor.source.version} → {manifest.version}</span><details className="lineage-fold"><summary>版本与来源</summary><dl className="lineage-fold__summary"><div><dt>专家标识</dt><dd>{manifest.name}</dd></div><div><dt>入口 Agent</dt><dd>{manifest.entryAgent}</dd></div><div><dt>基础版本</dt><dd>{editor.source.version}</dd></div></dl></details></div>}
    <form id="zz-expert-form" onSubmit={event => { event.preventDefault(); save(manifest, knowledgeIds) }}><fieldset className="zz-reset-fieldset" disabled={busy}>
      <div className="expert-form"><section><h2>基本信息</h2>
        <label><span>名称</span><input required maxLength={200} value={manifest.displayName.zh} onChange={event => change('displayName', { ...manifest.displayName, zh: event.target.value })} placeholder="例如：高级研发顾问" /></label>
        <label><span>简介</span><textarea rows={3} required maxLength={200} value={manifest.description.zh} onChange={event => change('description', { ...manifest.description, zh: event.target.value })} placeholder="说明这个专家适合解决什么问题" /></label>
        <label><span>职业</span><input required maxLength={200} value={manifest.profession.zh} onChange={event => change('profession', { ...manifest.profession, zh: event.target.value })} placeholder="例如：研发顾问" /></label>
        <label><span>标签</span><input value={tagsText} onChange={event => { setTagsText(event.target.value); change('tags', event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean).map(bilingual)) }} placeholder="用逗号分隔，例如：架构，代码质量" /></label>
        <label><span>分类</span><input maxLength={100} value={manifest.categoryId ?? ''} onChange={event => change('categoryId', event.target.value)} placeholder="办公、开发、研究" /></label>
        <div className="zz-expert-field-row"><label><span>标识</span><input required pattern="[a-z0-9][a-z0-9-]{0,62}" maxLength={63} disabled={!!editor.source} value={manifest.name} onChange={event => change('name', event.target.value)} placeholder="report-expert" /></label><label><span>版本</span><input required value={manifest.version} onChange={event => change('version', event.target.value)} /></label></div>
      </section><section><h2>工作方式</h2>
        <label><span>核心指令</span><textarea required rows={12} value={manifest.personaInstructions} onChange={event => change('personaInstructions', event.target.value)} placeholder="描述角色、目标、工作步骤、输出格式和边界" /></label>
        <label><span>该专家的新会话模型</span><input required list="zz-expert-model-options" maxLength={200} value={manifest.model} onChange={event => change('model', event.target.value)} placeholder="选择或输入已配置模型" /><datalist id="zz-expert-model-options">{pools.models.items.map(model => <option key={`${model.provider}/${model.id}`} value={model.id}>{model.name} · {model.provider}</option>)}</datalist></label>
        <div className="zz-expert-field-row"><label><span>推理强度</span><select value={manifest.reasoningEffort ?? ''} onChange={event => change('reasoningEffort', event.target.value || undefined)}><option value="">模型默认</option><option value="minimal">极低</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label><span>交流风格</span><select value={manifest.personality ?? 'none'} onChange={event => change('personality', event.target.value)}><option value="none">按人设指令</option><option value="friendly">友善耐心</option><option value="pragmatic">简洁务实</option></select></label></div>
        <details><summary>开场与快捷问题</summary><div className="zz-expert-stack"><label><span>开场任务</span><textarea rows={2} maxLength={200} value={manifest.initPrompt?.zh ?? ''} onChange={event => change('initPrompt', event.target.value ? bilingual(event.target.value) : undefined)} /></label><label><span>快捷问题，每行一个</span><textarea rows={3} value={promptsText} onChange={event => { setPromptsText(event.target.value); change('quickPrompts', event.target.value.split('\n').filter(Boolean).map(bilingual)) }} /></label></div></details>
      </section></div>
      <section className="capability-provision"><div className="capability-provision__heading"><h2>能力配备</h2><p>为该专家补充可调用的技能、连接器与知识库。</p></div>
        {Object.values(pools).some(pool => pool.state === 'error') && <div role="alert" className="editor-page__error">{Object.values(pools).filter(pool => pool.state === 'error').map(pool => pool.error).join(' ')}<button type="button" className="btn btn--secondary" onClick={() => setAttempt(value => value + 1)}>重新读取候选目录</button></div>}
        {['skill', 'mcp'].map(kind => <CapabilityGroup key={kind} title={kind === 'skill' ? '技能' : '连接器'} state={pools.capabilities.state} options={pools.capabilities.items.filter(item => item.kind === kind).map(item => ({ ...item, id: item.sourceId }))} bindings={capabilities.filter(item => item.kind === kind).map(item => ({ id: item.sourceId }))} add={id => change('capabilities', [...capabilities, { kind, sourceId: id }])} remove={id => change('capabilities', capabilities.filter(item => item.kind !== kind || item.sourceId !== id))} />)}
        <CapabilityGroup title="知识库" state={pools.knowledge.state} options={pools.knowledge.items} bindings={knowledgeIds.map(id => ({ id }))} add={id => { setDirty(true); setKnowledgeIds([...knowledgeIds, id]) }} remove={id => { setDirty(true); setKnowledgeIds(knowledgeIds.filter(value => value !== id)) }} />
      </section>
    </fieldset></form>
    {discard && <Dialog title="有未保存的修改" className="zz-expert-modal" close={() => setDiscard(false)}><div className="zz-expert-dialog-body"><p>退出后这些修改将丢失。</p></div><footer className="zz-expert-dialog-footer"><button className="btn btn--secondary" onClick={() => setDiscard(false)}>继续编辑</button><button className="btn btn--danger" onClick={close}>放弃修改</button></footer></Dialog>}
  </main>
}
