import type { SessionId } from "./ids.js";

export interface PlanModeState { readonly active: boolean; readonly pending?: boolean; }
export interface PlanModeService {
  get(sessionId: SessionId): Promise<PlanModeState>;
  set(sessionId: SessionId, active: boolean): Promise<PlanModeState>;
}
