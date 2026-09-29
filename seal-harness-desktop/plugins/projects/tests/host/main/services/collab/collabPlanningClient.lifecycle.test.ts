import { describe, expect, it, vi } from 'vitest';

import { createCollabPlanningClient } from '../../../../../stratex/main/services/collab/collabPlanningClient.js';

/**
 * 规划域生命周期六个端点（MIL-07）的网络面：路径、请求体、失败分档与阶段记录投影。
 *
 * ⭐ 盯的判据：
 *  - 四条写路径打到 `.../{complete|reopen}`，请求体恰好是契约四键（snake_case）——幂等键原样上送；
 *  - 409 版本冲突带回 currentVersion，其余 409 / 422 靠 serverCode 区分（服务端文案 ⛔ 不透传）；
 *  - 阶段记录的数组键是服务端的 `events`，投影成客户端契约的 `items`；一条坏整页拒。
 */

const BASE_URL = 'http://collab.invalid/';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MILESTONE_ID = '22222222-2222-4222-8222-222222222222';
const ITERATION_ID = '33333333-3333-4333-8333-333333333333';
const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

function milestoneWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MILESTONE_ID,
    name: '成员邀请与权限管理',
    objective_md: '',
    owner_subject: null,
    status: 'completed',
    start_at: null,
    due_at: null,
    archived_at: null,
    version: 5,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    iteration_summary: { total: 2, open: 0, completed: 2 },
    visible_requirement_count: 3,
    ...overrides,
  };
}

function iterationWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    linked_requirements: [],
    linked_requirements_has_more: false,
    id: ITERATION_ID,
    milestone_id: MILESTONE_ID,
    name: '迭代 1 · 需求录入与认领',
    criteria_md: '完成本轮范围并通过验收',
    owner_subject: 'u-bob',
    priority: 'medium',
    status: 'completed',
    due_at: null,
    archived_at: null,
    version: 2,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    ...overrides,
  };
}

function eventWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    iteration_id: ITERATION_ID,
    from_status: 'open',
    to_status: 'completed',
    actor_subject: 'u-alice',
    reason: '三条验收用例全部通过',
    evidence_refs: [`todo:${REQUIREMENT_ID}`],
    occurred_at: '2026-09-05T08:00:00Z',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createCollabPlanningClient({ baseUrl: BASE_URL, fetchImpl });
}

function call(fetchImpl: ReturnType<typeof vi.fn>, index = 0): { url: URL; init: RequestInit } {
  const args = fetchImpl.mock.calls[index] as [URL, RequestInit];
  return { url: new URL(String(args[0])), init: args[1] };
}

const LIFECYCLE_BODY = {
  expectedVersion: 1,
  clientRequestId: 'req-life-1',
  reason: '三条验收用例全部通过',
  evidenceRefs: [`todo:${REQUIREMENT_ID}`],
};

describe('collab planning lifecycle writes', () => {
  it('完成一轮迭代：POST .../iterations/{id}/complete，请求体恰为契约四键', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { iteration: iterationWire() }));
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).completeIteration(
      'tok',
      { projectId: PROJECT_ID, iterationId: ITERATION_ID, ...LIFECYCLE_BODY },
    );

    expect(outcome).toMatchObject({
      ok: true,
      value: { id: ITERATION_ID, status: 'completed', version: 2 },
    });
    const { url, init } = call(fetchImpl);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/iterations/${ITERATION_ID}/complete`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      expected_version: 1,
      client_request_id: 'req-life-1',
      reason: '三条验收用例全部通过',
      evidence_refs: [`todo:${REQUIREMENT_ID}`],
    });
    // 令牌只进 Authorization 头：⛔ 不进路径、查询串或请求体。
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(url.search).toBe('');
    expect(String(init.body)).not.toContain('tok');
  });

  it('四条写路径各打各的动作段（目标 / 轮次不串、完成 / 重开不反）', async () => {
    const fetchImpl = vi.fn(async (input: URL) =>
      String(input).includes('/milestones/')
        ? jsonResponse(200, { milestone: milestoneWire() })
        : jsonResponse(200, { iteration: iterationWire() }),
    );
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    const milestoneInput = { projectId: PROJECT_ID, milestoneId: MILESTONE_ID, ...LIFECYCLE_BODY };
    const iterationInput = { projectId: PROJECT_ID, iterationId: ITERATION_ID, ...LIFECYCLE_BODY };

    await expect(client.completeMilestone('tok', milestoneInput)).resolves.toMatchObject({
      ok: true,
      value: { id: MILESTONE_ID, iterationSummary: { completed: 2 } },
    });
    await client.reopenMilestone('tok', milestoneInput);
    await client.completeIteration('tok', iterationInput);
    await client.reopenIteration('tok', iterationInput);

    expect(fetchImpl.mock.calls.map((_, index) => call(fetchImpl, index).url.pathname)).toEqual([
      `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/complete`,
      `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/reopen`,
      `/api/v1/projects/${PROJECT_ID}/iterations/${ITERATION_ID}/complete`,
      `/api/v1/projects/${PROJECT_ID}/iterations/${ITERATION_ID}/reopen`,
    ]);
  });

  it('409 版本冲突带回 currentVersion；其余 409 与 422 靠 serverCode 分开，服务端文案不透传', async () => {
    const cases: readonly [number, Record<string, unknown>, Record<string, unknown>][] = [
      [
        409,
        { error: 'version_conflict', detail: '给人看的', current_version: 7 },
        { ok: false, code: 'conflict', currentVersion: 7 },
      ],
      [
        409,
        { error: 'milestone_has_open_rounds', detail: '给人看的', open_round_count: 2 },
        { ok: false, code: 'conflict', serverCode: 'milestone_has_open_rounds' },
      ],
      [
        409,
        { error: 'idempotency_conflict', detail: '给人看的' },
        { ok: false, code: 'conflict', serverCode: 'idempotency_conflict' },
      ],
      [
        422,
        { error: 'completion_evidence_required', detail: '给人看的' },
        { ok: false, code: 'rejected', serverCode: 'completion_evidence_required' },
      ],
      [403, { error: 'forbidden' }, { ok: false, code: 'forbidden', serverCode: 'forbidden' }],
      [
        404,
        { error: 'milestone_not_found' },
        { ok: false, code: 'rejected', serverCode: 'milestone_not_found' },
      ],
    ];
    for (const [status, body, expected] of cases) {
      const fetchImpl = vi.fn(async () => jsonResponse(status, body));
      const outcome = await clientWith(fetchImpl as unknown as typeof fetch).completeMilestone(
        'tok',
        { projectId: PROJECT_ID, milestoneId: MILESTONE_ID, ...LIFECYCLE_BODY },
      );
      expect(outcome).toEqual(expected);
      expect(JSON.stringify(outcome)).not.toContain('给人看的');
    }
  });

  it('成功体不可信（投影缺键）⇒ transient，不当成功', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { iteration: iterationWire({ status: 'done' }) }),
    );
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).reopenIteration('tok', {
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        ...LIFECYCLE_BODY,
      }),
    ).resolves.toEqual({ ok: false, code: 'transient' });
  });
});

describe('collab planning lifecycle stage records', () => {
  it('GET .../iterations/{id}/events：服务端 `events` 投影成 `items`，正文原样', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        events: [
          eventWire(),
          eventWire({
            id: '66666666-6666-4666-8666-666666666666',
            from_status: 'completed',
            to_status: 'open',
            reason: '客户追加一轮验收',
            evidence_refs: [],
          }),
        ],
        total: 2,
        page: 1,
        page_size: 100,
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listIterationEvents(
      'tok',
      { projectId: PROJECT_ID, iterationId: ITERATION_ID, pageSize: 100 },
    );

    expect(outcome).toEqual({
      ok: true,
      value: {
        items: [
          {
            id: EVENT_ID,
            iterationId: ITERATION_ID,
            fromStatus: 'open',
            toStatus: 'completed',
            actorSubject: 'u-alice',
            reason: '三条验收用例全部通过',
            evidenceRefs: [`todo:${REQUIREMENT_ID}`],
            occurredAt: '2026-09-05T08:00:00Z',
          },
          {
            id: '66666666-6666-4666-8666-666666666666',
            iterationId: ITERATION_ID,
            fromStatus: 'completed',
            toStatus: 'open',
            actorSubject: 'u-alice',
            reason: '客户追加一轮验收',
            evidenceRefs: [],
            occurredAt: '2026-09-05T08:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      },
    });
    const { url, init } = call(fetchImpl);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/iterations/${ITERATION_ID}/events`);
    expect(url.searchParams.get('page_size')).toBe('100');
    expect(init.method).toBe('GET');
  });

  it('目标的阶段记录走 .../milestones/{id}/events；缺正文键按空投影', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        events: [
          {
            id: EVENT_ID,
            milestone_id: MILESTONE_ID,
            from_status: 'open',
            to_status: 'completed',
            actor_subject: 'u-alice',
            occurred_at: '2026-09-05T08:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listMilestoneEvents(
      'tok',
      { projectId: PROJECT_ID, milestoneId: MILESTONE_ID },
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: { items: [{ milestoneId: MILESTONE_ID, reason: '', evidenceRefs: [] }], total: 1 },
    });
    expect(call(fetchImpl).url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/events`,
    );
  });

  it('⭐ 读侧不严于服务端写入契约：含空白 / 中文的证据引用照常读回，整页不失败', async () => {
    // 服务端写入只校验「非空、≤256 字符、≤16 条」，不查 token 形状——别的写入方写进来的
    // 这类引用是合法数据。读侧若套写入前的 token 正则，一条就让整页阶段记录取不回来。
    const loose = ['验收记录 第二版', `${'引'.repeat(256)}`, 'submission: 带空白'];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        events: [
          eventWire(),
          eventWire({ id: '88888888-8888-4888-8888-888888888888', evidence_refs: loose }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listIterationEvents(
      'tok',
      { projectId: PROJECT_ID, iterationId: ITERATION_ID },
    );
    expect(outcome).toMatchObject({ ok: true, value: { total: 2 } });
    expect(outcome.ok && outcome.value.items[1]?.evidenceRefs).toEqual(loose);
  });

  it('一条阶段记录越出服务端契约（状态越出闭集 / 空引用 / 超长引用）⇒ 整页 transient', async () => {
    for (const bad of [
      { to_status: 'done' },
      { evidence_refs: [''] },
      { evidence_refs: ['a'.repeat(257)] },
    ]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          events: [eventWire(), eventWire({ id: '77777777-7777-4777-8777-777777777777', ...bad })],
          total: 2,
          page: 1,
          page_size: 20,
        }),
      );
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).listIterationEvents('tok', {
          projectId: PROJECT_ID,
          iterationId: ITERATION_ID,
        }),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('读失败按状态分档并透传业务码（跨项目 / 不存在 404）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'iteration_not_found' }));
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listIterationEvents('tok', {
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
      }),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'iteration_not_found' });
  });
});
