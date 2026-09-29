import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const workspaceSchema = z.strictObject({
  accountKey: z.string(), projectId: z.uuid(), localProjectId: z.uuid(),
  bindingId: z.uuid(), revision: z.number().int().positive(), cwd: z.string().min(1),
})
const sessionSchema = z.object({
  accountKey: z.string(), projectId: z.uuid(), sessionId: z.string().min(1),
  cwd: z.string().min(1), bindingId: z.uuid(), revision: z.number().int().positive(),
})
const stateSchema = z.strictObject({
  version: z.literal(1), workspaces: z.array(workspaceSchema), sessions: z.array(sessionSchema),
})
export type WorkspaceBinding = z.infer<typeof workspaceSchema>
export type ProjectSession = z.infer<typeof sessionSchema>

/** Only project affiliation and local paths; credentials remain in the identity service. */
export class ProjectAgentStore {
  private state: z.infer<typeof stateSchema>
  constructor(private readonly file: string) {
    try { this.state = stateSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.state = { version: 1, workspaces: [], sessions: [] }
    }
  }
  workspace(accountKey: string, projectId: string) {
    return this.state.workspaces.find(row => row.accountKey === accountKey && row.projectId === projectId)
  }
  workspaceByBinding(accountKey: string, bindingId: string) {
    return this.state.workspaces.find(row => row.accountKey === accountKey && row.bindingId === bindingId)
  }
  setWorkspace(accountKey: string, projectId: string, cwd: string, localProjectId: string) {
    const prior = this.workspace(accountKey, projectId)
    const row: WorkspaceBinding = { accountKey, projectId, cwd, localProjectId, bindingId: prior?.bindingId ?? randomUUID(), revision: (prior?.revision ?? 0) + 1 }
    this.save({ ...this.state, workspaces: [...this.state.workspaces.filter(item => item !== prior), row] })
    return row
  }
  sessions(accountKey: string, projectId: string) {
    return this.state.sessions.filter(row => row.accountKey === accountKey && row.projectId === projectId)
  }
  session(sessionId: string) { return this.state.sessions.find(row => row.sessionId === sessionId) }
  saveSession(row: ProjectSession) {
    this.save({ ...this.state, sessions: [...this.state.sessions.filter(item => item.sessionId !== row.sessionId), row] })
  }
  removeSession(sessionId: string) {
    this.save({ ...this.state, sessions: this.state.sessions.filter(row => row.sessionId !== sessionId) })
  }
  private save(state: z.infer<typeof stateSchema>) {
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(stateSchema.parse(state)))
    renameSync(temp, this.file)
    this.state = state
  }
}
