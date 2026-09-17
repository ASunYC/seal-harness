// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
const { createHistoryWindow } = await import(pathToFileURL(resolve("apps/web/public/history-window.js")).href);
const source = await readFile(resolve("apps/web/public/app.js"), "utf8");
// Exercise the actual app coordinators with a minimal message renderer and
// controlled network. Full Electron scroll/Markdown rendering is a separate gate.
const names = ["renderSessionPage", "renderHistoryMessages", "appendTranscriptNode", "loadEarlierMessages", "scrollTranscriptToBottom"];
const functions = names.map(name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`Missing coordinator ${name}`);
  const next = source.slice(start + 1).search(/^\s*(?:async )?function \w+\(/m);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}).join("\n");
function harness() {
  document.body.innerHTML = '<div id="transcript"></div><button id="load-earlier"></button><div id="turn-navigator-slot"></div><div id="back-to-bottom-slot"></div><button id="back-to-bottom"></button>';
  const api = vi.fn<(...args: any[]) => Promise<any>>(async () => { throw new Error("Cached history must not fetch"); });
  const dispose = vi.fn();
  const factory = new Function("document", "createHistoryWindow", "api", "disposeCopyActions", `
    const $ = id => document.getElementById(id);
    const state = {sessionId:'s', running:false};
    let historyWindow=null, historySnapshot=null, historyCanTrim=false, renderingHistory=false;
    const transcriptPositions=new Map(), liveToolHosts=new Set(), liveToolViews=new Map(), settledToolResults=new Map();
    const HISTORY_PAGE_MESSAGES=50;
    const renderStatsLine=()=>{}, renderTurnNavigator=()=>{}, applyTranscriptView=()=>{}, updateMessageActionVisibility=()=>{}, updateActiveTurn=()=>{};
    const normalizeTurnOutline=value=>value, localizeCodeCopyButtons=()=>{};
    const setStatus=message=>{throw new Error(message)};
    const renderAnchoredMessage=message=>{const node=document.createElement('article'); node.textContent=String(message.id); appendTranscriptNode(node); return node;};
    ${functions}
    return {renderSessionPage, loadEarlierMessages, scrollTranscriptToBottom, appendTranscriptNode};
  `);
  return { ...factory(document, createHistoryWindow, api, dispose), api, dispose };
}
const messages = Array.from({ length: 200 }, (_, id) => ({ id, turnId: `t${Math.floor(id / 3)}` }));
const page = { messages, window: { hasMore: false, nextBefore: null }, turnOutline: [] };
it("inserts all new history siblings before the anchor without moving settled tool rows", () => {
  document.body.innerHTML='<main id="transcript"><article id="anchor">latest</article></main>';
  const render = new Function("document", `
    const $=id=>document.getElementById(id); let renderingHistory=false;
    const renderAnchoredMessage=message=>{
      if(message.result) return document.getElementById('tool');
      const row=document.createElement('article');row.textContent=message.text;$('transcript').append(row);
      if(message.tool){const tool=document.createElement('aside');tool.id='tool';tool.textContent='tool';$('transcript').append(tool);}
      return row;
    };
    ${functions}
    return renderHistoryMessages;
  `)(document);
  render([{text:'first',tool:true},{text:'second'},{result:true}],document.getElementById('anchor'));
  expect([...document.querySelector('main')!.children].map(node=>node.textContent)).toEqual(['first','tool','second','latest']);
});
it("mounts a bounded history, reveals cached rows with no fetch, and releases old nodes on latest", async () => {
  const app = harness(); app.renderSessionPage(page);
  expect(document.querySelectorAll("article")).toHaveLength(62);
  expect((document.getElementById("load-earlier") as HTMLButtonElement).hidden).toBe(false);
  await app.loadEarlierMessages();
  expect(document.querySelectorAll("article").length).toBeGreaterThan(62);
  expect(app.api).not.toHaveBeenCalled();
  app.scrollTranscriptToBottom();
  expect(document.querySelectorAll("article")).toHaveLength(62);
  expect(app.dispose).toHaveBeenCalledTimes(2);
  app.scrollTranscriptToBottom();
  expect(app.dispose).toHaveBeenCalledTimes(2);
});
it("never rebuilds over content appended after the saved snapshot", () => {
  const app = harness(); app.renderSessionPage(page, true);
  const live = document.createElement("p"); live.textContent = "new command result";
  app.appendTranscriptNode(live); app.scrollTranscriptToBottom();
  expect(live.isConnected).toBe(true);
  expect(document.querySelectorAll("article")).toHaveLength(200);
  expect(app.dispose).toHaveBeenCalledTimes(1);
});
it("fetches only after cached history is exhausted and keeps fetched rows available after trimming", async () => {
  const app = harness();
  app.renderSessionPage({ ...page, window: { hasMore: true, nextBefore: 50 } });
  await app.loadEarlierMessages(200);
  expect(app.api).not.toHaveBeenCalled();
  app.api.mockResolvedValueOnce({ json: async () => ({ messages: [{ id: -1, turnId: "old" }], window: { hasMore: false, nextBefore: null }, turnOutline: [] }) });
  await app.loadEarlierMessages();
  expect(app.api).toHaveBeenCalledWith("/api/sessions/s/messages?before=50&limit=50");
  expect(document.querySelector("article")?.textContent).toBe("-1");
  app.scrollTranscriptToBottom();
  await app.loadEarlierMessages(250);
  expect(document.querySelectorAll("article")).toHaveLength(201);
  expect(document.querySelector("article")?.textContent).toBe("-1");
  expect(app.api).toHaveBeenCalledTimes(1);
});
