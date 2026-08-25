declare const brand: unique symbol;

export type BrandedId<TName extends string> = string & { readonly [brand]: TName };

export type SessionId = BrandedId<"SessionId">;
export type RunId = BrandedId<"RunId">;
export type TurnId = BrandedId<"TurnId">;
export type MessageId = BrandedId<"MessageId">;
export type ToolCallId = BrandedId<"ToolCallId">;

export function sessionId(value: string): SessionId {
  return asId<SessionId>(value, "SessionId");
}

export function runId(value: string): RunId {
  return asId<RunId>(value, "RunId");
}

export function turnId(value: string): TurnId {
  return asId<TurnId>(value, "TurnId");
}

export function messageId(value: string): MessageId {
  return asId<MessageId>(value, "MessageId");
}

export function toolCallId(value: string): ToolCallId {
  return asId<ToolCallId>(value, "ToolCallId");
}

function asId<TId extends string>(value: string, name: string): TId {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized as TId;
}
