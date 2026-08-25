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
  };
  "turn.started": {
    readonly runId: RunId;
    readonly turnId: TurnId;
  };
  "message.appended": {
    readonly messageId: MessageId;
    readonly runId?: RunId;
    readonly turnId?: TurnId;
    readonly message: AgentMessage;
  };
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
  "turn.completed": {
    readonly runId: RunId;
    readonly turnId: TurnId;
    readonly usage?: ModelUsage;
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
}

export type SessionEventType = keyof SessionEventMap;
export type SessionEvent = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventMap[K];
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

export interface SessionStore {
  create(request: CreateSessionRequest): Promise<SessionSnapshot>;
  read(id: SessionId): Promise<SessionSnapshot | undefined>;
  append(request: AppendSessionRequest): Promise<SessionSnapshot>;
  fork(request: ForkSessionRequest): Promise<SessionSnapshot>;
  list(): Promise<readonly SessionSnapshot[]>;
}

export function deriveSessionMessages(session: SessionSnapshot): AgentMessage[] {
  let messages: AgentMessage[] = [];
  for (const stored of session.events) {
    if (stored.event.type === "message.appended") {
      messages.push(stored.event.payload.message);
    } else if (stored.event.type === "context.compacted") {
      const { summaryMessage, retainedMessageCount } = stored.event.payload;
      messages = [
        summaryMessage,
        ...(retainedMessageCount === 0 ? [] : messages.slice(-retainedMessageCount)),
      ];
    }
  }
  return messages;
}
