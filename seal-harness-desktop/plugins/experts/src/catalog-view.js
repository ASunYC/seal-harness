// Stratex features/experts/catalog-view.ts:21-44；分类由目录文案推导，不改 Host category。
const DEVELOPMENT_HINTS = ['开发', '工程', '代码', '编码', '架构', '前端', '后端', '小程序', '测试', '调试', '自动化', 'devops', 'git']

export const expertCategory = value => ({ office: '办公类', development: '开发类' })[value] || value

export function categoryForExpert(entry) {
  const haystack = `${entry.displayName || entry.name || ''} ${entry.description || entry.summary || ''} ${(entry.tags ?? []).join(' ')}`.toLocaleLowerCase()
  return DEVELOPMENT_HINTS.some(hint => haystack.includes(hint.toLocaleLowerCase())) ? '开发类' : '办公类'
}
