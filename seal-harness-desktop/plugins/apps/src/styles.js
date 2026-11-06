export const styles = `
.seal-apps-page{height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base,#141414);color:var(--dsw-alias-label-primary,#f4f4f5)}
.seal-apps-page,.seal-apps-page *,.seal-apps-page *::before,.seal-apps-page *::after{box-sizing:border-box}
.seal-apps-nav{height:54px;display:flex;gap:12px;align-items:center;padding:0 28px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-primary,#eee) 10%,transparent);position:sticky;top:0;background:inherit;z-index:1}
.seal-apps-nav strong{font-size:20px;font-weight:600}.seal-apps-nav button{background:none;border:0;color:inherit;font-size:22px;padding:5px 10px;cursor:pointer}.seal-apps-nav span{font-size:10px;background:var(--dsw-alias-bg-layer-2,#292929);padding:4px 8px;border-radius:7px;color:var(--dsw-alias-label-secondary,#aaa)}
.seal-apps-content{width:100%;max-width:1740px;padding:20px 28px 40px;margin-inline:auto}
.seal-apps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px}.seal-app-card{min-width:0;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary,#eee) 14%,transparent);border-radius:16px;padding:24px;background:var(--dsw-alias-bg-layer-1,#1d1d1f)}
.seal-app-card-header{display:flex;align-items:center;gap:14px}.seal-app-logo{width:48px;height:48px;display:grid;place-items:center;background:#447ae41a;color:#8caeff;border:1px solid #6b91ff33;border-radius:12px}.seal-app-logo svg{width:30px;height:30px}.seal-app-card h2{font-size:20px;margin:0 0 4px}.seal-app-card-header p{font-size:12px;margin:0;color:var(--dsw-alias-label-secondary,#aaa)}.seal-app-platform{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#aaa)}
.seal-app-description{font-size:14px;line-height:1.8;margin:20px 0;color:var(--dsw-alias-label-secondary,#b0b0b4)}.seal-app-meta{display:flex;gap:14px;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}.seal-app-meta a{color:inherit}.seal-app-card footer{display:flex;gap:10px;align-items:center;margin-top:22px}.seal-apps-page button:disabled{opacity:.5;cursor:default}.seal-app-card footer button,.seal-app-dialog button{border:1px solid var(--dsw-alias-border-primary,#ffffff20);background:transparent;color:inherit;border-radius:9px;min-height:36px;padding:8px 15px;cursor:pointer;font-size:13px}.seal-apps-page .seal-app-primary{background:var(--dsw-alias-label-primary,#f4f4f5);color:var(--dsw-alias-bg-base,#151515);font-weight:600}.seal-app-uninstall{margin-left:auto}.seal-app-mcp{font-size:12px;margin:18px 0 0;color:var(--dsw-alias-label-secondary,#aaa)}.seal-apps-error{color:var(--dsw-alias-state-error-primary,#ed8f88);font-size:13px;line-height:1.6}.seal-apps-help{font-size:12px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#888);margin-top:28px;max-width:650px}.seal-app-progress{font-size:12px;margin-top:18px}.seal-app-progress progress{width:100%;height:5px;accent-color:#8caeff}.seal-app-dialog-backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;z-index:1000}.seal-app-dialog{background:var(--dsw-alias-bg-layer-1,#252525);border:1px solid var(--dsw-alias-border-primary,#ffffff20);padding:26px;border-radius:16px;max-width:440px;margin:20px}.seal-app-dialog h2{margin:0;font-size:18px}.seal-app-dialog p{font-size:14px;line-height:1.8}.seal-app-dialog footer{display:flex;justify-content:flex-end;gap:10px}
@media(max-width:700px){.seal-apps-content{padding:14px 16px 28px}.seal-apps-nav{padding:0 16px}.seal-app-card{padding:20px}.seal-apps-grid{grid-template-columns:1fr}}

.zz-resource-page.seal-apps-page.resource-page-shell { display:flex; flex-direction:column; align-items:center; gap:32px; max-width:none; padding:28px clamp(24px,4vw,48px) 48px; }
[data-platform=darwin] .zz-resource-page.seal-apps-page.resource-page-shell { padding-top:calc(28px + var(--dsh-frame-top-clearance,0px)); }
.seal-apps-page .seal-apps-nav { position:static; z-index:auto; width:100%; max-width:960px; height:auto; min-height:32px; padding:0; border:0; background:transparent; }
.seal-apps-heading h1 { margin:0; font-size:20px; font-weight:500; line-height:28px; }
.seal-apps-heading p { margin:4px 0 0; color:var(--dsw-alias-label-secondary,var(--muted2)); font-size:13px; line-height:20px; }
.seal-apps-page .seal-apps-content { display:grid; gap:0; width:100%; max-width:960px; padding:0; margin:0; }
.seal-apps-tabs { display:flex; align-items:center; gap:8px; margin:0 0 16px; }
.seal-apps-tabs button { min-height:32px; padding:4px 12px; border:0; border-radius:8px; color:var(--muted2); background:transparent; font-size:14px; cursor:pointer; }
.seal-apps-tabs button[aria-pressed=true] { color:var(--ink); background:var(--raised); font-weight:650; }
.zz-resource-page.seal-apps-page .resource-installed .resource-installed__summary { min-height:32px; padding:0; }
.zz-resource-page.seal-apps-page .resource-installed .resource-installed__summary h2 { font-size:14px; font-weight:500; line-height:22px; }
.seal-apps-page .seal-apps-grid { grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:14px; margin-top:18px; }
.seal-apps-page .seal-app-card { padding:16px; border-radius:12px; }
.seal-apps-page .seal-app-card footer button,.seal-apps-page .seal-apps-installed-card button { min-height:32px; padding:0 12px; border-radius:8px; font-size:13px; font-weight:500; }
.seal-apps-page .seal-apps-help { margin:24px 0 0; }
.seal-apps-installed-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:14px; }
.seal-apps-installed-card { display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; padding:16px; border:1px solid var(--line); border-radius:12px; background:var(--panel); }
.seal-apps-installed-card strong { font-size:14px; }
.seal-apps-installed-card p { margin:4px 0 0; color:var(--muted2); font-size:12px; }
.seal-apps-installed-card button { flex:none; background:var(--raised); color:var(--ink); cursor:pointer; }
.seal-app-local-path { display:grid; gap:8px; margin-top:18px; color:var(--muted2); font-size:12px; }
.seal-app-local-path input { width:100%; min-width:0; padding:9px 10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--ink); font:inherit; }
.seal-app-local-path input:focus { outline:2px solid #8caeff; outline-offset:1px; }
.seal-apps-empty { min-height:110px; display:grid; place-items:center; align-content:center; gap:4px; color:var(--muted2); text-align:center; }
.seal-apps-empty strong { color:var(--ink); font-size:14px; }
.seal-apps-empty p { margin:0; font-size:12px; }
@media(max-width:700px){.zz-resource-page.seal-apps-page.resource-page-shell { padding-inline:16px; }.seal-apps-page .seal-apps-grid,.seal-apps-installed-list { grid-template-columns:1fr; }}
`
