// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/transcript-view.js")).href;

describe("transcript view projection", () => {
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
