export const styles = `
.seal-office { box-sizing:border-box; width:100%; height:100%; min-width:0; overflow:auto; padding:28px var(--seal-page-inset,32px) 40px; scrollbar-gutter:stable both-edges; --dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font:14px/1.6 var(--seal-page-font,"Segoe UI",sans-serif); --office-line:var(--dsw-alias-border-l1); --office-muted:var(--dsw-alias-label-secondary); --office-card:var(--dsw-alias-bg-layer-1); }
.seal-office * { box-sizing:border-box; }
.seal-office :is(button,input,select,textarea) { font:inherit; }
.seal-office button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:34px; padding:6px 12px; border:1px solid var(--dsw-alias-border-l3); border-radius:9px; background:var(--dsw-alias-bg-layer-2); color:inherit; cursor:pointer; font-size:13px; font-weight:500; line-height:20px; }
.seal-office button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.seal-office button:disabled { opacity:.45; cursor:default; }
.seal-office button.office-primary { background:var(--dsw-alias-button-primary-fill); border-color:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }
.seal-office button.office-primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
.seal-office :is(button,input,select,textarea,summary):focus-visible { outline:2px solid var(--office-muted); outline-offset:3px; }
.seal-office > .office-header { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:20px; margin-bottom:28px; }
.office-header h2 { margin:0; font-size:24px; line-height:32px; font-weight:600; }
.office-header p { margin:8px 0 0; color:var(--office-muted); font-size:14px; line-height:22px; }
.office-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.seal-office .office-file-input { display:none; }
.office-layout { display:grid; grid-template-columns:240px minmax(0,1fr); align-items:start; gap:24px; }
.office-layout--empty { display:block; }
.office-list { min-width:0; padding:16px 12px; border:1px solid var(--office-line); border-radius:14px; background:var(--office-card); }
.office-list-heading { display:flex; justify-content:space-between; padding:0 8px 12px; color:var(--office-muted); font-size:12px; }
.office-list ul { display:grid; gap:4px; list-style:none; padding:0; margin:0; max-height:65vh; overflow:auto; }
.seal-office .office-list button { width:100%; justify-content:flex-start; padding:12px 8px; border:0; background:transparent; text-align:left; font-weight:400; }
.seal-office .office-list button[aria-current=true] { background:var(--dsw-alias-interactive-bg-hover); }
.office-list button > span:last-child { min-width:0; }
.office-list strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
.office-list small { display:block; margin-top:3px; color:var(--office-muted); font-size:11px; }
.office-file-symbol { display:inline-grid; flex:none; place-items:center; width:38px; height:44px; border:1px solid var(--office-line); border-radius:8px; background:var(--dsw-alias-bg-base); font-size:15px; font-weight:600; color:var(--office-muted); }
.office-content { min-width:0; }
.office-empty { display:flex; flex-direction:column; align-items:center; padding:64px 24px 52px; text-align:center; border:1px dashed var(--dsw-alias-border-l2); border-radius:16px; }
.office-empty > svg { color:var(--office-muted); margin-bottom:20px; }
.office-empty h3 { margin:0; font-size:20px; line-height:28px; font-weight:600; }
.office-empty p { margin:8px 0 28px; color:var(--office-muted); }
.office-quick-create { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; width:min(600px,100%); }
.seal-office .office-quick-create button { flex-direction:column; padding:20px 12px; gap:12px; background:var(--office-card); border-color:var(--office-line); border-radius:12px; }
.office-quick-create small { color:var(--office-muted); font-size:12px; font-weight:400; }
.office-card { border:1px solid var(--office-line); border-radius:14px; background:var(--office-card); overflow:hidden; }
.office-card-header { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:16px; padding:20px 24px; border-bottom:1px solid var(--office-line); }
.office-card-header h3 { margin:0; font-size:16px; line-height:24px; font-weight:600; overflow-wrap:anywhere; }
.office-card-header p { margin:4px 0 0; font-size:12px; color:var(--office-muted); }
.office-form { padding:24px; }
.office-form-grid { display:grid; grid-template-columns:minmax(0,2fr) minmax(160px,1fr); gap:20px; }
.seal-office label { display:grid; gap:8px; margin:0 0 20px; min-width:0; }
.seal-office label > span { font-size:13px; font-weight:500; }
.seal-office :is(input:not([type=file]),select,textarea) { box-sizing:border-box; width:100%; min-width:0; padding:10px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:inherit; line-height:22px; }
.seal-office textarea { resize:vertical; }
.office-form textarea { min-height:180px; }
.seal-office .notice { margin:0; font-size:12px; line-height:20px; color:var(--office-muted); }
.office-form-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-top:24px; padding-top:20px; border-top:1px solid var(--office-line); }
.office-editor-body { padding:24px; }
.office-editor-body > .notice { margin-bottom:20px; }
.office-editor-body label:last-child { margin-bottom:0; }
.office-help { margin-top:24px; color:var(--office-muted); font-size:12px; line-height:1.8; }
.office-help summary { width:fit-content; cursor:pointer; border-radius:4px; }
.office-help p { margin:10px 0 0; max-width:900px; }
.office-alert { margin:0 0 20px; padding:12px 16px; border:1px solid var(--dsw-alias-state-error-primary); border-radius:10px; color:var(--dsw-alias-state-error-primary); }
.office-processing { margin:16px 0; color:var(--office-muted); }
@media(max-width:1050px) { .office-layout { grid-template-columns:200px minmax(0,1fr); gap:16px; } }
@media(max-width:800px) { .office-layout { grid-template-columns:minmax(0,1fr); } .office-list ul { max-height:210px; } .office-empty { padding:40px 16px; } .office-quick-create { grid-template-columns:minmax(0,1fr); } .seal-office .office-quick-create button { flex-direction:row; justify-content:flex-start; text-align:left; padding:14px; } .office-quick-create small { margin-left:auto; } .office-form-grid { grid-template-columns:minmax(0,1fr); gap:0; } .office-card-header,.office-form,.office-editor-body { padding:18px; } }
`
