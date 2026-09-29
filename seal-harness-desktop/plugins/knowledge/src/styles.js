import { resourceStyles } from '../../capability-shared/src/resource-styles.js'
import { sourceStyles } from './source-styles.js'

export const styles = resourceStyles + sourceStyles + `
.zz-knowledge { --px-1:1px; height:100%; overflow:auto; font-family:var(--font-sans); font-size:var(--fs-body); }
.zz-knowledge *, .zz-knowledge *::before, .zz-knowledge *::after { box-sizing:border-box; }
.zz-knowledge button, .zz-knowledge input, .zz-knowledge select, .zz-knowledge textarea { font:inherit; }
.zz-knowledge button { cursor:pointer; }
.zz-knowledge button:disabled { opacity:.5; cursor:default; }
.zz-knowledge button:focus-visible, .zz-knowledge summary:focus-visible, .zz-knowledge input:focus-visible, .zz-knowledge select:focus-visible, .zz-knowledge textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.zz-knowledge .zz-knowledge-dialog { padding:0; margin:auto; }
.zz-knowledge .zz-knowledge-dialog:not([open]) { display:none; }
.zz-knowledge .zz-knowledge-dialog::backdrop { background:#0007; }
.zz-knowledge .zz-knowledge-dialog.preview-panel { position:fixed; inset:48px 0 0 auto; margin:0; max-height:calc(100vh - 48px); color:var(--ink); }
.zz-knowledge .preview-panel h2 { margin:0; font-size:var(--fs-400); }
.zz-knowledge .knowledge-service summary { list-style:none; }
.zz-knowledge .knowledge-service summary::-webkit-details-marker { display:none; }
.zz-knowledge .knowledge-service__menu { position:absolute; top:calc(100% + 5px); right:0; z-index:40; }
.zz-knowledge :is(.vault-modal__close, .file-queue__remove) { display:inline-grid; place-items:center; }
.zz-knowledge :is(.knowledge-service__configure, .configuration-add) { display:inline-flex; align-items:center; justify-content:center; gap:6px; }
.zz-knowledge .knowledge-service__configure { justify-content:flex-start; }
.zz-knowledge .dialog-actions { display:flex; justify-content:flex-end; gap:var(--sp-2); margin-top:var(--sp-5); padding-top:var(--sp-4); border-top:var(--bw) solid var(--line); }
.zz-knowledge .file-queue li { grid-template-columns:minmax(0,1fr) auto 28px; }
.zz-knowledge .file-queue progress { grid-column:1 / 4; }
.zz-knowledge .knowledge-analysis { margin-top:24px; color:var(--muted2); }
.zz-knowledge .knowledge-analysis summary { cursor:pointer; }
.zz-knowledge .knowledge-notice { color:var(--ok-text); }
.zz-knowledge .zz-knowledge-search { display:flex; align-items:end; gap:12px; }
.zz-knowledge .zz-knowledge-search label { display:grid; flex:1; gap:6px; }
.zz-knowledge .zz-knowledge-search input { width:100%; padding:10px 12px; color:var(--ink); background:var(--panel); border:var(--bw) solid var(--line-strong); border-radius:8px; }
.zz-knowledge .zz-knowledge-citation { margin-top:20px; padding:14px; border-left:3px solid var(--accent); background:var(--sunken); }
.zz-knowledge .zz-knowledge-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.zz-knowledge .zz-knowledge-text, .zz-knowledge .vault-modal__body pre { white-space:pre-wrap; overflow-wrap:anywhere; }
@media(max-width:900px) { .zz-knowledge .library-share-redeem { grid-template-columns:1fr; } .zz-knowledge .zz-knowledge-dialog.preview-panel { width:calc(100vw - 24px); } }
@media(prefers-reduced-motion:reduce) { .zz-knowledge * { transition:none !important; } }
`
