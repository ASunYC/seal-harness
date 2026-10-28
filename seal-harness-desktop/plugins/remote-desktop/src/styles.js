export const styles = `
.seal-remote-page { box-sizing:border-box; height:100%; min-height:0; overflow:auto; padding:32px; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-base,#151618); font:14px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif; }
.seal-remote-header,.seal-remote-actions,.seal-remote-toolbar,.seal-remote-host-heading { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.seal-remote-header { justify-content:space-between; align-items:flex-start; margin-bottom:24px; }
.seal-remote-page h1 { margin:0; font-size:24px; line-height:32px; font-weight:600; }
.seal-remote-page p { color:var(--dsw-alias-label-secondary,#aaa); margin:8px 0; overflow-wrap:anywhere; }
.seal-remote-page button,.seal-remote-page select,.seal-remote-page input { box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#41434a); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#22242a); color:inherit; padding:8px 12px; font:inherit; min-height:36px; }
.seal-remote-page button { cursor:pointer; }.seal-remote-page button:disabled { opacity:.5; cursor:default; }
.seal-remote-page button:focus-visible,.seal-remote-page input:focus-visible,.seal-remote-page select:focus-visible,.seal-remote-page summary:focus-visible { outline:2px solid var(--dsw-alias-brand-primary,#82a7ea); outline-offset:2px; }
.seal-remote-page button.seal-remote-primary { background:var(--dsw-alias-label-primary,#f6f6f6); color:var(--dsw-alias-bg-base,#151618); }
.seal-remote-clients { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:24px; }
.seal-remote-clients > div { border:1px solid var(--dsw-alias-border-l2,#41434a); border-radius:10px; padding:14px 16px; min-width:0; }
.seal-remote-clients strong { margin-right:12px; }.seal-remote-clients span { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }.seal-remote-clients span[data-available="true"] { color:#8fcb9b; }.seal-remote-clients p { font-size:12px; margin-bottom:0; }
.seal-remote-toolbar { margin:0 0 18px; }.seal-remote-toolbar input { flex:1; min-width:180px; }.seal-remote-toolbar > span { color:var(--dsw-alias-label-secondary,#aaa); white-space:nowrap; }
.seal-remote-hosts { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr)); gap:16px; }
.seal-remote-host { border:1px solid var(--dsw-alias-border-l2,#41434a); background:var(--dsw-alias-bg-layer-1,#22242a); border-radius:12px; padding:20px; min-width:0; display:flex; flex-direction:column; align-items:stretch; }
.seal-remote-host-heading { justify-content:space-between; flex-wrap:nowrap; }.seal-remote-host-heading h2 { margin:0; font-size:17px; font-weight:600; overflow-wrap:anywhere; min-width:0; }
.seal-remote-protocol { border-radius:5px; padding:2px 7px; background:var(--dsw-alias-bg-base,#151618); font-size:12px; flex:none; }
.seal-remote-host .seal-remote-address { font-family:ui-monospace,Consolas,monospace; color:var(--dsw-alias-label-primary,#eee); }
.seal-remote-host > .seal-remote-actions { margin-top:auto; padding-top:16px; }.seal-remote-client-path { font-size:12px; }
.seal-remote-check { border-top:1px solid var(--dsw-alias-border-l2,#41434a); margin-top:10px; padding-top:10px; font-size:12px; }.seal-remote-check > span { display:inline-block; margin-right:12px; }.seal-remote-check span[data-ok="true"] { color:#8fcb9b; }.seal-remote-check span[data-ok="false"] { color:#e3b774; }.seal-remote-check p { margin:4px 0; }
.seal-remote-error { color:#ef9999!important; white-space:pre-wrap; }.seal-remote-notice { border:1px solid var(--dsw-alias-border-l2,#41434a); padding:12px 16px; border-radius:8px; }
.seal-remote-empty { display:grid; min-height:220px; align-content:center; justify-items:center; gap:8px; padding:24px; text-align:center; border:1px dashed var(--dsw-alias-border-l2,#41434a); border-radius:12px; }.seal-remote-empty strong { font-size:18px; }
.seal-remote-note { font-size:12px; margin-top:20px!important; }
.seal-remote-backdrop { position:fixed; inset:0; z-index:1100; display:flex; align-items:center; justify-content:center; background:var(--dsw-alias-bg-mask-2,#0009); padding:20px; }
.seal-remote-dialog { box-sizing:border-box; width:560px; max-width:100%; max-height:calc(100vh - 40px); overflow:auto; padding:24px; border:1px solid var(--dsw-alias-border-l2,#41434a); border-radius:14px; background:var(--dsw-alias-bg-layer-1,#22242a); box-shadow:0 16px 60px #0005; }
.seal-remote-dialog h2 { margin:0 0 20px; font-size:20px; font-weight:600; }.seal-remote-form { display:grid; gap:14px; }.seal-remote-form label { display:flex; flex-wrap:wrap; gap:5px 8px; align-items:baseline; }.seal-remote-form label > input,.seal-remote-form label > select { width:100%; min-width:0; }.seal-remote-optional { font-size:12px; color:var(--dsw-alias-label-secondary,#aaa); }.seal-remote-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }.seal-remote-form details { border-top:1px solid var(--dsw-alias-border-l2,#41434a); padding-top:10px; }.seal-remote-form summary { cursor:pointer; margin-bottom:10px; }.seal-remote-form details p { font-size:12px; }.seal-remote-form .seal-remote-note { margin:0!important; }.seal-remote-dialog footer { justify-content:flex-end; margin-top:8px; }
@media(max-width:800px) { .seal-remote-page { padding:20px; }.seal-remote-clients { grid-template-columns:1fr; gap:8px; }.seal-remote-clients > div { padding:10px 14px; }.seal-remote-host { padding:16px; } }
@media(max-width:420px) { .seal-remote-form-grid { grid-template-columns:1fr; }.seal-remote-backdrop { padding:12px; }.seal-remote-dialog { padding:18px; max-height:calc(100vh - 24px); } }
`
