import { describe, expect, it } from "vitest";
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN, deriveSessionMessages, foldSessionSurface, interruptedSessionClosers, materializeForkEvents, type SessionEvent, type StoredSessionEvent } from "../src/index.js";

const stored = (sequence: number, event: SessionEvent): StoredSessionEvent => ({ sequence, timestamp: "2026-01-01T00:00:00.000Z", event });
const message = (value: string): SessionEvent => ({ type: "message.appended", payload: { messageId: `m-${value}` as never, message: { role: "user", content: [{ type: "text", text: value }] } }, surfaceOp: "append" });

describe("Session surface", () => {
  it("folds a cited positional replacement and derives model history", () => {
    const events = [
      stored(1, { type: "session.created", payload: { cwd: "/workspace" } }),
      stored(2, message("one")), stored(3, message("two")), stored(4, message("keep")),
      stored(5, { type: "context.compacted", payload: { summaryMessage: { role: "assistant", content: [{ type: "text", text: "summary" }] }, sourceMessageCount: 3, retainedMessageCount: 1 }, surfaceOp: { op: "replace", start: 2, end: 3 }, sourceEventSeqs: [2, 3] }),
    ];
    expect(foldSessionSurface(events)).toEqual({ nodes: [5, 4], replaceGeneration: 1, replacements: [{ sequence: 5, start: 2, end: 3, shadowedSequences: [2, 3] }] });
    expect(deriveSessionMessages({ id: "session" as never, version: 5, events }).map((entry) => entry.content[0])).toEqual([{ type: "text", text: "summary" }, { type: "text", text: "keep" }]);
  });

  it("rejects invalid ranges, missing provenance, and metadata on log-only events", () => {
    const prefix = [stored(1, { type: "session.created", payload: { cwd: "/workspace" } }), stored(2, message("one"))];
    expect(() => foldSessionSurface([...prefix, stored(3, { ...message("bad"), surfaceOp: { op: "replace", start: 2, end: 2 } })])).toThrow("cite every shadowed");
    expect(() => foldSessionSurface([...prefix, stored(3, { ...message("bad"), surfaceOp: { op: "replace", start: 9, end: 9 }, sourceEventSeqs: [2] })])).toThrow("start sequence 9");
    expect(() => foldSessionSurface([stored(1, { type: "session.created", payload: { cwd: "/workspace" }, surfaceOp: "append" })])).toThrow("not surface-eligible");
  });

  it("reads legacy compaction events with their retained-tail semantics", () => {
    const events = [stored(1, { type: "session.created", payload: { cwd: "/workspace" } }), stored(2, message("one")), stored(3, message("keep")), stored(4, { type: "context.compacted", payload: { summaryMessage: { role: "assistant", content: [{ type: "text", text: "summary" }] }, sourceMessageCount: 2, retainedMessageCount: 1 } })];
    expect(foldSessionSurface(events).nodes).toEqual([4, 3]);
  });

  it("removes a cited range without introducing a placeholder surface node", () => {
    const events = [
      stored(1, { type: "session.created", payload: { cwd: "/workspace" } }),
      stored(2, message("one")), stored(3, message("two")), stored(4, message("keep")),
      stored(5, { type: "surface.removed", payload: {}, surfaceOp: { op: "replace", start: 2, end: 3 }, sourceEventSeqs: [2, 3] }),
    ];
    expect(foldSessionSurface(events)).toEqual({ nodes: [4], replaceGeneration: 1, replacements: [{ sequence: 5, start: 2, end: 3, shadowedSequences: [2, 3] }] });
    expect(deriveSessionMessages({ id: "session" as never, version: 5, events }).map((entry) => entry.content[0])).toEqual([{ type: "text", text: "keep" }]);
  });

  it("replays imported plugin surface events without feeding opaque data to the model", () => {
    const events = [
      stored(1, { type: "session.created", payload: { cwd: "/workspace" } }),
      stored(2, message("known")),
      stored(3, { type: "dsh.imported", payload: { type: "plugin/card", data: { label: "visible" } }, surfaceOp: "append" }),
    ];
    expect(foldSessionSurface(events).nodes).toEqual([2, 3]);
    expect(deriveSessionMessages({ id: "session" as never, version: 3, events }).map((entry) => entry.content[0])).toEqual([{ type: "text", text: "known" }]);
  });

  it("distinguishes calls interrupted before and after their durable start", () => {
    const runId = "run" as never; const turnId = "turn" as never; const before = "before" as never; const after = "after" as never;
    const events = [
      stored(1, { type: "session.created", payload: { cwd: "/workspace" } }),
      stored(2, { type: "run.started", payload: { runId, model: { provider: "p", model: "m" } } }),
      stored(3, { type: "turn.started", payload: { runId, turnId } }),
      stored(4, { type: "message.appended", payload: { messageId: "calls" as never, runId, turnId, message: { role: "assistant", content: [{ type: "tool_call", id: before, name: "read", arguments: {} }, { type: "tool_call", id: after, name: "write", arguments: {} }] } }, surfaceOp: "append" }),
      stored(5, { type: "tool.started", payload: { runId, turnId, callId: after, name: "write", input: {} } }),
    ];
    const closers = interruptedSessionClosers({ id: "session" as never, version: 5, events });
    const results = closers.filter((event) => event.type === "tool.completed");
    expect(results.map((event) => event.type === "tool.completed" && (event.payload.result.details as { code: string }).code)).toEqual([TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN]);
    expect(closers.slice(-2).map((event) => event.type)).toEqual(["turn.completed", "run.completed"]);
    expect(closers.at(-1)).toMatchObject({ type: "run.completed", payload: { outcome: "aborted" } });
  });

  it("remaps surface ranges and provenance when a fork renumbers its transcript", () => {
    const events = [stored(1, { type: "session.created", payload: { cwd: "/workspace" } }), stored(2, message("one")), stored(3, message("two")), stored(4, { type: "context.compacted", payload: { summaryMessage: { role: "assistant", content: [{ type: "text", text: "summary" }] }, sourceMessageCount: 2, retainedMessageCount: 0 }, surfaceOp: { op: "replace", start: 2, end: 3 }, sourceEventSeqs: [2, 3] })];
    const fork = materializeForkEvents({ id: "source" as never, version: 4, events });
    expect(fork[4]).toMatchObject({ surfaceOp: { op: "replace", start: 3, end: 4 }, sourceEventSeqs: [3, 4] });
    expect(foldSessionSurface(fork.map((event, index) => stored(index + 1, event))).nodes).toEqual([5]);
  });

  it("copies chunk provenance required by a forked assistant message", () => {
    const runId = "run" as never; const turnId = "turn" as never;
    const events = [
      stored(1, { type: "session.created", payload: { cwd: "/workspace" } }),
      stored(2, { type: "run.started", payload: { runId, model: { provider: "p", model: "m" } } }),
      stored(3, { type: "turn.started", payload: { runId, turnId } }),
      stored(4, { type: "assistant.chunk", payload: { runId, turnId, step: 0, chunk: { type: "text-delta", index: 0, text: "answer" } } }),
      stored(5, { type: "message.appended", payload: { messageId: "answer" as never, runId, turnId, message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }, surfaceOp: "append", sourceEventSeqs: [4] }),
    ];
    const fork = materializeForkEvents({ id: "source" as never, version: 5, events });
    expect(fork.map((event) => event.type)).toEqual(["session.created", "session.forked", "assistant.chunk", "message.appended"]);
    expect(fork[3]).toMatchObject({ sourceEventSeqs: [3] });
  });
});
