import { createServer } from 'node:http';
import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import type { ProjectTestRoundDetail } from '../../../../stratex/shared/protocol/project-testing.js';
import { describe, expect, it } from 'vitest';
import { CollabTestingClient } from '../../../../stratex/main/services/collab/collabTestingClient.js';
import {
  registerProjectTestingHandlers,
  type ProjectTestingHandlerOptions,
} from '../../../../stratex/main/ipc/projectCollabHandlersTesting.js';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
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
type Handler = (event: unknown, input: unknown) => Promise<unknown>;
function harness(options: {
  testing: CollabTestingClient;
  activeAccount?: ProjectTestingHandlerOptions['activeAccount'];
  authorize?: ProjectTestingHandlerOptions['authorize'];
}) {
  const handlers = new Map<string, Handler>();
  registerProjectTestingHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: { testing: options.testing, accessToken: async () => 'isolated-token' },
      activeAccount: options.activeAccount ?? (() => ({ accountKey: 'acc-1', authEpoch: 1 })),
      authorize: options.authorize ?? (() => true),
    },
  );
  return { handlers };
}
function handlerOf(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('Missing lifecycle handler');
  return handler;
}
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

function lifecycleSuccess(channel: string): { wire: object; expected: object } {
  const round = {
    id: ROUND_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    round_no: 1,
    state: 'withdrawn',
    submitted_by_subject: 'u-me',
    reviewer_subject: 'u-other',
    version: 2,
    created_at: ROUND.createdAt,
    updated_at: ROUND.updatedAt,
    summary: ROUND.summary,
  };
  const snapshot = { title: '历史用例', preconditions: '', steps: '操作', expected: '预期' };
  const execution = {
    id: VERSION_ID,
    case_id: TASK_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    round_id: ROUND_ID,
    result: 'failed',
    actual_result: '错误提示',
    evidence_refs: [],
    tested_by_subject: 'u-other',
    tested_at: ROUND.updatedAt,
    case_snapshot: snapshot,
  };
  const testCase = {
    id: TASK_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    submission_id: ROUND_ID,
    ordinal: 1,
    ...snapshot,
    result: 'failed',
    copied_from_case_id: null,
    created_by_subject: 'u-other',
    updated_by_subject: 'u-other',
    version: 2,
    created_at: ROUND.createdAt,
    updated_at: ROUND.updatedAt,
  };
  const defect = {
    id: TASK_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    round_id: ROUND_ID,
    case_id: TASK_ID,
    title: '错误提示缺陷',
    description: '复现说明',
    severity: 'major',
    assignee_subject: 'u-me',
    state: 'fixed',
    created_by_subject: 'u-other',
    version: 2,
    created_at: ROUND.createdAt,
    updated_at: ROUND.updatedAt,
  };
  const history = {
    id: VERSION_ID,
    defect_id: TASK_ID,
    action: 'fixed',
    from_assignee_subject: 'u-me',
    to_assignee_subject: 'u-me',
    actor_subject: 'u-me',
    summary: '已修复',
    evidence_refs: [],
    created_at: ROUND.updatedAt,
  };
  const paging = { total: 3, has_more: true, next_cursor: 'page-3' };
  const pageView = { total: 3, hasMore: true, nextCursor: 'page-3' };
  const executionView = {
    caseId: TASK_ID,
    testedBySubject: 'u-other',
    actualResult: '错误提示',
    caseSnapshot: snapshot,
  };
  const defectView = {
    id: TASK_ID,
    roundId: ROUND_ID,
    assigneeSubject: 'u-me',
    state: 'fixed',
    version: 2,
  };
  switch (channel) {
    case IPC.PROJECT_TEST_ROUND_ACTION:
      return {
        wire: { submission: round },
        expected: { submission: { ...ROUND, state: 'withdrawn', version: 2 } },
      };
    case IPC.PROJECT_TEST_ROUND_ACTIONS:
      return {
        wire: {
          ...paging,
          items: [
            {
              id: VERSION_ID,
              action: 'withdraw',
              actor_subject: 'u-me',
              reason: '补充规格',
              created_at: ROUND.updatedAt,
            },
          ],
        },
        expected: {
          ...pageView,
          items: [{ actorSubject: 'u-me', reason: '补充规格', action: 'withdraw' }],
        },
      };
    case IPC.PROJECT_TEST_ROUNDS:
      return {
        wire: { ...paging, items: [round] },
        expected: {
          ...pageView,
          items: [{ id: ROUND_ID, projectId: PROJECT_ID, state: 'withdrawn' }],
        },
      };
    case IPC.PROJECT_TEST_CASE_EXECUTE:
      return {
        wire: { test_case: testCase, execution },
        expected: {
          testCase: { id: TASK_ID, submissionId: ROUND_ID, version: 2 },
          execution: executionView,
        },
      };
    case IPC.PROJECT_TEST_EXECUTIONS:
      return {
        wire: { ...paging, items: [execution] },
        expected: { ...pageView, items: [executionView] },
      };
    case IPC.PROJECT_TEST_DEFECT_ACTION:
      return { wire: { defect }, expected: { defect: defectView } };
    case IPC.PROJECT_TEST_DEFECTS:
      return {
        wire: { ...paging, items: [defect] },
        expected: { ...pageView, items: [defectView] },
      };
    case IPC.PROJECT_TEST_DEFECT_DETAIL:
      return {
        wire: { ...paging, defect, history: [history] },
        expected: {
          ...pageView,
          defect: defectView,
          history: [{ actorSubject: 'u-me', toAssigneeSubject: 'u-me', summary: '已修复' }],
        },
      };
    default:
      throw new Error('缺少生命周期成功测试数据');
  }
}

describe('测试生命周期真实 HTTP 成功投影与响应后授权', () => {
  it.each(LIFECYCLE_CASES)(
    '%s 成功回执映射且在途身份变更后不泄漏',
    async (channel, _method, _path, payload) => {
      const fixture = lifecycleSuccess(channel);
      let account = { accountKey: 'acc-1', authEpoch: 1 };
      let trusted = true;
      let change: 'none' | 'account' | 'epoch' | 'navigation' = 'none';
      let requests = 0;
      const server = createServer((_request, response) => {
        requests += 1;
        // 请求实际抵达后、HTTP 回执返回前改变授权，验证响应侧复核而非发送前拦截。
        if (change === 'account') account = { accountKey: 'acc-2', authEpoch: 1 };
        if (change === 'epoch') account = { accountKey: 'acc-1', authEpoch: 2 };
        if (change === 'navigation') trusted = false;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(fixture.wire));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('缺少隔离 HTTP 地址');
        const testing = new CollabTestingClient({ baseUrl: `http://127.0.0.1:${address.port}/` });
        const { handlers } = harness({
          testing,
          activeAccount: () => account,
          authorize: () => trusted,
        });
        const handler = handlerOf(handlers, channel);
        const input = { projectId: PROJECT_ID, ...payload };
        const success = await handler({}, input);
        expect(success).toMatchObject({ ok: true, ...fixture.expected });
        expect(JSON.stringify(success)).not.toMatch(
          /project_id|actor_subject|tested_by_subject|next_cursor/,
        );
        expect(requests).toBe(1);
        for (const invalidation of ['account', 'epoch', 'navigation'] as const) {
          account = { accountKey: 'acc-1', authEpoch: 1 };
          trusted = true;
          change = invalidation;
          const previousRequests = requests;
          const rejected = await handler({}, input);
          expect(requests).toBe(previousRequests + 1);
          expect(rejected).toMatchObject({ ok: false, code: 'authRequired' });
          expect(JSON.stringify(rejected)).not.toMatch(
            /补充规格|历史用例|错误提示|已修复|u-me|u-other/,
          );
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
