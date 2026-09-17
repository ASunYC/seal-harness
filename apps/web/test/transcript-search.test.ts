// @vitest-environment jsdom
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
const url = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-search.js")).href;
describe("transcript search destination", () => {
  it("actual app coordinator unfolds the match and focuses it without touching other groups", async () => {
    const { locateTranscriptMatch } = await import(url);
    const source = await readFile(resolve('apps/web/public/app.js'), 'utf8');
    const start = source.indexOf('async function focusSessionSearch(');
    const end = source.indexOf('\nfunction transcriptInteractionActive(', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    document.body.innerHTML = '<main id="transcript"><details id="other"><summary>Other</summary></details><details id="group"><summary>Process</summary><details id="thinking"><summary>Thinking</summary><div class="reasoning-content">target text</div></details></details></main>';
    const scroll = vi.fn(); (document.querySelector('.reasoning-content') as any).scrollIntoView = scroll;
    const status = vi.fn(); const state = { running: false, sessionId: 's', sessionLoadGeneration: 1, messageBefore: null };
    const focus = new Function('document', 'locateTranscriptMatch', 'state', 'setStatus', `
      const $=id=>document.getElementById(id), currentLocale='zh-CN', historyWindow=null;
      const updateTranscriptFollow=()=>{}, updateActiveTurn=()=>{};
      ${source.slice(start, end)}
      return focusSessionSearch;
    `)(document, locateTranscriptMatch, state, status);
    await focus({ searchQuery: 'target', contentHit: true }, 's', 1);
    expect((document.getElementById('group') as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById('thinking') as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById('other') as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement?.className).toBe('reasoning-content');
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(status).toHaveBeenCalledWith('已定位匹配内容');
  });
  it("matches literal text across inline formatting without rewriting it", async () => {
    const { findTranscriptMatch } = await import(url);
    document.body.innerHTML = '<main><div class="content">Hello <strong>[world]</strong><button>hidden</button></div></main>';
    const root = document.querySelector('main')!; const before = root.innerHTML;
    const match = findTranscriptMatch(root, 'HELLO [world]');
    expect(match.range.toString()).toBe('Hello [world]');
    expect(root.innerHTML).toBe(before);
    expect(findTranscriptMatch(root, 'hidden')).toBeNull();
  });
  it("loads older content until a match is available", async () => {
    const { locateTranscriptMatch } = await import(url);
    document.body.innerHTML = '<main></main>'; const root = document.querySelector('main')!;
    let cursor = 2;
    const loadEarlier = vi.fn(async () => { cursor--; if (!cursor) root.innerHTML = '<div class="content">older result</div>'; });
    const match = await locateTranscriptMatch({ root, query: 'older', active: () => true, cursor: () => cursor || null, loadEarlier });
    expect(match.range.toString()).toBe('older'); expect(loadEarlier).toHaveBeenCalledTimes(2);
  });
  it("stops on session replacement and on stalled pagination", async () => {
    const { locateTranscriptMatch } = await import(url);
    document.body.innerHTML = '<main></main>'; const root = document.querySelector('main')!;
    let active = true;
    const loadEarlier = vi.fn(async () => { active = false; root.innerHTML = '<div class="content">match</div>'; });
    expect(await locateTranscriptMatch({ root, query: 'match', active: () => active, cursor: () => 1, loadEarlier })).toBeNull();
    root.replaceChildren(); const stalled = vi.fn(async () => {});
    expect(await locateTranscriptMatch({ root, query: 'none', active: () => true, cursor: () => 1, loadEarlier: stalled })).toBeNull();
    expect(stalled).toHaveBeenCalledTimes(1);
  });
});
