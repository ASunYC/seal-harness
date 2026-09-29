import { describe, expect, it, vi } from 'vitest';

import type { ProjectRequirementSubmitRequest } from '../../../../../stratex/shared/protocol/project-testing.js';
import { createCollabTestingClient } from '../../../../../stratex/main/services/collab/collabTestingClient.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_REQUIREMENT_ID = '77777777-7777-4777-8777-777777777777';

// 测试假地址独立成行：guard-no-runtime-fetch 按「同一行 fetch 词 + http://」判定。
const BASE_URL = 'http://collab.invalid/';

function roundWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUND_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    round_no: 1,
    state: 'queued',
    submitted_by_subject: 'u-me',
    reviewer_subject: 'u-other',
    version: 1,
    created_at: '2026-09-14T08:00:00+00:00',
    updated_at: '2026-09-14T08:00:00+00:00',
    summary: '全部任务已完成，交付物见附件。',
    ...overrides,
  };
}

function todoWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REQUIREMENT_ID,
    item_kind: 'requirement',
    title: '需求整体提测',
    status: 'inReview',
    assignee_subject: 'u-me',
    assignee_display_name: '林舟',
    priority: 'high',
    labels: [],
    due_at: null,
    description: '',
    version: 5,
    created_at: '2026-09-10T00:00:00+00:00',
    updated_at: '2026-09-14T08:00:00+00:00',
    ...overrides,
  };
}

function snapshotWire(): Record<string, unknown> {
  return {
    requirement: {
      id: REQUIREMENT_ID,
      title: '需求整体提测',
      description: '说明',
      priority: 'high',
      status: 'inProgress',
      constraints_text: '',
      labels: ['检索'],
      item_kind: 'requirement',
    },
    tasks: [
      {
        id: TASK_ID,
        parent_id: REQUIREMENT_ID,
        title: '补齐接口',
        status: 'done',
        item_kind: 'task',
      },
    ],
    criteria: [{ ordinal: 1, text: '主要流程可连续完成', checked: false }],
    attachments: [
      {
        file_version_id: VERSION_ID,
        asset_id: ASSET_ID,
        version_no: 2,
        filename: '交付说明.docx',
        content_sha256: 'a'.repeat(64),
        byte_size: 1024,
      },
    ],
    gate: {
      gate_version: 3,
      submission_gate: {
        require_tasks: true,
        require_all_tasks_done: true,
        require_criteria: true,
        require_ready_artifacts: false,
      },
      required_item_count: 1,
      required_item_ordinals: [1],
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createCollabTestingClient({ baseUrl: BASE_URL, fetchImpl });
}

/** 取一次 fetch 调用的 URL、init 与请求体（体只在写请求上有）。 */
function callOf(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  const call = fetchImpl.mock.calls[index];
  const url = call?.[0] as URL;
  const init = call?.[1] as RequestInit | undefined;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { url, init, body };
}

const SUBMIT_INPUT: ProjectRequirementSubmitRequest = {
  projectId: PROJECT_ID,
  requirementId: REQUIREMENT_ID,
  expectedVersion: 4,
  clientRequestId: 'req-submit-1',
  summary: '全部任务已完成，交付物见附件。',
  reviewerSubject: 'u-other',
  artifactVersionIds: [VERSION_ID],
};

describe('CollabTestingClient 整需求提交', () => {
  it.each(['submit', 'claim'] as const)('capability等待后失效的%s不得POST', async (action) => {
    let release!: (response: Response) => void;
    const capability = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, {}))
      .mockReturnValueOnce(capability);
    const client = clientWith(fetchImpl);
    let current = true;
    const pending =
      action === 'submit'
        ? client.submitRequirementForTest(
            'old-token',
            { ...SUBMIT_INPUT, reviewerSubject: null },
            () => current,
          )
        : client.actOnTestRound(
            'old-token',
            {
              action: 'reviewer',
              projectId: PROJECT_ID,
              submissionId: ROUND_ID,
              expectedVersion: 1,
              clientRequestId: 'claim-stale',
              reviewerSubject: 'u-me',
              reason: 'claim',
              claim: true,
            },
            () => current,
          );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    current = false;
    release(
      jsonResponse(200, {
        capabilities: ['requirement.optional_test_reviewer'],
        service_version: 'new',
      }),
    );
    await pending;
    expect(
      fetchImpl.mock.calls.filter((call) => (call[1] as RequestInit).method === 'POST'),
    ).toHaveLength(0);
  });
  it('空负责人先协商能力，新服务保留null，旧服务不发送写请求', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          capabilities: ['requirement.optional_test_reviewer'],
          service_version: 'new',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, { submission: roundWire({ reviewer_subject: null }), todo: todoWire() }),
      );
    const result = await clientWith(fetchImpl).submitRequirementForTest('tok', {
      ...SUBMIT_INPUT,
      reviewerSubject: null,
    });
    expect(result.ok).toBe(true);
    expect(callOf(fetchImpl, 1).body).toEqual(expect.objectContaining({ reviewer_subject: null }));
    const old = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { capabilities: [], service_version: 'old' }));
    expect(
      await clientWith(old).submitRequirementForTest('tok', {
        ...SUBMIT_INPUT,
        reviewerSubject: null,
      }),
    ).toEqual({ ok: false, code: 'rejected', serverCode: 'optional_test_reviewer_unsupported' });
    expect(old).toHaveBeenCalledTimes(1);
  });

  it('显式认领能力不支持时禁止发送reviewer写请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const result = await clientWith(fetchImpl).actOnTestRound('tok', {
      action: 'reviewer',
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      expectedVersion: 1,
      clientRequestId: 'claim-1',
      reviewerSubject: 'u-me',
      reason: '认领测试',
      claim: true,
    });
    expect(result).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'optional_test_reviewer_unsupported',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('⭐ 按 todo id 打端点；请求体逐键就是服务端那五个键（⛔ 不带 projectId、快照与账号）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { submission: roundWire(), todo: todoWire() }),
    );
    await clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
      'tok',
      SUBMIT_INPUT,
    );

    const { url, init, body } = callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(`/api/v1/todos/${REQUIREMENT_ID}/submissions`);
    expect(body).toEqual({
      expected_version: 4,
      client_request_id: 'req-submit-1',
      summary: '全部任务已完成，交付物见附件。',
      reviewer_subject: 'u-other',
      artifacts: [{ file_version_id: VERSION_ID }],
    });
    // 令牌只进 Authorization 头（⛔ 不进查询串）。
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(url.search).toBe('');
  });

  it('没选交付物也显式发空数组（同一次点击的重试，请求体逐字节一致）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { submission: roundWire(), todo: todoWire() }),
    );
    await clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest('tok', {
      ...SUBMIT_INPUT,
      artifactVersionIds: [],
    });
    expect((callOf(fetchImpl).body as Record<string, unknown>).artifacts).toEqual([]);
  });

  it('201 ⇒ 新建（replayed=false）；轮次与需求投影成 camelCase', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { submission: roundWire(), todo: todoWire() }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
      'tok',
      SUBMIT_INPUT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.replayed).toBe(false);
    expect(outcome.value.submission).toEqual({
      id: ROUND_ID,
      projectId: PROJECT_ID,
      requirementId: REQUIREMENT_ID,
      roundNo: 1,
      state: 'queued',
      submittedBySubject: 'u-me',
      reviewerSubject: 'u-other',
      version: 1,
      createdAt: '2026-09-14T08:00:00+00:00',
      updatedAt: '2026-09-14T08:00:00+00:00',
      summary: '全部任务已完成，交付物见附件。',
    });
    expect(outcome.value.todo.id).toBe(REQUIREMENT_ID);
    expect(outcome.value.todo.status).toBe('inReview');
  });

  it('200 ⇒ 同号同内容的重试命中回放（replayed=true，⛔ 不是失败）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { submission: roundWire(), todo: todoWire() }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
      'tok',
      SUBMIT_INPUT,
    );
    expect(outcome.ok && outcome.value.replayed).toBe(true);
  });

  it('⛔ 服务端多给的未知字段进不了投影（逐字段挑选，不透传）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, {
        submission: roundWire({ request_fingerprint: 'f'.repeat(64) }),
        todo: todoWire(),
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
      'tok',
      SUBMIT_INPUT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.submission).not.toHaveProperty('requestFingerprint');
    expect(outcome.value.submission).not.toHaveProperty('request_fingerprint');
  });

  it('2xx 坏形状一律 transient：未知状态 / 缺需求 / 轮次不属于这条需求或这个项目', async () => {
    for (const body of [
      { submission: roundWire({ state: 'pending' }), todo: todoWire() },
      { submission: roundWire() },
      { submission: roundWire({ requirement_id: OTHER_REQUIREMENT_ID }), todo: todoWire() },
      {
        submission: roundWire({ project_id: '88888888-8888-4888-8888-888888888888' }),
        todo: todoWire(),
      },
      { submission: roundWire(), todo: todoWire({ id: OTHER_REQUIREMENT_ID }) },
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(201, body));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
          'tok',
          SUBMIT_INPUT,
        ),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('409 版本冲突：业务码与当前版本一起带回', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: 'version_conflict', detail: '不透传', current_version: 7 }),
    );
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
        'tok',
        SUBMIT_INPUT,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      currentVersion: 7,
    });
  });

  it('⭐ 409 缺 current_version 仍带 serverCode（⛔ 不塌缩成无码 conflict）', async () => {
    for (const code of [
      'idempotency_retry',
      'idempotency_conflict',
      'active_round_exists',
      'legacy_review_in_progress',
      'requirement_not_submittable',
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(409, { error: code, detail: '不透传' }));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
          'tok',
          SUBMIT_INPUT,
        ),
      ).resolves.toEqual({ ok: false, code: 'conflict', serverCode: code });
    }
  });

  it('409 旧评审未结：带回条数（⛔ 不带是哪几条）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: 'open_legacy_review', legacy_open_review_count: 3 }),
    );
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
        'tok',
        SUBMIT_INPUT,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'open_legacy_review',
      legacyOpenReviewCount: 3,
    });
  });

  it('422 未完成任务：id 与总数映射出来；其余 422 只带业务码', async () => {
    const unfinished = vi.fn(async () =>
      jsonResponse(422, {
        error: 'submission_tasks_unfinished',
        detail: '不透传',
        unfinished_task_ids: [TASK_ID],
        unfinished_task_count: 4,
      }),
    );
    await expect(
      clientWith(unfinished as unknown as typeof fetch).submitRequirementForTest(
        'tok',
        SUBMIT_INPUT,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'submission_tasks_unfinished',
      unfinishedTaskIds: [TASK_ID],
      unfinishedTaskCount: 4,
    });

    const reviewer = vi.fn(async () => jsonResponse(422, { error: 'reviewer_not_editor' }));
    await expect(
      clientWith(reviewer as unknown as typeof fetch).submitRequirementForTest('tok', SUBMIT_INPUT),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'reviewer_not_editor' });
  });

  it('附加字段形状不对就丢掉那几个键（⛔ 不编数），业务码照带', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, {
        error: 'submission_tasks_unfinished',
        unfinished_task_ids: ['not-a-uuid'],
        unfinished_task_count: -1,
      }),
    );
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).submitRequirementForTest(
        'tok',
        SUBMIT_INPUT,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'submission_tasks_unfinished',
    });
  });

  it('403 / 404 按状态分档并带业务码；5xx 与网络失败是 transient 且不带业务码', async () => {
    const forbidden = vi.fn(async () => jsonResponse(403, { error: 'reviewer_not_independent' }));
    await expect(
      clientWith(forbidden as unknown as typeof fetch).submitRequirementForTest(
        'tok',
        SUBMIT_INPUT,
      ),
    ).resolves.toEqual({ ok: false, code: 'forbidden', serverCode: 'reviewer_not_independent' });

    const missing = vi.fn(async () => jsonResponse(404, { error: 'artifact_not_found' }));
    await expect(
      clientWith(missing as unknown as typeof fetch).submitRequirementForTest('tok', SUBMIT_INPUT),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'artifact_not_found' });

    const broken = vi.fn(async () => jsonResponse(500, { error: 'internal_error' }));
    await expect(
      clientWith(broken as unknown as typeof fetch).submitRequirementForTest('tok', SUBMIT_INPUT),
    ).resolves.toEqual({ ok: false, code: 'transient' });

    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      clientWith(offline as unknown as typeof fetch).submitRequirementForTest('tok', SUBMIT_INPUT),
    ).resolves.toEqual({ ok: false, code: 'transient' });
  });
});

describe('CollabTestingClient 轮次列表', () => {
  const LIST_INPUT = { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID } as const;

  it('按需求打端点；游标与条数按给的发，没给就不发', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { submissions: [], has_more: false, next_cursor: null }),
    );
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    await client.listRequirementSubmissions('tok', LIST_INPUT);
    await client.listRequirementSubmissions('tok', { ...LIST_INPUT, cursor: 'c-2', limit: 30 });

    const first = callOf(fetchImpl, 0);
    expect(first.init?.method).toBe('GET');
    expect(first.url.pathname).toBe(`/api/v1/todos/${REQUIREMENT_ID}/submissions`);
    expect(first.url.search).toBe('');
    const second = callOf(fetchImpl, 1);
    expect(second.url.searchParams.get('cursor')).toBe('c-2');
    expect(second.url.searchParams.get('limit')).toBe('30');
  });

  it('投影出最新在前的一页（服务端定序，⛔ 不重排）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        submissions: [
          roundWire({ id: '99999999-9999-4999-8999-999999999992', round_no: 2 }),
          roundWire({ round_no: 1, state: 'returned' }),
        ],
        has_more: true,
        next_cursor: 'cursor-next',
      }),
    );
    const outcome = await clientWith(
      fetchImpl as unknown as typeof fetch,
    ).listRequirementSubmissions('tok', LIST_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.submissions.map((round) => round.roundNo)).toEqual([2, 1]);
    expect(outcome.value.submissions[1]?.state).toBe('returned');
    expect(outcome.value.hasMore).toBe(true);
    expect(outcome.value.nextCursor).toBe('cursor-next');
  });

  it('⛔ 一条坏全批坏；游标与 hasMore 不同生同灭、混进别的需求的轮次都判不可信', async () => {
    for (const body of [
      {
        submissions: [roundWire(), roundWire({ state: 'archived' })],
        has_more: false,
        next_cursor: null,
      },
      { submissions: [roundWire()], has_more: true, next_cursor: null },
      {
        submissions: [roundWire({ requirement_id: OTHER_REQUIREMENT_ID })],
        has_more: false,
        next_cursor: null,
      },
      { submissions: [roundWire()] },
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, body));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).listRequirementSubmissions(
          'tok',
          LIST_INPUT,
        ),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('需求不可见 404 带业务码', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'todo_not_found' }));
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listRequirementSubmissions(
        'tok',
        LIST_INPUT,
      ),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'todo_not_found' });
  });
});

describe('CollabTestingClient 单轮详情', () => {
  const DETAIL_INPUT = { projectId: PROJECT_ID, submissionId: ROUND_ID } as const;

  it('轮次 + 五面快照逐面映射成 camelCase', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { submission: roundWire(), snapshot: snapshotWire() }),
    );
    const outcome = await clientWith(
      fetchImpl as unknown as typeof fetch,
    ).fetchRequirementSubmission('tok', DETAIL_INPUT);
    expect(callOf(fetchImpl).url.pathname).toBe(`/api/v1/submissions/${ROUND_ID}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.submission.summary).toBe('全部任务已完成，交付物见附件。');
    expect(outcome.value.snapshot).toEqual({
      requirement: {
        id: REQUIREMENT_ID,
        title: '需求整体提测',
        description: '说明',
        priority: 'high',
        status: 'inProgress',
        constraintsText: '',
        labels: ['检索'],
        itemKind: 'requirement',
      },
      tasks: [
        {
          id: TASK_ID,
          parentId: REQUIREMENT_ID,
          title: '补齐接口',
          status: 'done',
          itemKind: 'task',
        },
      ],
      criteria: [{ ordinal: 1, text: '主要流程可连续完成', checked: false }],
      attachments: [
        {
          fileVersionId: VERSION_ID,
          assetId: ASSET_ID,
          versionNo: 2,
          filename: '交付说明.docx',
          contentSha256: 'a'.repeat(64),
          byteSize: 1024,
        },
      ],
      gate: {
        gateVersion: 3,
        submissionGate: {
          requireTasks: true,
          requireAllTasksDone: true,
          requireCriteria: true,
          requireReadyArtifacts: false,
        },
        requiredItemCount: 1,
        requiredItemOrdinals: [1],
      },
    });
  });

  it('门槛闭集外的键挑不进投影（逐字段挑选）；闭集内缺一个布尔即整份不可信', async () => {
    const gateWithExtra = snapshotWire();
    const gate = (gateWithExtra.gate as Record<string, Record<string, unknown>>).submission_gate!;
    gate.per_task = true;
    const extra = vi.fn(async () =>
      jsonResponse(200, { submission: roundWire(), snapshot: gateWithExtra }),
    );
    const accepted = await clientWith(extra as unknown as typeof fetch).fetchRequirementSubmission(
      'tok',
      DETAIL_INPUT,
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Object.keys(accepted.value.snapshot.gate.submissionGate)).toEqual([
        'requireTasks',
        'requireAllTasksDone',
        'requireCriteria',
        'requireReadyArtifacts',
      ]);
    }

    const missingSwitch = snapshotWire();
    delete (missingSwitch.gate as Record<string, Record<string, unknown>>).submission_gate!
      .require_criteria;
    const missing = vi.fn(async () =>
      jsonResponse(200, { submission: roundWire(), snapshot: missingSwitch }),
    );
    await expect(
      clientWith(missing as unknown as typeof fetch).fetchRequirementSubmission(
        'tok',
        DETAIL_INPUT,
      ),
    ).resolves.toEqual({ ok: false, code: 'transient' });
  });

  it('⛔ 快照缺面（空对象）、回来的不是这一轮：一律 transient', async () => {
    for (const body of [
      { submission: roundWire(), snapshot: {} },
      {
        submission: roundWire({ id: '99999999-9999-4999-8999-999999999999' }),
        snapshot: snapshotWire(),
      },
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, body));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).fetchRequirementSubmission(
          'tok',
          DETAIL_INPUT,
        ),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('不存在 / 不可见同一个 404 业务码', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'submission_not_found' }));
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).fetchRequirementSubmission(
        'tok',
        DETAIL_INPUT,
      ),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'submission_not_found' });
  });
});

describe('测试闭环客户端边界', () => {
  it('轮次动作历史保留签署事实并传递分页位置', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, {
        items: [
          {
            id: ROUND_ID,
            action: 'withdraw',
            actor_subject: 'reviewer',
            reason: '补充证据',
            created_at: '2026-09-16T00:00:00Z',
          },
        ],
        total: 2,
        has_more: true,
        next_cursor: 'next-page',
      }),
    );
    const result = await clientWith(send).listTestRoundActions('test-token', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      cursor: 'page-one',
      limit: 1,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        ok: true,
        items: [{ actorSubject: 'reviewer', reason: '补充证据' }],
        hasMore: true,
        nextCursor: 'next-page',
      },
    });
    expect(String(send.mock.calls[0]?.[0])).toContain(
      `/submissions/${ROUND_ID}/actions?cursor=page-one&limit=1`,
    );
  });
  it('撤回动作透传轮次版本与原因，保留服务器实体', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, {
        submission: roundWire({ state: 'withdrawn' }),
        todo: todoWire({ status: 'inProgress' }),
      }),
    );
    const result = await clientWith(send).actOnTestRound('test-token', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      action: 'withdraw',
      expectedVersion: 1,
      clientRequestId: 'withdraw-1',
      reason: '补充交付',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { ok: true, submission: { state: 'withdrawn' } },
    });
    const call = send.mock.calls[0];
    expect(String(call?.[0])).toBe(`${BASE_URL}api/v1/submissions/${ROUND_ID}/withdraw`);
    expect(call?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      expected_version: 1,
      client_request_id: 'withdraw-1',
      reason: '补充交付',
    });
  });
  it('项目列表拒绝其他项目轮次，不能显示跨项目数据', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, {
        items: [roundWire({ project_id: OTHER_REQUIREMENT_ID })],
        total: 1,
        has_more: false,
        next_cursor: null,
      }),
    );
    expect(
      await clientWith(send).listProjectTestRounds('test-token', { projectId: PROJECT_ID }),
    ).toEqual({ ok: false, code: 'transient' });
  });
  it('结论版本冲突保留当前版本以供显式重签', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      jsonResponse(409, { code: 'version_conflict', current_version: 7 }),
    );
    expect(
      await clientWith(send).actOnTestRound('test-token', {
        projectId: PROJECT_ID,
        submissionId: ROUND_ID,
        action: 'decision',
        expectedVersion: 1,
        clientRequestId: 'decision-1',
        decision: 'returned',
        reason: '回归未过',
      }),
    ).toMatchObject({ ok: false, code: 'conflict', currentVersion: 7 });
  });
});
