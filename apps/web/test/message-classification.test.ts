import { describe, expect, it } from "vitest";
import { commandMessageViews, compactionMessageViews, modelRetryMessageViews, referenceLabelsByMessageSequence, steeringMessageSequences, systemPromptMessageViews, transcriptNodeSequences, turnErrorMessageViews, turnMaxTokensMessageViews, turnTailMessageViews, unknownSurfaceMessageViews, workflowRunMessageViews } from "../src/message-classification.js";

const user = (id: string) => ({ id, role: "user", content: [{ type: "text", text: id }], source: { kind: "user-rpc", rpcId: id } });
const stored = (sequence: number, event: unknown) => ({ sequence, timestamp: new Date(sequence).toISOString(), event }) as any;

describe("steering message classification", () => {
  it("marks a next-step claim but not a canceled removal", () => {
    const events = [
      stored(1, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, inserted: [user("steer")] } }),
      stored(2, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, removedCount: 1, inserted: [] } }),
      stored(3, { type: "message.appended", payload: { messageId: "steer", message: user("steer") } }),
      stored(4, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, inserted: [user("discarded")] } }),
      stored(5, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, removedCount: 1, inserted: [], outcome: "canceled" } }),
      stored(6, { type: "message.appended", payload: { messageId: "discarded", message: user("discarded") } }),
    ];
    expect([...steeringMessageSequences(events)]).toEqual([3]);
  });

  it("keeps a claim through a replacement and isolates next-turn claims", () => {
    const events = [
      stored(1, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, inserted: [user("claimed")] } }),
      stored(2, { type: "agent/inbox.spliced", payload: { target: "next-step", start: 0, removedCount: 1, inserted: [] } }),
      stored(3, { type: "message.appended", payload: { messageId: "original", message: user("claimed") } }),
      stored(4, { type: "message.appended", payload: { messageId: "replacement", message: user("claimed") } }),
      stored(5, { type: "agent/inbox.spliced", payload: { target: "next-turn", start: 0, inserted: [user("later")] } }),
      stored(6, { type: "agent/inbox.spliced", payload: { target: "next-turn", start: 0, removedCount: 1, inserted: [] } }),
      stored(7, { type: "message.appended", payload: { messageId: "later", message: user("later") } }),
    ];
    expect([...steeringMessageSequences(events)]).toEqual([3, 4]);
  });

  it("associates only an immediately following valid session recall", () => {
    const recall = (id: string, labels: unknown) => stored(Number(id), { type: "message.appended", payload: { messageId: id, message: { ...user(id), source: { kind: "session-reference", form: "recall", references: labels } } } });
    const events = [
      stored(1, { type: "message.appended", payload: { messageId: "one", message: user("one") } }),
      recall("2", [{ sessionId: "s1", label: "Research" }, { sessionId: "s2", label: "Review" }]),
      stored(3, { type: "message.appended", payload: { messageId: "three", message: user("three") } }),
      stored(4, { type: "message.appended", payload: { messageId: "assistant", message: { role: "assistant", content: [] } } }),
      recall("5", [{ sessionId: "s3", label: "Not adjacent" }]),
      stored(6, { type: "message.appended", payload: { messageId: "six", message: user("six") } }),
      recall("7", [{ sessionId: "s4" }]),
    ];
    expect([...referenceLabelsByMessageSequence(events, [1, 2, 3, 4, 5, 6, 7])]).toEqual([[1, ["Research", "Review"]]]);
  });

  it("folds command lifecycle rows at the original run position", () => {
    const events = [
      stored(1, { type: "command.run", payload: { commandId: "a", name: "feedback", args: "useful" } }),
      stored(2, { type: "command.run", payload: { commandId: "b", name: "compact" } }),
      stored(3, { type: "command.done", payload: { commandId: "a", kind: "success", text: "Recorded" } }),
      stored(4, { type: "command.done", payload: { commandId: "b", kind: "error", text: "First line\nDetails" } }),
      stored(5, { type: "command.done", payload: { commandId: "unknown", kind: "success" } }),
    ];
    expect([...commandMessageViews(events)]).toEqual([
      [1, { role: "command", commandId: "a", name: "feedback", args: "useful", outcome: { kind: "success", text: "Recorded" } }],
      [2, { role: "command", commandId: "b", name: "compact", outcome: { kind: "error", text: "First line\nDetails" } }],
    ]);
  });

  it("keeps commands ordered while honoring surface replacement anchors", () => {
    const events = [
      stored(1, { type: "message.appended", payload: { messageId: "one", message: user("one") }, surfaceOp: "append" }),
      stored(2, { type: "message.appended", payload: { messageId: "two", message: user("two") }, surfaceOp: "append" }),
      stored(3, { type: "command.run", payload: { commandId: "c", name: "feedback" } }),
      stored(4, { type: "message.appended", payload: { messageId: "four", message: user("four") }, surfaceOp: "append" }),
      stored(5, { type: "message.appended", payload: { messageId: "replacement", message: user("replacement") }, surfaceOp: { op: "replace", start: 1, end: 2 }, sourceEventSeqs: [1, 2] }),
    ];
    expect(transcriptNodeSequences(events)).toEqual([5, 3, 4]);
  });

  it("folds a manual compact command and its checkpoint into one repositioned node", () => {
    const events = [
      stored(1, { type: "command.run", payload: { commandId: "compact-1", name: "compact" } }),
      stored(2, { type: "dsh.imported", payload: { type: "compaction/summary", data: { compactionId: "c1", sourceCommandId: "compact-1", summary: [{ type: "text", text: "summary" }], shadowedSeqs: [8, 9], shadowedTokenCount: 90 } } }),
      stored(3, { type: "message.appended", payload: { messageId: "checkpoint", message: { ...user("checkpoint"), source: { kind: "plugin", plugin: "compact", compactionId: "c1", sourceCommandId: "compact-1" } } }, surfaceOp: "append" }),
      stored(4, { type: "command.done", payload: { commandId: "compact-1", kind: "success", text: "done" } }),
    ];
    expect([...commandMessageViews(events)]).toEqual([[3, {
      role: "command", commandId: "compact-1", name: "compact", outcome: { kind: "success", text: "done" },
      compaction: { role: "compaction", summary: "summary", shadowedItemCount: 2, shadowedTokenCount: 90 },
    }]]);
    expect(transcriptNodeSequences(events)).toEqual([3]);
  });

  it("projects only failed runs with a real turn and error", () => {
    const events = [
      stored(1, { type: "run.started", payload: { runId: "r1", model: { provider: "p", model: "m" } } }),
      stored(2, { type: "turn.started", payload: { runId: "r1", turnId: "t1" } }),
      stored(3, { type: "run.completed", payload: { runId: "r1", outcome: "failed", error: "provider failed" } }),
      stored(4, { type: "run.completed", payload: { runId: "r2", outcome: "failed", error: "before turn" } }),
      stored(5, { type: "turn.started", payload: { runId: "r3", turnId: "t3" } }),
      stored(6, { type: "run.completed", payload: { runId: "r3", outcome: "aborted", error: "stopped" } }),
    ];
    expect([...turnErrorMessageViews(events)]).toEqual([[3, { role: "turn-error", runId: "r1", turnId: "t1", message: "provider failed" }]]);
    expect(transcriptNodeSequences(events)).toEqual([3]);
  });

  it("projects imported terminal turn errors with display-safe provider fields", () => {
    const events = [
      stored(1, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 4 } } }),
      stored(2, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 4, reason: { kind: "error", error: { code: "SERVER", message: "provider failed" } } } } }),
      stored(3, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 5 } } }),
      stored(4, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 5, reason: { kind: "error", error: { code: "AUTH", message: "secret-bearing diagnostic" } } } } }),
    ];
    expect([...turnErrorMessageViews(events)]).toEqual([
      [2, { role: "turn-error", turnId: "dsh-turn-4", code: "SERVER", message: "provider failed" }],
      [4, { role: "turn-error", turnId: "dsh-turn-5", code: "AUTH", message: "" }],
    ]);
    expect(transcriptNodeSequences(events)).toEqual([2, 4]);
  });

  it("folds imported DSH retry chains and rejects incomplete records", () => {
    const retry = { retryId: "retry-1", turn: 1, step: 2, provider: "test", mode: "normal", retry: 1, maxRetries: 3, delayMs: 1500, failure: { code: "SERVER", message: "temporary" } };
    const events = [
      stored(1, { type: "dsh.imported", payload: { type: "llm/retry", data: retry } }),
      stored(2, { type: "dsh.imported", payload: { type: "llm/retry-started", data: { retryId: "retry-1", retry: 1 } } }),
      stored(3, { type: "dsh.imported", payload: { type: "llm/retry", data: { ...retry, retry: 2, delayMs: 2500 } } }),
      stored(4, { type: "dsh.imported", payload: { type: "llm/retry", data: { retryId: "broken" } } }),
      stored(5, { type: "run.completed", payload: { runId: "run", outcome: "failed", error: "done" } }),
    ];
    expect([...modelRetryMessageViews(events)]).toEqual([[1, expect.objectContaining({ role: "model-retry", retryId: "retry-1", retry: 2, delayMs: 2500, retryState: "cancelled" })]]);
    expect(transcriptNodeSequences(events)).toEqual([1]);
  });

  it("projects native and imported request headers with DSH visibility rules", () => {
    const header = (system: string, tools: unknown[] = []) => ({ config: { model: { provider: "p", model: "m" } }, system, tools });
    const events = [
      stored(1, { type: "request.header", payload: { header: header("base"), reason: "initial" } }),
      stored(2, { type: "request.header", payload: { header: header("base"), reason: "series" } }),
      stored(3, { type: "request.header", payload: { header: header("base", [{ name: "read" }]), reason: "change" } }),
      stored(4, { type: "dsh.imported", payload: { type: "request/header", data: { header: header("changed", [{ name: "read" }]), reason: "change" } } }),
      stored(5, { type: "dsh.imported", payload: { type: "request/header", data: { header: header(""), reason: "series" } } }),
    ];
    expect([...systemPromptMessageViews(events)]).toEqual([[1, { role: "system-prompt", text: "base" }], [2, { role: "system-prompt", text: "base" }], [4, { role: "system-prompt", text: "changed" }]]);
    expect(transcriptNodeSequences(events)).toEqual([1, 2, 4]);
  });

  it("anchors the first request prompt to its turn or step boundary", () => {
    const header = (system: string) => ({ config: { model: { provider: "p", model: "m" } }, system, tools: [] });
    const events = [
      stored(1, { type: "turn.started", payload: { runId: "native", turnId: "native-turn" } }),
      stored(2, { type: "message.appended", payload: { message: { role: "user", content: [] } } }),
      stored(3, { type: "request.header", payload: { header: header("native"), reason: "initial" } }),
      stored(4, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 2 } } }),
      stored(5, { type: "dsh.imported", payload: { type: "step/start", data: { turn: 2, step: 1 } } }),
      stored(6, { type: "dsh.imported", payload: { type: "request/header", data: { header: header("imported"), reason: "series" } } }),
      stored(7, { type: "dsh.imported", payload: { type: "request/header", data: { header: header("changed"), reason: "change" } } }),
      stored(8, { type: "dsh.imported", payload: { type: "step/start", data: { turn: 2, step: 2 } } }),
      stored(9, { type: "dsh.imported", payload: { type: "request/header", data: { header: header("step two"), reason: "series" } } }),
    ];
    expect([...systemPromptMessageViews(events)]).toEqual([[1, { role: "system-prompt", text: "native" }], [4, { role: "system-prompt", text: "imported" }], [7, { role: "system-prompt", text: "changed" }], [8, { role: "system-prompt", text: "step two" }]]);
    expect(transcriptNodeSequences(events)).toEqual([1, 2, 4, 7, 8]);
  });

  it("projects native and imported max-token turn endings as standalone transcript nodes", () => {
    const events = [
      stored(1, { type: "turn.completed", payload: { runId: "r1", turnId: "t1", stopReason: "length" } }),
      stored(2, { type: "turn.completed", payload: { runId: "r2", turnId: "t2", stopReason: "stop" } }),
      stored(3, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 3, reason: { kind: "max-tokens" } } } }),
      stored(4, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } } }),
    ];
    expect([...turnMaxTokensMessageViews(events)]).toEqual([[1, { role: "turn-max-tokens" }], [3, { role: "turn-max-tokens" }]]);
    expect(transcriptNodeSequences(events)).toEqual([1, 2, 3, 4]);
  });

  it("projects a native completed-turn tail only when no Assistant can own it", () => {
    const events = [
      stored(1, { type: "turn.started", payload: { runId: "r1", turnId: "without-assistant" } }),
      stored(2, { type: "turn.completed", payload: { runId: "r1", turnId: "without-assistant", stopReason: "stop" } }),
      stored(3, { type: "turn.started", payload: { runId: "r2", turnId: "with-assistant" } }),
      stored(4, { type: "message.appended", payload: { turnId: "with-assistant", message: { role: "assistant", content: [] } } }),
      stored(5, { type: "turn.completed", payload: { runId: "r2", turnId: "with-assistant", stopReason: "stop" } }),
    ];
    expect([...turnTailMessageViews(events)]).toEqual([[2, { role: "turn-tail", turnId: "without-assistant" }]]);
    expect(transcriptNodeSequences(events)).toEqual([2, 4]);
  });

  it("projects an imported completed-turn tail only when no converted Assistant can own it", () => {
    const events = [
      stored(1, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 2 } } }),
      stored(2, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } } }),
      stored(3, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 3 } } }),
      stored(4, { type: "message.appended", payload: { turnId: "dsh-turn-3", message: { role: "assistant", content: [] } } }),
      stored(5, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 3, reason: { kind: "completed" } } } }),
    ];
    expect([...turnTailMessageViews(events)]).toEqual([[2, { role: "turn-tail", turnId: "dsh-turn-2" }]]);
    expect(transcriptNodeSequences(events)).toEqual([2, 4]);
  });

  it("projects native and complete imported automatic compaction checkpoints", () => {
    const events = [
      stored(1, { type: "context.compacted", payload: { summaryMessage: { role: "assistant", content: [{ type: "text", text: "native summary" }] }, sourceMessageCount: 5, retainedMessageCount: 2 }, surfaceOp: "append" }),
      stored(2, { type: "dsh.imported", payload: { type: "compaction/summary", data: { compactionId: "auto", summary: [{ type: "text", text: "imported summary" }], shadowedSeqs: [4, 5, 6], shadowedTokenCount: 120 } } }),
      stored(3, { type: "message.appended", payload: { messageId: "checkpoint", message: { ...user("checkpoint"), source: { kind: "plugin", plugin: "compact", compactionId: "auto" } } }, surfaceOp: "append" }),
      stored(4, { type: "dsh.imported", payload: { type: "compaction/summary", data: { compactionId: "manual", sourceCommandId: "command", summary: [{ type: "text", text: "manual" }], shadowedSeqs: [], shadowedTokenCount: 0 } } }),
      stored(5, { type: "message.appended", payload: { messageId: "manual", message: { ...user("manual"), source: { kind: "plugin", plugin: "compact", compactionId: "manual", sourceCommandId: "command" } } }, surfaceOp: "append" }),
    ];
    expect([...compactionMessageViews(events)]).toEqual([
      [1, { role: "compaction", summary: "native summary", shadowedItemCount: 3, shadowedTokenCount: null }],
      [3, { role: "compaction", summary: "imported summary", shadowedItemCount: 3, shadowedTokenCount: 120 }],
    ]);
    expect(transcriptNodeSequences(events)).toEqual([1, 3, 5]);
  });

  it("preserves unknown imported append and replacement surface nodes", () => {
    const events = [
      stored(1, { type: "dsh.imported", payload: { type: "plugin/card", data: { value: 1 } }, surfaceOp: "append" }),
      stored(2, { type: "dsh.imported", payload: { type: "plugin/card-v2", data: { value: 2 } }, surfaceOp: { op: "replace", start: 1, end: 1 }, sourceEventSeqs: [1] }),
      stored(3, { type: "dsh.imported", payload: { type: "plugin/log-only", data: {} } }),
    ];
    expect([...unknownSurfaceMessageViews(events)]).toEqual([[1, { role: "unknown-surface", type: "plugin/card", data: { value: 1 } }], [2, { role: "unknown-surface", type: "plugin/card-v2", data: { value: 2 } }]]);
    expect(transcriptNodeSequences(events)).toEqual([2]);
  });

  it("folds native and imported workflow lifecycle families into run nodes", () => {
    const events = [
      stored(1, { type: "workflow.started", payload: { workflowId: "native", name: "Native flow" } }),
      stored(2, { type: "workflow.agent.started", payload: { workflowId: "native", sequence: 1, label: "Research", childSessionId: "child-1", phase: "plan" } }),
      stored(3, { type: "workflow.agent.completed", payload: { workflowId: "native", sequence: 1, outcome: "completed" } }),
      stored(4, { type: "workflow.completed", payload: { workflowId: "native", outcome: "completed", agentsStarted: 1 } }),
      stored(5, { type: "dsh.imported", payload: { type: "tool-workflow/run-start", data: { runId: "dsh", name: "DSH flow" } } }),
      stored(6, { type: "dsh.imported", payload: { type: "tool-workflow/agent-start", data: { runId: "dsh", seq: 2, label: "Review", childId: "child-2" } } }),
      stored(7, { type: "dsh.imported", payload: { type: "tool-workflow/agent-end", data: { runId: "dsh", seq: 2, outcome: "failed" } } }),
      stored(8, { type: "dsh.imported", payload: { type: "tool-workflow/run-end", data: { runId: "dsh", stopReason: "error" } } }),
    ];
    expect([...workflowRunMessageViews(events)]).toEqual([
      [1, { role: "workflow-run", workflowId: "native", name: "Native flow", status: "completed", phases: [{ key: "value:4:plan", phase: "plan", members: [{ sequence: 1, label: "Research", childSessionId: "child-1", status: "completed" }] }] }],
      [5, { role: "workflow-run", workflowId: "dsh", name: "DSH flow", status: "failed", phases: [{ key: "missing", phase: null, members: [{ sequence: 2, label: "Review", childSessionId: "child-2", status: "failed" }] }] }],
    ]);
    expect(transcriptNodeSequences(events)).toEqual([1, 5]);
  });

  it("marks unterminated workflow runs and active members interrupted after their owning turn closes", () => {
    const events = [
      stored(1, { type: "turn.started", payload: { runId: "native-run", turnId: "native-turn" } }),
      stored(2, { type: "workflow.started", payload: { workflowId: "native", name: "Native interrupted" } }),
      stored(3, { type: "workflow.agent.started", payload: { workflowId: "native", sequence: 1, label: "Done", childSessionId: "child-done" } }),
      stored(4, { type: "workflow.agent.completed", payload: { workflowId: "native", sequence: 1, outcome: "completed" } }),
      stored(5, { type: "workflow.agent.started", payload: { workflowId: "native", sequence: 2, label: "Open", childSessionId: "child-open" } }),
      stored(6, { type: "turn.completed", payload: { runId: "native-run", turnId: "native-turn", stopReason: "stop" } }),
      stored(7, { type: "dsh.imported", payload: { type: "turn/start", data: { turn: 4 } } }),
      stored(8, { type: "dsh.imported", payload: { type: "tool-workflow/run-start", data: { runId: "dsh", name: "DSH interrupted" } } }),
      stored(9, { type: "dsh.imported", payload: { type: "tool-workflow/agent-start", data: { runId: "dsh", seq: 1, label: "Open", childId: "child-dsh" } } }),
      stored(10, { type: "dsh.imported", payload: { type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } } }),
    ];
    expect([...workflowRunMessageViews(events)]).toEqual([
      [2, { role: "workflow-run", workflowId: "native", name: "Native interrupted", status: "interrupted", phases: [{ key: "missing", phase: null, members: [{ sequence: 1, label: "Done", childSessionId: "child-done", status: "completed" }, { sequence: 2, label: "Open", childSessionId: "child-open", status: "interrupted" }] }] }],
      [8, { role: "workflow-run", workflowId: "dsh", name: "DSH interrupted", status: "interrupted", phases: [{ key: "missing", phase: null, members: [{ sequence: 1, label: "Open", childSessionId: "child-dsh", status: "interrupted" }] }] }],
    ]);
  });
});
