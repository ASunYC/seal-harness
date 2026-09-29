import { projectTestingErrorShape, refineTestingPage } from './project-testing.js';
import { z } from 'zod';

import { ProjectTestEvidenceRefSchema } from './project-testing-cases.js';

const id = z.string().uuid();
const subject = z.string().min(1).max(256);
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\0'));

/** 缺陷生命周期独立于测试轮次状态。 */
export const ProjectTestDefectSchema = z.strictObject({
  id,
  projectId: id,
  requirementId: id,
  roundId: id,
  caseId: id.nullable(),
  title: text(400).min(1),
  description: text(16000),
  severity: z.enum(['blocker', 'major', 'minor']),
  assigneeSubject: subject,
  state: z.enum(['open', 'fixed', 'closed']),
  createdBySubject: subject,
  version: z.number().int().positive(),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
});

/** 修复与复测历史只追加，身份和时间由服务端签署。 */
export const ProjectTestDefectHistorySchema = z.strictObject({
  id,
  defectId: id,
  action: z.enum(['created', 'assigned', 'fixed', 'retest-passed', 'retest-failed']),
  fromAssigneeSubject: subject.nullable(),
  toAssigneeSubject: subject,
  actorSubject: subject,
  summary: text(16000),
  evidenceRefs: z.array(ProjectTestEvidenceRefSchema).max(32),
  createdAt: z.string().max(64),
});

export type ProjectTestDefect = z.infer<typeof ProjectTestDefectSchema>;
export type ProjectTestDefectHistory = z.infer<typeof ProjectTestDefectHistorySchema>;

const version = z.number().int().positive();
const command = {
  projectId: id,
  expectedVersion: version,
  clientRequestId: z.string().min(1).max(128),
};
const evidence = z.array(ProjectTestEvidenceRefSchema).max(32);
/** 每种动作只接收自己的字段，禁止客户端签署身份和历史。 */
export const ProjectTestDefectActionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...command,
    action: z.literal('create'),
    submissionId: id,
    title: z.string().min(1).max(200),
    description: text(8000),
    severity: z.enum(['blocker', 'major', 'minor']),
    assigneeSubject: subject,
    caseId: id.nullable(),
  }),
  z.strictObject({
    ...command,
    action: z.literal('assign'),
    defectId: id,
    assigneeSubject: subject,
    reason: text(8000),
  }),
  z.strictObject({
    ...command,
    action: z.literal('fix'),
    defectId: id,
    summary: text(8000),
    evidenceRefs: evidence,
  }),
  z.strictObject({
    ...command,
    action: z.literal('retest'),
    defectId: id,
    result: z.enum(['passed', 'failed']),
    summary: text(8000),
    evidenceRefs: evidence,
  }),
]);
export const ProjectTestDefectActionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), defect: ProjectTestDefectSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...projectTestingErrorShape,
    currentVersion: version.nullable(),
  }),
]);
export const ProjectTestDefectsRequestSchema = z.strictObject({
  projectId: id,
  submissionId: id,
  cursor: z.string().max(1024).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const ProjectTestDefectDetailRequestSchema = z.strictObject({
  projectId: id,
  defectId: id,
  cursor: z.string().max(1024).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const paging = {
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(1024).nullable(),
};
export const ProjectTestDefectsResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      items: z.array(ProjectTestDefectSchema).max(50),
      ...paging,
    })
    .superRefine(refineTestingPage),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);
export const ProjectTestDefectDetailResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      defect: ProjectTestDefectSchema,
      history: z.array(ProjectTestDefectHistorySchema).max(50),
      ...paging,
    })
    .superRefine(refineTestingPage),
  z.strictObject({ ok: z.literal(false), ...projectTestingErrorShape }),
]);
export type ProjectTestDefectActionRequest = z.infer<typeof ProjectTestDefectActionRequestSchema>;
export type ProjectTestDefectActionResult = z.infer<typeof ProjectTestDefectActionResultSchema>;
export type ProjectTestDefectsRequest = z.infer<typeof ProjectTestDefectsRequestSchema>;
export type ProjectTestDefectsResult = z.infer<typeof ProjectTestDefectsResultSchema>;
export type ProjectTestDefectDetailRequest = z.infer<typeof ProjectTestDefectDetailRequestSchema>;
export type ProjectTestDefectDetailResult = z.infer<typeof ProjectTestDefectDetailResultSchema>;
