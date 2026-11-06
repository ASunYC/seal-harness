import React from 'react'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

const officeKind = 'seal-workspace-office'

function GuideIcon({ kind }) {
  const paths = {
    files: <><path d="M3 7h6l2 2h10v10H3z" /><path d="M3 7V5h7l2 2" /></>,
    terminal: <><path d="m5 7 5 5-5 5" /><path d="M12 17h7" /></>,
    browser: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18" /></>,
    chat: <path d="M4 5h16v12H9l-5 3z" />,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[kind] ?? <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 12h8M12 8v8" /></>}</svg>
}

function fileName(address) {
  const path = parseFileAddress(address)?.path
  return path?.split(/[\\/]/u).at(-1) ?? address
}

export function RightGuide({ useTabInfo, sessionId, tabs, right }) {
  const { tab } = useTabInfo()
  const entries = React.useSyncExternalStore(tabs.subscribe.bind(tabs), () => tabs.guide())
  const openTabs = React.useSyncExternalStore(right.openTabs.subscribe.bind(right.openTabs), () => right.openTabs.getSnapshot())
  const [address, setAddress] = React.useState('')
  const [showDescriptions, setShowDescriptions] = React.useState(true)
  const [showDocuments, setShowDocuments] = React.useState(true)
  const moreRef = React.useRef(null)
  const hasBrowser = entries.some(entry => entry.kind === 'browser')
  const documents = openTabs.filter(item => item.sessionId === sessionId && item.kind === officeKind)
  React.useEffect(() => {
    const dismiss = event => { if (!moreRef.current?.contains(event.target)) moreRef.current.open = false }
    const escape = event => { if (event.key === 'Escape' && moreRef.current?.open) moreRef.current.open = false }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  const openTool = kind => {
    if (moreRef.current) moreRef.current.open = false
    tab.actions.openTab(kind, { replaceTab: true })
  }
  const openBrowser = event => {
    event.preventDefault()
    const url = address.trim()
    if (url) tab.actions.openTab('browser', { replaceTab: true, params: { url } })
    else tab.actions.openTab('browser', { replaceTab: true })
  }

  return <main className="seal-right-guide" aria-label="右侧工作区开始页">
    <div className="seal-right-guide-toolbar">
      {hasBrowser && <form className="seal-right-guide-address" onSubmit={openBrowser} role="search">
        <GuideIcon kind="browser" />
        <input type="text" aria-label="网址" placeholder="输入网址" value={address} onChange={event => setAddress(event.target.value)} />
        <button type="submit" aria-label="打开网址" title="打开网址">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </form>}
      <details className="seal-right-guide-more" ref={moreRef}>
        <summary aria-label="更多设置" title="更多设置">⋯</summary>
        <div className="seal-right-guide-menu" aria-label="更多设置选项">
          <p className="seal-right-guide-menu-heading">工具</p>
          {entries.map(entry => <button type="button" key={`${entry.kind}:${entry.id}`} onClick={() => openTool(entry.kind)}>
            <span>{entry.title()}</span><span aria-hidden="true">›</span>
          </button>)}
          <p className="seal-right-guide-menu-heading seal-right-guide-menu-divider">开始页显示</p>
          <button type="button" aria-pressed={showDescriptions} onClick={() => setShowDescriptions(value => !value)}>
            <span>显示工具说明</span><span aria-hidden="true">{showDescriptions ? '✓' : ''}</span>
          </button>
          <button type="button" aria-pressed={showDocuments} onClick={() => setShowDocuments(value => !value)}>
            <span>显示已打开文档</span><span aria-hidden="true">{showDocuments ? '✓' : ''}</span>
          </button>
        </div>
      </details>
    </div>
    <section className="seal-right-guide-section" aria-labelledby="seal-right-guide-tools">
      <h2 id="seal-right-guide-tools">工具</h2>
      <div className="seal-right-guide-grid">
        {entries.map(entry => <button type="button" className="seal-right-guide-tool" key={`${entry.kind}:${entry.id}`}
          onClick={() => openTool(entry.kind)}>
          <span className="seal-right-guide-tool-icon"><GuideIcon kind={entry.kind} /></span>
          <span className="seal-right-guide-tool-copy"><strong>{entry.title()}</strong>{showDescriptions && entry.description && <small>{entry.description()}</small>}</span>
          <span className="seal-right-guide-tool-arrow" aria-hidden="true">›</span>
        </button>)}
      </div>
    </section>
    {showDocuments && <section className="seal-right-guide-section seal-right-guide-documents" aria-labelledby="seal-right-guide-documents">
      <h2 id="seal-right-guide-documents">已打开的文档</h2>
      {documents.length ? <div className="seal-right-guide-document-list">
        {[...documents].reverse().map(item => <button type="button" className="seal-right-guide-document" key={item.tabId}
          onClick={() => right.openResourceIn(sessionId, item.contentId)}>
          <span className="seal-right-guide-document-icon">{fileName(item.contentId).split('.').at(-1)?.slice(0, 1).toUpperCase()}</span>
          <span className="seal-right-guide-document-copy"><strong>{fileName(item.contentId)}</strong><small>工作区文档</small></span>
          <span className="seal-right-guide-tool-arrow" aria-hidden="true">›</span>
        </button>)}
      </div> : <p className="seal-right-guide-empty">在聊天中生成或打开 Office 文档后，可在这里切换。</p>}
    </section>}
  </main>
}
