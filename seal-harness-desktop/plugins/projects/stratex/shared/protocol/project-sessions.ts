import { z } from 'zod';
import { LocalSessionIdSchema } from './session-id.js';

export const ProjectSessionListRequestSchema = z.strictObject({ projectId: z.string().uuid() });
export const ProjectSessionCreateRequestSchema = ProjectSessionListRequestSchema.extend({ text: z.string().optional() });
export const ProjectSessionOpenRequestSchema = ProjectSessionListRequestSchema.extend({ sessionId: LocalSessionIdSchema });
const failure = z.object({ ok: z.literal(false), code: z.string(), message: z.string() });
export const ProjectSessionListResultSchema = z.union([z.object({ ok: z.literal(true), sessions: z.array(z.object({
  sessionId: LocalSessionIdSchema, title: z.string(), updatedAt: z.string(),
})) }), failure]);
export const ProjectSessionResultSchema = z.union([z.object({ ok: z.literal(true), sessionId: LocalSessionIdSchema }), failure]);
export const ProjectAgentChangedSchema = z.object({ projectId: z.string().uuid(), sessionId: LocalSessionIdSchema, tool: z.string() });
