import { registerProjectTestCaseHandlers } from '../../../../stratex/main/ipc/projectCollabHandlersTestCases.js';
import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { CollabTestingClient } from '../../../../stratex/main/services/collab/collabTestingClient.js';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import { PROJECT_COLLAB_REFERENCE_CODES, type Todo } from '../../../../stratex/shared/protocol/project-collab.js';
import type {
  ProjectTestRoundDetail,
  ProjectTestRoundSnapshot,
} from '../../../../stratex/shared/protocol/project-testing.js';
import {
  registerProjectTestingHandlers,
  type ProjectTestingClientPort,
  type ProjectTestingIpcDependencies,
} from '../../../../stratex/main/ipc/projectCollabHandlersTesting.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const TASK_ID = '66666666-6666-4666-8666-666666666666';

const ROUND: ProjectTestRoundDetail = {
  id: ROUND_ID,
  projectId: PROJECT_ID,
  requirementId: REQUIREMENT_ID,
  roundNo: 1,
  state: 'queued',
  submittedBySubject: 'u-me',
  reviewerSubject: 'u-other',
  version: 1,
  createdAt: '2026-09-14T08:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
  summary: '全部任务已完成。',
};

const TODO: Todo = {
  id: REQUIREMENT_ID,
  itemKind: 'requirement',
  parentId: null,
  source: 'manual',
  visibility: 'shared',
  title: '需求整体提测',
  status: 'inReview',
  assigneeKind: 'member',
  assigneeSubject: 'u-me',
  assigneeDisplayName: '林舟',
  priority: 'high',
  labels: [],
  startAt: null,
  dueAt: null,
  description: '',
  sessionRef: null,
  refs: [],
  constraintsText: '',
  acceptanceTotal: 1,
  acceptanceChecked: 0,
  childTotal: 1,
  childDone: 1,
  version: 5,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
};

const SNAPSHOT: ProjectTestRoundSnapshot = {
  requirement: {
    id: REQUIREMENT_ID,
    title: '需求整体提测',
    description: '',
    priority: 'high',
    status: 'inProgress',
    constraintsText: '',
    labels: [],
    itemKind: 'requirement',
  },
  tasks: [
    { id: TASK_ID, parentId: REQUIREMENT_ID, title: '补齐接口', status: 'done', itemKind: 'task' },
  ],
  criteria: [{ ordinal: 1, text: '主要流程可连续完成', checked: false }],
  attachments: [],
  gate: {
    gateVersion: 1,
    submissionGate: {
      requireTasks: false,
      requireAllTasksDone: false,
      requireCriteria: false,
      requireReadyArtifacts: false,
    },
    requiredItemCount: 1,
    requiredItemOrdinals: [1],
  },
};

const SUBMIT_REQUEST = {
  projectId: PROJECT_ID,
  requirementId: REQUIREMENT_ID,
  expectedVersion: 4,
  clientRequestId: 'req-from-ui',
  summary: '全部任务已完成。',
  reviewerSubject: 'u-other',
  artifactVersionIds: [VERSION_ID],
} as const;

const NULL_EXTRAS = {
  currentVersion: null,
  unfinishedTaskIds: null,
  unfinishedTaskCount: null,
  legacyOpenReviewCount: null,
} as const;

describe('提测 IPC 到真实 HTTP 的发送前授权', () => {
  it.each([
    'submit-account',
    'submit-epoch',
    'submit-navigation',
    'claim-account',
    'claim-epoch',
    'claim-navigation',
  ])('能力查询期间%s改变时零POST', async (scenario) => {
    let writes = 0;
    let release!: () => void;
    let entered!: () => void;
    const capabilityEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        release = () => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              capabilities: ['requirement.optional_test_reviewer'],
              service_version: 'new',
            }),
          );
        };
        entered();
      } else {
        writes += 1;
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ detail: { code: 'forbidden' } }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server');
      let account = { accountKey: 'acc-1', authEpoch: 1 };
      let trusted = true;
      const testing = new CollabTestingClient({ baseUrl: `http://127.0.0.1:${address.port}/` });
      const { handlers } = harness({
        testing,
        activeAccount: () => account,
        authorize: () => trusted,
      });
      const claim = scenario.startsWith('claim');
      const pending = handlerOf(
        handlers,
        claim ? IPC.PROJECT_TEST_ROUND_ACTION : IPC.PROJECT_REQUIREMENT_SUBMIT,
      )(
        {},
        claim
          ? {
              action: 'reviewer',
              projectId: PROJECT_ID,
              submissionId: ROUND_ID,
              expectedVersion: 1,
              clientRequestId: 'claim-deferred',
              reviewerSubject: 'u-other',
              reason: 'claim',
              claim: true,
            }
          : { ...SUBMIT_REQUEST, reviewerSubject: null },
      );
      await capabilityEntered;
      if (scenario.endsWith('account')) account = { accountKey: 'acc-2', authEpoch: 1 };
      if (scenario.endsWith('epoch')) account = { ...account, authEpoch: 2 };
      if (scenario.endsWith('navigation')) trusted = false;
      release();
      expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
      expect(writes).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it.each([
    'account',
    'epoch',
    'navigation',
    'account-microtask',
    'epoch-microtask',
    'navigation-microtask',
    'case-account',
    'case-epoch',
    'case-navigation',
    'case-account-microtask',
    'case-epoch-microtask',
    'case-navigation-microtask',
  ] as const)('%s 在取令牌期间改变时零 HTTP 写入', async (change) => {
    let writes = 0;
    const server = createServer((_request, response) => {
      writes += 1;
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ detail: { code: 'forbidden' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('缺少隔离 HTTP 地址');
      let resolveToken: (value: string | null) => void = () => {
        throw new Error('令牌尚未初始化');
      };
      const token = {
        promise: new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        }),
        resolve: (value: string | null) => resolveToken(value),
      };
      let resolveEntered: () => void = () => {
        throw new Error('入口尚未初始化');
      };
      const entered = {
        promise: new Promise<void>((resolve) => {
          resolveEntered = resolve;
        }),
        resolve: () => resolveEntered(),
      };
      let account = { accountKey: 'acc-1', authEpoch: 1 };
      let trusted = true;
      const client = new CollabTestingClient({ baseUrl: `http://127.0.0.1:${address.port}/` });
      const accessToken = async (): Promise<string | null> => {
        entered.resolve();
        return await token.promise;
      };
      const { handlers } = harness({
        testing: client,
        authorize: () => trusted,
        activeAccount: () => account,
        accessToken,
      });
      registerProjectTestCaseHandlers(
        {
          handle: (channel, listener) => {
            handlers.set(channel, listener);
          },
        },
        {
          dependencies: { testing: client, accessToken },
          authorize: () => trusted,
          activeAccount: () => account,
        },
      );
      const caseWrite = change.startsWith('case-');
      const pending = handlerOf(
        handlers,
        caseWrite ? IPC.PROJECT_ROUND_TEST_CASE_CREATE : IPC.PROJECT_REQUIREMENT_SUBMIT,
      )(
        {},
        caseWrite
          ? {
              projectId: PROJECT_ID,
              submissionId: ROUND_ID,
              clientRequestId: 'case-create',
              title: '用例',
              preconditions: '',
              steps: '操作',
              expected: '预期',
            }
          : SUBMIT_REQUEST,
      );
      await entered.promise;
      const mutate = (): void => {
        if (change.includes('account')) account = { accountKey: 'acc-2', authEpoch: 1 };
        if (change.includes('epoch')) account = { accountKey: 'acc-1', authEpoch: 2 };
        if (change.includes('navigation')) trusted = false;
      };
      if (change.endsWith('microtask')) void token.promise.then(mutate);
      else mutate();
      token.resolve('isolated-test-token');
      expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
      expect(writes).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

type Handler = (event: unknown, input: unknown) => Promise<unknown>;

const LIFECYCLE_CASES = [
  [
    'project:test-round-action',
    'POST',
    `submissions/${ROUND_ID}/withdraw`,
    {
      submissionId: ROUND_ID,
      action: 'withdraw',
      expectedVersion: 1,
      clientRequestId: 'withdraw-1',
      reason: '补充规格',
    },
    true,
  ],
  [
    'project:test-round-actions',
    'GET',
    `submissions/${ROUND_ID}/actions`,
    { submissionId: ROUND_ID, cursor: 'page-2', limit: 2 },
    false,
  ],
  ['project:test-rounds', 'GET', `projects/${PROJECT_ID}/test-rounds`, { limit: 2 }, false],
  [
    'project:test-case-execute',
    'POST',
    `test-cases/${TASK_ID}/executions`,
    {
      caseId: TASK_ID,
      expectedVersion: 1,
      clientRequestId: 'execution-1',
      result: 'failed',
      actualResult: '错误提示',
      evidenceRefs: [],
    },
    true,
  ],
  [
    'project:test-executions',
    'GET',
    `test-cases/${TASK_ID}/executions`,
    { caseId: TASK_ID, limit: 2 },
    false,
  ],
  [
    'project:test-defect-action',
    'POST',
    `defects/${TASK_ID}/fixes`,
    {
      defectId: TASK_ID,
      action: 'fix',
      expectedVersion: 1,
      clientRequestId: 'fix-1',
      summary: '已修复',
      evidenceRefs: [],
    },
    true,
  ],
  [
    'project:test-defects',
    'GET',
    `submissions/${ROUND_ID}/defects`,
    { submissionId: ROUND_ID, limit: 2 },
    false,
  ],
  [
    'project:test-defect-detail',
    'GET',
    `defects/${TASK_ID}`,
    { defectId: TASK_ID, limit: 2 },
    false,
  ],
] as const;

describe('测试生命周期八条 IPC 到真实 HTTP', () => {
  it.each(LIFECYCLE_CASES)(
    '%s 透传服务失败且发送前重新授权',
    async (channel, method, path, payload, write) => {
      const requests: { method: string | undefined; url: string | undefined }[] = [];
      const server = createServer((request, response) => {
        requests.push({ method: request.method, url: request.url });
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'version_conflict', current_version: 7 }));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('缺少隔离 HTTP 地址');
        const testing = new CollabTestingClient({ baseUrl: `http://127.0.0.1:${address.port}/` });
        const input = { projectId: PROJECT_ID, ...payload };
        const { handlers } = harness({ testing });
        const handler = handlerOf(handlers, channel);
        expect(await handler({}, input)).toMatchObject({
          ok: false,
          code: 'conflict',
          serverCode: 'version_conflict',
          ...(write ? { currentVersion: 7 } : {}),
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]?.method).toBe(method);
        expect(requests[0]?.url?.split('?')[0]).toBe(`/api/v1/${path}`);
        expect(await handler({}, { ...input, actorSubject: 'forged' })).toMatchObject({
          ok: false,
          code: 'invalidRequest',
        });
        expect(requests).toHaveLength(1);
        for (const change of ['account', 'epoch', 'navigation'] as const) {
          let account = { accountKey: 'acc-1', authEpoch: 1 };
          let trusted = true;
          const denied = harness({
            testing,
            activeAccount: () => account,
            authorize: () => trusted,
            accessToken: async () => {
              queueMicrotask(() => {
                if (change === 'account') account = { accountKey: 'acc-2', authEpoch: 1 };
                if (change === 'epoch') account = { accountKey: 'acc-1', authEpoch: 2 };
                if (change === 'navigation') trusted = false;
              });
              return 'isolated-token';
            },
          });
          expect(await handlerOf(denied.handlers, channel)({}, input)).toMatchObject({
            ok: false,
            code: 'authRequired',
          });
          expect(requests).toHaveLength(1);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});

function fakeTesting(overrides: Partial<ProjectTestingClientPort> = {}): ProjectTestingClientPort {
  return {
    actOnTestRound: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listTestRoundActions: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listProjectTestRounds: vi.fn(async () => ({
      ok: false as const,
      code: 'transient' as const,
    })),
    executeTestCase: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listTestExecutions: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    actOnTestDefect: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    listTestDefects: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    fetchTestDefect: vi.fn(async () => ({ ok: false as const, code: 'transient' as const })),
    submitRequirementForTest: vi.fn(async () => ({
      ok: true as const,
      value: { submission: ROUND, todo: TODO, replayed: false },
    })),
    listRequirementSubmissions: vi.fn(async () => ({
      ok: true as const,
      value: { submissions: [ROUND], hasMore: false, nextCursor: null },
    })),
    fetchRequirementSubmission: vi.fn(async () => ({
      ok: true as const,
      value: { submission: ROUND, snapshot: SNAPSHOT },
    })),
    ...overrides,
  };
}

interface HarnessOptions {
  readonly testing?: ProjectTestingClientPort;
  readonly dependencies?: ProjectTestingIpcDependencies | null;
  readonly authorize?: (event: unknown) => boolean;
  readonly activeAccount?: () => { accountKey: string; authEpoch: number } | null;
  readonly accessToken?: () => Promise<string | null>;
}

function harness(options: HarnessOptions = {}): {
  readonly handlers: Map<string, Handler>;
  readonly testing: ProjectTestingClientPort;
} {
  const handlers = new Map<string, Handler>();
  const testing = options.testing ?? fakeTesting();
  registerProjectTestingHandlers(
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
  return { handlers, testing };
}

function handlerOf(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler missing for ${channel}`);
  return handler;
}

describe('整需求提测 IPC 三条通道', () => {
  it('三条全部注册，通道名逐字钉住', () => {
    const { handlers } = harness();
    expect([
      IPC.PROJECT_REQUIREMENT_SUBMIT,
      IPC.PROJECT_REQUIREMENT_SUBMISSIONS,
      IPC.PROJECT_SUBMISSION_DETAIL,
    ]).toEqual([
      'project:requirement-submit',
      'project:requirement-submissions',
      'project:submission-detail',
    ]);
    expect([...handlers.keys()].sort()).toEqual(
      [
        ...LIFECYCLE_CASES.map(([channel]) => channel),
        IPC.PROJECT_REQUIREMENT_SUBMIT,
        IPC.PROJECT_REQUIREMENT_SUBMISSIONS,
        IPC.PROJECT_SUBMISSION_DETAIL,
      ].sort(),
    );
  });

  it('⭐ 提交：请求原样交给客户端（请求号不在这一层重生成），成功出参带 replayed', async () => {
    const { handlers, testing } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST),
    ).resolves.toEqual({ ok: true, submission: ROUND, todo: TODO, replayed: false });
    expect(testing.submitRequirementForTest).toHaveBeenCalledWith(
      'token',
      SUBMIT_REQUEST,
      expect.any(Function),
    );
  });

  it('⛔ 非法入参（缺请求号 / 夹带账号或快照字段 / 交付物不是版本 uuid）⇒ invalidRequest，且不打网络', async () => {
    const { handlers, testing } = harness();
    const withoutKey: Record<string, unknown> = { ...SUBMIT_REQUEST };
    delete withoutKey.clientRequestId;
    for (const bad of [
      withoutKey,
      { ...SUBMIT_REQUEST, accountKey: 'leak' },
      { ...SUBMIT_REQUEST, tasksSnapshot: [] },
      { ...SUBMIT_REQUEST, artifactVersionIds: ['asset:not-a-version'] },
    ]) {
      await expect(handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, bad)).resolves.toEqual({
        ok: false,
        code: 'invalidRequest',
        message: expect.any(String),
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.invalidRequest,
        ...NULL_EXTRAS,
      });
    }
    expect(testing.submitRequirementForTest).not.toHaveBeenCalled();
  });

  it('⭐ 失败透传 serverCode 与附加字段；currentVersion 只在 conflict 时非空', async () => {
    const cases = [
      {
        outcome: {
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'version_conflict',
          currentVersion: 7,
        },
        expected: { code: 'conflict', serverCode: 'version_conflict', currentVersion: 7 },
      },
      {
        outcome: {
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'submission_tasks_unfinished',
          unfinishedTaskIds: [TASK_ID],
          unfinishedTaskCount: 3,
        },
        expected: {
          code: 'rejected',
          serverCode: 'submission_tasks_unfinished',
          unfinishedTaskIds: [TASK_ID],
          unfinishedTaskCount: 3,
        },
      },
      {
        outcome: {
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'open_legacy_review',
          legacyOpenReviewCount: 2,
        },
        expected: { code: 'conflict', serverCode: 'open_legacy_review', legacyOpenReviewCount: 2 },
      },
      {
        outcome: {
          ok: false as const,
          code: 'forbidden' as const,
          serverCode: 'reviewer_not_independent',
          // 版本号只属于冲突：别的失败码带着它也要清成 null。
          currentVersion: 9,
        },
        expected: { code: 'forbidden', serverCode: 'reviewer_not_independent' },
      },
    ];
    for (const { outcome, expected } of cases) {
      const { handlers } = harness({
        testing: fakeTesting({ submitRequirementForTest: vi.fn(async () => outcome) }),
      });
      await expect(
        handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST),
      ).resolves.toEqual({
        ok: false,
        message: expect.any(String),
        referenceCode:
          PROJECT_COLLAB_REFERENCE_CODES[
            expected.code as keyof typeof PROJECT_COLLAB_REFERENCE_CODES
          ],
        ...NULL_EXTRAS,
        ...expected,
      });
    }
  });

  it('轮次列表：原样透传一页；失败带 serverCode', async () => {
    const { handlers, testing } = harness();
    const request = { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID, limit: 30 };
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMISSIONS)({}, request),
    ).resolves.toEqual({ ok: true, submissions: [ROUND], hasMore: false, nextCursor: null });
    expect(testing.listRequirementSubmissions).toHaveBeenCalledWith('token', request);

    const denied = harness({
      testing: fakeTesting({
        listRequirementSubmissions: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'todo_not_found',
        })),
      }),
    });
    await expect(
      handlerOf(denied.handlers, IPC.PROJECT_REQUIREMENT_SUBMISSIONS)({}, request),
    ).resolves.toMatchObject({ ok: false, code: 'rejected', serverCode: 'todo_not_found' });
    await expect(
      handlerOf(denied.handlers, IPC.PROJECT_REQUIREMENT_SUBMISSIONS)(
        {},
        { ...request, limit: 51 },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
  });

  it('单轮详情：轮次 + 快照原样透传；失败带 serverCode', async () => {
    const { handlers } = harness();
    const request = { projectId: PROJECT_ID, submissionId: ROUND_ID };
    await expect(handlerOf(handlers, IPC.PROJECT_SUBMISSION_DETAIL)({}, request)).resolves.toEqual({
      ok: true,
      submission: ROUND,
      snapshot: SNAPSHOT,
    });

    const missing = harness({
      testing: fakeTesting({
        fetchRequirementSubmission: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'submission_not_found',
        })),
      }),
    });
    await expect(
      handlerOf(missing.handlers, IPC.PROJECT_SUBMISSION_DETAIL)({}, request),
    ).resolves.toMatchObject({ ok: false, code: 'rejected', serverCode: 'submission_not_found' });
  });
});

describe('整需求提测 IPC 门禁', () => {
  it('未授权 / 无账号 / 未装配各有明确失败码，且一律不打网络', async () => {
    const testing = fakeTesting();
    const unauthorized = harness({ testing, authorize: () => false });
    await expect(
      handlerOf(unauthorized.handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired', ...NULL_EXTRAS });

    const noAccount = harness({ testing, activeAccount: () => null });
    await expect(
      handlerOf(noAccount.handlers, IPC.PROJECT_REQUIREMENT_SUBMISSIONS)(
        {},
        { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });

    const unassembled = harness({ dependencies: null });
    await expect(
      handlerOf(unassembled.handlers, IPC.PROJECT_SUBMISSION_DETAIL)(
        {},
        { projectId: PROJECT_ID, submissionId: ROUND_ID },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'unavailable' });

    expect(testing.submitRequirementForTest).not.toHaveBeenCalled();
    expect(testing.listRequirementSubmissions).not.toHaveBeenCalled();
  });

  it('拿不到令牌 ⇒ credentialRejected（不打网络）', async () => {
    const testing = fakeTesting();
    const { handlers } = harness({ testing, accessToken: async () => null });
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST),
    ).resolves.toMatchObject({ ok: false, code: 'credentialRejected' });
    expect(testing.submitRequirementForTest).not.toHaveBeenCalled();
  });

  it('⭐ 在途换账号：结果一律作废为 authRequired（不把上一个账号的回执交给下一个账号）', async () => {
    let epoch = 1;
    const testing = fakeTesting({
      submitRequirementForTest: vi.fn(async () => {
        epoch = 2;
        return { ok: true as const, value: { submission: ROUND, todo: TODO, replayed: false } };
      }),
    });
    const { handlers } = harness({
      testing,
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('客户端抛异常收敛为 transient（异常消息不跨 IPC）', async () => {
    const testing = fakeTesting({
      submitRequirementForTest: vi.fn(async () => {
        throw new Error('内部细节：token=abc');
      }),
    });
    const { handlers } = harness({ testing });
    const result = await handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SUBMIT)({}, SUBMIT_REQUEST);
    expect(result).toMatchObject({ ok: false, code: 'transient' });
    expect(JSON.stringify(result)).not.toContain('token=abc');
  });
});
