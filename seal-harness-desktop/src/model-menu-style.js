/** 上游模型分组标题是半透明 sticky 层；叠一层实底，避免滚动行文字透出。 */
export const modelMenuStyle = `
[role="menu"] > .scrollable > section[role="group"] > div[id]:first-child {
  background: linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu)), var(--dsw-alias-bg-layer-1);
}
`
