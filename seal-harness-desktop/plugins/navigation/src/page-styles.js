// 页面主标题以市场为基准；精确限定页头，不影响首页、决策、正文或弹窗内部标题。
export const pageStyles = `
#root { --seal-page-inset: 32px; --seal-page-font: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif; }
#root :is(.seal-token-page, .seal-kb-page, .seal-remote-page, .seal-acp-page, .seal-nav-page[data-seal-nav-panel="spaces"], .seal-nav-content[data-seal-nav-panel="market"], [data-testid="task-manager-page"]) {
  font-family: var(--seal-page-font); font-size: 14px; line-height: 1.6; --dsh-scrollbar-width: 9px; --dsh-scrollbar-thumb-border: 2px;
}
#root :is(.seal-token-page, .seal-acp-page, .seal-nav-page[data-seal-nav-panel="spaces"], .seal-nav-content[data-seal-nav-panel="market"]) {
  box-sizing: border-box; padding: var(--seal-page-inset); scrollbar-gutter: stable both-edges;
}
#root .seal-remote-content { scrollbar-gutter: stable both-edges; }
#root :is(.seal-token-page > header h1, .seal-kb-header h1, .seal-remote-header h1, .seal-acp-header h1, .seal-nav-page[data-seal-nav-panel="spaces"] > h1, [data-seal-nav-panel="market"] .dshMarketHeaderTitle h2, [data-testid="task-manager-page"] h1, [data-plugin-page-header="list"] h1, .zz-skills > .resource-page-nav h1, .zz-connectors > .resource-page-nav h1, .seal-apps-page > .seal-apps-nav h1, .zz-experts > .resource-page-nav h1, .seal-org-header h1, .seal-office > header > h2) {
  margin: 0; font-family: var(--seal-page-font); font-size: 24px; line-height: 32px; font-weight: 600; font-style: normal; letter-spacing: normal;
}
#root :is(.seal-token-page > header > p, .seal-kb-header > div:first-child > p, .seal-remote-header > div:first-child > p, .seal-acp-header > div:first-child > p, .seal-nav-page[data-seal-nav-panel="spaces"] > p, [data-seal-nav-panel="market"] .dshMarketHeaderTitle > p) {
  margin: 8px 0 0; font-family: var(--seal-page-font); font-size: 14px; line-height: 22px; font-weight: 400; font-style: normal; letter-spacing: normal; color: var(--dsw-alias-label-secondary,#aaa);
}
#root :is(.seal-kb-header, .seal-remote-header, .seal-acp-header) { align-items: flex-start; margin: 0 0 24px; }
#root .seal-token-page { gap: 24px; }
#root .seal-token-page > header { margin: 0; }
/* 市场沿同一个外层滚动，不在内容右侧额外预留一列。 */
#root .seal-nav-content[data-seal-nav-panel="market"] { overflow: auto; }
#root [data-seal-nav-panel="market"] > .dshMarketRoot { flex: none; min-height: 0; gap: 24px; }
#root [data-seal-nav-panel="market"] .dshMarketHeader { margin: 0; }
#root [data-seal-nav-panel="market"] .dshMarketMain { overflow: visible; }
/* 原生任务页已有列表和详情，只固定列表宽度并提供未选中时的右侧引导。 */
#root [data-testid="task-manager-page"] > div:first-child { display: flex; flex: 0 0 260px; width: 260px; border-right: 1px solid var(--dsw-alias-border-l1,#34363b); background: var(--dsw-alias-bg-layer-1,#1c1d20); }
#root [data-testid="task-manager-page"] > div:first-child > div:first-child { scrollbar-gutter: stable; }
#root [data-testid="task-manager-page"] > div:first-child > div:first-child > div:first-child { box-sizing: border-box; max-width: none; width: 100%; margin: 0; padding: 28px 12px 18px; }
#root [data-testid="task-manager-page"] > div:first-child > div:first-child > div:first-child > div:has(> h1) { gap: 8px; margin: 0 8px 18px; padding-top: 0; }
#root [data-testid="task-manager-page"] h1 { align-self: flex-start; }
/* 任务栏的输入与空态操作需要可见的实体边框，焦点线由复合搜索框外层承载。 */
#root [data-testid="task-manager-page"] > div:first-child { --seal-task-control-border:color-mix(in srgb,var(--dsw-alias-label-secondary) 80%,var(--dsw-alias-bg-layer-1)); }
#root [data-testid="task-manager-page"] > div:first-child div:has(> span > input[type="search"]) {
  box-sizing:border-box; height:36px; border:1px solid var(--seal-task-control-border); border-radius:9px; background:var(--dsw-alias-bg-base);
}
#root [data-testid="task-manager-page"] > div:first-child span:has(> input[type="search"]) { border:0; background:transparent; }
#root [data-testid="task-manager-page"] > div:first-child input[type="search"] { height:100%; border:0; outline:none; box-shadow:none; background:transparent; }
#root [data-testid="task-manager-page"] > div:first-child div:has(> span > input[type="search"]):hover { border-color:var(--dsw-alias-label-secondary); }
#root [data-testid="task-manager-page"] > div:first-child div:has(> span > input[type="search"]):focus-within { outline:2px solid var(--dsw-alias-label-secondary); outline-offset:2px; }
#root [data-testid="task-manager-page"] > div:first-child [role="status"] > button {
  border:1px solid var(--seal-task-control-border); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
}
#root [data-testid="task-manager-page"] > div:first-child [role="status"] > button:hover:not(:disabled) { border-color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-interactive-bg-hover); }
#root [data-testid="task-manager-page"] > aside { flex: 1 1 auto; min-width: 0; border-left: 0; }
#root [data-testid="task-manager-page"]:not(:has(> aside))::after { content: '选择左侧任务查看详情'; display: grid; flex: 1; min-width: 0; place-items: center; color: var(--dsw-alias-label-secondary,#aaa); }
@media (max-width: 620px) { #root [data-testid="task-manager-page"] { flex-direction: column; } #root [data-testid="task-manager-page"] > div:first-child { flex: 0 0 35vh; width: 100%; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); } #root [data-testid="task-manager-page"] > aside { flex: 1 1 auto; min-height: 0; } }
@media (max-width: 800px) { #root { --seal-page-inset: 20px; } }

/* 能力四页与市场共用横向内边距及对称滚动槽，不再叠加960px居中列。 */
#root:has(.seal-nav-rail[data-capabilities-active="true"]) :is([data-plugin-panel],.zz-skills.resource-page-shell,.zz-connectors.resource-page-shell,.seal-apps-page.resource-page-shell) {
  box-sizing:border-box; width:100%; max-width:none; padding-inline:var(--seal-page-inset); scrollbar-gutter:stable both-edges; --dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px;
}
#root:has(.seal-nav-rail[data-capabilities-active="true"]) [data-plugin-panel] > *,
#root:has(.seal-nav-rail[data-capabilities-active="true"]) :is(.zz-skills.resource-page-shell,.zz-connectors.resource-page-shell,.seal-apps-page.resource-page-shell) > :is(header,.skills-page-content,.capability-page__content,.seal-apps-content) {
  width:100%; max-width:none; margin-inline:0;
}
/* 首页资源子页沿用能力页的页头尺度，目录与业务内部布局保持独立。 */
#root :is(.seal-org-page,.zz-experts.resource-page-shell) {
  box-sizing:border-box; width:100%; max-width:none; padding:28px var(--seal-page-inset) 48px; margin:0;
  scrollbar-gutter:stable both-edges; overflow:auto; --dsh-scrollbar-width:9px; --dsh-scrollbar-thumb-border:2px;
}
#root .zz-experts.resource-page-shell { display:flex; flex-direction:column; gap:32px; }
#root :is(.seal-org-header,.zz-experts > .resource-page-nav) {
  position:static; z-index:auto; display:flex; flex:none; width:100%; max-width:none; height:auto; min-height:32px;
  align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:16px; margin:0; padding:0;
  border:0; background:transparent; backdrop-filter:none;
}
#root .seal-org-page > .seal-org-header { margin-bottom:32px; }
#root .zz-experts > .experts-page__content { width:100%; max-width:none; margin:0; padding:0; }
#root :is(.seal-org-header .seal-org-actions,.zz-experts > .resource-page-nav .experts-actions) { gap:8px; }
#root :is(.seal-org-header,.zz-experts > .resource-page-nav) button {
  height:32px; min-height:32px; padding:0 12px; border:1px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
  font-family:inherit; font-size:13px; font-weight:500; line-height:20px; white-space:nowrap;
}
#root :is(.seal-org-header,.zz-experts > .resource-page-nav) button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
#root :is(.seal-org-header .seal-org-primary,.zz-experts > .resource-page-nav .btn--primary) {
  border-color:var(--dsw-alias-button-primary-fill); background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground);
}
#root :is(.seal-org-header .seal-org-primary,.zz-experts > .resource-page-nav .btn--primary):hover:not(:disabled) {
  border-color:var(--dsw-alias-button-primary-hover); background:var(--dsw-alias-button-primary-hover);
}
[data-platform=darwin] #root :is(.seal-org-page,.zz-experts.resource-page-shell) { padding-top:calc(28px + var(--dsh-frame-top-clearance,0px)); }
`
