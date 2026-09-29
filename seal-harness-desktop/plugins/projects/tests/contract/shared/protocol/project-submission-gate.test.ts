import { describe, expect, it } from 'vitest';
import {
  ProjectSubmissionGateUpdateRequestSchema,
  ProjectSubmissionGateValuesSchema,
} from '../../../../stratex/shared/protocol/project-submission-gate.js';
import { ProjectTestRoundSnapshotGateSchema } from '../../../../stratex/shared/protocol/project-testing.js';

const values = {
  requireTasks: true,
  requireAllTasksDone: false,
  requireCriteria: true,
  requireReadyArtifacts: false,
};

describe('提交规则闭集', () => {
  it('复用历史快照中的四布尔定义，拒绝单任务提测与安全绕过键', () => {
    expect(ProjectSubmissionGateValuesSchema).toBe(
      ProjectTestRoundSnapshotGateSchema.shape.submissionGate,
    );
    for (const extra of ['allowSingleTask', 'skipAuthorization']) {
      expect(
        ProjectSubmissionGateValuesSchema.safeParse({ ...values, [extra]: true }).success,
      ).toBe(false);
    }
  });
  it('拒绝缺项、伪布尔、无行版本或混入 AI 文本的写请求', () => {
    const request = {
      projectId: '11111111-1111-4111-8111-111111111111',
      submissionGate: values,
      expectedVersion: 0,
    };
    expect(ProjectSubmissionGateUpdateRequestSchema.safeParse(request).success).toBe(true);
    for (const invalid of [
      { ...request, expectedVersion: -1 },
      { ...request, expectedVersion: undefined },
      { ...request, aiEntryRules: '不应覆写' },
      { ...request, submissionGate: { ...values, requireTasks: 1 } },
      { ...request, submissionGate: { ...values, requireCriteria: undefined } },
    ])
      expect(ProjectSubmissionGateUpdateRequestSchema.safeParse(invalid).success).toBe(false);
  });
});
