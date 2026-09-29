import hljs from 'highlight.js/lib/common';
import MarkdownIt, { type Env } from 'markdown-it';

/**
 * 会话正文的受限 Markdown 渲染（SMOOTH-07 切片一：完成态消息）。
 *
 * 安全边界：
 * - `html: false`：模型输出中的原生 HTML 一律按文本转义，杜绝 XSS；
 * - 链接中和：不渲染可点击 <a>（Electron 内点击会整窗导航/外发），
 *   链接文字保留、URL 以行内代码展示，用户可自行复制；
 * - 图片中和：Markdown 图片只显示替代文字与地址，不创建会触发网络请求的 <img>；
 * - 代码高亮只认显式语言且输出经 hljs 转义，未知语言退纯文本。
 */
const renderer = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  highlight: (code, language) => {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return '';
  },
});

renderer.renderer.rules['link_open'] = () => '<span class="md-link">';
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
    ? ` <code class="md-link__href">${renderer.utils.escapeHtml(href)}</code>`
    : '';
  return `${suffix}</span>`;
};

renderer.renderer.rules['image'] = (tokens, index) => {
  const token = tokens[index];
  const alt = renderer.utils.escapeHtml(String(token?.content || '图片'));
  const source = String(token?.attrGet('src') ?? '');
  const suffix = source
    ? ` <code class="md-link__href">${renderer.utils.escapeHtml(source)}</code>`
    : '';
  return `<span class="md-image-placeholder">[图片：${alt}]${suffix}</span>`;
};

const defaultFence = renderer.renderer.rules['fence']?.bind(renderer.renderer.rules);

/** 渲染期透传给规则的 env：在 markdown-it 的 `Env` 上加一个复制按钮开关。 */
interface RenderEnv extends Env {
  /** 是否为围栏代码块渲染「复制」按钮；缺省视为开启。 */
  copyButton?: boolean;
}

renderer.renderer.rules['fence'] = (tokens, index, options, env, self) => {
  const rendered =
    defaultFence?.(tokens, index, options, env, self) ?? self.renderToken(tokens, index, options);
  // 复制按钮的点击**只**在 MessageBubble 容器里做了事件委托。没有那层委托的容器
  // （项目动态/讨论）须经 copyButton:false 关掉它——否则会摆出一个点了没反应的假按钮。
  const copyButton =
    (env as RenderEnv | undefined)?.copyButton === false
      ? ''
      : '<button type="button" class="md-copy" aria-label="复制代码">复制</button>';
  return `<div class="md-fence">${copyButton}${rendered}</div>`;
};

/** `renderMarkdown` 的调用形态。默认保持与会话页一致（出复制按钮）。 */
export interface RenderMarkdownOptions {
  /**
   * 是否输出围栏代码块的「复制」按钮。默认 `true`——会话气泡容器（`MessageBubble.vue`）
   * 已对 `.md-copy` 做点击委托，按钮真的可用。项目动态/讨论容器**没有**这层委托，
   * 须传 `false`：否则会出一个点了没反应的假按钮（违反「没实现的能力不放假开关」）。
   */
  copyButton?: boolean;
}

export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): string {
  const env: RenderEnv = { copyButton: options.copyButton ?? true };
  return renderer.render(text, env);
}

/**
 * 行内受限 Markdown：只处理行内标记（`**加粗**`、`` `代码` ``、链接/图片中和），
 * 不产出块级元素（无 `<p>`/`<table>`/标题）。用于评论这类与作者名、时间同处一行的
 * 紧凑位置——避免把块级 `<div>` 塞进 `<p>` 造成非法嵌套。
 *
 * 安全边界与 {@link renderMarkdown} 同：同一个 `renderer` 实例，`html:false` 一样转义
 * 原生 HTML，链接与图片一样中和。围栏代码块不属于行内范畴，故与复制按钮无关。
 */
export function renderMarkdownInline(text: string): string {
  return renderer.renderInline(text);
}
