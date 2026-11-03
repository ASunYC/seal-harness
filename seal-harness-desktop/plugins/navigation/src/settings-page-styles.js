export const settingsPageStyles = `
.seal-settings-page { display:flex; flex-direction:column; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-base,#151618); font:14px/1.5 "Segoe UI","Microsoft YaHei UI",sans-serif; }
.seal-settings-page * { box-sizing:border-box; }
.seal-settings-header { flex:none; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; min-height:88px; padding:24px 32px; border-bottom:1px solid var(--dsw-alias-border-l1,#34363b); }
.seal-settings-header h1 { margin:0; font-family:var(--seal-page-font); font-size:24px; line-height:32px; font-weight:600; }
.seal-settings-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; min-width:0; }
.seal-settings-actions > [data-slot] { display:contents; }
.seal-settings-body { display:grid; grid-template-columns:216px minmax(0,1fr); flex:1; min-height:0; min-width:0; }
.seal-settings-nav { display:flex; flex-direction:column; gap:6px; min-width:0; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:20px 12px; border-right:1px solid var(--dsw-alias-border-l1,#34363b); scrollbar-width:thin; }
.seal-settings-nav button { display:flex; flex:none; align-items:center; gap:12px; min-height:42px; width:100%; padding:10px 12px; border:0; border-radius:9px; background:transparent; color:var(--dsw-alias-label-secondary,#aaa); font:inherit; text-align:left; cursor:pointer; }
.seal-settings-nav button svg { flex:none; }
.seal-settings-nav button span { min-width:0; overflow-wrap:anywhere; }
.seal-settings-nav button:hover,.seal-settings-nav button[aria-current="page"] { color:var(--dsw-alias-label-primary,#fff); background:var(--dsw-alias-interactive-bg-hover,#34363b); }
.seal-settings-nav button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary,#7998d0); outline-offset:-2px; }
.seal-settings-content { min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable both-edges; padding:28px 32px 40px; }
.seal-settings-content > [data-slot] { display:contents; }
.seal-settings-content :is(input,select,textarea) { max-width:100%; }
.seal-settings-content :is(h1,h2,h3,p) { overflow-wrap:anywhere; }
.seal-settings-content .seal-computer-page { background:transparent; width:100%; }
@media(max-width:900px) { .seal-settings-header{padding:20px 24px}.seal-settings-body{grid-template-columns:188px minmax(0,1fr)}.seal-settings-content{padding:24px} }
@media(max-width:640px) { .seal-settings-header{padding:16px 20px;gap:12px}.seal-settings-header h1{font-size:24px;line-height:32px}.seal-settings-actions{justify-content:flex-start}.seal-settings-body{grid-template-columns:148px minmax(0,1fr)}.seal-settings-nav{padding:12px 8px}.seal-settings-nav button{padding:10px 8px;gap:8px}.seal-settings-content{padding:20px 16px} }

/* 仅调整当前设置页根内容，不改二级对话框、表格和候选列表的局部滚动。 */
#root .seal-settings-page .seal-settings-content > [data-slot] > :is(div,main,section) { width:100%; min-width:0; max-width:none; font-family:inherit; }
#root .seal-settings-page .seal-settings-content > [data-slot] > :is(div,main,section) > :is(h1,h2):first-child,
#root .seal-settings-page .seal-settings-content .dshDesktopSettingsHeader > h2,
#root .seal-settings-page .seal-settings-content :is(.seal-computer-header,.seal-token-page>header) h1,
#root .seal-settings-page .seal-settings-content .ask-jev-settings-page>header h1 { margin-top:0; font-family:var(--seal-page-font); font-size:24px; line-height:32px; font-weight:600; }
#root .seal-settings-page .seal-settings-content :is(.sh-imggen-settings,.sh-weknora-settings,.dshDesktopSettings,.ask-jev-settings-page) { width:100%; max-width:none; padding:0; background:transparent; }
#root .seal-settings-page .seal-settings-content .seal-token-page { height:auto; min-height:0; padding:0; overflow:visible; }
#root .seal-settings-page .seal-settings-content .seal-computer-page { padding:0; background:transparent; }
#root .seal-settings-page .seal-settings-content :is(.sh-imggen-settings-row,.sh-imggen-settings-actions,.sh-weknora-settings .actions,.seal-token-actions) { flex-wrap:wrap; }
#root .seal-settings-page .seal-settings-content :is(.sh-imggen-settings-form label,.sh-imggen-settings-form input,.sh-weknora-settings label,.sh-weknora-settings input) { min-width:0; max-width:100%; box-sizing:border-box; }
#root .seal-settings-page .seal-settings-content .sh-weknora-settings input { width:100%; }
#root .seal-settings-page .seal-settings-content[data-settings-active="agent-presets"] ul { grid-template-columns:repeat(auto-fill,minmax(min(268px,100%),1fr)); }
#root .seal-settings-page .seal-settings-content:is([data-settings-width="narrow"],[data-settings-width="tight"]) :is(.sh-imggen-settings-row,.ask-jev-settings-form) { display:flex; flex-direction:column; align-items:stretch; }
#root .seal-settings-page .seal-settings-content:is([data-settings-width="narrow"],[data-settings-width="tight"]) .seal-token-charts { grid-template-columns:1fr; }
#root .seal-settings-page .seal-settings-content:is([data-settings-width="narrow"],[data-settings-width="tight"]) .seal-token-cards { grid-template-columns:repeat(2,minmax(0,1fr)); }
#root .seal-settings-page .seal-settings-content[data-settings-width="tight"] .seal-token-cards { grid-template-columns:1fr; }
#root .seal-settings-page .seal-settings-content[data-settings-width="tight"] .seal-token-bar { grid-template-columns:minmax(50px,1fr) minmax(35px,1fr) auto; }

/* 内置清单的二级tab有独立宽度限制；只适配其公开语义节点，保留市场及隐藏tab。 */
#root .seal-settings-page .seal-settings-content[data-settings-active="plugins"] [data-slot="settings.plugins.tab"] > [aria-busy] { width:100%; max-width:none; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] ul:has(> [data-plugin-module]) { grid-template-columns:minmax(0,1fr); gap:16px; align-items:start; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-module] { min-width:0; align-self:start; border-radius:12px; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-module] > button[aria-expanded] { min-height:132px; padding:16px; gap:6px; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-module] > button[aria-expanded] > span[id] { color:var(--dsw-alias-label-secondary,inherit); }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] > div:first-child { flex-wrap:wrap; row-gap:8px; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] > div:first-child > div { min-width:0; max-width:100%; }
#root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] button[aria-haspopup="menu"] { min-width:0; max-width:100%; }
@container (min-width:640px) { #root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] ul:has(> [data-plugin-module]) { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@container (min-width:980px) { #root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] ul:has(> [data-plugin-module]) { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@container (min-width:1320px) { #root .seal-settings-content[data-settings-active="plugins"] [data-plugin-scope] ul:has(> [data-plugin-module]) { grid-template-columns:repeat(4,minmax(0,1fr)); } }
`
