export const styles = `
.seal-acp-page{box-sizing:border-box;min-width:0;height:100%;overflow:auto;padding:32px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#151618);font:14px/1.6 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif}
.seal-acp-page *,.seal-acp-page *::before,.seal-acp-page *::after{box-sizing:border-box}
.seal-acp-page p{color:var(--dsw-alias-label-secondary,#a9abb0)}
.seal-acp-header h1{margin:0;font-size:24px}.seal-acp-header p{margin:8px 0 0}
.seal-acp-divider{height:28px;margin:16px 0 14px;border:1px solid var(--dsw-alias-border-l1,#292a2c);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1b1b1d)}
.seal-acp-surface{min-width:0;padding:30px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#19191b)}
.seal-acp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}
.seal-acp-toolbar p{margin:0 0 12px;font-size:14px;line-height:1.55}.seal-acp-toolbar p:last-child{margin:0;font-size:13px}
.seal-acp-page button,.seal-acp-page input,.seal-acp-page textarea,.seal-acp-page select{font:inherit;color:inherit}
.seal-acp-page button{padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,#45464b);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#232428);cursor:pointer}
.seal-acp-page button:disabled{opacity:.45;cursor:default}.seal-acp-page button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#7c9ff9)}
.seal-acp-page button:focus-visible,.seal-acp-page input:focus-visible,.seal-acp-page textarea:focus-visible,.seal-acp-page select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#7c9ff9);outline-offset:2px}
.seal-acp-primary{flex:none;border-color:transparent!important;color:#fff!important;background:var(--dsw-alias-brand-primary,#517fcc)!important}
.seal-acp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px 12px}
.seal-acp-card{display:flex;min-width:0;min-height:200px;flex-direction:column;padding:24px;border:1px solid var(--dsw-alias-border-l2,#343538);border-radius:16px;background:var(--dsw-alias-bg-base,#151618);transition:border-color .18s,box-shadow .18s,transform .18s}
.seal-acp-card:hover{border-color:var(--dsw-alias-border-l3,#52545a);box-shadow:0 4px 14px #0002;transform:translateY(-2px)}
.seal-acp-card-top{display:flex;min-width:0;align-items:center;gap:12px}.seal-acp-page .seal-acp-card-open{display:flex;min-width:0;flex:1;align-items:center;gap:12px;padding:0;border:0;background:transparent;text-align:left}.seal-acp-page .seal-acp-card-open:hover:not(:disabled){border:0}.seal-acp-icon{display:block;width:40px;height:40px;flex:none;object-fit:contain;border-radius:6px}.seal-acp-card[data-runner="pi"] .seal-acp-icon{filter:invert(1)}
.seal-acp-card h2{flex:1;min-width:0;margin:0;font-size:17px;line-height:1.3;font-weight:600;overflow-wrap:anywhere}
.seal-acp-card input[role="switch"]{appearance:none;width:36px;height:20px;flex:none;margin:0;padding:3px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3,#4b4c50);cursor:pointer;transition:background .15s}
.seal-acp-card input[role="switch"]::after{display:block;width:14px;height:14px;border-radius:50%;background:#fff;content:'';transition:transform .15s}
.seal-acp-card input[role="switch"]:checked{background:var(--dsw-alias-brand-primary,#517fcc)}.seal-acp-card input[role="switch"]:checked::after{transform:translateX(16px)}
.seal-acp-card input[role="switch"]:disabled{opacity:.55;cursor:default}
.seal-acp-page .seal-acp-card-detail{display:block;width:100%;min-height:46px;margin:12px 0 16px;padding:0;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary,#a9abb0);font-size:12px;line-height:1.55;text-align:left}
.seal-acp-page .seal-acp-card-detail:hover:not(:disabled){border:0;color:var(--dsw-alias-label-primary,#eee)}
.seal-acp-card-detail span{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.seal-acp-card-bottom{margin-top:auto}.seal-acp-badge{display:inline-flex;align-items:center;gap:5px;min-height:22px;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#292a2d);color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1}
.seal-acp-badge::before{content:'♧';font-size:14px}.seal-acp-badge[data-ready="true"]{color:#70bd90;background:#70bd901a}
.seal-acp-badge[data-enabled="true"]:not([data-ready="true"]){color:var(--dsw-alias-brand-primary,#7c9ff9);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#7c9ff9) 13%,transparent)}
.seal-acp-history{margin-top:26px}.seal-acp-history h2{margin:0 0 10px;font-size:16px}.seal-acp-history>p{margin:0;font-size:12px}.seal-acp-page>p:last-of-type{margin-top:24px;font-size:12px}
.seal-acp-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.seal-acp-error{padding:10px 14px;border:1px solid #8f4548;border-radius:9px;color:#f3b4b7!important}
.seal-acp-modal{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:20px;background:#0008}
.seal-acp-dialog{width:min(650px,100%);max-height:92vh;overflow:auto;padding:24px;border:1px solid var(--dsw-alias-border-l2,#4a4b51);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#222327)}
.seal-acp-dialog h2{margin:0 0 14px}.seal-acp-dialog label{display:block;margin:12px 0}
.seal-acp-dialog input:not([type="checkbox"]),.seal-acp-dialog textarea,.seal-acp-dialog select{display:block;width:100%;margin-top:5px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#4b4d54);border-radius:8px;background:#1113}
.seal-acp-dialog textarea{min-height:68px;resize:vertical}.seal-acp-dialog small{display:block;color:var(--dsw-alias-label-secondary,#b1b3bb)}.seal-acp-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2,#4a4b51)}.seal-acp-dialog footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
.seal-acp-run{margin-top:14px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#393b42);border-radius:12px}.seal-acp-run pre{max-height:360px;overflow:auto;padding:12px;border-radius:8px;background:#0003;white-space:pre-wrap;overflow-wrap:anywhere}.seal-acp-run time{font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)}
@media(max-width:1050px){.seal-acp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.seal-acp-page{padding:20px}.seal-acp-surface{padding:18px}.seal-acp-toolbar{align-items:stretch;flex-direction:column}.seal-acp-toolbar>.seal-acp-primary{align-self:flex-end}.seal-acp-grid{grid-template-columns:1fr}.seal-acp-card:hover{transform:none}}
`
