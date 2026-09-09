import type { SessionId } from "./ids.js";
export interface AskUserQuestionOption { readonly label: string; readonly description?: string }
export interface AskUserQuestionItem { readonly id: string; readonly question: string; readonly detail?: string; readonly header?: string; readonly options?: readonly AskUserQuestionOption[]; readonly multiSelect?: boolean; readonly intent?: { readonly kind: "plan-review"; readonly approve: string } }
export interface AskUserQuestionAnswerItem { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }
export interface AskUserQuestionAnswer { readonly answers: readonly AskUserQuestionAnswerItem[] }
export interface AskUserQuestionRequest { readonly sessionId: SessionId; readonly questions: readonly AskUserQuestionItem[]; readonly signal?: AbortSignal }
export type UserQuestionAnswerer = (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer | undefined>;
export interface UserQuestionService { registerAnswerer(answerer: UserQuestionAnswerer): () => void; ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> }
export class UserQuestionError extends Error { override readonly name = "UserQuestionError"; constructor(message: string, readonly code: string) { super(message); } }
