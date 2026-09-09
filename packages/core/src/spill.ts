import type { SessionId, ToolCallId } from "./ids.js";

export interface SpillOwner { readonly sessionId: SessionId }
export interface SpillSource {
  readonly toolName: string;
  readonly callId: ToolCallId;
  readonly label: "result" | "dispatch";
}
export interface SaveTextSpill {
  readonly owner: SpillOwner;
  readonly source: SpillSource;
  readonly suggestedName: string;
  readonly content: string;
}
export interface SpillRef {
  readonly locator: string;
  readonly bytes: number;
  readonly retrievalHint: string;
}
export interface SpillStore {
  saveText(input: SaveTextSpill): Promise<SpillRef>;
}
