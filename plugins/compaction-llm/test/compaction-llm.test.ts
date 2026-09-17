import { sessionId, text, userMessage, type ModelRequest, type ModelService, type ModelStreamEvent } from "@seal-harness/core";
import { describe, expect, it } from "vitest";
import { LlmCompactionService } from "../src/index.js";

const MODEL = { provider: "mock", model: "summarizer" };
const MESSAGES = [
  userMessage("one"),
  { role: "assistant" as const, content: [text("answer one")] },
  userMessage("two"),
  { role: "assistant" as const, content: [text("answer two")] },
  userMessage("three"),
  { role: "assistant" as const, content: [text("answer three")] },
];

describe("LlmCompactionService", () => {
  it.each(['completed', 'fallback', 'failed', 'aborted'] as const)("reports the real summary lifecycle: %s", async outcome => {
    const events: unknown[] = []; const controller = new AbortController();
    const service = new LlmCompactionService(fakeModels(async function* () {
      expect(events).toEqual([{state:'started'}]);
      if (outcome === 'aborted') controller.abort(new Error('stop'));
      if (outcome !== 'completed') throw new Error('offline');
      yield {type:'text_delta', delta:'summary'};
      yield {type:'done', stopReason:'stop'};
    }), {thresholdMessages:4, retainMessages:2, fallbackOnError:outcome !== 'failed'});
    const result = service.compact({sessionId:sessionId('s'),messages:MESSAGES,model:MODEL,signal:controller.signal,onProgress:event=>events.push(event)});
    if (outcome === 'failed' || outcome === 'aborted') await expect(result).rejects.toThrow();
    else await result;
    expect(events).toEqual([{state:'started'},{state:'finished',outcome}]);
  });
  it("does not announce compaction below threshold and isolates observer failures", async () => {
    const events: unknown[] = [];
    const service = new LlmCompactionService(fakeModels(async function* () {
      yield {type:'text_delta',delta:'summary'}; yield {type:'done',stopReason:'stop'};
    }), {thresholdMessages:4,retainMessages:2});
    const request = {sessionId:sessionId('s'),messages:[],model:MODEL,signal:new AbortController().signal,onProgress:(event: unknown)=>events.push(event)};
    expect(await service.compact(request)).toBeUndefined(); expect(events).toEqual([]);
    expect(await service.compact({...request,messages:MESSAGES,onProgress:()=>{throw new Error('UI failed');}})).toBeDefined();
  });
  it("summarizes the dropped window without exposing tools or entering the Agent loop", async () => {
    let captured: ModelRequest | undefined;
    const models = fakeModels(async function* (request) {
      captured = request;
      yield { type: "text_delta", delta: "Kept the important decisions." };
      yield { type: "done", stopReason: "stop" };
    });
    const service = new LlmCompactionService(models, { thresholdMessages: 4, retainMessages: 2 });
    const result = await service.compact({ sessionId: sessionId("session"), messages: MESSAGES, model: MODEL, signal: new AbortController().signal });

    expect(result?.summaryMessage).toEqual({ role: "user", content: [text("Conversation summary:\nKept the important decisions.")] });
    expect(result?.retainedMessages).toEqual(MESSAGES.slice(4));
    expect(captured).toMatchObject({ model: MODEL, tools: [], temperature: 0, maxOutputTokens: 2048 });
    expect(captured?.messages[0]?.content[0]).toMatchObject({ text: expect.stringContaining("answer two") });
  });

  it("falls back to deterministic compaction on provider failure", async () => {
    const service = new LlmCompactionService(fakeModels(async function* () { throw new Error("offline"); }), { thresholdMessages: 4, retainMessages: 2 });
    const result = await service.compact({ sessionId: sessionId("session"), messages: MESSAGES, model: MODEL, signal: new AbortController().signal });
    expect(result?.summaryMessage.content[0]).toMatchObject({ text: expect.stringContaining("Compacted conversation history") });
  });

  it("propagates cancellation instead of silently falling back", async () => {
    const controller = new AbortController();
    const service = new LlmCompactionService(fakeModels(async function* () {
      controller.abort(new Error("stop"));
      throw new Error("provider aborted");
    }), { thresholdMessages: 4, retainMessages: 2 });
    await expect(service.compact({ sessionId: sessionId("session"), messages: MESSAGES, model: MODEL, signal: controller.signal })).rejects.toThrow("stop");
  });
});

function fakeModels(stream: (request: ModelRequest) => AsyncIterable<ModelStreamEvent>): ModelService {
  return {
    async list() { return []; },
    async get() { return undefined; },
    stream,
  };
}
