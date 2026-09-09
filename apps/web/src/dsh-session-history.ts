import type { AgentMessage, ContentBlock, SessionSnapshot, StoredSessionEvent } from "@seal-harness/core";

export interface DshWireEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
  readonly sourceEventSeqs?: readonly number[];
  readonly surfaceOp?: "append" | { readonly op: "replace"; readonly start: number; readonly end: number };
}

export interface DshHistoryRecord { readonly type: "event"; readonly event: DshWireEvent }

export interface DshWireHistory {
  readonly header: {
    readonly version: number;
    readonly id: string;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly parentSession?: string;
    readonly origin?: "subagent";
    readonly agentPreset?: string;
  };
  readonly records: readonly DshHistoryRecord[];
  /** Seal store sequence that produced each wire record at the same array index. */
  readonly sealSequences: readonly number[];
}

export interface DshAttachmentMetadata {
  readonly attachmentId: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
  readonly originalDimensions?: { readonly width: number; readonly height: number };
}

/**
 * Deterministically projects Seal's durable journal into a dense DSH journal.
 * A Seal event can expand to several DSH lifecycle records; callers must use
 * the returned DSH cursor rather than treating a Seal version as a wire seq.
 */
export function dshWireHistory(session: SessionSnapshot, attachments: ReadonlyMap<string, DshAttachmentMetadata> = new Map()): DshWireHistory {
  const records: DshHistoryRecord[] = [];
  const sealSequences: number[] = [];
  const primarySeqBySealSeq = new Map<number, number>();
  const turns = new Map<string, { turn: number; step: number; openStep: boolean }>();
  const models = new Map<string, { provider: string; model: string }>();
  let nextTurn = 0;
  const push = (stored: StoredSessionEvent, type: string, data: unknown, extra: Partial<DshWireEvent> = {}): number => {
    const seq = records.length;
    records.push({ type: "event", event: { type, seq, time: eventTime(stored), data, ...extra } });
    sealSequences.push(stored.sequence);
    return seq;
  };
  const ensureStep = (stored: StoredSessionEvent, state: { turn: number; step: number; openStep: boolean }): void => {
    if (state.openStep) return;
    push(stored, "step/start", { turn: state.turn, step: state.step });
    state.openStep = true;
  };
  const closeStep = (stored: StoredSessionEvent, state: { turn: number; step: number; openStep: boolean }): void => {
    if (!state.openStep) return;
    push(stored, "step/end", { turn: state.turn, step: state.step });
    state.openStep = false;
    state.step += 1;
  };

  for (const stored of session.events) {
    const event = stored.event;
    let primary: number;
    switch (event.type) {
      case "session.created":
        primary = push(stored, "seal/session-created", event.payload, { ignorable: true });
        break;
      case "session.forked":
        primary = push(stored, "seal/session-forked", event.payload, { ignorable: true });
        break;
      case "run.started":
        models.set(event.payload.runId, event.payload.model);
        primary = push(stored, "seal/run-started", event.payload, { ignorable: true });
        break;
      case "turn.started": {
        const state = { turn: nextTurn++, step: 1, openStep: false };
        turns.set(event.payload.turnId, state);
        primary = push(stored, "turn/start", { turn: state.turn });
        break;
      }
      case "step.started": {
        const state = turns.get(event.payload.turnId);
        if (state === undefined) primary = push(stored, "seal/step-started", event.payload, { ignorable: true });
        else { state.step = event.payload.step; primary = push(stored, "step/start", { turn: state.turn, step: state.step }); state.openStep = true; }
        break;
      }
      case "assistant.chunk": {
        const state = turns.get(event.payload.turnId);
        if (state === undefined) primary = push(stored, "seal/assistant-chunk", event.payload, { ignorable: true });
        else { state.step = event.payload.step; ensureStep(stored, state); primary = push(stored, "assistant/chunk", { turn: state.turn, step: state.step, chunk: event.payload.chunk }); }
        break;
      }
      case "message.appended": {
        const state = event.payload.turnId === undefined ? undefined : turns.get(event.payload.turnId);
        if (event.payload.message.role !== "user" && state === undefined) {
          primary = push(stored, "seal/message-appended", event.payload, { ignorable: true });
          break;
        }
        if (event.payload.message.role !== "user" && state !== undefined) ensureStep(stored, state);
        const model = event.payload.runId === undefined ? undefined : models.get(event.payload.runId);
        primary = push(stored, ...messageWire(event.payload.message, event.payload.messageId, state, model, attachments), surfaceMetadata(event, primarySeqBySealSeq));
        if (event.payload.message.role === "tool" && state !== undefined && !String(event.payload.turnId).startsWith("dsh-turn-")) closeStep(stored, state);
        break;
      }
      case "tool.started": {
        const state = turns.get(event.payload.turnId);
        if (state === undefined) {
          primary = push(stored, "seal/tool-started", event.payload, { ignorable: true });
          break;
        }
        ensureStep(stored, state);
        primary = push(stored, "tool/call", { turn: state.turn, step: state.step, callId: event.payload.callId, name: event.payload.name, arguments: JSON.stringify(event.payload.input) });
        break;
      }
      case "tool.completed":
        // The following tool-role message is the canonical DSH tool/result.
        primary = push(stored, "seal/tool-completed", event.payload, { ignorable: true });
        break;
      case "step.completed": {
        const state = turns.get(event.payload.turnId);
        if (state === undefined) primary = push(stored, "seal/step-completed", event.payload, { ignorable: true });
        else { state.step = event.payload.step; primary = state.openStep ? push(stored, "step/end", { turn: state.turn, step: state.step }) : push(stored, "seal/step-completed", event.payload, { ignorable: true }); state.openStep = false; state.step += 1; }
        break;
      }
      case "tool/code-dispatch-start":
        primary = push(stored, "tool/code-dispatch-start", event.payload);
        break;
      case "tool/code-dispatch":
        primary = push(stored, "tool/code-dispatch", {
          ...event.payload,
          content: event.payload.content.map((block) => contentBlock(block, attachments)),
        });
        break;
      case "dsh.imported": {
        const data = event.payload.data; const turn = Number.isSafeInteger(data.turn) ? data.turn as number : undefined; const importedTurnId = turn === undefined ? undefined : `dsh-turn-${turn}`;
        if (event.payload.type === "turn/start" && turn !== undefined) turns.set(importedTurnId!, { turn, step: 1, openStep: false });
        else if (event.payload.type === "step/start" && importedTurnId !== undefined && Number.isSafeInteger(data.step)) {
          const state = turns.get(importedTurnId); if (state !== undefined) { state.step = data.step as number; state.openStep = true; }
        }
        else if (event.payload.type === "step/end" && importedTurnId !== undefined && Number.isSafeInteger(data.step)) {
          const state = turns.get(importedTurnId); if (state !== undefined) { state.step = (data.step as number) + 1; state.openStep = false; }
        }
        primary = push(stored, event.payload.type, event.payload.data, { ...(event.payload.ignorable ? { ignorable: true } : {}), ...(event.payload.time === undefined ? {} : { time: event.payload.time }) });
        if (event.payload.type === "turn/end" && importedTurnId !== undefined) turns.delete(importedTurnId);
        break;
      }
      case "request.header":
        primary = push(stored, "request/header", event.payload);
        break;
      case "agent/inbox.spliced":
        primary = push(stored, "agent/inbox.spliced", event.payload);
        break;
      case "turn.completed": {
        const state = turns.get(event.payload.turnId);
        if (state === undefined) {
          primary = push(stored, "seal/turn-completed", event.payload, { ignorable: true });
          break;
        }
        closeStep(stored, state);
        primary = push(stored, "turn/end", { turn: state.turn, reason: event.payload.outcome === "interrupted" ? { kind: "interrupted" } : event.payload.stopReason === "length" ? { kind: "max-tokens" } : { kind: "completed" } });
        turns.delete(event.payload.turnId);
        break;
      }
      default:
        primary = push(stored, `seal/${event.type.replaceAll(".", "-")}`, event.payload, { ignorable: true });
        break;
    }
    primarySeqBySealSeq.set(stored.sequence, primary);
  }

  const created = session.events.find((entry) => entry.event.type === "session.created");
  const createdPayload = created?.event.type === "session.created" ? created.event.payload : undefined;
  const metadata = createdPayload?.metadata;
  const parent = typeof metadata?.["sealHarness.parentSessionId"] === "string" ? metadata["sealHarness.parentSessionId"] : undefined;
  const fork = session.events.find((entry) => entry.event.type === "session.forked");
  const forkParent = fork?.event.type === "session.forked" ? fork.event.payload.sourceSessionId : undefined;
  const parentSession = parent ?? forkParent;
  let preset: string | undefined;
  for (const entry of session.events) if (entry.event.type === "agent-preset.selected") preset = entry.event.payload.preset;
  return {
    header: {
      version: 0,
      id: session.id,
      createdAt: created === undefined ? 0 : eventTime(created),
      ...(createdPayload?.cwd === undefined ? {} : { cwd: createdPayload.cwd }),
      ...(parentSession === undefined ? {} : { parentSession }),
      ...(parent === undefined ? {} : { origin: "subagent" as const }),
      ...(preset === undefined ? {} : { agentPreset: preset }),
    },
    records,
    sealSequences,
  };
}

export interface DshSessionMetrics {
  readonly stats: { readonly turns: number; readonly steps: number; readonly llmMs: number; readonly toolMs: number; readonly ttftMs: number; readonly ttftSteps: number; readonly decodeMs: number; readonly decodeTokens: number };
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number };
}

/** Whole-journal statistics used by the same composer dock as DSH's StatsLine. */
export function dshSessionMetrics(records: readonly DshHistoryRecord[]): DshSessionMetrics {
  const stats = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
  const open = new Map<string, { start: number; firstToken: number | null }>(); const pending = new Map<string, number>(); const turns = new Set<number>();
  let inputTokens = 0; let outputTokens = 0; let totalTokens = 0; let cacheReadTokens = 0; let cacheWriteTokens = 0; let usageCount = 0;
  const object = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const integer = (value: unknown): number | undefined => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
  const identity = (data: Record<string, unknown>): string | undefined => Number.isSafeInteger(data.turn) && Number.isSafeInteger(data.step) ? `${String(data.turn)}:${String(data.step)}` : undefined;
  for (const record of records) {
    const event = record.event; const data = object(event.data); if (data === undefined) continue; const key = identity(data);
    if (event.type === "step/start" && key !== undefined) open.set(key, { start: event.time, firstToken: null });
    else if (event.type === "assistant/chunk" && key !== undefined) { const step = open.get(key); const chunk = object(data.chunk); const kind = chunk?.type; if (step !== undefined && step.firstToken === null && (kind === "text_delta" || kind === "reasoning_delta")) step.firstToken = event.time; }
    else if (event.type === "assistant/message" && key !== undefined) {
      const step = open.get(key); const usage = object(data.usage); const output = integer(usage?.outputTokens);
      if (step !== undefined) { stats.llmMs += Math.max(0, event.time - step.start); if (step.firstToken !== null) { stats.ttftMs += Math.max(0, step.firstToken - step.start); stats.ttftSteps += 1; if (output !== undefined) { stats.decodeMs += Math.max(0, event.time - step.firstToken); stats.decodeTokens += output; } } }
      const input = integer(usage?.inputTokens); const total = integer(usage?.totalTokens); const read = integer(usage?.cacheReadTokens) ?? 0; const write = integer(usage?.cacheWriteTokens) ?? 0;
      if (input !== undefined && output !== undefined && total !== undefined && total >= input + output + read + write) { inputTokens += input; outputTokens += output; totalTokens += total; cacheReadTokens += read; cacheWriteTokens += write; usageCount += 1; }
    } else if (event.type === "tool/call" && typeof data.callId === "string") pending.set(data.callId, event.time);
    else if (event.type === "tool/result") { const message = object(data.message); const source = object(message?.source); const callId = typeof source?.callId === "string" ? source.callId : undefined; const start = callId === undefined ? undefined : pending.get(callId); if (callId !== undefined) pending.delete(callId); if (start !== undefined) stats.toolMs += Math.max(0, event.time - start); }
    else if (event.type === "step/end") { if (key !== undefined) open.delete(key); stats.steps += 1; if (Number.isSafeInteger(data.turn)) turns.add(data.turn as number); }
    else if (event.type === "turn/end") pending.clear();
  }
  stats.turns = turns.size;
  return { stats, ...(usageCount === 0 ? {} : { usage: { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens } }) };
}

export function dshHistoryPage(records: readonly DshHistoryRecord[], throughSeq: number, beforeSeq: number | undefined, maxMessages = 50): { readonly records: readonly DshHistoryRecord[]; readonly hasMore: boolean } {
  const end = Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1);
  let count = 0;
  let cut = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = records[index]?.event;
    if (event === undefined || event.surfaceOp === undefined || (event.type !== "user/message" && event.type !== "assistant/message")) continue;
    count += 1;
    if (count >= maxMessages) {
      cut = Math.min(event.seq, ...(event.sourceEventSeqs ?? [event.seq]));
      break;
    }
  }
  return { records: records.slice(cut, end), hasMore: cut > 0 };
}

function messageWire(message: AgentMessage, id: string, state: { turn: number; step: number } | undefined, model: { provider: string; model: string } | undefined, attachments: ReadonlyMap<string, DshAttachmentMetadata>): [string, unknown] {
  const content = message.content.map((block) => contentBlock(block, attachments));
  if (message.role === "user") return ["user/message", { id, role: "user", content, source: message.source ?? { kind: "user" } }];
  if (message.role === "assistant") {
    const imported = message.providerData?.dsh; const metadata = typeof imported === "object" && imported !== null && !Array.isArray(imported) ? imported as Record<string, unknown> : undefined;
    const importedSource = metadata?.source; const source = typeof importedSource === "object" && importedSource !== null && !Array.isArray(importedSource) ? importedSource : { kind: "model", provider: model?.provider ?? "seal", model: model?.model ?? "unknown" };
    const replaySource = message.replayState === undefined ? source : { ...(source as Record<string, unknown>), replayState: message.replayState };
    return ["assistant/message", {
      turn: state?.turn ?? 0,
      step: state?.step ?? 0,
      message: { id, role: "assistant", content, source: replaySource },
      ...(metadata?.usage === undefined ? {} : { usage: metadata.usage }),
      ...(metadata?.interrupted === true ? { interrupted: true } : {}),
    }];
  }
  const imported = message.providerData?.dsh; const metadata = typeof imported === "object" && imported !== null && !Array.isArray(imported) ? imported as Record<string, unknown> : undefined;
  const importedSource = metadata?.source; const source = typeof importedSource === "object" && importedSource !== null && !Array.isArray(importedSource) ? importedSource : { kind: "tool", callId: message.callId };
  return ["tool/result", {
    turn: state?.turn ?? 0,
    step: state?.step ?? 0,
    message: { id, role: "user", content: [{ type: "tool-result", toolCallId: message.callId, content, ...(message.isError ? { isError: true } : {}) }], source },
    ...(metadata?.error === undefined ? {} : { error: metadata.error }),
    ...(metadata?.meta === undefined ? {} : { meta: metadata.meta }),
  }];
}

function contentBlock(block: ContentBlock | AgentMessage["content"][number], attachments: ReadonlyMap<string, DshAttachmentMetadata>): unknown {
  if (block.type === "text" || block.type === "reasoning") return { type: block.type, text: block.text };
  if (block.type === "tool_call") return { type: "tool-call", id: block.id, name: block.name, arguments: typeof block.providerData?.dshArguments === "string" ? block.providerData.dshArguments : JSON.stringify(block.arguments) };
  if (block.type === "attachment") {
    const imported = block.providerData?.dshAttachment; if (typeof imported === "object" && imported !== null && !Array.isArray(imported)) return imported;
    return { type: "image", attachment: attachments.get(block.id) ?? { attachmentId: block.id, mediaType: block.mimeType ?? "application/octet-stream", bytes: 0, width: 0, height: 0, ...(block.name === undefined ? {} : { name: block.name }) } };
  }
  if (block.type === "image") return { type: "seal/inline-image", mediaType: block.mimeType, data: block.data };
  return block;
}

function surfaceMetadata(event: Extract<StoredSessionEvent["event"], { type: "message.appended" }>, seqs: ReadonlyMap<number, number>): Partial<DshWireEvent> {
  const surfaceOp = event.surfaceOp === undefined ? "append" : event.surfaceOp === "append" ? "append" : {
    op: "replace" as const,
    start: seqs.get(event.surfaceOp.start) ?? event.surfaceOp.start,
    end: seqs.get(event.surfaceOp.end) ?? event.surfaceOp.end,
  };
  const sources = event.sourceEventSeqs?.map((seq) => seqs.get(seq)).filter((seq): seq is number => seq !== undefined);
  return { surfaceOp, ...(sources === undefined ? {} : { sourceEventSeqs: sources }) };
}

function eventTime(stored: StoredSessionEvent): number {
  const parsed = Date.parse(stored.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}
