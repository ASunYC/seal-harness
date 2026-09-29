import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const testCase = {
  id: CASE_ID,
  projectId: PROJECT_ID,
  requirementId: REQUIREMENT_ID,
  submissionId: ROUND_ID,
  ordinal: 1,
  title: '邀请码过期后兑换被拒',
  preconditions: '',
  steps: '打开邀请链接',
  expected: '提示已过期',
  result: 'notrun',
  copiedFromCaseId: null,
  createdBySubject: 'u-henry',
  updatedBySubject: 'u-henry',
  version: 1,
  createdAt: '2026-09-15T01:00:00Z',
  updatedAt: '2026-09-15T01:00:00Z',
};

const draft = {
  title: testCase.title,
  preconditions: '',
  steps: testCase.steps,
  expected: testCase.expected,
};

describe('project collab preload 测试轮次用例五条（TST-04）', () => {
  it('五条各走自己的通道；失败体的业务码与附加字段原样过桥', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) => {
      switch (channel) {
        case IPC.PROJECT_ROUND_TEST_CASES:
          return {
            ok: true,
            testCases: [testCase],
            hasMore: false,
            nextCursor: null,
            total: 1,
            copySource: null,
          };
        case IPC.PROJECT_ROUND_TEST_CASE_CREATE:
          return {
            ok: false,
            code: 'rejected',
            message: '请求被服务端拒绝。',
            referenceCode: 'STRX-COLLAB-009',
            serverCode: 'test_case_fields_required',
            field: null,
            missingFields: ['title'],
          };
        case IPC.PROJECT_TEST_CASE_UPDATE:
          return {
            ok: false,
            code: 'conflict',
            message: '内容已被更新，请刷新后重试。',
            referenceCode: 'STRX-COLLAB-006',
            serverCode: 'version_conflict',
            field: null,
            missingFields: null,
            currentVersion: 3,
          };
        case IPC.PROJECT_ROUND_TEST_CASES_COPY:
          return { ok: true, copiedCount: 2, sourceSubmissionId: ROUND_ID, sourceRoundNo: 1 };
        default:
          return { ok: true, counts: [{ submissionId: ROUND_ID, caseCount: 1 }] };
      }
    });
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    const listRequest = { projectId: PROJECT_ID, submissionId: ROUND_ID };
    await expect(api.listProjectRoundTestCases(listRequest)).resolves.toMatchObject({
      ok: true,
      total: 1,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ROUND_TEST_CASES, listRequest);

    const createRequest = {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      clientRequestId: 'c1',
      ...draft,
    };
    await expect(api.createProjectRoundTestCase(createRequest)).resolves.toMatchObject({
      ok: false,
      serverCode: 'test_case_fields_required',
      missingFields: ['title'],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ROUND_TEST_CASE_CREATE, createRequest);

    const updateRequest = { projectId: PROJECT_ID, caseId: CASE_ID, expectedVersion: 2, ...draft };
    await expect(api.updateProjectTestCase(updateRequest)).resolves.toMatchObject({
      ok: false,
      serverCode: 'version_conflict',
      currentVersion: 3,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_TEST_CASE_UPDATE, updateRequest);

    await expect(api.copyProjectRoundTestCases(listRequest)).resolves.toMatchObject({
      copiedCount: 2,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ROUND_TEST_CASES_COPY, listRequest);

    const countsRequest = { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID };
    await expect(api.listProjectRequirementTestCaseCounts(countsRequest)).resolves.toMatchObject({
      ok: true,
      counts: [{ caseCount: 1 }],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS, countsRequest);
  });

  it('⛔ 入参夹带账号 / 必测 / 结果字段在桥上就拒，不发 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const createRequest = {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      clientRequestId: 'c1',
      ...draft,
    };
    for (const bad of [
      { ...createRequest, accountKey: 'leak' },
      { ...createRequest, required: true },
      { ...createRequest, result: 'passed' },
    ]) {
      await expect(api.createProjectRoundTestCase(bad as never)).rejects.toThrow();
    }
    await expect(
      api.updateProjectTestCase({
        projectId: PROJECT_ID,
        caseId: CASE_ID,
        expectedVersion: 1,
      } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ Main 回来的失败体缺附加键、用例多带字段在桥上拒收', async () => {
    const missingExtras = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: false,
      code: 'conflict',
      message: '内容已被更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'version_conflict',
    }));
    await expect(
      createProjectCollabPreloadApi(missingExtras, () => () => undefined).updateProjectTestCase({
        projectId: PROJECT_ID,
        caseId: CASE_ID,
        expectedVersion: 2,
        ...draft,
      }),
    ).rejects.toThrow();

    const leaky = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: true,
      testCases: [{ ...testCase, requestFingerprint: 'x' }],
      hasMore: false,
      nextCursor: null,
      total: 1,
      copySource: null,
    }));
    await expect(
      createProjectCollabPreloadApi(leaky, () => () => undefined).listProjectRoundTestCases({
        projectId: PROJECT_ID,
        submissionId: ROUND_ID,
      }),
    ).rejects.toThrow();
  });
});

const lifecycleMethods = [
  [
    'actOnProjectTestRound',
    'testRoundAction',
    'PROJECT_TEST_ROUND_ACTION',
    {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      action: 'withdraw',
      reason: '修订',
      expectedVersion: 2,
      clientRequestId: 'round-1',
    },
    true,
  ],
  [
    'listProjectTestRoundActions',
    'testRoundActions',
    'PROJECT_TEST_ROUND_ACTIONS',
    { projectId: PROJECT_ID, submissionId: ROUND_ID, cursor: 'next', limit: 2 },
    false,
  ],
  [
    'listProjectTestRounds',
    'testRounds',
    'PROJECT_TEST_ROUNDS',
    { projectId: PROJECT_ID, state: 'testing', cursor: 'next', limit: 2 },
    false,
  ],
  [
    'executeProjectTestCase',
    'testCaseExecute',
    'PROJECT_TEST_CASE_EXECUTE',
    {
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      expectedVersion: 2,
      clientRequestId: 'exec-1',
      result: 'passed',
      actualResult: '符合预期',
      evidenceRefs: [],
    },
    true,
  ],
  [
    'listProjectTestExecutions',
    'testExecutions',
    'PROJECT_TEST_EXECUTIONS',
    { projectId: PROJECT_ID, caseId: CASE_ID, cursor: 'next', limit: 2 },
    false,
  ],
  [
    'actOnProjectTestDefect',
    'testDefectAction',
    'PROJECT_TEST_DEFECT_ACTION',
    {
      projectId: PROJECT_ID,
      defectId: CASE_ID,
      action: 'fix',
      expectedVersion: 2,
      clientRequestId: 'fix-1',
      summary: '已修复',
      evidenceRefs: [],
    },
    true,
  ],
  [
    'listProjectTestDefects',
    'testDefects',
    'PROJECT_TEST_DEFECTS',
    { projectId: PROJECT_ID, submissionId: ROUND_ID, cursor: 'next', limit: 2 },
    false,
  ],
  [
    'readProjectTestDefect',
    'testDefectDetail',
    'PROJECT_TEST_DEFECT_DETAIL',
    { projectId: PROJECT_ID, defectId: CASE_ID, cursor: 'next', limit: 2 },
    false,
  ],
] as const;

describe('测试生命周期八条桥接边界', () => {
  it.each(lifecycleMethods)(
    '%s 传递请求、409业务码与版本',
    async (method, _sdkMethod, channel, request, writes) => {
      const result = {
        ok: false,
        code: 'conflict',
        message: '请刷新后重试。',
        referenceCode: 'STRX-COLLAB-006',
        serverCode: 'version_conflict',
        ...(writes ? { currentVersion: 9 } : {}),
      };
      const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
      const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
      expect(IPC[channel]).toEqual(expect.any(String));
      expect(new Set(lifecycleMethods.map((entry) => IPC[entry[2]])).size).toBe(8);
      await expect(api[method](request as never)).resolves.toEqual(result);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC[channel], request);
    },
  );
  it.each(lifecycleMethods)(
    '%s 拒绝调用方伪造身份与不可信响应',
    async (method, _sdk, _channel, request) => {
      const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true, accountKey: 'forged' }));
      const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
      await expect(api[method]({ ...request, actorSubject: 'forged' } as never)).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
      await expect(api[method](request as never)).rejects.toThrow();
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );
});
