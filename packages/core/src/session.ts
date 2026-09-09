import type { AgentMessage } from "./content.js";
import type { MessageId, RunId, SessionId, ToolCallId, TurnId } from "./ids.js";
import type { JsonObject } from "./json.js";
import type { ModelRef, ModelUsage } from "./model.js";
import type { ToolResult } from "./tool.js";

export interface SessionEventMap {
  "session.created": {
    readonly cwd: string;
    readonly metadata?: JsonObject;
  };
  "session.forked": {
    readonly sourceSessionId: SessionId;
    readonly sourceVersion: number;
  };
  "run.started": {
    readonly runId: RunId;
    readonly model: ModelRef;
    readonly reasoning?: "off" | "low" | "medium" | "high" | "max";
    readonly maxTokens?: number;
  };
  "turn.started": {
    readonly runId: RunId;
    readonly turnId: TurnId;
  };
  "step.started": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly step: number;
  };
  "step.completed": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly step: number;
  };
  "request.header": {
    readonly header: {
      readonly config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: "off" | "low" | "medium" | "high" | "max"; readonly maxTokens?: number };
      readonly system?: string;
      readonly tools?: readonly import("./model.js").ModelToolDefinition[];
    };
    readonly reason: "initial" | "resume" | "change" | "series";
    readonly startsSeries?: boolean;
  };
  "request.context": {
    readonly provider: string;
    readonly model: string;
    readonly contextWindow?: number;
  };
  "assistant.chunk": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly step: number;
    readonly chunk: JsonObject;
  };
  "message.appended": {
    readonly messageId: MessageId;
    readonly runId?: RunId;
    readonly turnId?: TurnId;
    readonly message: AgentMessage;
  };
  "surface.removed": Record<string, never>;
  "tool.started": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly callId: ToolCallId;
    readonly name: string;
    readonly input: JsonObject;
  };
  "tool.completed": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly callId: ToolCallId;
    readonly name: string;
    readonly result: ToolResult;
  };
  "tool/code-dispatch-start": {
    readonly rootCallId: ToolCallId;
    readonly parentCallId: ToolCallId;
    readonly subCallId: ToolCallId;
    readonly name: string;
    readonly arguments: import("./json.js").JsonValue;
  };
  "tool/code-dispatch": {
    readonly rootCallId: ToolCallId;
    readonly parentCallId: ToolCallId;
    readonly subCallId: ToolCallId;
    readonly name: string;
    readonly arguments: import("./json.js").JsonValue;
    readonly isError: boolean;
    readonly content: readonly import("./content.js").ContentBlock[];
  };
  "turn.completed": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly usage?: ModelUsage;
    readonly timing?: { readonly firstTokenAt?: number };
    readonly stopReason?: import("./model.js").ModelStopReason;
    readonly outcome?: "completed" | "interrupted";
  };
  "run.completed": {
    readonly runId: RunId;
    readonly outcome: "completed" | "aborted" | "failed";
    readonly error?: string;
  };
  "session.metadata": {
    readonly patch: JsonObject;
  };
  "context.compacted": {
    readonly summaryMessage: AgentMessage;
    readonly sourceMessageCount: number;
    readonly retainedMessageCount: number;
  };
  "workflow.started": {
    readonly workflowId: string;
    readonly name: string;
  };
  "workflow.agent.started": {
    readonly workflowId: string;
    readonly sequence: number;
    readonly label: string;
    readonly childSessionId: SessionId;
    readonly phase?: string;
  };
  "workflow.agent.completed": {
    readonly workflowId: string;
    readonly sequence: number;
    readonly outcome: "completed" | "failed" | "aborted";
  };
  "workflow.completed": {
    readonly workflowId: string;
    readonly outcome: "completed" | "failed" | "aborted";
    readonly agentsStarted: number;
    readonly error?: string;
  };
  "schedule.changed": {
    readonly version: 1;
    readonly operation: "create" | "delete" | "dispatch";
    readonly id: string;
    readonly record?: {
      readonly kind: "after" | "at" | "every";
      readonly prompt: string;
      readonly scheduledAt: string;
      readonly intervalSeconds?: number;
    };
    readonly acceptedAt?: string;
  };
  "command.run": { readonly commandId: string; readonly name: string; readonly args?: string };
  "command.done": { readonly commandId: string; readonly kind: "success" | "error"; readonly text?: string };
  "feedback.recorded": { readonly text: string };
  "permission.preset": { readonly preset: string };
  "sandbox.mode": { readonly mode: import("./sandbox.js").SandboxMode };
  "approval.policy": { readonly policy: import("./permission.js").ApprovalPolicy };
  "agent-preset.selected": { readonly preset: string };
  /** Lossless log-only DSH seed record without a native Seal equivalent. */
  "dsh.imported": { readonly type: string; readonly data: JsonObject; readonly ignorable?: boolean; readonly time?: number };
  "agent/inbox.spliced": {
    readonly target: "next-turn" | "next-step";
    readonly start: number;
    readonly removedCount?: number;
    readonly inserted: readonly import("./content.js").UserMessage[];
    readonly outcome?: "canceled";
  };
  "team/member": {
    readonly teamId: SessionId;
    readonly memberId: SessionId;
    readonly name: string;
    readonly state: "provisioning" | "active" | "failed";
    readonly description: string;
    readonly context: "fresh" | "fork";
    readonly model?: ModelRef;
    readonly diagnostic?: string;
  };
  "team/message/queued": {
    readonly teamId: SessionId;
    readonly messageId: string;
    readonly from: string;
    readonly to: string;
    readonly content: readonly import("./content.js").ContentBlock[];
  };
  "team/message/delivered": { readonly teamId: SessionId; readonly messageId: string };
  "team/task": { readonly teamId: SessionId; readonly task: Omit<import("./team.js").TeamTaskView, "ready" | "writeScopeWarnings"> };
}

export type SessionEventType = keyof SessionEventMap;
export type SessionSurfaceEventType = "message.appended" | "context.compacted" | "surface.removed" | "dsh.imported";
export type SessionSurfaceOp = "append" | { readonly op: "replace"; readonly start: number; readonly end: number };
export type SessionEvent = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventMap[K];
    readonly surfaceOp?: SessionSurfaceOp;
    readonly sourceEventSeqs?: readonly number[];
  }
}[SessionEventType];

export interface StoredSessionEvent {
  readonly sequence: number;
  readonly timestamp: string;
  readonly event: SessionEvent;
}

export interface SessionSnapshot {
  readonly id: SessionId;
  readonly version: number;
  readonly events: readonly StoredSessionEvent[];
}

export interface CreateSessionRequest {
  readonly id: SessionId;
  readonly cwd: string;
  readonly metadata?: JsonObject;
  /** Events committed atomically after session.created during creation. */
  readonly initialEvents?: readonly SessionEvent[];
}

export interface AppendSessionRequest {
  readonly id: SessionId;
  readonly expectedVersion: number;
  readonly events: readonly SessionEvent[];
}

export interface ForkSessionRequest {
  readonly sourceId: SessionId;
  readonly targetId: SessionId;
  readonly throughVersion?: number;
  /** Optional child creation metadata replacing the source Session metadata. */
  readonly metadata?: JsonObject;
}

export class SessionConflictError extends Error {
  override readonly name = "SessionConflictError";

  constructor(
    readonly sessionId: SessionId,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Session ${sessionId} version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
    );
  }
}

export class SessionNotFoundError extends Error {
  override readonly name = "SessionNotFoundError";

  constructor(readonly sessionId: SessionId) {
    super(`Session not found: ${sessionId}`);
  }
}

export class SessionAlreadyExistsError extends Error {
  override readonly name = "SessionAlreadyExistsError";

  constructor(readonly sessionId: SessionId) {
    super(`Session already exists: ${sessionId}`);
  }
}

export const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";
export const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";

/** Build deterministic synthetic events that make an interrupted run safe to resume. */
export function interruptedSessionClosers(session: SessionSnapshot): SessionEvent[] {
  const runs = new Map<RunId, { turnId?: TurnId; step?: number }>();
  const calls = new Map<ToolCallId, { runId: RunId; turnId: TurnId; name: string; startedSequence?: number }>();
  for (const stored of session.events) {
    const event = stored.event;
    if (event.type === "run.started") runs.set(event.payload.runId, {});
    else if (event.type === "run.completed") { runs.delete(event.payload.runId); for (const [id, call] of calls) if (call.runId === event.payload.runId) calls.delete(id); }
    else if (event.type === "turn.started") runs.set(event.payload.runId, { turnId: event.payload.turnId });
    else if (event.type === "step.started") runs.set(event.payload.runId, { turnId: event.payload.turnId, step: event.payload.step });
    else if (event.type === "step.completed") runs.set(event.payload.runId, { turnId: event.payload.turnId });
    else if (event.type === "turn.completed") { const run = runs.get(event.payload.runId); if (run !== undefined) runs.set(event.payload.runId, {}); }
    else if (event.type === "message.appended" && event.payload.runId !== undefined && event.payload.turnId !== undefined && event.payload.message.role === "assistant") {
      for (const block of event.payload.message.content) if (block.type === "tool_call") calls.set(block.id, { runId: event.payload.runId, turnId: event.payload.turnId, name: block.name });
    } else if (event.type === "tool.started") {
      const prior = calls.get(event.payload.callId); calls.set(event.payload.callId, { runId: event.payload.runId, turnId: event.payload.turnId, name: event.payload.name, ...(prior ?? {}), startedSequence: stored.sequence });
    } else if (event.type === "tool.completed") calls.delete(event.payload.callId);
  }
  const events: SessionEvent[] = [];
  for (const [runId, run] of runs) {
    for (const [callId, call] of calls) {
      if (call.runId !== runId) continue;
      const started = call.startedSequence !== undefined; const code = started ? TOOL_OUTCOME_UNKNOWN : TOOL_NOT_STARTED;
      const result: ToolResult = { isError: true, details: { recovered: true, code }, content: [{ type: "text", text: started ? "The tool call was interrupted after it started, but no result was durably recorded. Its outcome is unknown; verify external state before retrying a non-idempotent operation." : "The tool call was interrupted before it was recorded as started. Retry it if it is still needed." }] };
      events.push({ type: "tool.completed", payload: { runId, turnId: call.turnId, callId, name: call.name, result } });
      events.push({ type: "message.appended", payload: { messageId: `interrupted-tool-result-${callId}-${session.version + events.length + 1}` as MessageId, runId, turnId: call.turnId, message: { role: "tool", callId, name: call.name, content: result.content, isError: true } }, surfaceOp: "append", ...(call.startedSequence === undefined ? {} : { sourceEventSeqs: [call.startedSequence] }) });
    }
    if (run.turnId !== undefined) {
      if (run.step !== undefined) events.push({ type: "step.completed", payload: { runId, turnId: run.turnId, step: run.step } });
      events.push({ type: "turn.completed", payload: { runId, turnId: run.turnId, outcome: "interrupted" } });
    }
    events.push({ type: "run.completed", payload: { runId, outcome: "aborted", error: "Recovered an interrupted run" } });
  }
  return events;
}

export interface SessionStore {
  /** Remove a session from storage. Returns false if it does not exist. */
  delete?(id: SessionId): Promise<boolean>;
  create(request: CreateSessionRequest): Promise<SessionSnapshot>;
  read(id: SessionId): Promise<SessionSnapshot | undefined>;
  append(request: AppendSessionRequest): Promise<SessionSnapshot>;
  fork(request: ForkSessionRequest): Promise<SessionSnapshot>;
  list(): Promise<readonly SessionSnapshot[]>;
  /** Resolve a backend-owned per-session artifact without materializing it. */
  locate?(id: SessionId): { readonly kind: string; readonly path: string } | undefined;
  /** Read the backend's exact decoded artifact text together with its parsed snapshot. */
  readRaw?(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>;
}

export interface SessionRawArtifact {
  readonly filename: string;
  readonly content: string;
  readonly snapshot: SessionSnapshot;
}

export function deriveSessionMessages(session: SessionSnapshot): AgentMessage[] {
  const bySequence = new Map(session.events.map((stored) => [stored.sequence, stored]));
  return foldSessionSurface(session.events).nodes.flatMap((sequence) => {
    const event = bySequence.get(sequence)?.event;
    if (event?.type === "message.appended") return [event.payload.message];
    if (event?.type === "context.compacted") return [event.payload.summaryMessage];
    if (event?.type === "dsh.imported") return [];
    throw new Error(`Session surface references invalid event at sequence ${sequence}`);
  });
}

export function foldSessionInbox(events: readonly StoredSessionEvent[]): { readonly nextTurn: readonly import("./content.js").UserMessage[]; readonly nextStep: readonly import("./content.js").UserMessage[] } {
  const nextTurn: import("./content.js").UserMessage[] = []; const nextStep: import("./content.js").UserMessage[] = [];
  for (const { event } of events) {
    if (event.type !== "agent/inbox.spliced") continue;
    const target = event.payload.target === "next-turn" ? nextTurn : nextStep;
    if (!Number.isSafeInteger(event.payload.start) || event.payload.start < 0 || event.payload.start > target.length) throw new Error(`Invalid inbox splice start ${event.payload.start}`);
    const removedCount = event.payload.removedCount ?? 0;
    if (!Number.isSafeInteger(removedCount) || removedCount < 0 || removedCount > target.length - event.payload.start) throw new Error(`Invalid inbox splice removedCount ${removedCount}`);
    const retainedIds = new Set([...nextTurn, ...nextStep].map((message) => message.id));
    for (const removed of target.slice(event.payload.start, event.payload.start + removedCount)) retainedIds.delete(removed.id);
    for (const inserted of event.payload.inserted) { if (inserted.id === undefined) throw new Error("Inbox splice inserted a message without id"); if (retainedIds.has(inserted.id)) throw new Error(`Duplicate inbox message id: ${inserted.id}`); retainedIds.add(inserted.id); }
    target.splice(event.payload.start, removedCount, ...structuredClone(event.payload.inserted));
  }
  return { nextTurn, nextStep };
}

export interface SessionSurfaceReplacement { readonly sequence: number; readonly start: number; readonly end: number; readonly shadowedSequences: readonly number[] }
export interface SessionSurfaceProjection { readonly nodes: readonly number[]; readonly replaceGeneration: number; readonly replacements: readonly SessionSurfaceReplacement[] }

/** Fold and validate the model-visible projection of an append-only Session log. */
export function foldSessionSurface(events: readonly StoredSessionEvent[]): SessionSurfaceProjection {
  const nodes: number[] = []; const replacements: SessionSurfaceReplacement[] = [];
  for (const [index, stored] of events.entries()) {
    const expected = index + 1;
    if (stored.sequence !== expected) throw new Error(`Session event sequence ${stored.sequence} is not contiguous; expected ${expected}`);
    const event = stored.event; const eligible = event.type === "message.appended" || event.type === "context.compacted" || event.type === "surface.removed" || (event.type === "dsh.imported" && (event.surfaceOp !== undefined || event.sourceEventSeqs !== undefined));
    if (!eligible) {
      if (event.surfaceOp !== undefined || event.sourceEventSeqs !== undefined) throw new Error(`Session event ${event.type} is not surface-eligible`);
      continue;
    }
    if (event.surfaceOp === undefined && event.type === "context.compacted") {
      const retained = event.payload.retainedMessageCount;
      if (!Number.isSafeInteger(retained) || retained < 0 || retained > nodes.length) throw new Error(`Invalid retainedMessageCount ${retained} at sequence ${stored.sequence}`);
      const cutoff = nodes.length - retained; const shadowed = nodes.slice(0, cutoff);
      if (shadowed.length === 0) nodes.push(stored.sequence);
      else { nodes.splice(0, cutoff, stored.sequence); replacements.push({ sequence: stored.sequence, start: shadowed[0]!, end: shadowed.at(-1)!, shadowedSequences: shadowed }); }
      continue;
    }
    const op = event.surfaceOp ?? "append";
    if (event.type === "surface.removed" && op === "append") throw new Error("surface.removed requires a replace operation");
    validateSources(event, stored.sequence, []);
    if (op === "append") { nodes.push(stored.sequence); continue; }
    if (op === null || typeof op !== "object" || op.op !== "replace" || !validSequence(op.start) || !validSequence(op.end)) throw new Error(`Invalid surface replacement at sequence ${stored.sequence}`);
    const startIndex = nodes.indexOf(op.start); const endIndex = nodes.indexOf(op.end);
    if (startIndex < 0) throw new Error(`Surface replace start sequence ${op.start} is not current`);
    if (endIndex < 0) throw new Error(`Surface replace end sequence ${op.end} is not current`);
    if (startIndex > endIndex) throw new Error(`Surface replace start ${op.start} is after end ${op.end}`);
    const shadowed = nodes.slice(startIndex, endIndex + 1); validateSources(event, stored.sequence, shadowed);
    nodes.splice(startIndex, shadowed.length, ...(event.type === "surface.removed" ? [] : [stored.sequence]));
    replacements.push({ sequence: stored.sequence, start: op.start, end: op.end, shadowedSequences: shadowed });
  }
  return { nodes, replaceGeneration: replacements.length, replacements };
}

/** Validate a prospective append against the exact surface state it will extend. */
export function assertSessionSurfaceAppend(current: SessionSnapshot, events: readonly SessionEvent[]): void {
  foldSessionSurface([...current.events, ...events.map((event, index) => ({ sequence: current.version + index + 1, timestamp: "", event }))]);
}

/** Materialize a forked transcript while remapping every sequence-bearing surface reference. */
export function materializeForkEvents(source: SessionSnapshot, throughVersion = source.version, metadata?: JsonObject): SessionEvent[] {
  if (throughVersion < 1 || throughVersion > source.version) throw new RangeError(`Invalid fork version ${throughVersion} for session ${source.id}`);
  const selected = source.events.slice(0, throughVersion);
  const created = selected.find((entry) => entry.event.type === "session.created");
  if (created?.event.type !== "session.created") throw new Error(`Source session has no creation event: ${source.id}`);
  const copiedSequences = new Set(selected.filter((entry) => entry.event.type === "message.appended" || entry.event.type === "context.compacted" || entry.event.type === "surface.removed" || entry.event.type === "session.metadata").map((entry) => entry.sequence));
  const selectedBySequence = new Map(selected.map((entry) => [entry.sequence, entry]));
  const pendingSources = [...copiedSequences];
  while (pendingSources.length > 0) {
    const source = selectedBySequence.get(pendingSources.pop()!)?.event.sourceEventSeqs;
    if (source === undefined) continue;
    for (const sequence of source) if (!copiedSequences.has(sequence) && selectedBySequence.has(sequence)) { copiedSequences.add(sequence); pendingSources.push(sequence); }
  }
  const copied = selected.filter((entry) => copiedSequences.has(entry.sequence));
  const sequenceMap = new Map(copied.map((entry, index) => [entry.sequence, index + 3]));
  const remap = (sequence: number): number => { const mapped = sequenceMap.get(sequence); if (mapped === undefined) throw new Error(`Fork surface reference ${sequence} is not present in the copied transcript`); return mapped; };
  const transcript = copied.map(({ event }): SessionEvent => {
    if (event.surfaceOp === undefined && event.sourceEventSeqs === undefined) return structuredClone(event);
    const surfaceOp = typeof event.surfaceOp === "object" ? { op: "replace" as const, start: remap(event.surfaceOp.start), end: remap(event.surfaceOp.end) } : event.surfaceOp;
    return { ...structuredClone(event), ...(surfaceOp === undefined ? {} : { surfaceOp }), ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs.map(remap) }) } as SessionEvent;
  });
  const creation = structuredClone(created.event.payload);
  const result: SessionEvent[] = [{ type: "session.created", payload: { ...creation, ...(metadata === undefined ? {} : { metadata: structuredClone(metadata) }) } }, { type: "session.forked", payload: { sourceSessionId: source.id, sourceVersion: throughVersion } }, ...transcript];
  foldSessionSurface(result.map((event, index) => ({ sequence: index + 1, timestamp: "", event })));
  return result;
}

function validSequence(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function validateSources(event: SessionEvent, sequence: number, shadowed: readonly number[]): void {
  const raw = event.sourceEventSeqs; if (raw === undefined) { if (shadowed.length > 0) throw new Error("Surface replacement must cite every shadowed sequence"); return; }
  if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs at sequence ${sequence} must be an array`);
  if (raw.length === 0) throw new Error(`sourceEventSeqs at sequence ${sequence} must not be empty`);
  const sources = new Set<number>();
  for (const source of raw) { if (!validSequence(source) || source >= sequence) throw new Error(`sourceEventSeqs must reference earlier events at sequence ${sequence}`); if (sources.has(source)) throw new Error(`sourceEventSeqs must not contain duplicates at sequence ${sequence}`); sources.add(source); }
  const missing = shadowed.filter((source) => !sources.has(source)); if (missing.length > 0) throw new Error(`Surface replacement is missing source sequences: ${missing.join(", ")}`);
}
