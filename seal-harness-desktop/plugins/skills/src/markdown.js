// 来源：Stratex skill/skill-markdown.ts，070ba39e82。
import MarkdownIt from 'markdown-it';

/**
 * Skill 说明文件的受限 Markdown 渲染器。
 *
 * Skill 包内容不可信，因此不允许原生 HTML、可点击链接或外部图片加载；
 * 同时保留常用 Markdown 结构，便于在工作台中校对真实说明文档。
 */
const renderer = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
});

renderer.renderer.rules['link_open'] = () => '<span class="skill-md-link">';
renderer.renderer.rules['link_close'] = (tokens, index) => {
  let href = '';
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor];
    if (token?.type === 'link_open') {
      href = String(token.attrGet('href') ?? '');
      break;
    }
  }
  const suffix = href
    ? ` <code class="skill-md-link__href">${renderer.utils.escapeHtml(href)}</code>`
    : '';
  return `${suffix}</span>`;
};

renderer.renderer.rules['image'] = (tokens, index) => {
  const token = tokens[index];
  const alt = renderer.utils.escapeHtml(token?.content || '未命名图片');
  const source = String(token?.attrGet('src') ?? '');
  const sourceLabel = source ? ` <code>${renderer.utils.escapeHtml(source)}</code>` : '';
  return `<span class="skill-md-image">图片：${alt}${sourceLabel}</span>`;
};

renderer.renderer.rules['table_open'] = () => '<div class="skill-md-table-wrap"><table>\n';
renderer.renderer.rules['table_close'] = () => '</table></div>\n';

export function renderSkillMarkdown(text) {
  return renderer.render(text);
}
