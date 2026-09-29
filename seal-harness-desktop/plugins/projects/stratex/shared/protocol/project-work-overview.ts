import { z } from 'zod';
import { IPC } from '../ipc/channels.js';

import {
  TodoSchema,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
} from './project-collab.js';

export const PROJECT_WORK_OVERVIEW_CHANNEL = IPC.PROJECT_WORK_OVERVIEW;
export const ProjectWorkOverviewGroupSchema = z.enum([
  'overdue',
  'due_today',
  'incomplete',
  'participating',
]);
const cursor = z.string().min(1).max(1024);
const count = z.number().int().safe().nonnegative();

/** 服务端统计当前身份的授权集合；游标绑定项目、分组和 UTC 日期。 */
export const ProjectWorkOverviewRequestSchema = z.strictObject({
  projectId: z.string().uuid(),
  group: ProjectWorkOverviewGroupSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: cursor.nullable().optional(),
});
export const ProjectWorkOverviewSchema = z
  .strictObject({
    counts: z.strictObject({
      overdue: count,
      dueToday: count,
      incomplete: count,
      participating: count,
    }),
    total: count,
    items: z.array(TodoSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .refine((page) => {
    const { overdue, dueToday, incomplete, participating } = page.counts;
    return (
      overdue + dueToday <= incomplete &&
      page.total >= Math.max(incomplete, participating) &&
      page.total <= incomplete + participating &&
      page.items.length <= page.total &&
      (page.nextCursor === null || page.items.length > 0) &&
      new Set(page.items.map((item) => item.id)).size === page.items.length
    );
  });
export const ProjectWorkOverviewResultSchema = z.discriminatedUnion('ok', [
  ProjectWorkOverviewSchema.safeExtend({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    code: ProjectCollabErrorCodeSchema,
    message: z.string().max(2048),
    referenceCode: ProjectCollabReferenceCodeSchema,
    serverCode: ProjectCollabServerCodeSchema.optional(),
  }),
]);
export type ProjectWorkOverviewGroup = z.infer<typeof ProjectWorkOverviewGroupSchema>;
export type ProjectWorkOverviewRequest = z.infer<typeof ProjectWorkOverviewRequestSchema>;
export type ProjectWorkOverview = z.infer<typeof ProjectWorkOverviewSchema>;
export type ProjectWorkOverviewResult = z.infer<typeof ProjectWorkOverviewResultSchema>;
