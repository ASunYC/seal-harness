import type { SessionId } from "./ids.js";

export interface ScheduleRecord {
  readonly id: string;
  readonly sessionId: SessionId;
  readonly kind: "after" | "at" | "every";
  readonly prompt: string;
  readonly scheduledAt: string;
  readonly intervalSeconds?: number;
}
export type CreateScheduleRequest =
  | { readonly sessionId: SessionId; readonly prompt: string; readonly afterSeconds: number }
  | { readonly sessionId: SessionId; readonly prompt: string; readonly at: string | { readonly date: string; readonly time: string; readonly timeZone: string } }
  | { readonly sessionId: SessionId; readonly prompt: string; readonly everySeconds: number };

export interface ScheduleService {
  create(request: CreateScheduleRequest): Promise<ScheduleRecord>;
  list(sessionId: SessionId): Promise<readonly ScheduleRecord[]>;
  delete(sessionId: SessionId, id: string): Promise<boolean>;
}
