import { z } from 'zod';

import {
  PROJECT_REF_TOKEN_PATTERN,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
} from './project-collab.js';

const uuid = z.string().uuid();
const count = z.number().int().safe().nonnegative();
const version = z.number().int().safe().positive();
const noNul = (value: string): boolean => !value.includes('\0');
const text = (max: number) => z.string().max(max).refine(noNul);
const subject = text(400).min(1);
const refs = z.array(z.string().regex(PROJECT_REF_TOKEN_PATTERN)).max(16);
const failureShape = {
  ok: z.literal(false),
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
};

/** 协助人不改变执行人；离组成员保留历史身份。 */
export const ProjectTodoCollaboratorSchema = z.strictObject({
  subject,
  displayName: text(400),
  state: z.enum(['active', 'removed']),
});
export const ProjectTodoCollaboratorsSchema = z.strictObject({
  todoId: uuid,
  version,
  collaborators: z
    .array(ProjectTodoCollaboratorSchema)
    .max(20)
    .refine((items) => new Set(items.map((item) => item.subject)).size === items.length),
});

/** 入站正文允许服务端20000码点的UTF-16表示；出站按同一码点上界判定。 */
export const ProjectTodoCommentSchema = z.strictObject({
  id: uuid,
  todoId: uuid,
  authorSubject: subject,
  authorDisplayName: text(400),
  bodyMd: text(40_000).min(1),
  refs,
  createdAt: z.string().min(1).max(64),
});
export const ProjectTodoCommentsSchema = z
  .strictObject({
    comments: z.array(ProjectTodoCommentSchema).max(50),
    nextCursor: uuid.nullable(),
  })
  .refine((page) => page.nextCursor === null || page.comments.at(-1)?.id === page.nextCursor);

/** 服务器重算子树预检；计数不可从当前页合成，预检成功也不代替删除时权限检查。 */
export const ProjectTodoDeletePreviewSchema = z
  .strictObject({
    rootIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    requirementCount: count,
    taskCount: count,
    testRoundCount: count,
    testCaseCount: count,
    activeRoundCount: count,
    canDelete: z.boolean(),
  })
  .refine((scope) => scope.canDelete === (scope.activeRoundCount === 0));

export const ProjectTodoCollaboratorsRequestSchema = z.strictObject({ todoId: uuid });
export const ProjectTodoCollaboratorsReplaceRequestSchema = z.strictObject({
  todoId: uuid,
  expectedVersion: version,
  clientRequestId: uuid,
  subjects: z
    .array(
      text(200)
        .min(1)
        .refine((value) => value.trim().length > 0),
    )
    .max(100)
    .transform((items) => [...new Set(items)])
    .refine((items) => items.length <= 20),
});
export const ProjectTodoCommentsRequestSchema = z.strictObject({
  todoId: uuid,
  beforeId: uuid.nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const ProjectTodoCommentCreateRequestSchema = z.strictObject({
  todoId: uuid,
  clientRequestId: uuid,
  bodyMd: text(40_000)
    .min(1)
    .refine((value) => value.trim().length > 0 && [...value].length <= 20_000),
  refs,
});
export const ProjectTodoDeletePreviewRequestSchema = z.strictObject({
  projectId: uuid,
  ids: z.array(uuid).min(1).max(100),
});

export const ProjectTodoCollaboratorsResultSchema = z.discriminatedUnion('ok', [
  ProjectTodoCollaboratorsSchema.extend({ ok: z.literal(true) }),
  z.strictObject(failureShape),
]);
export const ProjectTodoCollaboratorsReplaceResultSchema = z.discriminatedUnion('ok', [
  ProjectTodoCollaboratorsSchema.extend({ ok: z.literal(true), replayed: z.boolean() }),
  z.strictObject({ ...failureShape, currentVersion: version.nullable() }),
]);
export const ProjectTodoCommentsResultSchema = z.discriminatedUnion('ok', [
  ProjectTodoCommentsSchema.safeExtend({ ok: z.literal(true) }),
  z.strictObject(failureShape),
]);
export const ProjectTodoCommentCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), comment: ProjectTodoCommentSchema, replayed: z.boolean() }),
  z.strictObject(failureShape),
]);
export const ProjectTodoDeletePreviewResultSchema = z.discriminatedUnion('ok', [
  ProjectTodoDeletePreviewSchema.safeExtend({ ok: z.literal(true) }),
  z.strictObject(failureShape),
]);

export type ProjectTodoCollaborator = z.infer<typeof ProjectTodoCollaboratorSchema>;
export type ProjectTodoComment = z.infer<typeof ProjectTodoCommentSchema>;
export type ProjectTodoCollaborators = z.infer<typeof ProjectTodoCollaboratorsSchema>;
export type ProjectTodoComments = z.infer<typeof ProjectTodoCommentsSchema>;
export type ProjectTodoDeletePreview = z.infer<typeof ProjectTodoDeletePreviewSchema>;
export type ProjectTodoCollaboratorsRequest = z.infer<typeof ProjectTodoCollaboratorsRequestSchema>;
export type ProjectTodoCollaboratorsReplaceRequest = z.infer<
  typeof ProjectTodoCollaboratorsReplaceRequestSchema
>;
export type ProjectTodoCommentsRequest = z.infer<typeof ProjectTodoCommentsRequestSchema>;
export type ProjectTodoCommentCreateRequest = z.infer<typeof ProjectTodoCommentCreateRequestSchema>;
export type ProjectTodoDeletePreviewRequest = z.infer<typeof ProjectTodoDeletePreviewRequestSchema>;
export type ProjectTodoCollaboratorsResult = z.infer<typeof ProjectTodoCollaboratorsResultSchema>;
export type ProjectTodoCollaboratorsReplaceResult = z.infer<
  typeof ProjectTodoCollaboratorsReplaceResultSchema
>;
export type ProjectTodoCommentsResult = z.infer<typeof ProjectTodoCommentsResultSchema>;
export type ProjectTodoCommentCreateResult = z.infer<typeof ProjectTodoCommentCreateResultSchema>;
export type ProjectTodoDeletePreviewResult = z.infer<typeof ProjectTodoDeletePreviewResultSchema>;
