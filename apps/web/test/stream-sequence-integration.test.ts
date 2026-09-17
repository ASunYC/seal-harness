// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
const { createStreamSequence } = await import(pathToFileURL(resolve("apps/web/public/stream-sequence.js")).href);
const { projectTranscriptView, updateTranscriptActivity } = await import(pathToFileURL(resolve("apps/web/public/transcript-view.js")).href);
const source = await readFile(resolve("apps/web/public/app.js"), "utf8");
const handler = source.slice(source.indexOf("function handleStream("), source.indexOf("async function cancelRun("));
function harness(mode = "normal") {
  document.body.innerHTML = '<main id="transcript"><nav id="nav"></nav></main>';
  return new Function("document", "createStreamSequence", "projectTranscriptView", "updateTranscriptActivity", "mode", `
    const $=id=>document.getElementById(id), currentLocale='zh-CN';
    const streamSequences=new WeakMap(), liveToolViews=new Map(), state={transcriptFollowing:false}; let historyCanTrim=true;
    const statuses=[]; const t=x=>x, setStatus=(value,error)=>statuses.push({value,error}), disposeCopyActions=()=>{}, localizeCodeCopyButtons=()=>{}, renderMarkdown=x=>x;
    const appendTranscriptNode=node=>document.querySelector('#nav').before(node);
    let projections=0;
    const applyTranscriptView=()=>{projections++;projectTranscriptView(document.querySelector('main'),mode,()=> '过程');};
    const appendBubble=(role='assistant')=>{const node=document.createElement('article');node.className=role;node.innerHTML='<div class="content"></div>';appendTranscriptNode(node);return node;};
    const renderAnchoredMessage=message=>{const node=appendBubble(message.role);node.querySelector('.content').textContent=message.content.map(b=>b.text||'').join('');node.dataset.messageId=message.messageId;return node;};
    const appendReasoningDelta=(node,delta)=>{let box=node.querySelector('details');if(!box){box=document.createElement('details');box.className='reasoning';box.open=true;node.prepend(box);}box.textContent+=delta;};
    const appendToolCall=(call,parent)=>{const node=document.createElement('aside');node.textContent=call.id;parent.append(node);return node;};
    const appendToolResult=()=>{}, appendNotice=()=>{};
    ${handler}
    return {handleStream,appendBubble,statuses,liveToolViews,projectionCount:()=>projections};
  `)(document, createStreamSequence, projectTranscriptView, updateTranscriptActivity, mode);
}
it("shows native PI compaction progress and clears it after completion", () => {
  const make = harness('compact'); const first = make.appendBubble();
  make.handleStream({ type: 'event', event: { type: 'turn_start', turnId: 'native-compaction' } }, first);
  make.handleStream({ type: 'event', event: { type: 'compaction_activity', state: 'started', reason: 'threshold' } }, first);
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('正在压缩上下文');
  make.handleStream({ type: 'event', event: { type: 'compaction_activity', state: 'finished', reason: 'threshold', outcome: 'completed' } }, first);
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('准备模型请求');
  make.handleStream({ type: 'event', event: { type: 'text_delta', delta: 'continued' } }, first);
  expect(document.querySelector('article .content')?.textContent).toBe('continued');
});

it("inserts consumed messages once and separates the following answer", () => {
  const make = harness(); const first = make.appendBubble();
  const send = (event: Record<string, unknown>) => make.handleStream({ type: "event", event }, first);
  send({ type: "text_delta", delta: "before" });
  const user = { type: "user_message", message: { id: "queued-1", role: "user", content: [{ type: "text", text: "next" }] } };
  send(user); send(user);
  send({ type: "text_delta", delta: "after" });
  expect([...document.querySelectorAll('article')].map(n => [n.className, n.textContent])).toEqual([
    ["assistant", "before"], ["user", "next"], ["assistant", "after"],
  ]);
});
it("shows a waiting stage before first output and clears it on stream failure", () => {
  const make = harness('compact'); const first = make.appendBubble();
  make.handleStream({ type: 'event', event: { type: 'turn_start', turnId: 'wait' } }, first);
  make.handleStream({ type: 'event', event: { type: 'request_header' } }, first);
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('等待模型');
  make.handleStream({ type: 'error', error: 'failed' }, first);
  expect(document.querySelector('.turn-activity-preview')).toBeNull();
  expect(document.querySelector('.turn-process')?.getAttribute('data-completed')).toBe('true');
});
it("shows pre-run compaction and clears its marker on failure", () => {
  const make=harness(); const first=make.appendBubble();
  make.handleStream({type:'startup_activity',activity:'compaction',state:'started'},first);
  expect(first.dataset.startupActivity).toBe('compacting');
  expect(make.statuses.at(-1)?.value).toBe('正在压缩上下文');
  make.handleStream({type:'startup_activity',activity:'compaction',state:'finished',outcome:'failed'},first);
  expect(first.dataset.startupActivity).toBe('preparing');
  make.handleStream({type:'error',error:'summary failed'},first);
  expect(first.dataset.startupActivity).toBeUndefined();
});
it("uses runtime preparation and wait boundaries without duplicate placeholders", () => {
  const make = harness('compact'); const first = make.appendBubble();
  const send = (event: Record<string, unknown>) => make.handleStream({ type: 'event', event }, first);
  send({ type: 'turn_start', turnId: 'phases' });
  send({ type: 'runtime_activity', phase: 'preparing' });
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('准备模型请求');
  send({ type: 'request_header' });
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('准备模型请求');
  send({ type: 'runtime_activity', phase: 'waiting-model' });
  send({ type: 'runtime_activity', phase: 'waiting-model' });
  expect(document.querySelectorAll('article')).toHaveLength(1);
  expect(document.querySelector('.turn-activity-preview')?.textContent).toBe('等待模型');
  send({ type: 'text_delta', delta: 'answer' });
  expect(document.querySelectorAll('article')).toHaveLength(1);
  send({ type: 'turn_end', turnId: 'phases' });
  expect(document.querySelector('.turn-activity-preview')).toBeNull();
});
it("keeps identical queued prompts with different identities and retires an unused placeholder", () => {
  const make = harness(); const first = make.appendBubble();
  for (const id of ["one", "two"]) make.handleStream({ type: "event", event: { type: "user_message", message: { id, role: "user", content: [{ type: "text", text: "same" }] } } }, first);
  make.handleStream({ type: "event", event: { type: "text_delta", delta: "reply" } }, first);
  expect([...document.querySelectorAll('article')].map(n => [n.className, n.textContent])).toEqual([
    ["user", "same"], ["user", "same"], ["assistant", "reply"],
  ]);
});
it("appends streamed answers after their tool calls rather than rewriting the initial answer", () => {
  const make = harness();
  const first = make.appendBubble();
  for (const event of [
    { type: "reasoning_delta", delta: "检查" }, { type: "text_delta", delta: "开始检查" },
    { type: "tool_call", call: { id: "read-file" } }, { type: "tool_result" },
    { type: "reasoning_delta", delta: "总结" }, { type: "text_delta", delta: "最终结果" },
  ]) make.handleStream({ type: "event", event }, first);
  expect([...document.querySelector("main")!.children].map(node => node.tagName)).toEqual(["ARTICLE", "ASIDE", "ARTICLE", "NAV"]);
  expect([...document.querySelectorAll(".content")].map(node => node.textContent)).toEqual(["开始检查", "最终结果"]);
  make.handleStream({ type: "completed", stopReason: "stop" }, first);
  expect([...document.querySelectorAll("details")].every(node => !node.open)).toBe(true);
  make.handleStream({ type: "event", event: { type: "turn_start", index: 2 } }, first);
  make.handleStream({ type: "event", event: { type: "text_delta", delta: "后续回合" } }, first);
  expect([...document.querySelectorAll(".content")].map(node => node.textContent)).toEqual(["开始检查", "最终结果", "后续回合"]);
});
it("groups live activity with durable turn IDs and preserves folding between updates", () => {
  const make = harness("compact"); const first = make.appendBubble();
  const send = (event: Record<string, unknown>) => make.handleStream({ type: "event", event }, first);
  send({ type: "turn_start", index: 0, turnId: "saved-turn-1" });
  send({ type: "reasoning_delta", delta: "检查" });
  const process = document.querySelector(".turn-process") as HTMLDetailsElement;
  expect(process.open).toBe(true);
  process.open = false;
  send({ type: "text_delta", delta: "执行前" });
  expect((document.querySelector(".turn-process") as HTMLDetailsElement).open).toBe(false);
  send({ type: "tool_call", call: { id: "tool" } });
  send({ type: "turn_end", index: 0, turnId: "saved-turn-1" });
  send({ type: "turn_start", index: 1, turnId: "saved-turn-2" });
  send({ type: "reasoning_delta", delta: "总结" });
  send({ type: "text_delta", delta: "最终回答" });
  send({ type: "turn_end", index: 1, turnId: "saved-turn-2" });
  expect([...document.querySelectorAll(".turn-process")].map(node => node.getAttribute("data-turn-id"))).toEqual(["saved-turn-1", "saved-turn-2"]);
  expect([...document.querySelectorAll(".turn-process")].every(node => !(node as HTMLDetailsElement).open)).toBe(true);
  expect(document.querySelector('main > .assistant[data-turn-id="saved-turn-2"] .content')?.textContent).toBe("最终回答");
  expect(document.querySelector('aside')?.getAttribute('data-turn-id')).toBe("saved-turn-1");
  projectTranscriptView(document.querySelector("main"), "normal", () => "过程");
  expect([...document.querySelectorAll(".content")].map(node => node.textContent)).toEqual(["执行前", "最终回答"]);
  expect([...document.querySelectorAll(".reasoning")].map(node => node.textContent)).toEqual(["检查", "总结"]);
});
it("does not reparent the process or drop summary focus for ordinary text deltas", () => {
  const make=harness("compact"),first=make.appendBubble();
  const send=(event: Record<string, unknown>)=>make.handleStream({type:'event',event},first);
  send({type:'turn_start',index:0,turnId:'live'});
  send({type:'reasoning_delta',delta:'start'});
  const summary=document.querySelector<HTMLElement>('.turn-process > summary')!;
  summary.tabIndex=0;summary.focus();
  const before=make.projectionCount();
  for(let n=0;n<100;n++) send({type:'reasoning_delta',delta:'.'});
  expect(make.projectionCount()).toBe(before);
  expect(document.activeElement).toBe(summary);
  send({type:'text_delta',delta:'answer'});
  const after=make.projectionCount();summary.focus();
  for(let n=0;n<100;n++) send({type:'text_delta',delta:'.'});
  expect(make.projectionCount()).toBe(after);
  expect(document.activeElement).toBe(summary);
  send({type:'turn_end',index:0,turnId:'live'});
  expect(make.projectionCount()).toBe(after+1);
  expect((document.querySelector('.turn-process') as HTMLDetailsElement).open).toBe(false);
});
it("distinguishes stopped and failed runs without erasing partial output", () => {
  for(const [stopReason,label] of [['aborted','status.stopped'],['error','status.failed']]) {
    const make=harness(),first=make.appendBubble();
    make.handleStream({type:'event',event:{type:'text_delta',delta:'partial'}},first);
    make.handleStream({type:'completed',stopReason},first);
    expect(make.statuses.at(-1)).toEqual({value:label,error:stopReason==='error'});
    expect(first.querySelector('.content')!.textContent).toBe('partial');
  }
});
it("routes progress to its pending native tool without regrouping the transcript", () => {
  const make=harness(),first=make.appendBubble(),updates: unknown[]=[];
  make.liveToolViews.set('call',{native:{progress:(content: unknown)=>updates.push(content)}});
  const content=[{type:'text',text:'working'}];
  make.handleStream({type:'event',event:{type:'tool_progress',callId:'call',content}},first);
  make.handleStream({type:'event',event:{type:'tool_progress',callId:'unknown',content}},first);
  make.liveToolViews.delete('call');
  make.handleStream({type:'event',event:{type:'tool_progress',callId:'call',content}},first);
  expect(updates).toEqual([content]);expect(make.projectionCount()).toBe(0);
});
