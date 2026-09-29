import React, { useEffect, useId, useRef } from 'react'
import { Icon } from '../../capability-shared/src/icons.jsx'

// 原生 dialog 提供与 Stratex OverlaySurface 相同的焦点、Esc 和还焦语义。
export function Dialog({ title, className = '', busy = false, close, children, renderHeader, closeIconSize = 18, closeIconName = 'close', closeIconStrokeWidth = 1.55 }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const element = ref.current
    const previous = document.activeElement
    element.showModal()
    return () => { element.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={ref} className={`zz-resource-dialog ${className}`} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) close() }}>
    {renderHeader ? renderHeader(titleId) : <header className="zz-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="btn btn--ghost" aria-label={`关闭${title}`} disabled={busy} onClick={close}><Icon name={closeIconName} size={closeIconSize} strokeWidth={closeIconStrokeWidth} /></button></header>}
    {children}
  </dialog>
}

export const dialogStyles = `
.zz-resource-page .zz-resource-dialog {padding:0;color:var(--ink);background:var(--panel);border:var(--bw) solid var(--line-strong);border-radius:var(--r-xl);max-height:calc(100dvh - 80px);overflow:auto;box-shadow:var(--sh-3)}
.zz-resource-page .zz-resource-dialog::backdrop {background:var(--scrim)}
.zz-resource-page .zz-resource-dialog:not([open]) {display:none}
.zz-resource-page .zz-dialog-heading {display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 20px;border-bottom:var(--bw) solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
.zz-resource-page .zz-dialog-heading h2 {margin:0;font-size:var(--fs-600)}
.zz-resource-page .zz-reset-fieldset {border:0;padding:0;margin:0;min-width:0}
.zz-resource-page .zz-resource-dialog form {display:flex;flex-direction:column;min-height:0;overflow:auto}
.zz-resource-page .zz-installed-drawer {width:min(640px,92vw);margin:calc(70px + var(--dsh-frame-top-clearance,0px)) 28px 24px auto;max-height:calc(100dvh - 120px)}
.zz-resource-page .zz-directory-search {display:flex;align-items:center;gap:var(--sp-3);min-width:240px;width:min(360px,32vw);height:var(--ctl-h-lg);box-sizing:border-box;flex:1 1 300px;padding:0 var(--sp-3);border:var(--bw) solid var(--line-strong);border-radius:var(--r-md);background:var(--panel);color:var(--muted2)}
.zz-resource-page .zz-directory-search > span {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.zz-resource-page .zz-search-clear {display:grid;width:32px;height:32px;min-width:32px;border-radius:var(--r-sm);flex:0 0 auto;place-items:center;padding:0;border:0;background:transparent;color:var(--muted2);cursor:pointer}
.zz-resource-page .zz-directory-search input {width:100%;min-width:0;align-self:stretch;padding:0;border:0;background:transparent;color:var(--ink);outline-offset:5px}
.zz-resource-page .zz-directory-search input::-webkit-search-cancel-button {display:none;appearance:none}
.zz-resource-page .zz-search-clear:hover {color:var(--ink);background:var(--sunken)}
.zz-resource-page .zz-installed-drawer .zz-directory-search {width:100%}
.zz-resource-page .zz-directory-toolbar {display:flex;justify-content:space-between;align-items:center;gap:20px;padding:12px 0;color:var(--muted2);font-size:13px}
.zz-resource-page .zz-directory-toolbar nav {display:flex;gap:16px}
.zz-resource-page .zz-directory-toolbar a {color:var(--muted2);text-decoration:none}
.zz-resource-page .zz-directory-section {margin-top:32px;scroll-margin-top:80px}
.zz-resource-page .zz-directory-section > header {display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}
.zz-resource-page .zz-directory-section > header > div {flex:1;min-width:0}
.zz-resource-page .zz-directory-section h2 {display:flex;align-items:center;gap:10px;font-size:18px;margin:0}
.zz-resource-page .zz-directory-section h2::after {content:'';height:1px;background:var(--line);flex:1}
.zz-resource-page .zz-directory-section h2 span {font:12px var(--font-mono);color:var(--muted2)}
.zz-resource-page .zz-directory-section header p {margin:6px 0 0;color:var(--muted2);font-size:12px}
.zz-resource-page .zz-directory-placeholder {padding:24px;border:1px dashed var(--line);border-radius:var(--r-lg);color:var(--muted2);background:var(--sunken)}
.zz-resource-page .zz-directory-placeholder p {margin:6px 0 0}
`
