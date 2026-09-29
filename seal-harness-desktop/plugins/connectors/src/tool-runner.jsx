import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

// 来源 McpToolWorkbench 的参数表单/高级 JSON/运行结果，执行交给 DSH ToolRuntime。
export function ToolRunner({ item, tool, api, busy }) {
  const [json, setJson] = useState('{}'), [result, setResult] = useState(null), [error, setError] = useState(''), [running, setRunning] = useState(false)
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])
  let values = {}
  try { const parsed = JSON.parse(json); if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') values = parsed } catch {}
  function field(name, value) {
    const next = { ...values }
    if (value === undefined) delete next[name]; else next[name] = value
    setJson(JSON.stringify(next, null, 2))
  }
  async function execute(event) {
    event.preventDefault(); setError(''); setResult(null)
    let args
    try { args = JSON.parse(json); if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error() } catch { setError('JSON 参数必须是有效的对象。'); return }
    const controller = new AbortController(); request.current = controller; setRunning(true)
    try {
      const value = await api('connectors/testTool', { id: item.id, revision: item.revision, tool: tool.name, arguments: args }, controller.signal)
      if (!controller.signal.aborted) { if (value.isError) setError(value.error.message); else setResult(value.value ?? value.content) }
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message) } finally { if (!controller.signal.aborted) setRunning(false) }
  }
  const properties = Object.entries(tool.inputSchema?.properties ?? {})
  return <details className="mcp-tool-test"><summary><strong>测试此工具</strong><p className="mcp-muted">填写参数后运行一次，确认返回是否符合预期。</p></summary><form className="mcp-stack" onSubmit={execute}>
    <fieldset className="zz-reset-fieldset mcp-stack" disabled={running || busy}>{properties.map(([name, schema]) => <label className="mcp-field" key={name}><span>{schema.title || name}{tool.inputSchema?.required?.includes(name) ? ' *' : ''}</span>
      {schema.format === 'file' ? <div className="mcp-file-schema-unavailable" role="note"><Icon name="info" size={16} /><div><strong>文件参数暂不可用</strong><p>当前不会读取本机文件。</p></div></div> : Array.isArray(schema.enum) ? <select required={tool.inputSchema?.required?.includes(name)} value={String(values[name] ?? '')} onChange={event => field(name, schema.enum.find(value => String(value) === event.target.value))}><option value="">请选择</option>{schema.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : schema.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[name])} onChange={event => field(name, event.target.checked)} /> : ['object', 'array'].includes(schema.type) ? <small>使用下方高级 JSON 输入此参数。</small> : <input required={tool.inputSchema?.required?.includes(name)} value={values[name] ?? ''} type={['number', 'integer'].includes(schema.type) ? 'number' : 'text'} step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum} onChange={event => field(name, event.target.value === '' ? undefined : ['number', 'integer'].includes(schema.type) ? Number(event.target.value) : event.target.value)} />}
      {schema.description && <small>{schema.description}</small>}</label>)}{!properties.length && <p className="mcp-muted">此工具没有声明必填参数。</p>}<details><summary>高级输入（JSON）</summary><label className="mcp-field"><span>JSON 参数</span><textarea rows={8} spellCheck={false} value={json} onChange={event => setJson(event.target.value)} /></label></details></fieldset>
    <div className="mcp-inline-actions"><button className="btn btn--primary" disabled={running || busy || !item.enabled || item.enabledTools && !item.enabledTools.includes(tool.name) || !!item.workspacePath}>{running ? '正在运行…' : '运行工具'}</button>{running && <button type="button" className="btn btn--secondary" onClick={() => { request.current?.abort(); setRunning(false); setError('调用已取消。') }}>停止</button>}</div>
    <small className="mcp-muted">{item.workspacePath ? '此连接器限定工作区，请在该工作区的原生会话中调用。' : '使用已保存的认证。需要会话审批的工具请在原生会话中调用。'}</small>
    {error && <p role="alert" className="mcp-alert">{error}</p>}{result !== null && <section aria-label="运行结果"><h4>运行结果</h4><pre>{JSON.stringify(result, null, 2)}</pre></section>}
  </form></details>
}
