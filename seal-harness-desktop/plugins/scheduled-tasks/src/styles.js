export const styles = `
.seal-schedules { display:grid; grid-template-columns:280px minmax(0,1fr); min-width:0; width:100%; box-sizing:border-box; height:100%; overflow:hidden; font-family:var(--seal-page-font,"Segoe UI",sans-serif); color:var(--dsw-alias-label-primary,#20232a); background:var(--dsw-alias-bg-base,#fff); font-size:14px; }
.seal-schedules * { box-sizing:border-box; }
.seal-schedules__header { display:flex; align-items:center; justify-content:space-between; gap:20px; }
.seal-schedules__header p { color:var(--dsw-alias-label-tertiary,#858a92); font-size:11px; letter-spacing:.14em; }
.seal-schedules h1 { font-size:24px; line-height:32px; font-weight:600; margin:0; }
.seal-schedules h2 { font-size:18px; margin:0; }
.seal-schedules button,.seal-schedules input,.seal-schedules select,.seal-schedules textarea { font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l1,#dce0e6); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#fff); }
.seal-schedules button { padding:8px 12px; cursor:pointer; }
.seal-schedules button:hover { background:var(--dsw-alias-interactive-bg-hover,#f0f3f7); }
.seal-schedules button:disabled { cursor:default; opacity:.5; }
.seal-schedules button.seal-schedules__primary { color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); border-color:var(--dsw-alias-button-primary-fill); }
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

.seal-schedules__sidebar { display:flex; min-height:0; min-width:0; flex-direction:column; overflow:auto; padding:28px 16px 20px; border-right:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.seal-schedules__header { flex-wrap:wrap; gap:12px; }
.seal-schedules__header button { font-size:13px; padding:6px 10px; }
.seal-schedules__filters { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 16px; }
.seal-schedules__filters button { border:0; background:transparent; font-size:13px; padding:5px 10px; }
.seal-schedules__filters button[aria-pressed=true] { background:var(--dsw-alias-interactive-bg-hover); }
.seal-schedules__search { margin-bottom:16px; }
.seal-schedules__search > span { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.seal-schedules__search input,.seal-schedules__catalog-empty button { border-color:color-mix(in srgb,var(--dsw-alias-label-secondary) 80%,var(--dsw-alias-bg-layer-1)); }
.seal-schedules__search input { background:var(--dsw-alias-bg-base); }
.seal-schedules :is(button,input,textarea,select):focus-visible { outline:2px solid var(--dsw-alias-label-secondary); outline-offset:2px; }
.seal-schedules__catalog { flex:1; min-height:0; }
.seal-schedules button.seal-schedules__row { display:flex; flex-direction:column; align-items:flex-start; gap:6px; width:100%; margin-bottom:8px; padding:12px; border:0; text-align:left; background:transparent; }
.seal-schedules button.seal-schedules__row:hover,.seal-schedules button.seal-schedules__row[aria-current=page] { background:var(--dsw-alias-interactive-bg-hover); }
.seal-schedules__row strong { font-size:14px; font-weight:600; overflow-wrap:anywhere; }
.seal-schedules__row span,.seal-schedules__row small { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.6; }
.seal-schedules__catalog-empty { padding:40px 8px; text-align:center; color:var(--dsw-alias-label-secondary); font-size:13px; }
.seal-schedules button.seal-schedules__reminders { align-self:flex-start; margin-top:20px; border:0; padding:4px; font-size:12px; background:transparent; color:var(--dsw-alias-label-secondary); }
.seal-schedules__content { min-width:0; min-height:0; overflow:auto; padding:28px var(--seal-page-inset,32px); }
.seal-schedules__empty { padding:64px 24px; border:0; }
.seal-schedules__empty p { color:var(--dsw-alias-label-secondary); line-height:1.7; }
.seal-schedules__hint { margin-top:24px; }
.seal-schedules__editor { max-width:1000px; }
.seal-schedules__editor > p { margin-bottom:0; font-size:13px; }
.seal-schedules__editor label { min-width:0; }
.seal-schedules__editor form { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
.seal-schedules__editor input,.seal-schedules__editor select,.seal-schedules__editor textarea { background:var(--dsw-alias-bg-base); border-color:var(--dsw-alias-border-l2); }
@media(max-width:900px) { .seal-schedules { grid-template-columns:260px minmax(0,1fr); } .seal-schedules__editor form { grid-template-columns:minmax(0,1fr); } }
@media(max-width:760px) { .seal-schedules { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(240px,38vh) minmax(0,1fr); } .seal-schedules__sidebar { padding:20px; border-right:0; border-bottom:1px solid var(--dsw-alias-border-l1); } .seal-schedules__content { padding:20px; } .seal-schedules__catalog-empty { padding:12px; } .seal-schedules__catalog { overflow:auto; flex:1 0 80px; } .seal-schedules__editor { padding:18px; } }
`
