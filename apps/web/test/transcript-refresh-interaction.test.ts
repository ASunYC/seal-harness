// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
const source = await readFile("apps/web/public/app.js", "utf8");
const helpers = source.slice(source.indexOf("function transcriptInteractionActive("), source.indexOf("function updateTranscriptFollow("));
function harness(api = vi.fn(async () => ({ json: async () => ({ messages: [] }) }))) {
  document.body.innerHTML='<main id="transcript"><p>select this text</p><button>Review</button></main><button id="outside">Other</button><button id="trajectory-tab" aria-selected="false"></button>';
  window.getSelection()?.removeAllRanges();
  const render = vi.fn();
  const app = new Function("document", "window", "api", "renderSessionPage", `
    const $=id=>document.getElementById(id);
    const state={sessionId:'s',running:false,transcriptFollowing:true,loadedMessageCount:2,sessionInvalidated:false,sessionRefreshTimer:null};
    const refreshedHistorySize=n=>n,loadSessionFeedback=async()=>[],loadSessionState=async()=>{},scrollTranscriptToBottom=()=>{};
    function flushInvalidatedSession(){if(state.sessionInvalidated && state.sessionId){state.sessionInvalidated=false;void refreshOpenSession(state.sessionId);}}
    ${helpers}
    return {state,refreshOpenSession,transcriptInteractionActive};
  `)(document, window, api, render);
  return { ...app, render, api };
}
afterEach(()=>{vi.useRealTimers();window.getSelection()?.removeAllRanges();});
it("defers a refresh while a control is focused and resumes after focus leaves", async () => {
  vi.useFakeTimers(); const app=harness();
  document.querySelector<HTMLButtonElement>('main button')!.focus();
  await app.refreshOpenSession('s');
  await vi.advanceTimersByTimeAsync(750);
  expect(app.api).not.toHaveBeenCalled(); expect(app.render).not.toHaveBeenCalled();
  document.getElementById('outside')!.focus();
  await vi.advanceTimersByTimeAsync(250);
  expect(app.api).toHaveBeenCalledTimes(1);expect(app.render).toHaveBeenCalledTimes(1);
  expect(app.state.sessionInvalidated).toBe(false);
});
it("protects confirmation even without focus and selections crossing the transcript", () => {
  const app=harness(); const box=document.createElement('div');box.className='review-confirmation';document.querySelector('main')!.append(box);
  expect(app.transcriptInteractionActive()).toBe(true);box.remove();
  const range=document.createRange();range.selectNodeContents(document.querySelector('main p')!);window.getSelection()!.addRange(range);
  expect(app.transcriptInteractionActive()).toBe(true);
  window.getSelection()!.removeAllRanges();expect(app.transcriptInteractionActive()).toBe(false);
});
it("does not apply a late response after interaction begins, or refresh a different session", async () => {
  vi.useFakeTimers(); let resolve!: (value: any)=>void;
  const app=harness(vi.fn(()=>new Promise<any>(done=>{resolve=done;})));
  const pending=app.refreshOpenSession('s');
  document.querySelector<HTMLButtonElement>('main button')!.focus();
  resolve({json:async()=>({messages:[]})});await pending;
  expect(app.render).not.toHaveBeenCalled();
  app.state.sessionId='other';document.getElementById('outside')!.focus();
  await vi.advanceTimersByTimeAsync(500);
  expect(app.api).toHaveBeenCalledTimes(1);expect(app.render).not.toHaveBeenCalled();
});
