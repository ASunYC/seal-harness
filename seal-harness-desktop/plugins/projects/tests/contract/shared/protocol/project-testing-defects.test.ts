import { describe, expect, it } from 'vitest';
import {
  ProjectTestDefectActionRequestSchema,
  ProjectTestDefectSchema,
  ProjectTestDefectsResultSchema,
} from '../../../../stratex/shared/protocol/project-testing-defects.js';
import { ProjectTestRoundsResultSchema } from '../../../../stratex/shared/protocol/project-testing.js';
import { ProjectTestEvidenceRefSchema } from '../../../../stratex/shared/protocol/project-testing-cases.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('测试缺陷写入边界', () => {
  it.each([
    { hasMore: true, nextCursor: null },
    { hasMore: false, nextCursor: 'next' },
    { hasMore: true, nextCursor: '' },
  ])('拒绝会截断或循环分页的响应 %j', (paging) => {
    for (const schema of [ProjectTestDefectsResultSchema, ProjectTestRoundsResultSchema]) {
      expect(schema.safeParse({ ok: true, items: [], total: 0, ...paging }).success).toBe(false);
    }
  });
  it('不允许客户端伪造历史执行人或时间', () => {
    const input = {
      action: 'fix',
      projectId: id,
      defectId: id,
      expectedVersion: 1,
      clientRequestId: 'fixed-one',
      summary: '修复',
      evidenceRefs: [],
    };
    expect(ProjectTestDefectActionRequestSchema.safeParse(input).success).toBe(true);
    expect(
      ProjectTestDefectActionRequestSchema.safeParse({ ...input, actorSubject: 'manager' }).success,
    ).toBe(false);
    expect(
      ProjectTestDefectActionRequestSchema.safeParse({ ...input, createdAt: 'today' }).success,
    ).toBe(false);
  });
  it.each([
    'link:https://user:password@example.test/',
    'link:javascript:alert(1)',
    'file-version:not-a-uuid',
    'link:https://example.test\\@evil.test/',
  ])('拒绝不可信证据 %s', (ref) => {
    expect(ProjectTestEvidenceRefSchema.safeParse(ref).success).toBe(false);
  });
  it.each([`file-version:${id}`, 'link:https://example.test/report'])(
    '接受无凭据证据 %s',
    (ref) => {
      expect(ProjectTestEvidenceRefSchema.safeParse(ref).success).toBe(true);
    },
  );
  it('缺陷状态不混入轮次状态', () => {
    const row = {
      id,
      projectId: id,
      requirementId: id,
      roundId: id,
      caseId: null,
      title: '问题',
      description: '',
      severity: 'minor',
      assigneeSubject: 'dev',
      state: 'open',
      createdBySubject: 'tester',
      version: 1,
      createdAt: 'now',
      updatedAt: 'now',
    };
    expect(ProjectTestDefectSchema.safeParse(row).success).toBe(true);
    expect(ProjectTestDefectSchema.safeParse({ ...row, state: 'testing' }).success).toBe(false);
  });
});
