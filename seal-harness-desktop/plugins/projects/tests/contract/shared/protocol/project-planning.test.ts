import { describe, expect, it } from 'vitest';

import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';

import {
  PROJECT_ITERATION_MAX_CRITERIA_LENGTH,
  PROJECT_ITERATION_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH,
  PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH,
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  ProjectIterationCreateRequestSchema,
  ProjectIterationCreateResultSchema,
  ProjectIterationGroupCountsSchema,
  ProjectIterationListItemSchema,
  ProjectIterationListRequestSchema,
  ProjectIterationRequirementLinkRequestSchema,
  ProjectIterationRequirementLinkResultSchema,
  ProjectIterationRequirementListRequestSchema,
  ProjectIterationRequirementSchema,
  ProjectIterationRequirementUnlinkRequestSchema,
  ProjectIterationRequirementUnlinkResultSchema,
  ProjectIterationSchema,
  ProjectIterationUpdateRequestSchema,
  ProjectIterationUpdateResultSchema,
  ProjectMilestoneCreateRequestSchema,
  ProjectMilestoneListItemSchema,
  ProjectMilestoneListResultSchema,
  ProjectMilestoneSchema,
  ProjectMilestoneUpdateRequestSchema,
  isProjectIterationRequirementCurrent,
  isProjectIterationUnlinked,
  projectIterationUpdateServerCodeText,
} from '../../../../stratex/shared/protocol/project-planning.js';

describe('iteration update server-code copy', () => {
  it('maps milestone_archived to a restore-first explanation; unknown or absent codes fall back to null', () => {
    // 业务目标归档即整条只读（D-MODEL-01 §九）：说清下一步是恢复业务目标，⛔ 不露业务码本身。
    const text = projectIterationUpdateServerCodeText('milestone_archived');
    expect(text).toBe('所属业务目标已归档，请先恢复业务目标再修改。');
    expect(text).not.toContain('milestone_archived');
    for (const code of ['version_conflict', 'iteration_archived', '', undefined, null]) {
      expect(projectIterationUpdateServerCodeText(code)).toBeNull();
    }
  });
});

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

const MILESTONE_ID = '11111111-1111-4111-8111-111111111111';
const ITERATION_ID = '22222222-2222-4222-8222-222222222222';

const milestone = {
  id: MILESTONE_ID,
  name: '成员邀请与权限管理',
  objectiveMd: '让管理者能在一处看清谁在组里、谁能改什么。',
  ownerSubject: 'u-alice',
  status: 'open' as const,
  startAt: '2026-09-01T00:00:00Z',
  dueAt: '2026-10-01T00:00:00Z',
  archivedAt: null,
  version: 1,
  creatorSubject: 'u-alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const iteration = {
  id: ITERATION_ID,
  milestoneId: MILESTONE_ID,
  name: '第一轮：成员列表与角色改派',
  criteriaMd: '列表能按角色筛选，改派留审计。',
  ownerSubject: 'u-bob',
  priority: 'medium' as const,
  status: 'open' as const,
  dueAt: '2026-09-20T00:00:00Z',
  archivedAt: null,
  version: 1,
  creatorSubject: 'u-alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('project planning persistence contract', () => {
  it('parses a full milestone and iteration record', () => {
    expect(ProjectMilestoneSchema.parse(milestone).id).toBe(MILESTONE_ID);
    expect(ProjectIterationSchema.parse(iteration).milestoneId).toBe(MILESTONE_ID);
  });

  it('rejects unknown fields at both boundaries', () => {
    // strictObject：服务端多回一个字段时要红，而不是静默丢掉。
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, iterationCount: 3 })).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, linkedRequirements: [] })).toThrow();
  });

  // ── 判据 1：UUID 作关联键，不用名称或日期 ─────────────────────────────
  it('keys the milestone relation on a uuid, never on a name or a date', () => {
    expect(() =>
      ProjectIterationSchema.parse({ ...iteration, milestoneId: '成员邀请与权限管理' }),
    ).toThrow();
    expect(() =>
      ProjectIterationSchema.parse({ ...iteration, milestoneId: '2026-09-01' }),
    ).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, milestoneId: 'D-101' })).toThrow();
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, id: 'milestone-1' })).toThrow();
  });

  it('allows two milestones to share one name', () => {
    const first = ProjectMilestoneSchema.parse(milestone);
    const second = ProjectMilestoneSchema.parse({ ...milestone, id: ITERATION_ID });
    expect(second.name).toBe(first.name);
    expect(second.id).not.toBe(first.id);
  });

  // ── 判据 3：未关联是合法状态 ──────────────────────────────────────────
  it('accepts an iteration with no business goal and flags it as unlinked', () => {
    const unlinked = ProjectIterationSchema.parse({ ...iteration, milestoneId: null });
    expect(unlinked.milestoneId).toBeNull();
    expect(isProjectIterationUnlinked(unlinked)).toBe(true);
    expect(isProjectIterationUnlinked(ProjectIterationSchema.parse(iteration))).toBe(false);
  });

  // ── 判据 2：版本 / 归档 / 可空到期日 ──────────────────────────────────
  it('treats dueAt as an optional plain date on both entities', () => {
    expect(ProjectIterationSchema.parse({ ...iteration, dueAt: null }).dueAt).toBeNull();
    expect(
      ProjectMilestoneSchema.parse({ ...milestone, dueAt: null, startAt: null }).dueAt,
    ).toBeNull();
  });

  it('carries archivedAt rather than a delete flag', () => {
    const archived = ProjectMilestoneSchema.parse({
      ...milestone,
      archivedAt: '2026-10-02T00:00:00Z',
    });
    expect(archived.archivedAt).toBe('2026-10-02T00:00:00Z');
    expect(Object.keys(archived)).not.toContain('deletedAt');
  });

  it('never puts a client-side upper bound on a server-supplied number', () => {
    // ⛔ 事故复盘：有人给 childTotal 加了 .max(500)，子树越界时 mapArray 一条坏全批坏，
    //    整个看板取不回来。version 是服务端单调递增的计数，客户端不设上界。
    for (const version of [1, 2_147_483_647, Number.MAX_SAFE_INTEGER]) {
      expect(ProjectMilestoneSchema.parse({ ...milestone, version }).version).toBe(version);
      expect(ProjectIterationSchema.parse({ ...iteration, version }).version).toBe(version);
    }
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, version: 0 })).toThrow();
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, version: 1.5 })).toThrow();
  });

  // ── 闭集与长度上界（客户端拒绝的服务端必拒，反向不成立）──────────────
  it('closes the status and priority sets', () => {
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, status: 'archived' })).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, status: 'done' })).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, status: 'notStarted' })).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, priority: 'urgent' })).toThrow();
  });

  it('bounds user-authored text at the same numbers as the server DDL', () => {
    expect(PROJECT_MILESTONE_MAX_NAME_LENGTH).toBe(200);
    expect(PROJECT_ITERATION_MAX_NAME_LENGTH).toBe(200);
    expect(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH).toBe(20_000);
    expect(PROJECT_ITERATION_MAX_CRITERIA_LENGTH).toBe(20_000);
    expect(() => ProjectMilestoneSchema.parse({ ...milestone, name: '' })).toThrow();
    expect(() =>
      ProjectMilestoneSchema.parse({
        ...milestone,
        name: 'x'.repeat(PROJECT_MILESTONE_MAX_NAME_LENGTH + 1),
      }),
    ).toThrow();
    expect(() => ProjectIterationSchema.parse({ ...iteration, name: '' })).toThrow();
    expect(() =>
      ProjectIterationSchema.parse({
        ...iteration,
        criteriaMd: 'x'.repeat(PROJECT_ITERATION_MAX_CRITERIA_LENGTH + 1),
      }),
    ).toThrow();
    // 达成标准/目标说明可以为空串（没写），但不许夹带 NUL。
    expect(ProjectIterationSchema.parse({ ...iteration, criteriaMd: '' }).criteriaMd).toBe('');
    expect(() => ProjectIterationSchema.parse({ ...iteration, criteriaMd: 'a\0b' })).toThrow();
  });

  it('allows an owner-less round and keeps the subject bounded', () => {
    expect(
      ProjectIterationSchema.parse({ ...iteration, ownerSubject: null }).ownerSubject,
    ).toBeNull();
    expect(() => ProjectIterationSchema.parse({ ...iteration, ownerSubject: '' })).toThrow();
    expect(() =>
      ProjectIterationSchema.parse({ ...iteration, ownerSubject: 'u'.repeat(257) }),
    ).toThrow();
  });

  // ── 红线：契约里不可表达账号与会话正文 ────────────────────────────────
  it('cannot express an account key or any assistant transcript field', () => {
    for (const forbidden of ['accountKey', 'prompt', 'answer', 'transcript', 'filePath']) {
      expect(() => ProjectMilestoneSchema.parse({ ...milestone, [forbidden]: 'x' })).toThrow();
      expect(() => ProjectIterationSchema.parse({ ...iteration, [forbidden]: 'x' })).toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 请求 / 响应契约（CRUD 与权限链路）
// ══════════════════════════════════════════════════════════════════════════════

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const milestoneListItem = {
  ...milestone,
  iterationSummary: { total: 2, open: 1, completed: 1 },
  visibleRequirementCount: 0,
};

describe('project planning request contracts', () => {
  // ── 判据 1：列表/新建/修改/归档贯通；幂等键必填；409 带当前版本 ───────────
  it('requires a client request id on every write（可选的幂等键等于没有幂等键）', () => {
    for (const [schema, base] of [
      [ProjectMilestoneCreateRequestSchema, { projectId: PROJECT_ID, name: '成员邀请与权限管理' }],
      [ProjectIterationCreateRequestSchema, { projectId: PROJECT_ID, name: '第一轮' }],
      [
        ProjectMilestoneUpdateRequestSchema,
        { projectId: PROJECT_ID, milestoneId: MILESTONE_ID, expectedVersion: 1, name: '改名' },
      ],
      [
        ProjectIterationUpdateRequestSchema,
        { projectId: PROJECT_ID, iterationId: ITERATION_ID, expectedVersion: 1, priority: 'high' },
      ],
    ] as const) {
      expect(() => schema.parse(base)).toThrow();
      expect(() => schema.parse({ ...base, clientRequestId: '' })).toThrow();
      expect(schema.parse({ ...base, clientRequestId: 'req-1' })).toBeTruthy();
      expect(() =>
        schema.parse({
          ...base,
          clientRequestId: 'x'.repeat(PROJECT_PLANNING_MAX_CLIENT_REQUEST_ID_LENGTH + 1),
        }),
      ).toThrow();
    }
  });

  it('requires an expected version on every update（乐观锁不是可选项）', () => {
    expect(() =>
      ProjectMilestoneUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        clientRequestId: 'req-1',
        name: '改名',
      }),
    ).toThrow();
    expect(() =>
      ProjectMilestoneUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        clientRequestId: 'req-1',
        expectedVersion: 0,
        name: '改名',
      }),
    ).toThrow();
  });

  it('rejects an update that changes nothing（至少带一项变更）', () => {
    expect(() =>
      ProjectMilestoneUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
      }),
    ).toThrow();
    expect(() =>
      ProjectIterationUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
      }),
    ).toThrow();
  });

  it('treats archiving as a boolean action, never as a timestamp the client picks', () => {
    const archived = ProjectMilestoneUpdateRequestSchema.parse({
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 1,
      clientRequestId: 'req-1',
      archived: true,
    });
    expect(archived.archived).toBe(true);
    // 恢复是同一个字段的 false，不是另一个动作。
    expect(
      ProjectMilestoneUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
        archived: false,
      }).archived,
    ).toBe(false);
    // ⛔ 客户端不递归档时刻（服务端定），也不递 deletedAt（本域没有软删）。
    for (const forbidden of ['archivedAt', 'deletedAt']) {
      expect(() =>
        ProjectMilestoneUpdateRequestSchema.parse({
          projectId: PROJECT_ID,
          milestoneId: MILESTONE_ID,
          expectedVersion: 1,
          clientRequestId: 'req-1',
          [forbidden]: '2026-10-02T00:00:00Z',
        }),
      ).toThrow();
    }
  });

  it('carries currentVersion on conflict results only, and never bounds it', () => {
    const conflict = ProjectIterationUpdateResultSchema.parse({
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      currentVersion: 2_147_483_647,
    });
    expect(conflict.ok).toBe(false);
    // 失败分支必须带这个键（哪怕是 null）：漏填的通道过不了 schema。
    expect(() =>
      ProjectIterationUpdateResultSchema.parse({
        ok: false,
        code: 'transient',
        message: '网络暂时不可用，请稍后重试。',
        referenceCode: 'STRX-COLLAB-010',
      }),
    ).toThrow();
  });

  // ── 判据 2：权限分档在服务端；客户端契约只表达可递交的形状 ───────────────
  it('cannot express a cross-goal move on the iteration update channel', () => {
    // 首期不支持跨目标移动：服务端库层刻意没封（回填旧轮次要用），所以拒绝发生在
    // 路由层——客户端契约里连这个字段都不表达，是同一条纪律在这一层的载体。
    expect(() =>
      ProjectIterationUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
        milestoneId: MILESTONE_ID,
      }),
    ).toThrow();
  });

  it('cannot express a status change on either update channel（达成与重开另有留证动作）', () => {
    expect(() =>
      ProjectIterationUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
        status: 'completed',
      }),
    ).toThrow();
    expect(() =>
      ProjectMilestoneUpdateRequestSchema.parse({
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        expectedVersion: 1,
        clientRequestId: 'req-1',
        status: 'completed',
      }),
    ).toThrow();
  });

  it('carries every editable field in one iteration update（轮次更新只有 manager+ 一档）', () => {
    // 服务端已删掉「本轮负责人且 editor+ 只改三个字段」的 own 档（排期归管理者和拥有者，
    // D-MODEL-01 §四）。此前与那份服务端闭集逐字对应的客户端字段表随之删除——留着它等于
    // 钉住一份服务端已不存在的契约。现行契约只有一档：全部可改字段可以同一次递交。
    const everything = ProjectIterationUpdateRequestSchema.parse({
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 3,
      clientRequestId: 'req-1',
      name: '迭代 2 · 子任务拆解与跟踪',
      criteriaMd: '完成本轮范围并通过验收',
      ownerSubject: 'u-bob',
      priority: 'high',
      dueAt: '2026-10-01T00:00:00Z',
      archived: false,
    });
    expect(everything).toMatchObject({
      name: '迭代 2 · 子任务拆解与跟踪',
      criteriaMd: '完成本轮范围并通过验收',
      ownerSubject: 'u-bob',
      priority: 'high',
      dueAt: '2026-10-01T00:00:00Z',
      archived: false,
    });
  });

  it('lets a rename keep the same uuid and the same milestone link', () => {
    // 改名请求里只有 name：id 与 milestoneId 都不在可改字段里，所以「改名动了关联」
    // 在这一层结构性不可表达。
    const rename = ProjectIterationUpdateRequestSchema.parse({
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 1,
      clientRequestId: 'req-1',
      name: '改过名的轮次',
    });
    expect(rename.iterationId).toBe(ITERATION_ID);
    expect(Object.keys(rename)).not.toContain('milestoneId');
  });

  // ── 服务端计数：一律不设客户端上界 ────────────────────────────────────────
  it('never puts a client-side upper bound on any server-supplied count', () => {
    // ⛔ 事故复盘：childTotal 加了 .max(500)，子树越界时 mapArray 一条坏全批坏，
    //    整个看板取不回来。iterationSummary / visibleRequirementCount / groupCounts
    //    / total 全是服务端计数。
    for (const count of [0, 500, 501, 100_000, Number.MAX_SAFE_INTEGER]) {
      expect(
        ProjectMilestoneListItemSchema.parse({
          ...milestoneListItem,
          iterationSummary: { total: count, open: count, completed: 0 },
          visibleRequirementCount: count,
        }).visibleRequirementCount,
      ).toBe(count);
      expect(
        ProjectIterationGroupCountsSchema.parse({ mine: count, open: count, completed: count })
          .open,
      ).toBe(count);
      expect(
        ProjectMilestoneListResultSchema.parse({
          ok: true,
          items: [],
          total: count,
          page: 1,
          pageSize: 20,
        }),
      ).toBeTruthy();
    }
    // 负数与小数仍要拒（形状门还在，只是不设上界）。
    expect(() =>
      ProjectIterationGroupCountsSchema.parse({ mine: -1, open: 0, completed: 0 }),
    ).toThrow();
    expect(() =>
      ProjectIterationGroupCountsSchema.parse({ mine: 1.5, open: 0, completed: 0 }),
    ).toThrow();
  });

  it('never bounds the item array of a list result（页大小由服务端定，客户端不封顶）', () => {
    const items = Array.from({ length: 600 }, (_unused, index) => ({
      ...milestoneListItem,
      id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    }));
    const parsed = ProjectMilestoneListResultSchema.parse({
      ok: true,
      items,
      total: 600,
      page: 1,
      pageSize: 600,
    });
    expect(parsed.ok && parsed.items).toHaveLength(600);
  });

  it('bounds the page size request at the same number as the server', () => {
    expect(PROJECT_PLANNING_MAX_PAGE_SIZE).toBe(100);
    expect(
      ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, pageSize: 100 }).pageSize,
    ).toBe(100);
    expect(() =>
      ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, pageSize: 101 }),
    ).toThrow();
  });

  // ── 列表筛选：未关联是独立问题 ───────────────────────────────────────────
  it('asks about unlinked rounds with its own flag, not with an empty milestoneId', () => {
    const unlinked = ProjectIterationListRequestSchema.parse({
      projectId: PROJECT_ID,
      unlinked: true,
    });
    expect(unlinked.unlinked).toBe(true);
    expect(unlinked.milestoneId).toBeUndefined();
    // 「不筛」与「只要未关联」不能撞在同一个值上 ⇒ milestoneId 不可为 null。
    expect(() =>
      ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, milestoneId: null }),
    ).toThrow();
  });

  it('whitelists the sort field（不拼自由 SQL）', () => {
    for (const sort of ['due_at', 'priority', 'created_at', 'name'] as const) {
      expect(ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, sort }).sort).toBe(
        sort,
      );
    }
    for (const bad of ['version', 'criteria_md', 'due_at DESC', 'id; DROP TABLE todos']) {
      expect(() =>
        ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, sort: bad }),
      ).toThrow();
    }
  });

  // ── 红线：契约里不可表达账号与会话正文 ──────────────────────────────────
  it('cannot express an account key or any assistant transcript field on any channel', () => {
    for (const forbidden of ['accountKey', 'prompt', 'answer', 'transcript', 'filePath']) {
      expect(() =>
        ProjectMilestoneCreateRequestSchema.parse({
          projectId: PROJECT_ID,
          clientRequestId: 'req-1',
          name: '成员邀请与权限管理',
          [forbidden]: 'x',
        }),
      ).toThrow();
      expect(() =>
        ProjectIterationListRequestSchema.parse({ projectId: PROJECT_ID, [forbidden]: 'x' }),
      ).toThrow();
    }
  });

  it('bounds authored text on the write channels at the same numbers as the DDL', () => {
    expect(() =>
      ProjectMilestoneCreateRequestSchema.parse({
        projectId: PROJECT_ID,
        clientRequestId: 'req-1',
        name: 'x'.repeat(PROJECT_MILESTONE_MAX_NAME_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      ProjectIterationCreateRequestSchema.parse({
        projectId: PROJECT_ID,
        clientRequestId: 'req-1',
        name: '第一轮',
        criteriaMd: 'x'.repeat(PROJECT_ITERATION_MAX_CRITERIA_LENGTH + 1),
      }),
    ).toThrow();
    // 亲笔正文允许空串与换行，只拒 NUL。
    expect(
      ProjectIterationCreateRequestSchema.parse({
        projectId: PROJECT_ID,
        clientRequestId: 'req-1',
        name: '第一轮',
        criteriaMd: '第一行\n第二行',
      }).criteriaMd,
    ).toBe('第一行\n第二行');
    expect(() =>
      ProjectIterationCreateRequestSchema.parse({
        projectId: PROJECT_ID,
        clientRequestId: 'req-1',
        name: '第一轮',
        criteriaMd: 'a\0b',
      }),
    ).toThrow();
  });

  it('accepts an explicitly unlinked round on create（null 是有意的产品状态）', () => {
    const created = ProjectIterationCreateRequestSchema.parse({
      projectId: PROJECT_ID,
      clientRequestId: 'req-1',
      name: '未关联的一轮',
      milestoneId: null,
    });
    expect(created.milestoneId).toBeNull();
    // 但不接受名称/日期/原型编号当关联键。
    for (const bad of ['成员邀请与权限管理', '2026-09-01', 'D-101']) {
      expect(() =>
        ProjectIterationCreateRequestSchema.parse({
          projectId: PROJECT_ID,
          clientRequestId: 'req-1',
          name: '一轮',
          milestoneId: bad,
        }),
      ).toThrow();
    }
  });
});
// ═══ 迭代 ↔ 需求：关联历史（MIL-03）══════════════════════════════════════════

const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
const LINK_ID = '55555555-5555-4555-8555-555555555555';

const linkedRequirement = {
  requirementId: REQUIREMENT_ID,
  title: '邀请码可撤销',
  status: 'notStarted' as const,
  linkState: 'active' as const,
  linkedAt: '2026-09-02T00:00:00Z',
  unlinkedAt: null,
};

const iterationListItem = {
  ...iteration,
  linkedRequirements: [linkedRequirement],
  linkedRequirementsHasMore: false,
};

describe('project iteration requirement link contracts', () => {
  // ── 判据 1：两态 + 历史 ─────────────────────────────────────────────────
  it('关联两态是闭集：active ＝ 当前排期、closed ＝ 历史，别的词一律拒', () => {
    for (const good of ['active', 'closed']) {
      expect(
        ProjectIterationRequirementSchema.parse({ ...linkedRequirement, linkState: good })
          .linkState,
      ).toBe(good);
    }
    // ⚠️ 契约原文那一栏叫 `current_or_history`；取值不是那两个词（见 schema 注释）。
    for (const bad of ['current', 'history', 'open', 'done', '']) {
      expect(() =>
        ProjectIterationRequirementSchema.parse({ ...linkedRequirement, linkState: bad }),
      ).toThrow();
    }
  });

  it('历史关联带移出时刻；当前排期的移出时刻是 null（⛔ 不是缺席）', () => {
    const history = ProjectIterationRequirementSchema.parse({
      ...linkedRequirement,
      linkState: 'closed',
      unlinkedAt: '2026-09-05T00:00:00Z',
    });
    expect(history.unlinkedAt).toBe('2026-09-05T00:00:00Z');
    expect(isProjectIterationRequirementCurrent(history)).toBe(false);
    expect(isProjectIterationRequirementCurrent(linkedRequirement)).toBe(true);
    // 缺席不合法：strictObject 要求这个键存在（「没排过」与「排过又移出了」不同）。
    expect(() =>
      ProjectIterationRequirementSchema.parse(without(linkedRequirement, 'unlinkedAt')),
    ).toThrow();
  });

  // ── 判据 2/3：需求 UUID 是关联键，标题不是 ───────────────────────────────
  it('关联键只能是需求的 UUID——标题/日期/原型编号一律拒', () => {
    for (const bad of ['邀请码可撤销', '2026-09-02', 'D-101', '']) {
      expect(() =>
        ProjectIterationRequirementSchema.parse({ ...linkedRequirement, requirementId: bad }),
      ).toThrow();
    }
  });

  it('需求状态复用待办那一份闭集（⛔ 本域不另立一套状态词）', () => {
    for (const good of ['notStarted', 'inProgress', 'inReview', 'done', 'cancelled']) {
      expect(
        ProjectIterationRequirementSchema.parse({ ...linkedRequirement, status: good }).status,
      ).toBe(good);
    }
    // 轮次的两态**不是**需求的状态：混用会让「这一轮达成了」与「这条需求做完了」同字段。
    for (const bad of ['open', 'completed']) {
      expect(() =>
        ProjectIterationRequirementSchema.parse({ ...linkedRequirement, status: bad }),
      ).toThrow();
    }
  });

  it('轮次列表行 = 轮次本体 + 摘要 + has_more；三条出参形状同一份', () => {
    expect(ProjectIterationListItemSchema.parse(iterationListItem)).toEqual(iterationListItem);
    // ⭐ 单条出参（新建/修改）与列表行**同一个 schema**：否则渲染层把改完那一条拼回
    //    列表时关联摘要会消失。
    for (const schema of [ProjectIterationCreateResultSchema, ProjectIterationUpdateResultSchema]) {
      const parsed = schema.parse({ ok: true, iteration: iterationListItem });
      expect(parsed.ok && parsed.iteration.linkedRequirements).toEqual([linkedRequirement]);
    }
    // 少了关联两个键的旧形状**不再**通过（服务端恒回它们）。
    expect(() => ProjectIterationListItemSchema.parse(iteration)).toThrow();
  });

  it('⛔ 摘要数组不设条数上界：服务端计数/服务端截断的结果客户端不再设第二道墙', () => {
    const many = Array.from({ length: 5_000 }, (_unused, index) => ({
      ...linkedRequirement,
      requirementId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    }));
    expect(
      ProjectIterationListItemSchema.parse({ ...iterationListItem, linkedRequirements: many })
        .linkedRequirements,
    ).toHaveLength(5_000);
    // 目标那一侧的去重计数同理（大数照样过；已发生过 `.max(500)` 打空整页的事故）。
    expect(
      ProjectMilestoneListItemSchema.parse({
        ...milestoneListItem,
        visibleRequirementCount: 1_000_000,
      }).visibleRequirementCount,
    ).toBe(1_000_000);
  });

  // ── 判据 4：写请求形状 ─────────────────────────────────────────────────
  it('关联/移出都必带幂等键与两个 expected 版本（缺一即拒）', () => {
    const link = {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      requirementId: REQUIREMENT_ID,
      expectedRequirementVersion: 1,
      expectedIterationVersion: 1,
      clientRequestId: 'req-link-1',
    };
    for (const schema of [
      ProjectIterationRequirementLinkRequestSchema,
      ProjectIterationRequirementUnlinkRequestSchema,
    ]) {
      expect(schema.parse(link)).toEqual(link);
      for (const missing of [
        'clientRequestId',
        'expectedRequirementVersion',
        'expectedIterationVersion',
        'requirementId',
        'iterationId',
      ]) {
        expect(() => schema.parse(without(link, missing))).toThrow();
      }
      // ⛔ 契约里没有「要不要保留历史」这种开关（strictObject 连表达都不允许）。
      expect(() => schema.parse({ ...link, keepHistory: false })).toThrow();
      expect(() => schema.parse({ ...link, clientRequestId: '' })).toThrow();
    }
  });

  it('写出参：changed 是布尔、previousIterationId 可空、iteration 是列表行形状', () => {
    const linkRow = {
      id: LINK_ID,
      iterationId: ITERATION_ID,
      requirementId: REQUIREMENT_ID,
      state: 'active' as const,
      linkedAt: '2026-09-02T00:00:00Z',
      unlinkedAt: null,
      linkedBySubject: 'u-bob',
      version: 1,
    };
    const body = {
      ok: true as const,
      changed: true,
      link: linkRow,
      iteration: iterationListItem,
      requirementId: REQUIREMENT_ID,
      previousIterationId: null,
    };
    for (const schema of [
      ProjectIterationRequirementLinkResultSchema,
      ProjectIterationRequirementUnlinkResultSchema,
    ]) {
      expect(schema.parse(body)).toEqual(body);
      // 切排期：旧轮次的 id 带回来（⭐ 非空 ⇒ 另一张卡也变了，渲染层要一起刷）。
      const moved = schema.parse({ ...body, previousIterationId: MILESTONE_ID });
      expect(moved.ok && moved.previousIterationId).toBe(MILESTONE_ID);
      // 只接受 uuid 或 null：轮次名称一类的串当不了关联键。
      expect(() => schema.parse({ ...body, previousIterationId: '第一轮' })).toThrow();
      // `changed` 必须在（缺席会让渲染层分不清「真排上了」与「本来就排着」）。
      expect(() => schema.parse(without(body, 'changed'))).toThrow();
      // 失败分支的 currentVersion 仅在冲突时非空，但键恒在。
      expect(() =>
        schema.parse({
          ok: false,
          code: 'conflict',
          message: '内容已被他人更新，请刷新后重试。',
          referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
        }),
      ).toThrow();
    }
  });

  it('独立分页请求：页大小与规划域同界；⛔ 没有任何「搜标题」的入口', () => {
    const base = { projectId: PROJECT_ID, iterationId: ITERATION_ID };
    expect(ProjectIterationRequirementListRequestSchema.parse(base)).toEqual(base);
    expect(
      ProjectIterationRequirementListRequestSchema.parse({
        ...base,
        pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
        includeHistory: true,
      }).includeHistory,
    ).toBe(true);
    expect(() =>
      ProjectIterationRequirementListRequestSchema.parse({
        ...base,
        pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE + 1,
      }),
    ).toThrow();
    // ⛔ 需求标题是用户亲笔的正文，不开成一个可枚举的查询面（与目标/轮次同一条）。
    expect(() =>
      ProjectIterationRequirementListRequestSchema.parse({ ...base, q: '邀请码' }),
    ).toThrow();
  });
});
