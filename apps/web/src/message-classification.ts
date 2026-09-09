import type { StoredSessionEvent } from "@seal-harness/core";

/** Find user messages admitted from the active-turn inbox. */
export function steeringMessageSequences(events: readonly StoredSessionEvent[]): ReadonlySet<number> {
  const pending: string[] = [];
  let currentClaimed = new Set<string>();
  const steering = new Set<number>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "agent/inbox.spliced" && event.payload.target === "next-step") {
      const inserted = event.payload.inserted.map((message) => String(message.id));
      const removedCount = event.payload.removedCount ?? 0;
      if (removedCount > 0 && event.payload.outcome !== "canceled") {
        const removed = pending.splice(event.payload.start, removedCount, ...inserted);
        currentClaimed = new Set(removed);
      } else {
        pending.splice(event.payload.start, removedCount, ...inserted);
        for (const id of inserted) currentClaimed.delete(id);
      }
      continue;
    }
    if (event.type !== "message.appended" || event.payload.message.role !== "user") continue;
    const id = event.payload.message.id;
    if (id !== undefined && currentClaimed.has(String(id))) steering.add(entry.sequence);
  }
  return steering;
}

/** Associate a direct user row with an immediately following session recall. */
export function referenceLabelsByMessageSequence(events: readonly StoredSessionEvent[], surfaceNodes: readonly number[]): ReadonlyMap<number, readonly string[]> {
  const bySequence = new Map(events.map((entry) => [entry.sequence, entry.event]));
  const labels = new Map<number, readonly string[]>();
  for (let index = 0; index + 1 < surfaceNodes.length; index += 1) {
    const sequence = surfaceNodes[index]!; const nextSequence = surfaceNodes[index + 1]!;
    const event = bySequence.get(sequence); const next = bySequence.get(nextSequence);
    if (event?.type !== "message.appended" || event.payload.message.role !== "user") continue;
    if (event.payload.message.source?.kind !== "user" && event.payload.message.source?.kind !== "user-rpc") continue;
    if (next?.type !== "message.appended" || next.payload.message.role !== "user") continue;
    const source = next.payload.message.source;
    if (source?.kind !== "session-reference" || !Array.isArray(source.references)) continue;
    const values = source.references.map((reference) => typeof reference === "object" && reference !== null && !Array.isArray(reference) ? (reference as Record<string, unknown>).label : undefined);
    if (values.length > 0 && values.every((label): label is string => typeof label === "string" && label.length > 0)) labels.set(sequence, values);
  }
  return labels;
}

export interface CommandMessageView {
  readonly role: "command";
  readonly commandId: string;
  readonly name: string;
  readonly args?: string;
  readonly outcome: null | { readonly kind: "success" | "error"; readonly text?: string };
  readonly compaction?: CompactionMessageView;
}

export interface TurnErrorMessageView {
  readonly role: "turn-error";
  readonly runId?: string;
  readonly turnId: string;
  readonly message: string;
  readonly code?: string;
}

export interface ModelRetryMessageView {
  readonly role: "model-retry";
  readonly retryId: string;
  readonly turn: number;
  readonly step: number;
  readonly provider: string;
  readonly mode: string;
  readonly retry: number;
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly failure: { readonly code: string; readonly message: string };
  readonly retryState: "scheduled" | "started" | "cancelled";
}

export interface SystemPromptMessageView { readonly role: "system-prompt"; readonly text: string }
export interface TurnMaxTokensMessageView { readonly role: "turn-max-tokens" }
export interface TurnTailMessageView { readonly role: "turn-tail"; readonly turnId: string }
export interface CompactionMessageView {
  readonly role: "compaction";
  readonly summary: string | null;
  readonly shadowedItemCount: number | null;
  readonly shadowedTokenCount: number | null;
}
export interface UnknownSurfaceMessageView { readonly role: "unknown-surface"; readonly type: string; readonly data: unknown }
export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface WorkflowRunMessageView {
  readonly role: "workflow-run";
  readonly workflowId: string;
  readonly name: string;
  readonly status: WorkflowRunStatus;
  readonly phases: readonly { readonly key: string; readonly phase: string | null; readonly members: readonly { readonly sequence: number; readonly label: string; readonly childSessionId: string; readonly status: WorkflowRunStatus }[] }[];
}

/** Fold command run/done pairs into nodes anchored at their run sequence. */
export function commandMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, CommandMessageView> {
  const sequenceById = new Map<string, number>(); const views = new Map<number, CommandMessageView>(); const summaries = new Map<string, CompactionMessageView>(); const checkpoints = new Map<string, number>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "command.run") {
      sequenceById.set(event.payload.commandId, entry.sequence);
      views.set(entry.sequence, { role: "command", commandId: event.payload.commandId, name: event.payload.name, ...(event.payload.args === undefined ? {} : { args: event.payload.args }), outcome: null });
    } else if (event.type === "command.done") {
      const sequence = sequenceById.get(event.payload.commandId); const current = sequence === undefined ? undefined : views.get(sequence);
      if (sequence !== undefined && current !== undefined) views.set(sequence, { ...current, outcome: { kind: event.payload.kind, ...(event.payload.text === undefined ? {} : { text: event.payload.text }) } });
    } else if (event.type === "dsh.imported" && event.payload.type === "compaction/summary") {
      const data = event.payload.data;
      if (typeof data.sourceCommandId !== "string" || !Array.isArray(data.summary)) continue;
      const summary = data.summary.map((block) => typeof block === "object" && block !== null && !Array.isArray(block) && block.type === "text" && typeof block.text === "string" ? block.text : "").join("");
      summaries.set(data.sourceCommandId, { role: "compaction", summary: summary.trim() === "" ? null : summary, shadowedItemCount: Array.isArray(data.shadowedSeqs) && data.shadowedSeqs.every((seq) => Number.isSafeInteger(seq) && (seq as number) >= 0) ? data.shadowedSeqs.length : null, shadowedTokenCount: Number.isSafeInteger(data.shadowedTokenCount) && (data.shadowedTokenCount as number) >= 0 ? data.shadowedTokenCount as number : null });
    } else if (event.type === "message.appended" && event.payload.message.role === "user") {
      const source = event.payload.message.source;
      if (source?.kind !== "plugin") continue;
      const record = source as unknown as Record<string, unknown>;
      if (record.plugin === "compact" && typeof record.sourceCommandId === "string") checkpoints.set(record.sourceCommandId, entry.sequence);
    }
  }
  for (const [commandId, checkpoint] of checkpoints) {
    const sequence = sequenceById.get(commandId); const command = sequence === undefined ? undefined : views.get(sequence);
    if (sequence === undefined || command?.name !== "compact") continue;
    views.delete(sequence); views.set(checkpoint, { ...command, compaction: summaries.get(commandId) ?? { role: "compaction", summary: null, shadowedItemCount: null, shadowedTokenCount: null } });
  }
  return views;
}

/** Project failed runs onto the most recent turn owned by that run. */
export function turnErrorMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, TurnErrorMessageView> {
  const latestTurn = new Map<string, string>(); const views = new Map<number, TurnErrorMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "turn.started") latestTurn.set(String(event.payload.runId), String(event.payload.turnId));
    else if (event.type === "run.completed" && event.payload.outcome === "failed" && typeof event.payload.error === "string" && event.payload.error.length > 0) {
      const runId = String(event.payload.runId); const turnId = latestTurn.get(runId);
      if (turnId !== undefined) views.set(entry.sequence, { role: "turn-error", runId, turnId, message: event.payload.error });
    }
    else if (event.type === "dsh.imported" && event.payload.type === "turn/end" && Number.isSafeInteger(event.payload.data.turn)) {
      const reason = event.payload.data.reason;
      if (typeof reason !== "object" || reason === null || Array.isArray(reason) || (reason as Record<string, unknown>).kind !== "error") continue;
      const failure = (reason as Record<string, unknown>).error; const record = typeof failure === "object" && failure !== null && !Array.isArray(failure) ? failure as Record<string, unknown> : undefined;
      const code = typeof record?.code === "string" ? record.code : undefined; const message = code === "AUTH" ? "" : typeof record?.message === "string" ? record.message : failure === null || typeof failure !== "object" ? String(failure) : JSON.stringify(failure);
      views.set(entry.sequence, { role: "turn-error", turnId: `dsh-turn-${event.payload.data.turn as number}`, message, ...(code === undefined ? {} : { code }) });
    }
  }
  return views;
}

/** Fold losslessly imported DSH retry lifecycle events by producer retry id. */
export function modelRetryMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, ModelRetryMessageView> {
  const anchorById = new Map<string, number>(); const views = new Map<number, ModelRetryMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "dsh.imported" && event.payload.type === "llm/retry") {
      const data = event.payload.data; const failure = data.failure;
      if (typeof data.retryId !== "string" || data.retryId.length === 0 || !Number.isSafeInteger(data.turn) || !Number.isSafeInteger(data.step) || typeof data.provider !== "string" || typeof data.mode !== "string" || !Number.isSafeInteger(data.retry) || !Number.isSafeInteger(data.maxRetries) || typeof data.delayMs !== "number" || !Number.isFinite(data.delayMs) || data.delayMs < 0 || typeof failure !== "object" || failure === null || Array.isArray(failure)) continue;
      const record = failure as Record<string, unknown>;
      if (typeof record.code !== "string" || typeof record.message !== "string") continue;
      const anchor = anchorById.get(data.retryId) ?? entry.sequence; anchorById.set(data.retryId, anchor);
      views.set(anchor, { role: "model-retry", retryId: data.retryId, turn: data.turn as number, step: data.step as number, provider: data.provider, mode: data.mode, retry: data.retry as number, maxRetries: data.maxRetries as number, delayMs: data.delayMs, failure: { code: record.code, message: record.message }, retryState: "scheduled" });
    } else if (event.type === "dsh.imported" && event.payload.type === "llm/retry-started") {
      const data = event.payload.data; if (typeof data.retryId !== "string" || !Number.isSafeInteger(data.retry)) continue;
      const anchor = anchorById.get(data.retryId); const current = anchor === undefined ? undefined : views.get(anchor);
      if (anchor !== undefined && current !== undefined && current.retry === data.retry) views.set(anchor, { ...current, retryState: "started" });
    } else if (event.type === "run.completed") {
      for (const [anchor, current] of views) if (current.retryState === "scheduled") views.set(anchor, { ...current, retryState: "cancelled" });
    }
  }
  return views;
}

/** Project complete native or imported request headers using DSH visibility rules. */
export function systemPromptMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, SystemPromptMessageView> {
  const views = new Map<number, SystemPromptMessageView>(); let previous: { system: string; tools: unknown[] } | undefined;
  let nativeTurnAnchor: number | undefined; let nativePrompted = false;
  let importedTurn: number | undefined; let importedTurnAnchor: number | undefined; let importedStep: number | undefined; let importedStepAnchor: number | undefined; let previousImportedLocation: string | undefined;
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "turn.started") { nativeTurnAnchor = entry.sequence; nativePrompted = false; }
    else if (event.type === "turn.completed") { nativeTurnAnchor = undefined; nativePrompted = false; }
    else if (event.type === "dsh.imported" && event.payload.type === "turn/start" && Number.isSafeInteger(event.payload.data.turn)) { importedTurn = event.payload.data.turn as number; importedTurnAnchor = entry.sequence; importedStep = undefined; importedStepAnchor = undefined; }
    else if (event.type === "dsh.imported" && event.payload.type === "step/start" && Number.isSafeInteger(event.payload.data.turn) && Number.isSafeInteger(event.payload.data.step)) { importedTurn = event.payload.data.turn as number; importedStep = event.payload.data.step as number; importedStepAnchor = entry.sequence; }
    else if (event.type === "dsh.imported" && event.payload.type === "turn/end") { importedTurn = undefined; importedTurnAnchor = undefined; importedStep = undefined; importedStepAnchor = undefined; }
    const payload = event.type === "request.header" ? event.payload : event.type === "dsh.imported" && event.payload.type === "request/header" ? event.payload.data : undefined;
    if (payload === undefined || typeof payload.header !== "object" || payload.header === null || Array.isArray(payload.header)) continue;
    const header = payload.header as Record<string, unknown>; const system = header.system === undefined ? "" : header.system; const tools = header.tools === undefined ? [] : header.tools;
    if (typeof system !== "string" || !Array.isArray(tools) || typeof payload.reason !== "string") continue;
    const systemChanged = previous !== undefined && previous.system !== system; const toolsChanged = previous !== undefined && JSON.stringify(previous.tools) !== JSON.stringify(tools);
    const shows = previous === undefined || payload.reason !== "change" || payload.startsSeries === true || systemChanged || (systemChanged && toolsChanged);
    let anchor = entry.sequence;
    if (event.type === "request.header" && nativeTurnAnchor !== undefined && !nativePrompted && (previous !== undefined || payload.reason === "initial")) anchor = nativeTurnAnchor;
    else if (event.type === "dsh.imported" && importedTurn !== undefined && importedStep !== undefined) {
      const location = `${importedTurn}:${importedStep}`;
      if (!(previous === undefined && payload.reason !== "initial") && previousImportedLocation !== location) anchor = importedStep === 1 ? importedTurnAnchor ?? importedStepAnchor ?? entry.sequence : importedStepAnchor ?? entry.sequence;
      previousImportedLocation = location;
    }
    if (shows && system !== "") views.set(anchor, { role: "system-prompt", text: system });
    if (event.type === "request.header") nativePrompted = true;
    previous = { system, tools };
  }
  return views;
}

/** Project native and imported output-token-cap turn endings as standalone notices. */
export function turnMaxTokensMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, TurnMaxTokensMessageView> {
  const views = new Map<number, TurnMaxTokensMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "turn.completed" && event.payload.stopReason === "length") views.set(entry.sequence, { role: "turn-max-tokens" });
    else if (event.type === "dsh.imported" && event.payload.type === "turn/end") {
      const reason = event.payload.data.reason;
      if (typeof reason === "object" && reason !== null && !Array.isArray(reason) && (reason as Record<string, unknown>).kind === "max-tokens") views.set(entry.sequence, { role: "turn-max-tokens" });
    }
  }
  return views;
}

/** Keep completed turns observable even when no Assistant message can own their footer. */
export function turnTailMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, TurnTailMessageView> {
  const assistantTurns = new Set<string>(); const views = new Map<number, TurnTailMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "message.appended" && event.payload.message.role === "assistant" && event.payload.turnId !== undefined) assistantTurns.add(String(event.payload.turnId));
    else if (event.type === "turn.completed") {
      const turnId = String(event.payload.turnId); if (!assistantTurns.has(turnId)) views.set(entry.sequence, { role: "turn-tail", turnId });
    }
    else if (event.type === "dsh.imported" && event.payload.type === "turn/end" && Number.isSafeInteger(event.payload.data.turn)) {
      const turnId = `dsh-turn-${event.payload.data.turn as number}`; if (!assistantTurns.has(turnId)) views.set(entry.sequence, { role: "turn-tail", turnId });
    }
  }
  return views;
}

/** Project native checkpoints and complete imported DSH automatic compactions. */
export function compactionMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, CompactionMessageView> {
  const views = new Map<number, CompactionMessageView>();
  const imported = new Map<string, CompactionMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "context.compacted") {
      const summary = event.payload.summaryMessage.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
      views.set(entry.sequence, { role: "compaction", summary: summary.trim() === "" ? null : summary, shadowedItemCount: Math.max(0, event.payload.sourceMessageCount - event.payload.retainedMessageCount), shadowedTokenCount: null });
      continue;
    }
    if (event.type === "dsh.imported" && event.payload.type === "compaction/summary") {
      const data = event.payload.data;
      if (typeof data.compactionId !== "string" || data.compactionId === "" || data.sourceCommandId !== undefined || !Array.isArray(data.summary)) continue;
      const summary = data.summary.map((block) => typeof block === "object" && block !== null && !Array.isArray(block) && block.type === "text" && typeof block.text === "string" ? block.text : "").join("");
      const seqs = data.shadowedSeqs; const tokens = data.shadowedTokenCount;
      imported.set(data.compactionId, { role: "compaction", summary: summary.trim() === "" ? null : summary, shadowedItemCount: Array.isArray(seqs) && seqs.every((seq) => Number.isSafeInteger(seq) && (seq as number) >= 0) ? seqs.length : null, shadowedTokenCount: Number.isSafeInteger(tokens) && (tokens as number) >= 0 ? tokens as number : null });
      continue;
    }
    if (event.type !== "message.appended" || event.payload.message.role !== "user") continue;
    const source = event.payload.message.source;
    if (source?.kind !== "plugin") continue;
    const record = source as unknown as Record<string, unknown>;
    if (record.plugin !== "compact" || typeof record.compactionId !== "string" || record.sourceCommandId !== undefined) continue;
    const view = imported.get(record.compactionId); if (view !== undefined) views.set(entry.sequence, view);
  }
  return views;
}

/** Preserve plugin-defined DSH surface entries that no installed renderer claims. */
export function unknownSurfaceMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, UnknownSurfaceMessageView> {
  const views = new Map<number, UnknownSurfaceMessageView>();
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "dsh.imported" && event.surfaceOp !== undefined) views.set(entry.sequence, { role: "unknown-surface", type: event.payload.type, data: event.payload.data });
  }
  return views;
}

/** Fold native and imported workflow audit families into one node per run. */
export function workflowRunMessageViews(events: readonly StoredSessionEvent[]): ReadonlyMap<number, WorkflowRunMessageView> {
  type Member = { sequence: number; label: string; childSessionId: string; phase: string | null; status: WorkflowRunStatus };
  type State = { anchor: number; id: string; name: string; status: WorkflowRunStatus; turnKey?: string; turnClosed: boolean; members: Member[] };
  const states = new Map<string, State>();
  let nativeTurnKey: string | undefined; let importedTurnKey: string | undefined;
  const status = (value: unknown): WorkflowRunStatus => value === "completed" ? "completed" : value === "failed" || value === "error" ? "failed" : value === "aborted" || value === "cancelled" ? "cancelled" : "running";
  for (const entry of events) {
    const event = entry.event;
    if (event.type === "turn.started") nativeTurnKey = `native:${event.payload.turnId}`;
    else if (event.type === "turn.completed") {
      const key = `native:${event.payload.turnId}`; for (const state of states.values()) if (state.turnKey === key) state.turnClosed = true;
      if (nativeTurnKey === key) nativeTurnKey = undefined;
    } else if (event.type === "dsh.imported" && event.payload.type === "turn/start" && Number.isSafeInteger(event.payload.data.turn)) importedTurnKey = `imported:${event.payload.data.turn}`;
    else if (event.type === "dsh.imported" && event.payload.type === "turn/end" && Number.isSafeInteger(event.payload.data.turn)) {
      const key = `imported:${event.payload.data.turn}`; for (const state of states.values()) if (state.turnKey === key) state.turnClosed = true;
      if (importedTurnKey === key) importedTurnKey = undefined;
    }
    if (event.type === "workflow.started") states.set(event.payload.workflowId, { anchor: entry.sequence, id: event.payload.workflowId, name: event.payload.name, status: "running", ...(nativeTurnKey === undefined ? {} : { turnKey: nativeTurnKey }), turnClosed: false, members: [] });
    else if (event.type === "workflow.agent.started") {
      const state = states.get(event.payload.workflowId); if (state !== undefined) state.members.push({ sequence: event.payload.sequence, label: event.payload.label, childSessionId: event.payload.childSessionId, phase: event.payload.phase ?? null, status: "running" });
    } else if (event.type === "workflow.agent.completed") {
      const state = states.get(event.payload.workflowId); const member = state?.members.find((candidate) => candidate.sequence === event.payload.sequence); if (member !== undefined) member.status = status(event.payload.outcome);
    } else if (event.type === "workflow.completed") {
      const state = states.get(event.payload.workflowId); if (state !== undefined) state.status = status(event.payload.outcome);
    } else if (event.type === "dsh.imported") {
      const data = event.payload.data; const id = typeof data.runId === "string" ? data.runId : undefined;
      if (event.payload.type === "tool-workflow/run-start" && id !== undefined && typeof data.name === "string") states.set(id, { anchor: entry.sequence, id, name: data.name, status: "running", ...(importedTurnKey === undefined ? {} : { turnKey: importedTurnKey }), turnClosed: false, members: [] });
      else if (event.payload.type === "tool-workflow/agent-start" && id !== undefined) {
        const state = states.get(id); if (state !== undefined && Number.isSafeInteger(data.seq) && typeof data.label === "string" && typeof data.childId === "string") state.members.push({ sequence: data.seq as number, label: data.label, childSessionId: data.childId, phase: typeof data.phase === "string" ? data.phase : null, status: "running" });
      } else if (event.payload.type === "tool-workflow/agent-end" && id !== undefined) {
        const state = states.get(id); const member = state?.members.find((candidate) => candidate.sequence === data.seq); if (member !== undefined) member.status = status(data.outcome);
      } else if (event.payload.type === "tool-workflow/run-end" && id !== undefined) {
        const state = states.get(id); if (state !== undefined) state.status = status(data.stopReason);
      }
    }
  }
  const views = new Map<number, WorkflowRunMessageView>();
  for (const state of states.values()) {
    const interrupted = state.status === "running" && state.turnClosed;
    const groups = new Map<string, { key: string; phase: string | null; members: Member[] }>();
    for (const member of state.members) { const key = member.phase === null ? "missing" : `value:${member.phase.length}:${member.phase}`; const group = groups.get(key) ?? { key, phase: member.phase, members: [] }; group.members.push(member); groups.set(key, group); }
    views.set(state.anchor, { role: "workflow-run", workflowId: state.id, name: state.name, status: interrupted ? "interrupted" : state.status, phases: [...groups.values()].map((group) => ({ ...group, members: group.members.map(({ phase: _phase, ...member }) => ({ ...member, status: interrupted && member.status === "running" ? "interrupted" : member.status })) })) });
  }
  return views;
}

/** Replay the visible transcript while retaining non-surface command anchors. */
export function transcriptNodeSequences(events: readonly StoredSessionEvent[]): readonly number[] {
  const nodes: number[] = []; const runsWithTurns = new Set<string>(); const commandAnchors = new Set(commandMessageViews(events).keys()); const workflowAnchors = new Set(workflowRunMessageViews(events).keys()); const retryAnchors = new Set(modelRetryMessageViews(events).keys()); const promptAnchors = new Set(systemPromptMessageViews(events).keys()); const maxTokenAnchors = new Set(turnMaxTokensMessageViews(events).keys()); const tailAnchors = new Set(turnTailMessageViews(events).keys());
  for (const entry of events) {
    const event = entry.event;
    if (promptAnchors.has(entry.sequence)) { nodes.push(entry.sequence); if (event.type === "turn.started") runsWithTurns.add(String(event.payload.runId)); continue; }
    if (event.type === "turn.started") { runsWithTurns.add(String(event.payload.runId)); continue; }
    if (retryAnchors.has(entry.sequence)) { nodes.push(entry.sequence); continue; }
    if (maxTokenAnchors.has(entry.sequence) || tailAnchors.has(entry.sequence)) { nodes.push(entry.sequence); continue; }
    if (workflowAnchors.has(entry.sequence)) { nodes.push(entry.sequence); continue; }
    if (commandAnchors.has(entry.sequence) || (event.type === "run.completed" && event.payload.outcome === "failed" && typeof event.payload.error === "string" && event.payload.error.length > 0 && runsWithTurns.has(String(event.payload.runId)))) { nodes.push(entry.sequence); continue; }
    if (event.type !== "message.appended" && event.type !== "context.compacted" && event.type !== "surface.removed" && !(event.type === "dsh.imported" && event.surfaceOp !== undefined)) continue;
    if (event.surfaceOp === undefined && event.type === "context.compacted") {
      const surface = nodes.filter((sequence) => {
        const candidate = events[sequence - 1]?.event;
        return candidate?.type === "message.appended" || candidate?.type === "context.compacted";
      });
      const cutoff = surface.length - event.payload.retainedMessageCount;
      const start = surface[0]; const end = surface[cutoff - 1];
      if (start === undefined || end === undefined) nodes.push(entry.sequence);
      else { const startIndex = nodes.indexOf(start); nodes.splice(startIndex, nodes.indexOf(end) - startIndex + 1, entry.sequence); }
      continue;
    }
    const op = event.surfaceOp ?? "append";
    if (op === "append") { nodes.push(entry.sequence); continue; }
    const start = nodes.indexOf(op.start); const end = nodes.indexOf(op.end);
    nodes.splice(start, end - start + 1, ...(event.type === "surface.removed" ? [] : [entry.sequence]));
  }
  return nodes;
}
