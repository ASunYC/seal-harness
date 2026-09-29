import { describe, expect, it } from 'vitest';

import {
  mapIterationGroupCounts,
  mapIterationRequirementLink,
  mapPlanningPage,
  mapProjectIteration,
  mapProjectMilestone,
} from '../../../../../stratex/main/services/collab/collabPlanningWireMapping.js';

const MILESTONE_ID = '11111111-1111-4111-8111-111111111111';
const ITERATION_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
const LINK_ID = '55555555-5555-4555-8555-555555555555';

/**
 * 去掉一个键，造出「服务端**根本没回**这个键」那一态。
 *
 * ⚠️ 「缺席」与「显式 null」是两件不同的事：前者是旧服务端/投影漏列，后者是一个有意的
 * 值。⛔ 别用解构 rest 语法造它（会留下一个 eslint 挡下来的未用变量），也别用
 * `delete`（就地改对象）。
 */
function without(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function milestoneWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MILESTONE_ID,
    name: '成员邀请与权限管理',
    objective_md: '邀请、角色与撤销一条链走通。',
    owner_subject: 'u-bob',
    status: 'open',
    start_at: '2026-09-01T00:00:00Z',
    due_at: '2026-12-31T00:00:00Z',
    archived_at: null,
    version: 1,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    iteration_summary: { total: 2, open: 1, completed: 1 },
    visible_requirement_count: 0,
    ...overrides,
  };
}

function iterationWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITERATION_ID,
    milestone_id: MILESTONE_ID,
    name: '第一轮：成员列表与角色改派',
    criteria_md: '列表能按角色筛选，改派留审计。',
    owner_subject: 'u-bob',
    priority: 'medium',
    status: 'open',
    due_at: '2026-09-20T00:00:00Z',
    archived_at: null,
    version: 1,
    creator_subject: 'u-alice',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    // 关联需求的授权摘要（0022）。⚠️ 两个键**服务端恒回**，所以夹具也必须有它们：
    // 映射层刻意不给它们兜默认值（缺席即整条不可信），少了这两个键整条投影会是 null。
    linked_requirements: [
      {
        requirement_id: REQUIREMENT_ID,
        title: '邀请码可撤销',
        status: 'notStarted',
        state: 'active',
        linked_at: '2026-09-02T00:00:00Z',
        unlinked_at: null,
      },
    ],
    linked_requirements_has_more: false,
    ...overrides,
  };
}

describe('mapProjectMilestone', () => {
  it('snake_case → camelCase 逐字段投影，服务端聚合原样带出', () => {
    expect(mapProjectMilestone(milestoneWire())).toEqual({
      id: MILESTONE_ID,
      name: '成员邀请与权限管理',
      objectiveMd: '邀请、角色与撤销一条链走通。',
      ownerSubject: 'u-bob',
      status: 'open',
      startAt: '2026-09-01T00:00:00Z',
      dueAt: '2026-12-31T00:00:00Z',
      archivedAt: null,
      version: 1,
      creatorSubject: 'u-alice',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      iterationSummary: { total: 2, open: 1, completed: 1 },
      visibleRequirementCount: 0,
    });
  });

  it('⛔ 服务端后续新增的字段进不了投影（逐字段挑选），也带不进 project_id 与账号', () => {
    const mapped = mapProjectMilestone(
      milestoneWire({ project_id: PROJECT_ID, account_key: 'leak', secret_note: 'x' }),
    );
    expect(mapped).not.toBeNull();
    expect(Object.keys(mapped as object)).not.toContain('projectId');
    expect(Object.keys(mapped as object)).not.toContain('accountKey');
    expect(Object.keys(mapped as object)).not.toContain('secretNote');
  });

  it('归档时刻原样带出（归档是打标记，不是删除）', () => {
    expect(
      mapProjectMilestone(milestoneWire({ archived_at: '2026-10-02T00:00:00Z' }))?.archivedAt,
    ).toBe('2026-10-02T00:00:00Z');
  });

  it('⭐ 服务端计数一律不设上界：越界的数照旧映射得出', () => {
    // 盯的是「有人顺手给服务端计数加 .max(N)」——那会让 mapArray 一条坏全批坏，
    // 整页取不回来，表现是「列表空白」，看不出是哪一行越界。
    for (const count of [0, 500, 501, 10_000, 1_000_000]) {
      const mapped = mapProjectMilestone(
        milestoneWire({
          iteration_summary: { total: count, open: count, completed: 0 },
          visible_requirement_count: count,
        }),
      );
      expect(mapped?.iterationSummary.total).toBe(count);
      expect(mapped?.visibleRequirementCount).toBe(count);
    }
  });

  it('⛔ iteration_summary 缺席或形状不合 ⇒ 整条不可信（不补 {0,0,0}）', () => {
    // 兜一个 0 会把「这一页没算出来」说成「这个目标下没有轮次」——用户看到一个空
    // 进度条，而不是一次可察觉的失败。
    expect(mapProjectMilestone(milestoneWire({ iteration_summary: undefined }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ iteration_summary: { total: 1 } }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ iteration_summary: 'two' }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ visible_requirement_count: undefined }))).toBeNull();
  });

  it('形状不合一律 null：非对象 / 坏 uuid / 坏枚举 / 版本非正整数', () => {
    expect(mapProjectMilestone(null)).toBeNull();
    expect(mapProjectMilestone('x')).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ id: 'milestone-1' }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ status: 'archived' }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ version: 0 }))).toBeNull();
    expect(mapProjectMilestone(milestoneWire({ name: '' }))).toBeNull();
  });
});

describe('mapProjectIteration', () => {
  it('逐字段投影；未关联轮次的 milestoneId 是 null（有意的产品状态）', () => {
    expect(mapProjectIteration(iterationWire())?.milestoneId).toBe(MILESTONE_ID);
    const unlinked = mapProjectIteration(iterationWire({ milestone_id: null }));
    expect(unlinked).not.toBeNull();
    expect(unlinked?.milestoneId).toBeNull();
  });

  it('⛔ 不把「未关联」兜成某个目标，也不从名称/日期猜归属', () => {
    // milestone_id 只认 uuid 或 null；名称串、日期串、原型编号一律判整条不可信。
    for (const bad of ['成员邀请与权限管理', '2026-09-01', 'D-101']) {
      expect(mapProjectIteration(iterationWire({ milestone_id: bad }))).toBeNull();
    }
  });

  it('优先级与状态是闭集；坏值整条 null（不静默降级）', () => {
    expect(mapProjectIteration(iterationWire({ priority: 'urgent' }))).toBeNull();
    expect(mapProjectIteration(iterationWire({ status: 'done' }))).toBeNull();
    expect(mapProjectIteration(iterationWire({ status: 'notStarted' }))).toBeNull();
  });

  it('⛔ 投影里没有完成时间字段（「做完了没」只有 status 一个答案）', () => {
    const mapped = mapProjectIteration(
      iterationWire({ completed_at: '2026-09-30T00:00:00Z', actual_completed_at: 'x' }),
    );
    expect(mapped).not.toBeNull();
    for (const forbidden of ['completedAt', 'actualCompletedAt', 'finishedAt', 'doneAt']) {
      expect(Object.keys(mapped as object)).not.toContain(forbidden);
    }
  });

  it('到期日与归档可空；空达成标准投影成空串', () => {
    expect(mapProjectIteration(iterationWire({ due_at: null }))?.dueAt).toBeNull();
    expect(mapProjectIteration(iterationWire({ criteria_md: '' }))?.criteriaMd).toBe('');
  });

  it('关联需求摘要逐字段投影；requirementId 是**需求**的 uuid（列表第二列据它跳详情）', () => {
    const mapped = mapProjectIteration(iterationWire());
    expect(mapped?.linkedRequirements).toEqual([
      {
        requirementId: REQUIREMENT_ID,
        title: '邀请码可撤销',
        status: 'notStarted',
        linkState: 'active',
        linkedAt: '2026-09-02T00:00:00Z',
        unlinkedAt: null,
      },
    ]);
    expect(mapped?.linkedRequirementsHasMore).toBe(false);
  });

  it('历史关联（closed + unlinkedAt）照样投影出来——⛔ 「没返回」不等于「被删了」', () => {
    const mapped = mapProjectIteration(
      iterationWire({
        linked_requirements: [
          {
            requirement_id: REQUIREMENT_ID,
            title: '邀请码可撤销',
            status: 'done',
            state: 'closed',
            linked_at: '2026-09-02T00:00:00Z',
            unlinked_at: '2026-09-05T00:00:00Z',
          },
        ],
        linked_requirements_has_more: true,
      }),
    );
    expect(mapped?.linkedRequirements[0]?.linkState).toBe('closed');
    expect(mapped?.linkedRequirements[0]?.unlinkedAt).toBe('2026-09-05T00:00:00Z');
    expect(mapped?.linkedRequirementsHasMore).toBe(true);
  });

  it('⛔ 关联摘要两个键**不补默认值**：缺席即整条不可信（不是「这一轮没关联」）', () => {
    expect(mapProjectIteration(without(iterationWire(), 'linked_requirements'))).toBeNull();
    expect(
      mapProjectIteration(without(iterationWire(), 'linked_requirements_has_more')),
    ).toBeNull();
  });

  it('摘要闭集与形状：坏的 state / status / 非 uuid 一律整条 null（一条坏全批坏）', () => {
    for (const bad of [
      { state: 'current' },
      { status: 'open' },
      { requirement_id: '不是 uuid' },
      { title: '' },
    ]) {
      expect(
        mapProjectIteration(
          iterationWire({
            linked_requirements: [
              {
                requirement_id: REQUIREMENT_ID,
                title: '邀请码可撤销',
                status: 'notStarted',
                state: 'active',
                linked_at: '2026-09-02T00:00:00Z',
                unlinked_at: null,
                ...bad,
              },
            ],
          }),
        ),
      ).toBeNull();
    }
  });

  it('⛔ 摘要数组不设条数上界（服务端已截断；客户端再设一道会让整页取不回来）', () => {
    const many = Array.from({ length: 500 }, (_unused, index) => ({
      requirement_id: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
      title: `需求 ${index}`,
      status: 'notStarted',
      state: 'active',
      linked_at: '2026-09-02T00:00:00Z',
      unlinked_at: null,
    }));
    const mapped = mapProjectIteration(
      iterationWire({ linked_requirements: many, linked_requirements_has_more: true }),
    );
    expect(mapped?.linkedRequirements).toHaveLength(500);
  });
});

describe('mapIterationRequirementLink', () => {
  it('逐字段投影；`id` 是**关联行**的 id，与 requirementId 刻意分开', () => {
    expect(
      mapIterationRequirementLink({
        id: LINK_ID,
        iteration_id: ITERATION_ID,
        requirement_id: REQUIREMENT_ID,
        state: 'closed',
        linked_at: '2026-09-02T00:00:00Z',
        unlinked_at: '2026-09-05T00:00:00Z',
        linked_by_subject: 'u-bob',
        version: 2,
      }),
    ).toEqual({
      id: LINK_ID,
      iterationId: ITERATION_ID,
      requirementId: REQUIREMENT_ID,
      state: 'closed',
      linkedAt: '2026-09-02T00:00:00Z',
      unlinkedAt: '2026-09-05T00:00:00Z',
      linkedBySubject: 'u-bob',
      version: 2,
    });
  });

  it('坏形状整条 null：state 不在闭集、版本非正、关联人为空', () => {
    const base = {
      id: LINK_ID,
      iteration_id: ITERATION_ID,
      requirement_id: REQUIREMENT_ID,
      state: 'active',
      linked_at: '2026-09-02T00:00:00Z',
      unlinked_at: null,
      linked_by_subject: 'u-bob',
      version: 1,
    };
    for (const bad of [{ state: 'gone' }, { version: 0 }, { linked_by_subject: '' }]) {
      expect(mapIterationRequirementLink({ ...base, ...bad })).toBeNull();
    }
  });
});

describe('mapIterationGroupCounts', () => {
  it('三个分组原样带出；⛔ 相加不等于总数是正常的（同一轮会进两组）', () => {
    expect(mapIterationGroupCounts({ mine: 1, open: 2, completed: 0 })).toEqual({
      mine: 1,
      open: 2,
      completed: 0,
    });
  });

  it('⭐ 不设上界', () => {
    expect(mapIterationGroupCounts({ mine: 0, open: 100_000, completed: 501 })?.open).toBe(100_000);
  });

  it('缺任一分组或形状不合 ⇒ null（不兜 0：兜了会让用户以为自己名下没有轮次）', () => {
    expect(mapIterationGroupCounts({ mine: 1, open: 2 })).toBeNull();
    expect(mapIterationGroupCounts({ mine: 1, open: 2, completed: -1 })).toBeNull();
    expect(mapIterationGroupCounts(null)).toBeNull();
  });
});

describe('mapPlanningPage', () => {
  it('total/page/page_size 三个数投影成 camelCase', () => {
    expect(mapPlanningPage({ total: 7, page: 2, page_size: 20 })).toEqual({
      total: 7,
      page: 2,
      pageSize: 20,
    });
  });

  it('total 可以为 0（空列表）但页码必须为正', () => {
    expect(mapPlanningPage({ total: 0, page: 1, page_size: 20 })?.total).toBe(0);
    expect(mapPlanningPage({ total: 1, page: 0, page_size: 20 })).toBeNull();
    expect(mapPlanningPage({ total: 1, page: 1, page_size: 0 })).toBeNull();
  });

  it('⭐ total 不设上界（服务端计数）', () => {
    expect(mapPlanningPage({ total: 1_000_000, page: 1, page_size: 20 })?.total).toBe(1_000_000);
  });

  it('缺键 / 非数 / 小数一律 null（分页数错了会把「还有下一页」判反）', () => {
    expect(mapPlanningPage({ page: 1, page_size: 20 })).toBeNull();
    expect(mapPlanningPage({ total: '7', page: 1, page_size: 20 })).toBeNull();
    expect(mapPlanningPage({ total: 7.5, page: 1, page_size: 20 })).toBeNull();
  });
});
