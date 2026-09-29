import { z } from 'zod';
import { ProjectDictionaryEntrySchema } from './project-collab-dictionaries.js';
import {
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
} from './project-collab.js';

/** 既有项目模块/分类端点的只读分页契约。 */
export const ProjectDictionaryListRequestSchema = z.strictObject({
  projectId: z.string().uuid(),
  kind: z.enum(['modules', 'categories']),
  page: z.number().int().safe().positive(),
  pageSize: z.number().int().min(1).max(100),
});
export const ProjectDictionaryPageSchema = z.strictObject({
  items: z.array(ProjectDictionaryEntrySchema).max(100),
  total: z.number().int().safe().nonnegative(),
  page: z.number().int().safe().positive(),
  pageSize: z.number().int().min(1).max(100),
});
export const ProjectDictionaryListResultSchema = z.discriminatedUnion('ok', [
  ProjectDictionaryPageSchema.extend({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    code: ProjectCollabErrorCodeSchema,
    message: z.string().max(2048),
    referenceCode: ProjectCollabReferenceCodeSchema,
  }),
]);
export type ProjectDictionaryListRequest = z.infer<typeof ProjectDictionaryListRequestSchema>;
export type ProjectDictionaryPage = z.infer<typeof ProjectDictionaryPageSchema>;
export type ProjectDictionaryListResult = z.infer<typeof ProjectDictionaryListResultSchema>;
