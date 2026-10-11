export const styles = `
.seal-schedules { box-sizing:border-box; height:100%; overflow:auto; padding:32px; color:var(--dsw-alias-label-primary,#20232a); background:var(--dsw-alias-bg-base,#fff); font-size:14px; }
.seal-schedules * { box-sizing:border-box; }
.seal-schedules__header { display:flex; align-items:center; justify-content:space-between; gap:20px; }
.seal-schedules__header p { color:var(--dsw-alias-label-tertiary,#858a92); font-size:11px; letter-spacing:.14em; }
.seal-schedules h1 { font-size:28px; margin:8px 0 12px; }
.seal-schedules h2 { font-size:18px; margin:0; }
.seal-schedules button,.seal-schedules input,.seal-schedules select,.seal-schedules textarea { font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l1,#dce0e6); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#fff); }
.seal-schedules button { padding:8px 12px; cursor:pointer; }
.seal-schedules button:hover { background:var(--dsw-alias-interactive-bg-hover,#f0f3f7); }
.seal-schedules button:disabled { cursor:default; opacity:.5; }
.seal-schedules button.seal-schedules__primary { color:#fff; background:var(--dsw-alias-brand-primary,#4176e6); border-color:transparent; }
.seal-schedules__hint,.seal-schedules__muted,.seal-schedules__header span { color:var(--dsw-alias-label-secondary,#67717e); line-height:1.7; }
.seal-schedules__hint { padding:14px 0; font-size:13px; }
.seal-schedules__list { display:grid; gap:16px; }
.seal-schedules__task,.seal-schedules__editor { padding:22px; border:1px solid var(--dsw-alias-border-l1,#dce0e6); border-radius:14px; background:var(--dsw-alias-bg-layer-1,#fff); }
.seal-schedules__editor { margin-bottom:22px; }
.seal-schedules__task-title { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.seal-schedules__badge { font-size:12px; padding:4px 9px; border-radius:20px; background:var(--dsw-alias-interactive-bg-hover,#f0f3f7); }
.seal-schedules__prompt { white-space:pre-wrap; overflow-wrap:anywhere; max-height:110px; overflow:auto; line-height:1.7; }
.seal-schedules__actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
.seal-schedules__editor form { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:18px; }
.seal-schedules label { display:flex; flex-direction:column; gap:8px; }
.seal-schedules input,.seal-schedules select,.seal-schedules textarea { width:100%; padding:9px 10px; }
.seal-schedules .seal-schedules__check { display:inline-flex; flex-direction:row; align-items:center; margin-right:12px; }
.seal-schedules__check input { width:auto; }
.seal-schedules__wide { grid-column:1/-1; }
.seal-schedules fieldset { border:1px solid var(--dsw-alias-border-l1,#dce0e6); padding:12px; border-radius:8px; }
.seal-schedules__empty { border:1px dashed var(--dsw-alias-border-l1,#dce0e6); border-radius:14px; padding:48px 24px; text-align:center; }
.seal-schedules__history { border-top:1px solid var(--dsw-alias-border-l1,#dce0e6); margin-top:18px; }
.seal-schedules__run { display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--dsw-alias-border-l1,#dce0e6); padding:12px 0; }
.seal-schedules__run span { display:block; margin-top:5px; font-size:12px; color:var(--dsw-alias-label-secondary,#67717e); }
.seal-schedules__error { margin:12px 0; padding:12px; border:1px solid #cf6673; border-radius:8px; display:flex; justify-content:space-between; gap:12px; }
@media(max-width:760px) { .seal-schedules { padding:20px 16px; } .seal-schedules__header { align-items:flex-start; } .seal-schedules__editor form { grid-template-columns:1fr; } }
`
