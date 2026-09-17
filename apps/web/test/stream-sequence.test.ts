import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
const { createStreamSequence } = await import(pathToFileURL(resolve("apps/web/public/stream-sequence.js")).href);
it("separates text-only turns and does not allocate bubbles for empty turns", () => {
  let count = 0;
  const sequence = createStreamSequence(0, () => ++count);
  sequence.accept("turn_start");
  expect(sequence.accept("text_delta")).toBe(0);
  sequence.accept("turn_end");
  sequence.accept("turn_start");
  sequence.accept("turn_end");
  sequence.accept("turn_start");
  expect(count).toBe(0);
  expect(sequence.accept("text_delta")).toBe(1);
  expect(sequence.accept("text_delta")).toBe(1);
  expect(sequence.assistants).toEqual([0, 1]);
});
it("keeps reasoning and answer together until a tool separates the next answer", () => {
  const first = {}; const next = {};
  const sequence = createStreamSequence(first, () => next);
  expect(sequence.accept("reasoning_delta")).toBe(first);
  expect(sequence.accept("text_delta")).toBe(first);
  sequence.accept("tool_call"); sequence.accept("tool_result");
  expect(sequence.accept("text_delta")).toBe(next);
  expect(sequence.accept("text_delta")).toBe(next);
  expect(sequence.assistants).toEqual([first, next]);
});
it("preserves interleaved thinking and parallel tool batches without empty bubbles", () => {
  let count = 0;
  const sequence = createStreamSequence(0, () => ++count);
  sequence.accept("text_delta");
  expect(sequence.accept("reasoning_delta")).toBe(1);
  sequence.accept("tool_call"); sequence.accept("tool_call");
  sequence.accept("tool_progress"); sequence.accept("tool_result");
  expect(count).toBe(1);
  expect(sequence.accept("reasoning_delta")).toBe(2);
  expect(sequence.accept("text_delta")).toBe(2);
});
