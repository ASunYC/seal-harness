import { messageId, sessionId, text, toolCallId, type SessionSnapshot } from "@seal-harness/core";
import { describe, expect, it } from "vitest";
import { dshSessionMetrics, dshWireHistory } from "../src/dsh-session-history.js";

describe("dsh session history", () => {
  it("derives whole-log session statistics independent of message paging", () => {
    const event = (type: string, time: number, data: unknown) => ({ type: "event" as const, event: { type, seq: time, time, data } });
    const metrics = dshSessionMetrics([
      event("turn/start", 0, { turn: 1 }), event("step/start", 100, { turn: 1, step: 1 }),
      event("assistant/chunk", 250, { turn: 1, step: 1, chunk: { type: "text_delta", delta: "ok" } }),
      event("assistant/message", 600, { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 19, cacheReadTokens: 4 } }),
      event("tool/call", 650, { turn: 1, step: 1, callId: "call" }),
      event("tool/result", 900, { turn: 1, step: 1, message: { source: { kind: "tool", callId: "call" } } }),
      event("step/end", 950, { turn: 1, step: 1 }), event("turn/end", 1_000, { turn: 1 }),
    ]);
    expect(metrics).toEqual({ stats: { turns: 1, steps: 1, llmMs: 500, toolMs: 250, ttftMs: 150, ttftSteps: 1, decodeMs: 350, decodeTokens: 5 }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 19, cacheReadTokens: 4, cacheWriteTokens: 0 } });
  });
  it("projects durable PTC sub-dispatch events in the native DSH vocabulary", () => {
    const rootCallId = toolCallId("root");
    const subCallId = toolCallId("root:code:0");
    const session: SessionSnapshot = {
      id: sessionId("ptc-history"),
      version: 5,
      events: [
        { sequence: 1, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
        { sequence: 2, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "request.header", payload: { header: { config: { provider: "deepseek", model: "deepseek-chat" }, system: "be concise" }, reason: "initial" } } },
        { sequence: 3, timestamp: "2026-01-01T00:00:02.000Z", event: { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 7 } } } },
        { sequence: 4, timestamp: "2026-01-01T00:00:03.000Z", event: { type: "tool/code-dispatch-start", payload: { rootCallId, parentCallId: rootCallId, subCallId, name: "read", arguments: { path: "a.txt" } } } },
        { sequence: 5, timestamp: "2026-01-01T00:00:04.000Z", event: { type: "tool/code-dispatch", payload: { rootCallId, parentCallId: rootCallId, subCallId, name: "read", arguments: { path: "a.txt" }, isError: false, content: [{ type: "text", text: "ok" }] } } },
      ],
    };

    const projected = dshWireHistory(session);
    expect(projected.records.slice(1).map((record) => record.event.type)).toEqual(["request/header", "turn/start", "tool/code-dispatch-start", "tool/code-dispatch"]);
    expect(projected.records[1]?.event.data).toMatchObject({ header: { system: "be concise" }, reason: "initial" });
    expect(projected.records[4]?.event.data).toMatchObject({ subCallId: "root:code:0", isError: false, content: [{ type: "text", text: "ok" }] });
  });

  it("round-trips converted imported Assistant metadata through the native DSH vocabulary", () => {
    const session: SessionSnapshot = {
      id: sessionId("imported-history"), version: 5,
      events: [
        { sequence: 1, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
        { sequence: 2, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 7 }, time: 10 } } },
        { sequence: 3, timestamp: "2026-01-01T00:00:02.000Z", event: { type: "dsh.imported", payload: { type: "step/start", data: { turn: 7, step: 2 } } } },
        { sequence: 4, timestamp: "2026-01-01T00:00:03.000Z", event: { type: "message.appended", payload: { messageId: messageId("answer"), turnId: "dsh-turn-7" as never, message: { role: "assistant", content: [text("done"), { type: "attachment", id: "image", mimeType: "image/png", providerData: { dshAttachment: { type: "image", attachment: { attachmentId: "image", mediaType: "image/png", bytes: 8, width: 1, height: 2 } } } }, { type: "tool_call", id: toolCallId("raw"), name: "read_file", arguments: { path: "a.txt" }, providerData: { dshArguments: " { \"path\": \"a.txt\" } " } }], providerData: { dsh: { interrupted: true, usage: { inputTokens: 10, outputTokens: 2 }, source: { kind: "model", provider: "deepseek", model: "deepseek-chat" } } }, replayState: { response: ["opaque", 1], blocks: [null, null, { thoughtSignature: "tool-signature" }] } } }, surfaceOp: "append" } },
        { sequence: 5, timestamp: "2026-01-01T00:00:04.000Z", event: { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 7, reason: { kind: "completed" } } } } },
      ],
    };
    const projected = dshWireHistory(session);
    expect(projected.records.map((record) => record.event.type)).toEqual(["seal/session-created", "turn/start", "step/start", "assistant/message", "turn/end"]);
    expect(projected.records[1]?.event.time).toBe(10);
    expect(projected.records[3]?.event.data).toEqual({ turn: 7, step: 2, interrupted: true, usage: { inputTokens: 10, outputTokens: 2 }, message: { id: "answer", role: "assistant", content: [{ type: "text", text: "done" }, { type: "image", attachment: { attachmentId: "image", mediaType: "image/png", bytes: 8, width: 1, height: 2 } }, { type: "tool-call", id: "raw", name: "read_file", arguments: " { \"path\": \"a.txt\" } " }], source: { kind: "model", provider: "deepseek", model: "deepseek-chat", replayState: { response: ["opaque", 1], blocks: [null, null, { thoughtSignature: "tool-signature" }] } } } });
  });

  it("round-trips converted imported Tool result error and presentation metadata", () => {
    const session: SessionSnapshot = {
      id: sessionId("imported-tool-history"), version: 7,
      events: [
        { sequence: 1, timestamp: "2026-01-01T00:00:00.000Z", event: { type: "session.created", payload: { cwd: "/workspace" } } },
        { sequence: 2, timestamp: "2026-01-01T00:00:01.000Z", event: { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 3 } } } },
        { sequence: 3, timestamp: "2026-01-01T00:00:02.000Z", event: { type: "dsh.imported", payload: { type: "step/start", data: { turn: 3, step: 1 } } } },
        { sequence: 4, timestamp: "2026-01-01T00:00:03.000Z", event: { type: "dsh.imported", payload: { type: "tool/call", data: { turn: 3, step: 1, callId: "call", name: "read_file", arguments: "{}" } } } },
        { sequence: 5, timestamp: "2026-01-01T00:00:04.000Z", event: { type: "message.appended", payload: { messageId: messageId("result"), turnId: "dsh-turn-3" as never, message: { role: "tool", callId: toolCallId("call"), name: "read_file", content: [text("missing")], isError: true, providerData: { dsh: { error: { name: "ToolError", code: "ENOENT" }, meta: { path: "missing.txt" }, source: { kind: "tool", callId: "call" } } } } }, surfaceOp: "append" } },
        { sequence: 6, timestamp: "2026-01-01T00:00:05.000Z", event: { type: "dsh.imported", payload: { type: "step/end", data: { turn: 3, step: 1 } } } },
        { sequence: 7, timestamp: "2026-01-01T00:00:06.000Z", event: { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 3, reason: { kind: "completed" } } } } },
      ],
    };
    const projected = dshWireHistory(session);
    expect(projected.records.map((record) => record.event.type)).toEqual(["seal/session-created", "turn/start", "step/start", "tool/call", "tool/result", "step/end", "turn/end"]);
    expect(projected.records[4]?.event.data).toEqual({ turn: 3, step: 1, error: { name: "ToolError", code: "ENOENT" }, meta: { path: "missing.txt" }, message: { id: "result", role: "user", content: [{ type: "tool-result", toolCallId: "call", content: [{ type: "text", text: "missing" }], isError: true }], source: { kind: "tool", callId: "call" } } });
  });
});
