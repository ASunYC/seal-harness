import type { ProjectService, ProjectAccount, ProjectRequestContext } from '../../projects/src/host/service.js'
export type Account = ProjectAccount
export type RequestContext = ProjectRequestContext
export type ProjectsPort = Pick<ProjectService, 'clients' | 'getAccount' | 'accessToken' | 'register' | 'emit' | 'withSignal'>
export { ProjectSessionListRequestSchema as projectRequest, ProjectSessionCreateRequestSchema as createSessionRequest, ProjectSessionOpenRequestSchema as openSessionRequest } from '../../projects/stratex/shared/protocol/project-sessions.js'
export class ProjectAgentError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export function failure(error: unknown) {
  return { ok: false, code: error instanceof ProjectAgentError ? error.code : 'unavailable', message: error instanceof ProjectAgentError ? error.message : '项目会话当前不可用，请重试。' }
}
