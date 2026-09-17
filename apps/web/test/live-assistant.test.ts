import { expect, it } from "vitest";
import type { StoredSessionEvent } from "@seal-harness/core";
import { liveAssistantPreview } from "../src/live-assistant.js";
const stored = (event: unknown) => ({ sequence: 1, timestamp: "2026-01-01T00:00:00Z", event }) as StoredSessionEvent;
const delta = (type: string, text: string, index = 0) => stored({ type: "assistant.chunk", payload: { runId: "r", turnId: "t", step: 0, chunk: { type, text, index } } });
it("preserves thinking/text order and excludes completed snapshots", () => {
  const events = [delta("reasoning-delta", "think"), delta("text-delta", "reply", 1), delta("text-delta", " more", 1)];
  expect(liveAssistantPreview(events)[0]).toMatchObject({ live: true, turnCompleted: false, content: [{ type: "reasoning", text: "think" }, { type: "text", text: "reply more" }] });
  for (const terminal of [stored({ type: "step.completed", payload: {} }), stored({ type: "run.completed", payload: {} }), stored({ type: "message.appended", payload: { message: { role: "assistant" } } })]) expect(liveAssistantPreview([...events, terminal])).toEqual([]);
});
it("bounds partial output and ignores unknown chunk types", () => {
  const view = liveAssistantPreview([delta("text-delta", "x".repeat(210000)), delta("block-end", "duplicate")]);
  expect(view[0]?.content[0]?.text).toHaveLength(200000);
  expect(view[0]?.truncated).toBe(true);
});
it("reads PI chunks stored through the compatibility wire envelope", () => {
  const chunk = stored({ type: "dsh.imported", payload: { type: "assistant/chunk", data: { turn: 1, step: 0, chunk: { type: "text-delta", text: "partial", index: 0 } } } });
  expect(liveAssistantPreview([chunk])[0]?.content).toEqual([{ type: "text", text: "partial" }]);
  const end = stored({ type: "dsh.imported", payload: { type: "assistant/message", data: {} } });
  expect(liveAssistantPreview([chunk, end])).toEqual([]);
});
