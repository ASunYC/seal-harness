// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
const url = pathToFileURL(resolve(process.cwd(), "apps/web/public/child-transcript.js")).href;
describe("read-only child transcript", () => {
  it("joins custom calls with results while preserving failures, media and metadata", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement('main');
    root.append(renderChildTranscript([
      { role: 'assistant', content: [{ type: 'tool_call', id: 'c', name: 'custom', arguments: { query: 'hello' } }] },
      { role: 'tool', callId: 'c', isError: true, toolError: { message: 'Failed safely' }, toolMeta: { attempt: 2 }, content: [{ type: 'text', text: '<b>partial</b>' }, { type: 'attachment', id: 'out', name: 'output.txt' }, { type: 'custom/data', value: 42 }] },
      { role: 'tool', callId: 'unmatched', content: [{ type: 'text', text: 'orphan remains' }] },
    ], { sessionId: 'child' }));
    expect(root.querySelectorAll('.child-message')).toHaveLength(2);
    expect(root.querySelector('.child-tool').dataset.phase).toBe('error');
    expect(root.textContent).toContain('Failed safely'); expect(root.textContent).toContain('custom/data');
    expect(root.textContent).toContain('attempt'); expect(root.textContent).toContain('orphan remains');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('a').getAttribute('href')).toBe('/api/sessions/child/attachment-content/out');
  });
  it("collapses diagnostic prompts without losing full content and keeps retry failures visible", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement('main');
    root.append(renderChildTranscript([
      { role: 'system-prompt', atSeq: 12, text: '<script>not markup</script>' + 'x'.repeat(50000) },
      { role: 'model-retry', provider: 'provider', retry: 2, maxRetries: 3, retryState: 'cancelled', failure: { message: 'Rate limited' } },
    ]));
    const diagnostic = root.querySelector('.child-diagnostic');
    expect(diagnostic.open).toBe(false);
    expect(diagnostic.dataset.childDisclosure).toBe('12:system');
    expect(diagnostic.querySelector('script')).toBeNull();
    diagnostic.querySelector('button').click();
    expect(diagnostic.querySelector('pre').textContent.length).toBeGreaterThan(50000);
    expect(root.textContent).toContain('已取消重试');
    expect(root.textContent).toContain('2/3'); expect(root.textContent).toContain('Rate limited');
  });
  it("labels partial output and opens live thinking without labelling final messages live", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([{ role: "assistant", live: true, truncated: true, content: [{ type: "reasoning", text: "working" }] }]));
    expect(root.querySelector(".reasoning").open).toBe(true);
    expect(root.textContent).toContain("内容尚未完成");
    expect(root.textContent).toContain("长度上限");
    root.replaceChildren(renderChildTranscript([{ role: "assistant", content: [{ type: "reasoning", text: "done" }] }]));
    expect(root.querySelector(".child-live-status")).toBeNull();
    expect(root.querySelector(".reasoning").open).toBe(false);
  });
  it("scopes attachments to the child and keeps tool result media", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([
      { role: "assistant", content: [{ type: "tool_call", id: "c", name: "read_file", arguments: { path: "a" } }, { type: "attachment", id: "a/b", name: "report.txt" }] },
      { role: "tool", callId: "c", content: [{ type: "image", mimeType: "image/png", data: "AAAA" }] },
    ], { sessionId: "child/one" }));
    expect(root.querySelector("a").getAttribute("href")).toBe("/api/sessions/child%2Fone/attachment-content/a%2Fb");
    expect(root.querySelector(".semantic-tool img").src).toBe("data:image/png;base64,AAAA");
  });
  it("does not embed active image formats", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([{ role: "assistant", content: [{ type: "image", mimeType: "image/svg+xml", data: "AAAA" }] }]));
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("image");
  });
  it("separates thinking and reconciles a tool call with its result", async () => {
    const { renderChildTranscript } = await import(url);
    const doc = (globalThis as any).document;
    const root = doc.createElement("main");
    root.append(renderChildTranscript([
      { role: "assistant", content: [{ type: "reasoning", text: "Inspect first" }, { type: "text", text: "Running tests" }, { type: "tool_call", id: "c", name: "shell", arguments: { command: "pnpm test" } }] },
      { role: "tool", callId: "c", name: "shell", toolMeta: { stdout: "pass", exitCode: 0 }, content: [] },
    ]));
    expect(root.querySelector(".reasoning").textContent).toContain("Inspect first");
    expect(root.querySelectorAll(".child-message")).toHaveLength(1);
    expect(root.querySelector(".semantic-tool").dataset.phase).toBe("completed");
    expect(root.textContent).toContain("pass");
  });
  it("does not invent a running state for a completed call missing its result", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([{ role: "assistant", turnCompleted: true, content: [{ type: "tool_call", id: "c", name: "read_file", arguments: { path: "a" } }] }]));
    expect(root.querySelector(".semantic-tool").dataset.phase).toBe("unknown");
    expect(root.textContent).toContain("结果未加载");
  });
  it("keeps unknown tools and orphan results visible and renders untrusted content as text", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([
      { role: "assistant", content: [{ type: "tool_call", id: "x", name: "custom", arguments: { html: "<img src=x onerror=alert(1)>" } }] },
      { role: "tool", callId: "orphan", name: "external", content: [{ type: "text", text: "<script>bad</script>" }] },
    ]));
    expect(root.textContent).toContain("custom"); expect(root.textContent).toContain("<script>bad</script>");
    expect(root.querySelector("img,script")).toBeNull();
  });
  it("offers the complete text instead of silently truncating long output", async () => {
    const { renderChildTranscript } = await import(url);
    const root = (globalThis as any).document.createElement("main");
    root.append(renderChildTranscript([{ role: "assistant", content: [{ type: "text", text: "x".repeat(50_001) }] }]));
    expect(root.querySelector("pre").textContent.length).toBe(50_000);
    root.querySelector("button").click(); expect(root.querySelector("pre").textContent.length).toBe(50_001);
  });
});
