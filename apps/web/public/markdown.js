import katex from "/vendor/katex.mjs";
import hljs from "/vendor/highlight.mjs";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function safeHref(value) {
  const decoded = value.replace(/&amp;/g, "&").trim();
  return /^(?:https?:|mailto:|\/(?!\/)|#)/i.test(decoded) ? value : "#";
}

function inline(value) {
  const protectedValues = [];
  const protect = (html) => `\u0000${protectedValues.push(html) - 1}\u0000`;
  let source = String(value).replace(/`([^`\n]+)`/g, (_, content) => protect(`<code>${escapeHtml(content)}</code>`));
  source = source.replace(/\\\((.+?)\\\)|\$([^$\n]+?)\$/g, (_, parenthesized, dollar) => protect(renderMath(parenthesized ?? dollar, false)));
  let output = escapeHtml(source);
  output = output
    .replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, href) => {
      const source = safeHref(href);
      return source === "#" ? `![${alt}](${href})` : `<img src="${source}" alt="${alt}" loading="lazy">`;
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
      const target = safeHref(href);
      return `<a href="${target}"${/^https?:/i.test(target) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return output.replace(/\u0000(\d+)\u0000/g, (_, index) => protectedValues[Number(index)] || "");
}

function renderMath(source, displayMode) {
  try { return katex.renderToString(source, { displayMode, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" }); }
  catch { return `<code class="math-error">${escapeHtml(source)}</code>`; }
}

function renderCode(source, language) {
  if (!language || !hljs.getLanguage(language)) return escapeHtml(source);
  try { return hljs.highlight(source, { language, ignoreIllegals: true }).value; }
  catch { return escapeHtml(source); }
}

export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) output.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*```([^\s`]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(); flushList();
      const body = [];
      while (++index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index]);
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      output.push(`<div class="code-block"><button type="button" class="copy-code">Copy</button><pre><code${language}>${renderCode(body.join("\n"), fence[1])}</code></pre></div>`);
      continue;
    }
    const mathStart = /^\s*\$\$(.*)$/.exec(line);
    if (mathStart) {
      flushParagraph(); flushList();
      const parts = []; let current = mathStart[1]; let closed = false;
      if (current.endsWith("$$")) { parts.push(current.slice(0, -2)); closed = true; }
      else {
        if (current) parts.push(current);
        while (++index < lines.length) { current = lines[index]; if (current.trimEnd().endsWith("$$")) { parts.push(current.trimEnd().slice(0, -2)); closed = true; break; } parts.push(current); }
      }
      output.push(`<div class="math-block">${renderMath(parts.join("\n"), true)}</div>`);
      if (!closed) break;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || "")) {
      flushParagraph(); flushList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const headers = cells(line); index += 1;
      const rows = [];
      while (index + 1 < lines.length && lines[index + 1].includes("|") && lines[index + 1].trim()) rows.push(cells(lines[++index]));
      output.push(`<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inline(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); flushList(); output.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    const item = /^\s*([-+*]|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const tag = /\d+\./.test(item[1]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      list ||= { tag, items: [] }; list.items.push(item[2]); continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); flushList(); output.push("<hr>"); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    paragraph.push(line);
  }
  flushParagraph(); flushList();
  return output.join("\n");
}
