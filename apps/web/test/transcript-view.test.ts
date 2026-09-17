// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/transcript-view.js")).href;

describe("transcript view projection", () => {
  it("shows waiting after a settled tool and replaces it with subsequent model activity", async () => {
    const { projectTranscriptView, updateTranscriptActivity } = await import(moduleUrl);
    document.body.innerHTML = '<main><article class="assistant" data-turn-id="t" data-activity-phase="writing"></article><details class="semantic-tool" data-turn-id="t" data-phase="completed" data-activity-phase="waiting"></details></main>';
    const root = document.querySelector('main')!;
    projectTranscriptView(root, 'compact', () => 'Activity', 'en');
    expect(root.querySelector('.turn-activity-preview')?.textContent).toBe('Waiting for model');
    const group = root.querySelector('.turn-process')!;
    const next = document.createElement('article'); next.className = 'assistant'; next.dataset.activityPhase = 'thinking'; group.append(next);
    updateTranscriptActivity(root, 'en');
    expect(root.querySelector('.turn-activity-preview')?.textContent).toBe('Thinking');
    root.querySelector('.semantic-tool')!.setAttribute('data-phase', 'running');
    updateTranscriptActivity(root, 'en');
    expect(root.querySelector('.turn-activity-preview')?.textContent).toBe('Executing');
  });
  it("updates a collapsed live header without moving content or overriding the disclosure", async () => {
    const { projectTranscriptView, updateTranscriptActivity } = await import(moduleUrl);
    document.body.innerHTML = '<main><article class="assistant" data-turn-id="t" data-activity-phase="thinking"><details class="reasoning"><div class="reasoning-content"></div></details></article></main>';
    const root = document.querySelector('main')!;
    const thinking = root.querySelector('.reasoning-content') as HTMLElement;
    thinking.dataset.source = 'Earlier line\nInspecting the file';
    projectTranscriptView(root, 'compact', () => 'Activity', 'en');
    const group = root.querySelector('.turn-process') as HTMLDetailsElement;
    group.open = false;
    const article = root.querySelector('article')!;
    expect(group.querySelector('.turn-activity-preview')?.textContent).toBe('Thinking · Inspecting the file');
    thinking.dataset.source += '\n<img src=x onerror=bad()>';
    updateTranscriptActivity(root, 'en');
    expect(group.open).toBe(false); expect(article.parentElement).toBe(group);
    expect(group.querySelector('img')).toBeNull();
    expect(group.querySelector('.turn-activity-preview')?.textContent).toContain('<img');
    article.dataset.activityPhase = 'writing'; updateTranscriptActivity(root, 'en');
    expect(group.querySelector('.turn-activity-preview')?.textContent).toBe('Responding');
    article.dataset.turnCompleted = 'true'; projectTranscriptView(root, 'compact', () => 'Activity');
    expect(group.querySelector('.turn-activity-preview')).toBeNull();
  });
  it("prioritizes running tools and bounds their summary", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    document.body.innerHTML = '<main><details class="semantic-tool" data-phase="running" data-turn-id="t"><summary><strong>执行命令</strong><span class="semantic-tool-subject"></span></summary></details></main>';
    const root = document.querySelector('main')!;
    root.querySelector('.semantic-tool-subject')!.textContent = 'x'.repeat(500);
    projectTranscriptView(root, 'compact', () => '过程');
    const label = root.querySelector('.turn-activity-preview')!.textContent!;
    expect(label).toContain('正在执行 · 执行命令'); expect(label.length).toBeLessThan(180);
    expect(root.querySelector('.turn-process')?.getAttribute('data-activity')).toBe('tool');
  });
  it("preserves an active control and transfers focus to the summary when its turn folds", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    document.body.innerHTML='<main><article class="assistant" data-turn-id="focus" data-turn-completed="false"><button>Review</button></article></main><input id="outside">';
    const transcript=document.querySelector('main')!;
    projectTranscriptView(transcript,'compact',()=> 'Activity');
    const button=transcript.querySelector('button')!;button.focus();
    projectTranscriptView(transcript,'compact',()=> 'Activity');
    expect(document.activeElement).toBe(button);
    transcript.querySelector('article')!.dataset.turnCompleted='true';
    projectTranscriptView(transcript,'compact',()=> 'Activity');
    expect(document.activeElement).toBe(transcript.querySelector('.turn-process > summary'));
    document.getElementById('outside')!.focus();
    projectTranscriptView(transcript,'compact',()=> 'Activity');
    expect(document.activeElement).toBe(document.getElementById('outside'));
  });
  it("retains a focused input when returning from compact to normal view", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    document.body.innerHTML='<main><article class="assistant" data-turn-id="input"><input value="draft"></article></main>';
    const transcript=document.querySelector('main')!;
    projectTranscriptView(transcript,'compact',()=> 'Activity');
    const input=transcript.querySelector('input')!;input.focus();input.setSelectionRange(1,3);
    projectTranscriptView(transcript,'normal',()=> 'Activity');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('draft');expect(input.selectionStart).toBe(1);expect(input.selectionEnd).toBe(3);
  });
  it("creates a thinking-only process without hiding the answer or reviving cleared history", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    const doc = (globalThis as any).document;
    doc.body.innerHTML = `<main><article class="assistant" data-turn-id="t" data-turn-completed="true" data-reply="true"><details class="reasoning"><summary>Thinking</summary></details><div class="content">Done</div></article></main>`;
    const transcript = doc.querySelector("main");
    projectTranscriptView(transcript, "compact", () => "Thinking");
    expect(transcript.querySelector(".turn-process").open).toBe(false);
    expect(transcript.querySelector(":scope > .assistant .content").textContent).toBe("Done");
    transcript.replaceChildren();
    projectTranscriptView(transcript, "compact", () => "Thinking");
    expect(transcript.children).toHaveLength(0);
  });
  it("places final-answer thinking after tools and restores the original node in normal view", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    const doc = (globalThis as any).document;
    doc.body.innerHTML = `<main><article class="user" data-turn-id="t"></article>
      <details id="tool" class="tool" data-turn-id="t"></details>
      <article id="answer" class="assistant" data-turn-id="t" data-turn-completed="true" data-reply="true"><div class="label">Seal</div><details class="reasoning" open><summary>Thinking</summary><button>Copy</button></details><div class="content">Answer</div></article></main>`;
    const transcript = doc.querySelector("main");
    const reasoning = transcript.querySelector(".reasoning");
    const answer = transcript.querySelector("#answer");
    let clicked = 0;
    reasoning.querySelector("button").onclick = () => clicked++;
    for (let i = 0; i < 3; i++) {
      projectTranscriptView(transcript, "compact", () => "Activity");
      expect([...transcript.querySelector(".turn-process").children].map((n: any) => n.id || n.className || n.tagName)).toEqual(["SUMMARY", "tool", "reasoning"]);
      expect(answer.querySelector(".reasoning")).toBeNull();
      expect(transcript.querySelectorAll(".reasoning")).toHaveLength(1);
    }
    projectTranscriptView(transcript, "normal", () => "Activity");
    expect(answer.children[1]).toBe(reasoning);
    expect(reasoning.open).toBe(true);
    reasoning.querySelector("button").click();
    expect(clicked).toBe(1);
  });
  it("preserves disclosure choices across updates and folds only on completion", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    const doc = (globalThis as any).document;
    doc.body.innerHTML = `<main><article class="assistant" data-turn-id="t" data-turn-completed="false"></article></main>`;
    const transcript = doc.querySelector("main");
    const label = () => "Activity";
    projectTranscriptView(transcript, "compact", label);
    const disclosure = transcript.querySelector("details");
    expect(disclosure.open).toBe(true);
    disclosure.open = false;
    projectTranscriptView(transcript, "compact", label);
    expect(transcript.querySelector("details")).toBe(disclosure);
    expect(disclosure.open).toBe(false);
    disclosure.open = true;
    transcript.querySelector("article").dataset.turnCompleted = "true";
    projectTranscriptView(transcript, "compact", label);
    expect(disclosure.open).toBe(false);
    disclosure.open = true;
    projectTranscriptView(transcript, "compact", label);
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelectorAll("summary")).toHaveLength(1);
  });
  it("folds completed Turn process rows and restores their order in normal mode", async () => {
    const { projectTranscriptView } = await import(moduleUrl);
    const doc = (globalThis as any).document;
    doc.body.innerHTML = `<main id="transcript">
      <article id="user" class="message user" data-turn-id="t1" data-turn-completed="true"></article>
      <article id="draft" class="message assistant" data-turn-id="t1" data-turn-completed="true" data-reply="true" data-tool-call-count="2" data-subagent-count="1"></article>
      <details id="tool" class="tool" data-turn-id="t1" data-turn-completed="true"></details>
      <article id="answer" class="message assistant" data-turn-id="t1" data-turn-completed="true" data-reply="true"></article>
      <article id="running" class="message assistant" data-turn-id="t2" data-turn-completed="false"></article>
    </main>`;
    const transcript = doc.querySelector("main")!;

    projectTranscriptView(transcript, "compact", (messages: number, tools: number, subagents: number) => `${messages}/${tools}/${subagents}`);
    const disclosure = transcript.querySelector(":scope > .turn-process")!;
    expect(disclosure.querySelector("summary")?.textContent).toBe("1/2/1");
    expect([...disclosure.children].map((node) => node.id || node.tagName)).toEqual(["SUMMARY", "draft", "tool"]);
    expect([...transcript.children].map((node) => node.id || node.className)).toEqual(["user", "turn-process", "answer", "turn-process"]);

    projectTranscriptView(transcript, "normal", () => "unused");
    expect(transcript.querySelector(".turn-process")).toBeNull();
    expect([...transcript.children].map((node) => node.id)).toEqual(["user", "draft", "tool", "answer", "running"]);
  });

  it("keeps a running process open and folds a completed process without a final answer", async () => {
    const { projectTranscriptView } = await import(`${moduleUrl}?lifecycle`);
    const doc = (globalThis as any).document;
    doc.body.innerHTML = `<main id="transcript">
      <article id="running-user" class="message user" data-turn-id="running" data-turn-completed="false"></article>
      <article id="running-work" class="message assistant" data-turn-id="running" data-turn-completed="false" data-tool-call-count="1"></article>
      <article id="closed-user" class="message user" data-turn-id="closed" data-turn-completed="false"></article>
      <details id="closed-tool" class="tool" data-turn-id="closed" data-turn-completed="false"></details>
      <div id="closed-tail" class="turn-tail-message" data-turn-id="closed" data-turn-completed="true"></div>
    </main>`;
    const transcript = doc.querySelector("main")!;
    projectTranscriptView(transcript, "compact", (messages: number, tools: number) => `${messages}/${tools}`);
    const disclosures = [...transcript.querySelectorAll(":scope > .turn-process")] as any[];
    expect(disclosures).toHaveLength(2); expect(disclosures[0]?.open).toBe(true); expect(disclosures[1]?.open).toBe(false);
    expect(disclosures[0]?.querySelector("#running-work")).not.toBeNull(); expect(disclosures[1]?.querySelector("#closed-tool")).not.toBeNull();
    expect(transcript.querySelector(":scope > #closed-tail")).not.toBeNull();
  });
});
