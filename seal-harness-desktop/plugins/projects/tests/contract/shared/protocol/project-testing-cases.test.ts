import { describe, expect, it } from 'vitest';

import {
  PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT,
  PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH,
  PROJECT_TEST_CASE_MAX_PAGE_SIZE,
  PROJECT_TEST_CASE_MAX_PER_ROUND,
  PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH,
  PROJECT_TEST_CASE_MAX_STEPS_LENGTH,
  PROJECT_TEST_CASE_MAX_TITLE_LENGTH,
  ProjectRequirementTestCaseCountsResultSchema,
  ProjectRoundTestCaseCreateRequestSchema,
  ProjectRoundTestCaseCreateResultSchema,
  ProjectRoundTestCasesCopyResultSchema,
  ProjectRoundTestCasesRequestSchema,
  ProjectRoundTestCasesResultSchema,
  ProjectTestCaseResultSchema,
  ProjectTestCaseSchema,
  ProjectTestCaseUpdateRequestSchema,
  ProjectTestCaseUpdateResultSchema,
  projectTestCaseMissingFields,
  projectTestCaseServerCodeText,
  type ProjectTestCase,
} from '../../../../stratex/shared/protocol/project-testing-cases.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const CASE_ID = '44444444-4444-4444-8444-444444444444';

it('保留服务器执行身份、实际结果及证据引用', () => {
  const execution = {
    actualResult: '实际通过',
    testedBySubject: 'reviewer',
    testedAt: '2026-09-16T00:00:00Z',
    evidenceRefs: ['link:https://example.test/evidence'],
  };
  expect(ProjectTestCaseSchema.safeParse({ ...CASE, ...execution }).success).toBe(true);
});

const CASE: ProjectTestCase = {
  id: CASE_ID,
  projectId: PROJECT_ID,
  requirementId: REQUIREMENT_ID,
  submissionId: ROUND_ID,
  ordinal: 1,
  title: '邀请码过期后兑换被拒',
  preconditions: '',
  steps: '打开邀请链接\n点击兑换',
  expected: '提示邀请码已过期',
  result: 'notrun',
  copiedFromCaseId: null,
  createdBySubject: 'u-henry',
  updatedBySubject: 'u-henry',
  version: 1,
  createdAt: '2026-09-15T01:00:00Z',
  updatedAt: '2026-09-15T01:00:00Z',
};

const FAILURE = {
  ok: false,
  code: 'conflict',
  message: '内容已被他人更新，请刷新后重试。',
  referenceCode: 'STRX-COLLAB-006',
  serverCode: 'version_conflict',
} as const;

describe('轮次用例的形状', () => {
  it('上界与服务端 domain_test_cases 同值', () => {
    expect(PROJECT_TEST_CASE_MAX_TITLE_LENGTH).toBe(200);
    expect(PROJECT_TEST_CASE_MAX_PRECONDITIONS_LENGTH).toBe(4_000);
    expect(PROJECT_TEST_CASE_MAX_STEPS_LENGTH).toBe(8_000);
    expect(PROJECT_TEST_CASE_MAX_EXPECTED_LENGTH).toBe(4_000);
    expect(PROJECT_TEST_CASE_MAX_PAGE_SIZE).toBe(50);
    expect(PROJECT_TEST_CASE_MAX_PER_ROUND).toBe(200);
  });

  it('用例 strict：多一个键（指纹、账号、必测）即不可信', () => {
    expect(ProjectTestCaseSchema.safeParse(CASE).success).toBe(true);
    for (const extra of [{ requestFingerprint: 'a' }, { accountKey: 'k' }, { required: true }]) {
      expect(ProjectTestCaseSchema.safeParse({ ...CASE, ...extra }).success).toBe(false);
    }
  });

  it('执行结果只有原型四态：未执行 / 通过 / 失败 / 阻塞', () => {
    expect(ProjectTestCaseResultSchema.options).toEqual(['notrun', 'passed', 'failed', 'blocked']);
    expect(ProjectTestCaseSchema.safeParse({ ...CASE, result: 'skipped' }).success).toBe(false);
  });
});

describe('必填规则与服务端同一套（原型 caseEditor）', () => {
  it('名称 / 步骤 / 预期去空白后必填，前置可空；提示照抄原型那一句', () => {
    expect(
      projectTestCaseMissingFields({
        title: ' ',
        preconditions: '',
        steps: '\n',
        expected: '预期',
      }),
    ).toEqual(['title', 'steps']);
    expect(
      projectTestCaseMissingFields({
        title: '名称',
        preconditions: '',
        steps: '步骤',
        expected: '预期',
      }),
    ).toEqual([]);
    expect(PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT).toBe('请填写用例名称、操作步骤和预期结果。');
  });
});

describe('五条通道的请求', () => {
  it('新建请求 strict、幂等键必带；请求里没有必测、结果、新建人', () => {
    const request = {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      clientRequestId: 'case-1',
      title: CASE.title,
      preconditions: '',
      steps: CASE.steps,
      expected: CASE.expected,
    };
    expect(ProjectRoundTestCaseCreateRequestSchema.safeParse(request).success).toBe(true);
    expect(
      ProjectRoundTestCaseCreateRequestSchema.safeParse({ ...request, clientRequestId: '' })
        .success,
    ).toBe(false);
    for (const extra of [{ required: true }, { result: 'passed' }, { createdBySubject: 'u-x' }]) {
      expect(
        ProjectRoundTestCaseCreateRequestSchema.safeParse({ ...request, ...extra }).success,
      ).toBe(false);
    }
    expect(
      ProjectRoundTestCaseCreateRequestSchema.safeParse({
        ...request,
        title: '名'.repeat(PROJECT_TEST_CASE_MAX_TITLE_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('编辑是四项整表保存 + 期望版本', () => {
    const base = {
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      expectedVersion: 2,
      title: '改名',
      preconditions: '',
      steps: '步骤',
      expected: '预期',
    };
    expect(ProjectTestCaseUpdateRequestSchema.safeParse(base).success).toBe(true);
    const missingTitle: Record<string, unknown> = { ...base };
    delete missingTitle.title;
    expect(ProjectTestCaseUpdateRequestSchema.safeParse(missingTitle).success).toBe(false);
  });

  it('列表请求条数上界 50、游标可空', () => {
    const list = { projectId: PROJECT_ID, submissionId: ROUND_ID };
    expect(ProjectRoundTestCasesRequestSchema.safeParse({ ...list, limit: 50 }).success).toBe(true);
    expect(ProjectRoundTestCasesRequestSchema.safeParse({ ...list, limit: 51 }).success).toBe(
      false,
    );
    expect(ProjectRoundTestCasesRequestSchema.safeParse({ ...list, cursor: null }).success).toBe(
      true,
    );
  });
});

describe('五条通道的结果', () => {
  it('列表：游标与 hasMore 同生同灭；可复用来源可空', () => {
    const page = { ok: true, testCases: [CASE], hasMore: false, nextCursor: null, total: 1 };
    expect(ProjectRoundTestCasesResultSchema.safeParse({ ...page, copySource: null }).success).toBe(
      true,
    );
    expect(
      ProjectRoundTestCasesResultSchema.safeParse({
        ...page,
        copySource: { submissionId: ROUND_ID, roundNo: 1, caseCount: 3 },
      }).success,
    ).toBe(true);
    expect(
      ProjectRoundTestCasesResultSchema.safeParse({ ...page, hasMore: true, copySource: null })
        .success,
    ).toBe(false);
  });

  it('新建与编辑失败恒带附加键（取不到给 null），编辑另带 currentVersion', () => {
    const extras = { field: null, missingFields: ['title'] };
    expect(
      ProjectRoundTestCaseCreateResultSchema.safeParse({ ...FAILURE, ...extras }).success,
    ).toBe(true);
    expect(ProjectRoundTestCaseCreateResultSchema.safeParse(FAILURE).success).toBe(false);
    expect(
      ProjectTestCaseUpdateResultSchema.safeParse({ ...FAILURE, ...extras, currentVersion: 3 })
        .success,
    ).toBe(true);
    expect(ProjectTestCaseUpdateResultSchema.safeParse({ ...FAILURE, ...extras }).success).toBe(
      false,
    );
    expect(
      ProjectRoundTestCaseCreateResultSchema.safeParse({ ok: true, testCase: CASE, replayed: true })
        .success,
    ).toBe(true);
  });

  it('复用上轮与各轮条数', () => {
    expect(
      ProjectRoundTestCasesCopyResultSchema.safeParse({
        ok: true,
        copiedCount: 0,
        sourceSubmissionId: ROUND_ID,
        sourceRoundNo: 1,
      }).success,
    ).toBe(true);
    expect(
      ProjectRequirementTestCaseCountsResultSchema.safeParse({
        ok: true,
        counts: [{ submissionId: ROUND_ID, caseCount: 2 }],
      }).success,
    ).toBe(true);
  });
});

describe('projectTestCaseServerCodeText', () => {
  it('400 / 403 / 409 / 分页各有可读原因', () => {
    expect(projectTestCaseServerCodeText('test_case_fields_required')).toBe(
      PROJECT_TEST_CASE_FIELDS_REQUIRED_TEXT,
    );
    expect(projectTestCaseServerCodeText('test_case_field_too_long', { field: 'steps' })).toBe(
      '操作步骤超出长度上限，请精简后再保存。',
    );
    expect(projectTestCaseServerCodeText('not_round_reviewer')).toBe(
      '只有本轮测试负责人可以编辑测试用例。',
    );
    expect(projectTestCaseServerCodeText('test_round_closed')).toBe('这一轮测试已结束，用例只读。');
    expect(projectTestCaseServerCodeText('version_conflict')).toBe(
      '这条用例已被修改过，已刷新到最新版本；你填写的内容已保留，确认后可再次保存。',
    );
    expect(projectTestCaseServerCodeText('no_reusable_test_cases')).toBe(
      '没有可复用的上轮测试用例。',
    );
    expect(projectTestCaseServerCodeText('invalid_cursor')).toBe('分页位置已失效，已回到第一页。');
  });

  it('两个幂等码不塌缩；认不出的码与缺席一律 null', () => {
    expect(projectTestCaseServerCodeText('idempotency_retry')).not.toBe(
      projectTestCaseServerCodeText('idempotency_conflict'),
    );
    expect(projectTestCaseServerCodeText('something_new')).toBeNull();
    expect(projectTestCaseServerCodeText(undefined)).toBeNull();
  });
});
