// 一级内容页共用排版；只匹配这七个页面，不影响首页、决策或弹窗内部标题。
export const pageStyles = `
#root { --seal-page-inset: 32px; --seal-page-font: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif; }
#root :is(.seal-token-page, .seal-kb-page, .seal-remote-page, .seal-acp-page, .seal-nav-page[data-seal-nav-panel="spaces"], .seal-nav-content[data-seal-nav-panel="market"], [data-testid="task-manager-page"]) {
  font-family: var(--seal-page-font); font-size: 14px; line-height: 1.6; --dsh-scrollbar-width: 9px; --dsh-scrollbar-thumb-border: 2px;
}
#root :is(.seal-token-page, .seal-acp-page, .seal-nav-page[data-seal-nav-panel="spaces"], .seal-nav-content[data-seal-nav-panel="market"]) {
  box-sizing: border-box; padding: var(--seal-page-inset); scrollbar-gutter: stable both-edges;
}
#root .seal-remote-content { scrollbar-gutter: stable both-edges; }
#root :is(.seal-token-page > header h1, .seal-kb-header h1, .seal-remote-header h1, .seal-acp-header h1, .seal-nav-page[data-seal-nav-panel="spaces"] > h1, [data-seal-nav-panel="market"] .dshMarketHeaderTitle h2, [data-testid="task-manager-page"] h1) {
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
#root [data-testid="task-manager-page"] h1 { align-self: flex-start; font-size: 19px; line-height: 1.3; }
#root [data-testid="task-manager-page"] > aside { flex: 1 1 auto; min-width: 0; border-left: 0; }
#root [data-testid="task-manager-page"]:not(:has(> aside))::after { content: '选择左侧任务查看详情'; display: grid; flex: 1; min-width: 0; place-items: center; color: var(--dsw-alias-label-secondary,#aaa); }
@media (max-width: 620px) { #root [data-testid="task-manager-page"] { flex-direction: column; } #root [data-testid="task-manager-page"] > div:first-child { flex: 0 0 35vh; width: 100%; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1,#34363b); } #root [data-testid="task-manager-page"] > aside { flex: 1 1 auto; min-height: 0; } }
@media (max-width: 800px) { #root { --seal-page-inset: 20px; } }
`
