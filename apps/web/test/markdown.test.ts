import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const markdownSource = await readFile(resolve("apps/web/public/markdown.js"), "utf8");
const nodeSource = markdownSource
  .replace('"/vendor/katex.mjs"', JSON.stringify(import.meta.resolve("katex")))
  .replace('"/vendor/highlight.mjs"', JSON.stringify(import.meta.resolve("@highlightjs/cdn-assets/es/highlight.min.js")));
const markdownModule = import(`data:text/javascript;base64,${Buffer.from(nodeSource).toString("base64")}`) as Promise<{
  renderMarkdown(source: string): string;
}>;

describe("Web Markdown renderer", () => {
  it("renders common block and inline structures", async () => {
    const { renderMarkdown } = await markdownModule;
    const output = renderMarkdown("# Title\n\n**bold** and `code`\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```");
    expect(output).toContain("<h1>Title</h1>");
    expect(output).toContain("<strong>bold</strong>");
    expect(output).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(output).toContain("<table>");
    expect(output).toContain('<code class="language-ts">');
    expect(output).toContain("hljs-keyword");
    expect(output).toContain('class="copy-code">Copy</button>');
  });

  it("escapes raw HTML and rejects active or protocol-relative links", async () => {
    const { renderMarkdown } = await markdownModule;
    const output = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1)) [also bad](//evil.test) [good](https://example.com)');
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
    expect(output.match(/href="#"/g)).toHaveLength(2);
    expect(output).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });

  it("renders an unfinished streaming fence as escaped code", async () => {
    const { renderMarkdown } = await markdownModule;
    const output = renderMarkdown("```html\n<img onerror=alert(1)>");
    expect(output).toContain("&lt;"); expect(output).not.toContain("<img"); expect(output).toContain("hljs-attr");
  });

  it("renders inline and display mathematics locally", async () => {
    const { renderMarkdown } = await markdownModule;
    const output = renderMarkdown("Euler: $e^{i\\pi}+1=0$\n\n$$\n\\sum_{n=1}^{10} n\n$$");
    expect(output).toContain("katex");
    expect(output).toContain("math-block");
    expect(output).toContain("aria-hidden=\"true\"");
    expect(output).not.toContain("$e^{i");
  });
});
