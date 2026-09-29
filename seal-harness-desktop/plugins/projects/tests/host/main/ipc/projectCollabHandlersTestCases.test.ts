import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';
import type { ProjectTestCase } from '../../../../stratex/shared/protocol/project-testing-cases.js';
import {
  registerProjectTestCaseHandlers,
  type ProjectTestCaseClientPort,
  type ProjectTestCaseIpcDependencies,
} from '../../../../stratex/main/ipc/projectCollabHandlersTestCases.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_ROUND_ID = '55555555-5555-4555-8555-555555555555';

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

const DRAFT = {
  title: CASE.title,
  preconditions: CASE.preconditions,
  steps: CASE.steps,
  expected: CASE.expected,
} as const;

const CREATE_REQUEST = {
  projectId: PROJECT_ID,
  submissionId: ROUND_ID,
  clientRequestId: 'case-from-ui',
  ...DRAFT,
} as const;

const UPDATE_REQUEST = {
  projectId: PROJECT_ID,
  caseId: CASE_ID,
  expectedVersion: 2,
  ...DRAFT,
} as const;

const WRITE_NULL_EXTRAS = { field: null, missingFields: null } as const;

type Handler = (event: unknown, input: unknown) => Promise<unknown>;

function fakeCases(overrides: Partial<ProjectTestCaseClientPort> = {}): ProjectTestCaseClientPort {
  return {
    listRoundTestCases: vi.fn(async () => ({
      ok: true as const,
      value: { testCases: [CASE], hasMore: false, nextCursor: null, total: 1, copySource: null },
    })),
    createRoundTestCase: vi.fn(async () => ({
      ok: true as const,
      value: { testCase: CASE, replayed: false },
    })),
    updateTestCase: vi.fn(async () => ({ ok: true as const, value: { ...CASE, version: 3 } })),
    copyPreviousRoundTestCases: vi.fn(async () => ({
      ok: true as const,
      value: { copiedCount: 2, sourceSubmissionId: SOURCE_ROUND_ID, sourceRoundNo: 1 },
    })),
    listRequirementTestCaseCounts: vi.fn(async () => ({
      ok: true as const,
      value: { counts: [{ submissionId: ROUND_ID, caseCount: 1 }] },
    })),
    ...overrides,
  };
}

interface HarnessOptions {
  readonly testing?: ProjectTestCaseClientPort;
  readonly dependencies?: ProjectTestCaseIpcDependencies | null;
  readonly authorize?: (event: unknown) => boolean;
  readonly activeAccount?: () => { accountKey: string; authEpoch: number } | null;
  readonly accessToken?: () => Promise<string | null>;
}

function harness(options: HarnessOptions = {}) {
  const handlers = new Map<string, Handler>();
  const testing = options.testing ?? fakeCases();
  registerProjectTestCaseHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies:
        options.dependencies === undefined
          ? { testing, accessToken: options.accessToken ?? (async () => 'token') }
          : options.dependencies,
      authorize: options.authorize ?? (() => true),
      activeAccount: options.activeAccount ?? (() => ({ accountKey: 'acc-1', authEpoch: 1 })),
    },
  );
  const handlerOf = (channel: string): Handler => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`handler missing for ${channel}`);
    return handler;
  };
  return { handlers, testing, handlerOf };
}

describe('测试轮次用例 IPC 五条通道', () => {
  it('五条全部注册，通道名逐字钉住', () => {
    const { handlers } = harness();
    const channels = [
      IPC.PROJECT_ROUND_TEST_CASES,
      IPC.PROJECT_ROUND_TEST_CASE_CREATE,
      IPC.PROJECT_TEST_CASE_UPDATE,
      IPC.PROJECT_ROUND_TEST_CASES_COPY,
      IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS,
    ];
    expect(channels).toEqual([
      'project:round-test-cases',
      'project:round-test-case-create',
      'project:test-case-update',
      'project:round-test-cases-copy',
      'project:requirement-test-case-counts',
    ]);
    expect([...handlers.keys()].sort()).toEqual([...channels].sort());
  });

  it('列表 / 复用 / 条数：请求原样交给客户端，成功原样透传', async () => {
    const { handlerOf, testing } = harness();
    const listRequest = { projectId: PROJECT_ID, submissionId: ROUND_ID, limit: 30 };
    await expect(handlerOf(IPC.PROJECT_ROUND_TEST_CASES)({}, listRequest)).resolves.toEqual({
      ok: true,
      testCases: [CASE],
      hasMore: false,
      nextCursor: null,
      total: 1,
      copySource: null,
    });
    expect(testing.listRoundTestCases).toHaveBeenCalledWith('token', listRequest);

    const copyRequest = { projectId: PROJECT_ID, submissionId: ROUND_ID };
    await expect(handlerOf(IPC.PROJECT_ROUND_TEST_CASES_COPY)({}, copyRequest)).resolves.toEqual({
      ok: true,
      copiedCount: 2,
      sourceSubmissionId: SOURCE_ROUND_ID,
      sourceRoundNo: 1,
    });

    const countsRequest = { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID };
    await expect(
      handlerOf(IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS)({}, countsRequest),
    ).resolves.toEqual({ ok: true, counts: [{ submissionId: ROUND_ID, caseCount: 1 }] });
  });

  it('⭐ 新建：请求号不在这一层重生成；成功带 replayed', async () => {
    const { handlerOf, testing } = harness();
    await expect(
      handlerOf(IPC.PROJECT_ROUND_TEST_CASE_CREATE)({}, CREATE_REQUEST),
    ).resolves.toEqual({ ok: true, testCase: CASE, replayed: false });
    expect(testing.createRoundTestCase).toHaveBeenCalledWith('token', CREATE_REQUEST);
  });

  it('⛔ 非法入参（夹带账号 / 必测 / 结果、缺请求号）⇒ invalidRequest，且不打网络', async () => {
    const { handlerOf, testing } = harness();
    const withoutKey: Record<string, unknown> = { ...CREATE_REQUEST };
    delete withoutKey.clientRequestId;
    for (const bad of [
      withoutKey,
      { ...CREATE_REQUEST, accountKey: 'leak' },
      { ...CREATE_REQUEST, required: true },
      { ...CREATE_REQUEST, result: 'passed' },
    ]) {
      await expect(handlerOf(IPC.PROJECT_ROUND_TEST_CASE_CREATE)({}, bad)).resolves.toEqual({
        ok: false,
        code: 'invalidRequest',
        message: expect.any(String),
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.invalidRequest,
        ...WRITE_NULL_EXTRAS,
      });
    }
    expect(testing.createRoundTestCase).not.toHaveBeenCalled();
  });

  it('⭐ 写失败透传 serverCode 与附加字段；currentVersion 只在 conflict 时非空', async () => {
    const fieldsMissing = harness({
      testing: fakeCases({
        createRoundTestCase: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'test_case_fields_required',
          missingFields: ['title' as const],
        })),
      }),
    });
    await expect(
      fieldsMissing.handlerOf(IPC.PROJECT_ROUND_TEST_CASE_CREATE)({}, CREATE_REQUEST),
    ).resolves.toEqual({
      ok: false,
      code: 'rejected',
      message: expect.any(String),
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected,
      serverCode: 'test_case_fields_required',
      field: null,
      missingFields: ['title'],
    });

    const stale = harness({
      testing: fakeCases({
        updateTestCase: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'version_conflict',
          currentVersion: 5,
        })),
      }),
    });
    await expect(
      stale.handlerOf(IPC.PROJECT_TEST_CASE_UPDATE)({}, UPDATE_REQUEST),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      message: expect.any(String),
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
      serverCode: 'version_conflict',
      currentVersion: 5,
      ...WRITE_NULL_EXTRAS,
    });

    const notReviewer = harness({
      testing: fakeCases({
        updateTestCase: vi.fn(async () => ({
          ok: false as const,
          code: 'forbidden' as const,
          serverCode: 'not_round_reviewer',
          // 版本号只属于冲突：别的失败码带着它也要清成 null。
          currentVersion: 9,
        })),
      }),
    });
    await expect(
      notReviewer.handlerOf(IPC.PROJECT_TEST_CASE_UPDATE)({}, UPDATE_REQUEST),
    ).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
      serverCode: 'not_round_reviewer',
      currentVersion: null,
    });
  });

  it('读失败带 serverCode；条数上界外的 limit ⇒ invalidRequest', async () => {
    const denied = harness({
      testing: fakeCases({
        listRoundTestCases: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'invalid_cursor',
        })),
      }),
    });
    const request = { projectId: PROJECT_ID, submissionId: ROUND_ID, cursor: 'x' };
    await expect(
      denied.handlerOf(IPC.PROJECT_ROUND_TEST_CASES)({}, request),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rejected',
      serverCode: 'invalid_cursor',
    });
    await expect(
      denied.handlerOf(IPC.PROJECT_ROUND_TEST_CASES)({}, { ...request, limit: 51 }),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
  });
});

describe('测试轮次用例 IPC 门禁', () => {
  it('未授权 / 无账号 / 未装配 / 拿不到令牌各有明确失败码，且一律不打网络', async () => {
    const testing = fakeCases();
    await expect(
      harness({ testing, authorize: () => false }).handlerOf(IPC.PROJECT_ROUND_TEST_CASE_CREATE)(
        {},
        CREATE_REQUEST,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired', ...WRITE_NULL_EXTRAS });
    await expect(
      harness({ testing, activeAccount: () => null }).handlerOf(IPC.PROJECT_ROUND_TEST_CASES)(
        {},
        { projectId: PROJECT_ID, submissionId: ROUND_ID },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
    await expect(
      harness({ dependencies: null }).handlerOf(IPC.PROJECT_TEST_CASE_UPDATE)({}, UPDATE_REQUEST),
    ).resolves.toMatchObject({ ok: false, code: 'unavailable', currentVersion: null });
    await expect(
      harness({ testing, accessToken: async () => null }).handlerOf(
        IPC.PROJECT_ROUND_TEST_CASES_COPY,
      )({}, { projectId: PROJECT_ID, submissionId: ROUND_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'credentialRejected' });

    expect(testing.createRoundTestCase).not.toHaveBeenCalled();
    expect(testing.listRoundTestCases).not.toHaveBeenCalled();
    expect(testing.copyPreviousRoundTestCases).not.toHaveBeenCalled();
  });

  it('⭐ 在途换账号：结果一律作废为 authRequired', async () => {
    let epoch = 1;
    const testing = fakeCases({
      createRoundTestCase: vi.fn(async () => {
        epoch = 2;
        return { ok: true as const, value: { testCase: CASE, replayed: false } };
      }),
    });
    const { handlerOf } = harness({
      testing,
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
    });
    await expect(
      handlerOf(IPC.PROJECT_ROUND_TEST_CASE_CREATE)({}, CREATE_REQUEST),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('客户端抛异常收敛为 transient（异常消息不跨 IPC）', async () => {
    const testing = fakeCases({
      updateTestCase: vi.fn(async () => {
        throw new Error('内部细节：token=abc');
      }),
    });
    const result = await harness({ testing }).handlerOf(IPC.PROJECT_TEST_CASE_UPDATE)(
      {},
      UPDATE_REQUEST,
    );
    expect(result).toMatchObject({ ok: false, code: 'transient' });
    expect(JSON.stringify(result)).not.toContain('token=abc');
  });
});
