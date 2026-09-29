import { describe, expect, it, vi } from 'vitest';

import { createCollabPlanningClient } from '../../../../../stratex/main/services/collab/collabPlanningClient.js';

const BASE_URL = 'http://collab.invalid/';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MILESTONE_ID = '22222222-2222-4222-8222-222222222222';
const ITERATION_ID = '33333333-3333-4333-8333-333333333333';

function milestoneWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MILESTONE_ID,
    name: '成员邀请与权限管理',
    objective_md: '',
    owner_subject: null,
    status: 'open',
    start_at: null,
    due_at: null,
    archived_at: null,
    version: 1,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    iteration_summary: { total: 0, open: 0, completed: 0 },
    visible_requirement_count: 0,
    ...overrides,
  };
}

function iterationWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // 关联摘要两个键服务端恒回；映射层不兜默认值，夹具少了它们整条投影是 null。
    linked_requirements: [],
    linked_requirements_has_more: false,
    id: ITERATION_ID,
    milestone_id: MILESTONE_ID,
    name: '第一轮',
    criteria_md: '',
    owner_subject: 'u-bob',
    priority: 'medium',
    status: 'open',
    due_at: null,
    archived_at: null,
    version: 1,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
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

/** 取一次 fetch 调用的 URL 与请求体（体只在写请求上有）。 */
async function callOf(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  const call = fetchImpl.mock.calls[index];
  const url = call?.[0] as URL;
  const init = call?.[1] as RequestInit | undefined;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { url, init, body };
}

describe('CollabPlanningClient 列表', () => {
  it('目标列表：查询参数按 snake_case 拼，投影出 camelCase 分页信封', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [milestoneWire()], total: 1, page: 2, page_size: 20 }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listMilestones('tok', {
      projectId: PROJECT_ID,
      page: 2,
      pageSize: 20,
      q: '邀请',
      includeArchived: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.total).toBe(1);
    expect(outcome.value.page).toBe(2);
    expect(outcome.value.items[0]?.id).toBe(MILESTONE_ID);

    const { url, init } = await callOf(fetchImpl);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/milestones`);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.get('q')).toBe('邀请');
    expect(url.searchParams.get('include_archived')).toBe('true');
    // 令牌只进 Authorization 头（⛔ 不进查询串——查询串会进代理与访问日志）。
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(url.search).not.toContain('tok');
    // 没给时间段就不发（CORE-08 之前的请求逐字不变）。
    expect(url.searchParams.has('plan_from')).toBe(false);
  });

  it('目标列表：计划时间段两端映射到 plan_from / plan_to（CORE-08，ADR-0042）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 }),
    );
    await clientWith(fetchImpl as unknown as typeof fetch).listMilestones('tok', {
      projectId: PROJECT_ID,
      planFrom: '2026-09-01T00:00:00.000Z',
      planTo: '2026-10-01T00:00:00.000Z',
    });

    const { url } = await callOf(fetchImpl);
    expect(url.searchParams.get('plan_from')).toBe('2026-09-01T00:00:00.000Z');
    expect(url.searchParams.get('plan_to')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('轮次列表：分组计数原样带回；「未关联」用独立参数而不是空的 milestone_id', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [iterationWire({ milestone_id: null })],
        total: 1,
        page: 1,
        page_size: 20,
        group_counts: { mine: 1, open: 1, completed: 0 },
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listIterations('tok', {
      projectId: PROJECT_ID,
      unlinked: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.groupCounts).toEqual({ mine: 1, open: 1, completed: 0 });
    expect(outcome.value.items[0]?.milestoneId).toBeNull();
    const { url } = await callOf(fetchImpl);
    expect(url.searchParams.get('unlinked')).toBe('true');
    expect(url.searchParams.has('milestone_id')).toBe(false);
  });

  it('缺 group_counts ⇒ 整页不可信（transient），不兜成 0', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listIterations('tok', {
      projectId: PROJECT_ID,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('⛔ 一条坏全批坏：任一行不可信即整页 transient（不做部分采信）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [milestoneWire(), milestoneWire({ status: 'archived' })],
        total: 2,
        page: 1,
        page_size: 20,
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listMilestones('tok', {
      projectId: PROJECT_ID,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('⭐ 长列表不被任何客户端上界截断（服务端计数不封顶）', async () => {
    const items = Array.from({ length: 600 }, (_unused, index) =>
      milestoneWire({
        id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
        iteration_summary: { total: 900, open: 900, completed: 0 },
        visible_requirement_count: 900,
      }),
    );
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items, total: 100_000, page: 1, page_size: 600 }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).listMilestones('tok', {
      projectId: PROJECT_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.items).toHaveLength(600);
    expect(outcome.value.total).toBe(100_000);
  });
});

describe('CollabPlanningClient 写请求与幂等键', () => {
  it('⭐ 建目标必发 client_request_id；缺席的可选字段一个都不发', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { milestone: milestoneWire() }));
    await clientWith(fetchImpl as unknown as typeof fetch).createMilestone('tok', {
      projectId: PROJECT_ID,
      clientRequestId: 'req-1',
      name: '成员邀请与权限管理',
    });
    const { url, body } = await callOf(fetchImpl);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/milestones`);
    expect(body).toEqual({ client_request_id: 'req-1', name: '成员邀请与权限管理' });
  });

  it('null 与缺席分得开：null 要发出去（显式清空），undefined 不发', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { milestone: milestoneWire() }));
    await clientWith(fetchImpl as unknown as typeof fetch).updateMilestone('tok', {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 3,
      clientRequestId: 'req-2',
      ownerSubject: null,
      dueAt: null,
    });
    const { body } = await callOf(fetchImpl);
    expect(body).toEqual({
      expected_version: 3,
      client_request_id: 'req-2',
      owner_subject: null,
      due_at: null,
    });
  });

  it('归档与恢复都走 archived 布尔（⛔ 客户端不递时间戳）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { iteration: iterationWire() }));
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    await client.updateIteration('tok', {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 1,
      clientRequestId: 'req-archive',
      archived: true,
    });
    await client.updateIteration('tok', {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 2,
      clientRequestId: 'req-restore',
      archived: false,
    });
    expect((await callOf(fetchImpl, 0)).body).toMatchObject({ archived: true });
    expect((await callOf(fetchImpl, 1)).body).toMatchObject({ archived: false });
    for (const index of [0, 1]) {
      expect(Object.keys((await callOf(fetchImpl, index)).body as object)).not.toContain(
        'archived_at',
      );
    }
  });

  it('⛔ 轮次 PATCH 的请求体里结构性没有 milestone_id（首期不支持跨目标移动）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { iteration: iterationWire() }));
    await clientWith(fetchImpl as unknown as typeof fetch).updateIteration('tok', {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 1,
      clientRequestId: 'req-3',
      criteriaMd: '本轮达成标准',
      // @ts-expect-error 契约里没有这个字段——多传一个也进不了请求体。
      milestoneId: MILESTONE_ID,
    });
    const { url, body } = await callOf(fetchImpl);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/iterations/${ITERATION_ID}`);
    expect(Object.keys(body as object)).not.toContain('milestone_id');
  });

  it('建轮次时 milestoneId 为 null 要发出去（显式「未关联」）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { iteration: iterationWire({ milestone_id: null }) }),
    );
    await clientWith(fetchImpl as unknown as typeof fetch).createIteration('tok', {
      projectId: PROJECT_ID,
      clientRequestId: 'req-4',
      name: '未关联的一轮',
      milestoneId: null,
    });
    expect((await callOf(fetchImpl)).body).toEqual({
      client_request_id: 'req-4',
      name: '未关联的一轮',
      milestone_id: null,
    });
  });
});

describe('CollabPlanningClient 失败分档', () => {
  it('409 版本冲突：带回服务端 current_version', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: 'version_conflict', current_version: 7 }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).updateMilestone('tok', {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 3,
      clientRequestId: 'req-5',
      name: '改名',
    });
    expect(outcome).toEqual({ ok: false, code: 'conflict', currentVersion: 7 });
  });

  it('⭐ 409 但没有 current_version（幂等冲突）：不当成不可信响应，带 serverCode 回来', async () => {
    // 两种 409 要用户做的事完全不同：换个请求编号 vs 重试一次即可。
    // 塌缩成 transient 会让「换个编号」这条路变成一个看起来该重试的网络故障。
    for (const code of ['idempotency_conflict', 'idempotency_retry']) {
      const fetchImpl = vi.fn(async () => jsonResponse(409, { error: code, detail: '给人看的' }));
      const outcome = await clientWith(fetchImpl as unknown as typeof fetch).updateIteration(
        'tok',
        {
          projectId: PROJECT_ID,
          iterationId: ITERATION_ID,
          expectedVersion: 1,
          clientRequestId: 'req-6',
          priority: 'high',
        },
      );
      expect(outcome).toEqual({ ok: false, code: 'conflict', serverCode: code });
    }
  });

  it('403 / 404 / 429 / 5xx 按状态分档；4xx 透传服务端业务码', async () => {
    const cases: readonly [number, string, string][] = [
      [403, 'forbidden', 'forbidden'],
      [404, 'milestone_not_found', 'rejected'],
      [422, 'iteration_milestone_immutable', 'rejected'],
      [429, 'rate_limited', 'rateLimited'],
    ];
    for (const [status, serverCode, expected] of cases) {
      const fetchImpl = vi.fn(async () => jsonResponse(status, { error: serverCode }));
      const outcome = await clientWith(fetchImpl as unknown as typeof fetch).createIteration(
        'tok',
        { projectId: PROJECT_ID, clientRequestId: 'req-7', name: '一轮' },
      );
      expect(outcome).toEqual({ ok: false, code: expected, serverCode });
    }
    // 5xx 不透传业务码（服务端内部细节不进客户端）。
    const serverError = vi.fn(async () => jsonResponse(500, { error: 'internal_error' }));
    await expect(
      clientWith(serverError as unknown as typeof fetch).createIteration('tok', {
        projectId: PROJECT_ID,
        clientRequestId: 'req-8',
        name: '一轮',
      }),
    ).resolves.toEqual({ ok: false, code: 'transient' });
  });

  it('网络不可达 / 抛异常一律 transient（不自行重试）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listMilestones('tok', {
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ ok: false, code: 'transient' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('CollabPlanningClient 迭代排期整批保存（MIL-06）', () => {
  const REQUEST = {
    projectId: PROJECT_ID,
    milestoneId: MILESTONE_ID,
    clientRequestId: 'req-schedule-1',
    items: [{ iterationId: ITERATION_ID, dueAt: '2026-09-25', expectedVersion: 1 }],
  };

  it('一条 POST 发整批：路径挂在目标下、条目按 snake_case、只有 id/日期/版本', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        changed: true,
        iterations: [iterationWire({ due_at: '2026-09-25T00:00:00+00:00', version: 2 })],
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).saveIterationSchedule(
      'tok',
      REQUEST,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const { url, init, body } = await callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/iteration-schedule`,
    );
    expect(body).toEqual({
      client_request_id: 'req-schedule-1',
      items: [{ iteration_id: ITERATION_ID, due_at: '2026-09-25', expected_version: 1 }],
    });
    expect(outcome).toMatchObject({ ok: true, value: { changed: true } });
    expect(outcome.ok && outcome.value.iterations[0]?.version).toBe(2);
  });

  it('409 版本冲突：带回全部冲突条目（camelCase）与 serverCode', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, {
        error: 'version_conflict',
        detail: '排期里有迭代已被他人修改，请刷新后重试',
        conflicts: [{ iteration_id: ITERATION_ID, current_version: 3 }],
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).saveIterationSchedule(
      'tok',
      REQUEST,
    );
    expect(outcome).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      conflicts: [{ iterationId: ITERATION_ID, currentVersion: 3 }],
    });
  });

  it('⭐ 另外两个 409（在途 / 同编号异内容）不带冲突清单，serverCode 各自原样回来', async () => {
    for (const error of ['idempotency_retry', 'idempotency_conflict']) {
      const fetchImpl = vi.fn(async () => jsonResponse(409, { error, detail: 'x' }));
      const outcome = await clientWith(fetchImpl as unknown as typeof fetch).saveIterationSchedule(
        'tok',
        REQUEST,
      );
      expect(outcome).toEqual({ ok: false, code: 'conflict', serverCode: error });
    }
  });

  it('成功体不可信（缺 changed / 某轮投影失败）一律 transient，422 透传业务码', async () => {
    for (const bad of [{ iterations: [] }, { changed: true, iterations: [{ id: 'not-a-row' }] }]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, bad));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).saveIterationSchedule('tok', REQUEST),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
    const outOfPeriod = vi.fn(async () =>
      jsonResponse(422, { error: 'schedule_out_of_period', detail: '日期需在业务目标周期内' }),
    );
    await expect(
      clientWith(outOfPeriod as unknown as typeof fetch).saveIterationSchedule('tok', REQUEST),
    ).resolves.toMatchObject({ ok: false, serverCode: 'schedule_out_of_period' });
  });
});

describe('CollabPlanningClient 安排需求整批保存与需求排期现状（MIL-09）', () => {
  const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
  const OTHER_REQUIREMENT_ID = '55555555-5555-4555-8555-555555555555';
  const REQUEST = {
    projectId: PROJECT_ID,
    milestoneId: MILESTONE_ID,
    clientRequestId: 'req-arrange-1',
    items: [
      {
        requirementId: REQUIREMENT_ID,
        iterationId: null,
        expectedRequirementVersion: 2,
        expectedIterationId: ITERATION_ID,
      },
      {
        requirementId: OTHER_REQUIREMENT_ID,
        iterationId: ITERATION_ID,
        expectedRequirementVersion: 1,
        expectedIterationId: null,
      },
    ],
  };

  it('一条 POST 发整批：挂在目标下、snake_case、「不排」与「没排」的 null 显式发出', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        changed: true,
        iterations: [iterationWire({ version: 1 })],
        moves: [
          {
            requirement_id: REQUIREMENT_ID,
            iteration_id: null,
            previous_iteration_id: ITERATION_ID,
          },
        ],
      }),
    );
    const outcome = await clientWith(fetchImpl as unknown as typeof fetch).saveRequirementSchedule(
      'tok',
      REQUEST,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const { url, init, body } = await callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/requirement-schedule`,
    );
    // ⭐ 两个 null 键都在（服务端缺键即 422）：toEqual 对 undefined 键宽松，这里逐键查存在性。
    const items = (body as { items: Record<string, unknown>[] }).items;
    expect(Object.keys(items[0]!)).toContain('iteration_id');
    expect(Object.keys(items[1]!)).toContain('expected_iteration_id');
    expect(body).toEqual({
      client_request_id: 'req-arrange-1',
      items: [
        {
          requirement_id: REQUIREMENT_ID,
          iteration_id: null,
          expected_requirement_version: 2,
          expected_iteration_id: ITERATION_ID,
        },
        {
          requirement_id: OTHER_REQUIREMENT_ID,
          iteration_id: ITERATION_ID,
          expected_requirement_version: 1,
          expected_iteration_id: null,
        },
      ],
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        changed: true,
        moves: [
          { requirementId: REQUIREMENT_ID, iterationId: null, previousIterationId: ITERATION_ID },
        ],
      },
    });
  });

  it('无里程碑轮次走项目级排期路由，请求体与旧路由保持一致', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        changed: false,
        iterations: [],
        moves: [],
      }),
    );
    await clientWith(fetchImpl as unknown as typeof fetch).saveRequirementSchedule('tok', {
      ...REQUEST,
      milestoneId: null,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const { url, init, body } = await callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/requirement-schedule`);
    expect(body).toEqual({
      client_request_id: 'req-arrange-1',
      items: [
        {
          requirement_id: REQUIREMENT_ID,
          iteration_id: null,
          expected_requirement_version: 2,
          expected_iteration_id: ITERATION_ID,
        },
        {
          requirement_id: OTHER_REQUIREMENT_ID,
          iteration_id: ITERATION_ID,
          expected_requirement_version: 1,
          expected_iteration_id: null,
        },
      ],
    });
  });

  it('409 版本冲突：全部冲突条目（当前版本 + 当前排在哪一轮）camelCase 带回', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, {
        error: 'version_conflict',
        detail: '有需求已被他人更新或改排，请刷新后重试',
        conflicts: [
          { requirement_id: REQUIREMENT_ID, current_version: 3, current_iteration_id: null },
          {
            requirement_id: OTHER_REQUIREMENT_ID,
            current_version: 1,
            current_iteration_id: ITERATION_ID,
          },
        ],
      }),
    );
    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).saveRequirementSchedule('tok', REQUEST),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      conflicts: [
        { requirementId: REQUIREMENT_ID, currentVersion: 3, currentIterationId: null },
        {
          requirementId: OTHER_REQUIREMENT_ID,
          currentVersion: 1,
          currentIterationId: ITERATION_ID,
        },
      ],
    });
  });

  it('⭐ 其余 409（在途 / 同编号异内容 / 目标已归档）不带冲突清单，serverCode 各自原样回来', async () => {
    for (const error of ['idempotency_retry', 'idempotency_conflict', 'milestone_archived']) {
      const fetchImpl = vi.fn(async () => jsonResponse(409, { error, detail: 'x' }));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).saveRequirementSchedule('tok', REQUEST),
      ).resolves.toEqual({ ok: false, code: 'conflict', serverCode: error });
    }
  });

  it('成功体不可信（缺 changed / 缺 moves / 某条改动投影失败）一律 transient', async () => {
    for (const bad of [
      { iterations: [], moves: [] },
      { changed: true, iterations: [] },
      { changed: true, iterations: [], moves: [{ requirement_id: 'not-an-id' }] },
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, bad));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).saveRequirementSchedule('tok', REQUEST),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('完整组映射层级与根参数；旧服务和不完整响应拒绝作为整组使用', async () => {
    const row = {
      requirement_id: REQUIREMENT_ID,
      title: 'root',
      status: 'notStarted',
      version: 1,
      placement: null,
      parent_id: null,
      ancestor_path: [],
      has_parent: false,
      path_complete: true,
      has_visible_children: true,
    };
    const page = {
      items: [row],
      total: 1,
      page: 1,
      page_size: 100,
      unscheduled_total: 1,
      selection_scope: 'group',
      group_root_id: REQUIREMENT_ID,
      group_complete: true,
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, page));
    const input = { projectId: PROJECT_ID, groupRootId: REQUIREMENT_ID, pageSize: 20 };
    const result = await clientWith(fetchImpl as unknown as typeof fetch).listRequirementPlacements(
      'tok',
      input,
    );
    expect((await callOf(fetchImpl)).url.searchParams.get('group_root_id')).toBe(REQUIREMENT_ID);
    expect(result).toMatchObject({
      ok: true,
      value: {
        selectionScope: 'group',
        groupComplete: true,
        groupRootId: REQUIREMENT_ID,
        items: [{ parentId: null, ancestorPath: [], hasVisibleChildren: true }],
      },
    });
    const canonicalRoot = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
    const canonicalResponse = vi.fn(async () =>
      jsonResponse(200, {
        ...page,
        group_root_id: canonicalRoot,
        items: [{ ...row, requirement_id: canonicalRoot }],
      }),
    );
    await expect(
      clientWith(canonicalResponse as unknown as typeof fetch).listRequirementPlacements('tok', {
        ...input,
        groupRootId: canonicalRoot.toUpperCase(),
      }),
    ).resolves.toMatchObject({ ok: true, value: { groupRootId: canonicalRoot } });
    for (const extra of [
      { group_complete: false },
      { group_root_id: OTHER_REQUIREMENT_ID },
      { total: 2 },
      { selection_scope: undefined, group_root_id: undefined, group_complete: undefined },
      { items: [{ ...row, path_complete: 'yes' }] },
      { items: [{ ...row, ancestor_path: [{ requirement_id: OTHER_REQUIREMENT_ID, title: 7 }] }] },
      { items: [{ ...row, parent_id: 'bad-id' }] },
    ]) {
      const invalid = vi.fn(async () => jsonResponse(200, { ...page, ...extra }));
      await expect(
        clientWith(invalid as unknown as typeof fetch).listRequirementPlacements('tok', input),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('搜索保留短 ID 与特殊字符，授权父路径按共享字段映射', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            requirement_id: REQUIREMENT_ID,
            title: 'child',
            status: 'notStarted',
            version: 1,
            placement: null,
            parent_id: OTHER_REQUIREMENT_ID,
            ancestor_path: [{ requirement_id: OTHER_REQUIREMENT_ID, title: 'parent' }],
            has_parent: true,
            path_complete: true,
            has_visible_children: false,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        unscheduled_total: 1,
        selection_scope: 'page',
        group_root_id: null,
        group_complete: false,
      }),
    );
    const query = '44444444 %_ &+需求';
    const outcome = await clientWith(
      fetchImpl as unknown as typeof fetch,
    ).listRequirementPlacements('tok', { projectId: PROJECT_ID, q: query });
    expect((await callOf(fetchImpl)).url.searchParams.get('q')).toBe(query);
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        groupComplete: false,
        items: [
          {
            parentId: OTHER_REQUIREMENT_ID,
            hasParent: true,
            pathComplete: true,
            ancestorPath: [{ requirementId: OTHER_REQUIREMENT_ID, title: 'parent' }],
          },
        ],
      },
    });
  });

  it('需求排期现状：查询参数 snake_case；排期对象与未排条数原样投影', async () => {
    const wireItem = {
      requirement_id: REQUIREMENT_ID,
      title: '邀请码可撤销',
      status: 'inProgress',
      version: 2,
      placement: {
        iteration_id: ITERATION_ID,
        iteration_name: '第一轮',
        iteration_status: 'open',
        milestone_id: MILESTONE_ID,
        milestone_name: '成员邀请与权限管理',
      },
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [wireItem, { ...wireItem, requirement_id: OTHER_REQUIREMENT_ID, placement: null }],
        total: 2,
        page: 1,
        page_size: 1,
        unscheduled_total: 9,
      }),
    );
    const outcome = await clientWith(
      fetchImpl as unknown as typeof fetch,
    ).listRequirementPlacements('tok', {
      projectId: PROJECT_ID,
      requirementId: REQUIREMENT_ID,
      pageSize: 1,
      q: '邀请',
    });
    const { url, init } = await callOf(fetchImpl);
    expect(init?.method).toBe('GET');
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/requirement-placements`);
    expect(url.searchParams.get('requirement_id')).toBe(REQUIREMENT_ID);
    expect(url.searchParams.get('page_size')).toBe('1');
    expect(url.searchParams.get('q')).toBe('邀请');
    expect(outcome).toEqual({
      ok: true,
      value: {
        items: [
          {
            requirementId: REQUIREMENT_ID,
            title: '邀请码可撤销',
            status: 'inProgress',
            version: 2,
            placement: {
              iterationId: ITERATION_ID,
              iterationName: '第一轮',
              iterationStatus: 'open',
              milestoneId: MILESTONE_ID,
              milestoneName: '成员邀请与权限管理',
            },
          },
          {
            requirementId: OTHER_REQUIREMENT_ID,
            title: '邀请码可撤销',
            status: 'inProgress',
            version: 2,
            placement: null,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 1,
        unscheduledTotal: 9,
      },
    });
  });

  it('⛔ 未排条数缺席 / 为负、排期对象缺席不兜底：整页判不可信', async () => {
    const item = {
      requirement_id: REQUIREMENT_ID,
      title: '邀请码可撤销',
      status: 'notStarted',
      version: 1,
      placement: null,
    };
    const page = { total: 1, page: 1, page_size: 20 };
    const noPlacement: Record<string, unknown> = { ...item };
    delete noPlacement.placement;
    for (const bad of [
      { items: [item], ...page },
      { items: [item], ...page, unscheduled_total: -1 },
      { items: [noPlacement], ...page, unscheduled_total: 0 },
    ]) {
      const fetchImpl = vi.fn(async () => jsonResponse(200, bad));
      await expect(
        clientWith(fetchImpl as unknown as typeof fetch).listRequirementPlacements('tok', {
          projectId: PROJECT_ID,
        }),
      ).resolves.toEqual({ ok: false, code: 'transient' });
    }
  });

  it('服务端强制的周期 / 负责人码（MIL-10）：只带回业务码，⛔ 不透传越界 id 或任何条数', async () => {
    const milestonePatch = {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 1,
      clientRequestId: 'req-period',
      dueAt: '2026-10-25T00:00:00.000Z',
    };
    const uncovered = vi.fn(async () =>
      jsonResponse(409, {
        error: 'milestone_period_excludes_iterations',
        iteration_ids: [ITERATION_ID],
        active_requirement_count: 2,
      }),
    );
    await expect(
      clientWith(uncovered as unknown as typeof fetch).updateMilestone('tok', milestonePatch),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'milestone_period_excludes_iterations',
    });
    const ownerLeft = vi.fn(async () => jsonResponse(422, { error: 'owner_not_member' }));
    await expect(
      clientWith(ownerLeft as unknown as typeof fetch).updateIteration('tok', {
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        expectedVersion: 1,
        clientRequestId: 'req-owner',
        ownerSubject: 'u-left',
      }),
    ).resolves.toEqual({ ok: false, code: 'rejected', serverCode: 'owner_not_member' });
  });
});
