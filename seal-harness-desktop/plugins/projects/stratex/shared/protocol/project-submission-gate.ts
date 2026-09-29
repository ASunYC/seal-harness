import { z } from 'zod';
import { ProjectConventionsResultSchema } from './project-collab.js';
import { ProjectTestRoundSnapshotGateSchema } from './project-testing.js';

/** 门槛与历史快照共用同一个四布尔闭集；安全门槛不提供关闭入口。 */
export const ProjectSubmissionGateValuesSchema =
  ProjectTestRoundSnapshotGateSchema.shape.submissionGate;
export const ProjectSubmissionGateSchema = z.strictObject({
  submissionGate: ProjectSubmissionGateValuesSchema,
  gateVersion: z.number().int().safe().positive(),
  /** 行乐观锁版本，AI 规则修改也会推进它。 */
  ruleVersion: z.number().int().safe().nonnegative(),
});
export const ProjectSubmissionGateRequestSchema = z.strictObject({ projectId: z.string().uuid() });
export const ProjectSubmissionGateUpdateRequestSchema = ProjectSubmissionGateRequestSchema.extend({
  submissionGate: ProjectSubmissionGateValuesSchema,
  expectedVersion: z.number().int().safe().nonnegative(),
});
export const ProjectSubmissionGateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), gate: ProjectSubmissionGateSchema }),
  ProjectConventionsResultSchema.options[1],
]);
export type ProjectSubmissionGateValues = z.infer<typeof ProjectSubmissionGateValuesSchema>;
export type ProjectSubmissionGate = z.infer<typeof ProjectSubmissionGateSchema>;
export type ProjectSubmissionGateRequest = z.infer<typeof ProjectSubmissionGateRequestSchema>;
export type ProjectSubmissionGateUpdateRequest = z.infer<
  typeof ProjectSubmissionGateUpdateRequestSchema
>;
export type ProjectSubmissionGateResult = z.infer<typeof ProjectSubmissionGateResultSchema>;

/** 配置项文字与顺序供面板、编辑器共用。 */
export const PROJECT_SUBMISSION_GATE_FIELDS = [
  { key: 'requireTasks', label: '必须有关联任务' },
  { key: 'requireAllTasksDone', label: '关联任务全部完成' },
  { key: 'requireCriteria', label: '必须有验收判据' },
  { key: 'requireReadyArtifacts', label: '交付资产全部就绪' },
] as const satisfies readonly {
  readonly key: keyof ProjectSubmissionGateValues;
  readonly label: string;
}[];
