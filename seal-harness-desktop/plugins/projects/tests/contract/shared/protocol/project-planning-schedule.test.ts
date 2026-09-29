import { describe, expect, it } from 'vitest';

import {
  isCalendarDayKey,
  PROJECT_ITERATION_SCHEDULE_MAX_ITEMS,
  PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS,
  ProjectIterationScheduleSaveRequestSchema,
  ProjectIterationScheduleSaveResultSchema,
  ProjectRequirementPlacementListResultSchema,
  ProjectRequirementPlacementListRequestSchema,
  ProjectRequirementScheduleSaveRequestSchema,
  ProjectRequirementScheduleSaveResultSchema,
  projectRequirementScheduleServerCodeText,
} from '../../../../stratex/shared/protocol/project-planning-schedule.js';
import { projectMilestoneWriteServerCodeText } from '../../../../stratex/shared/protocol/project-planning.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';

describe('授权整组候选查询契约', () => {
  it('接受整组请求，拒绝混合搜索和后续页', () => {
    const input = { projectId: PROJECT, groupRootId: GOAL, pageSize: 20 };
    expect(ProjectRequirementPlacementListRequestSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ q: 'name' }, { requirementId: GOAL }, { page: 2 }]) {
      expect(
        ProjectRequirementPlacementListRequestSchema.safeParse({ ...input, ...extra }).success,
      ).toBe(false);
    }
  });

  it('完整组必须有根、完整标记、唯一条目和一致计数', () => {
    const item = {
      requirementId: GOAL,
      title: 'root',
      status: 'notStarted',
      version: 1,
      placement: null,
      parentId: null,
      ancestorPath: [],
      hasParent: false,
      pathComplete: true,
      hasVisibleChildren: false,
    };
    const page = {
      ok: true,
      items: [item],
      total: 1,
      page: 1,
      pageSize: 100,
      unscheduledTotal: 1,
      selectionScope: 'group',
      groupRootId: GOAL,
      groupComplete: true,
    };
    expect(ProjectRequirementPlacementListResultSchema.safeParse(page).success).toBe(true);
    for (const extra of [
      { groupComplete: false },
      { total: 2 },
      { pageSize: 20 },
      { groupRootId: PROJECT },
      { items: [item, item], total: 2 },
      { selectionScope: 'unknown' },
    ]) {
      expect(
        ProjectRequirementPlacementListResultSchema.safeParse({ ...page, ...extra }).success,
      ).toBe(false);
    }
  });
});

function itemId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`;
}

function request(items: ReadonlyArray<Record<string, unknown>>) {
  return { projectId: PROJECT, milestoneId: GOAL, clientRequestId: 'req-1', items };
}

describe('迭代排期整批保存契约', () => {
  it('日期只收真实日历日 YYYY-MM-DD（带时分 / 2 月 30 / 非零填充一律拒）', () => {
    expect(isCalendarDayKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-1', '2026-09-01T00:00:00Z', '']) {
      expect(isCalendarDayKey(bad)).toBe(false);
    }
  });

  it('⛔ 同一轮在一次请求里只能出现一次；条目 1..上界', () => {
    const one = { iterationId: itemId(1), dueAt: '2026-09-30', expectedVersion: 1 };
    expect(ProjectIterationScheduleSaveRequestSchema.safeParse(request([one])).success).toBe(true);
    expect(ProjectIterationScheduleSaveRequestSchema.safeParse(request([one, one])).success).toBe(
      false,
    );
    expect(ProjectIterationScheduleSaveRequestSchema.safeParse(request([])).success).toBe(false);
    const many = Array.from(
      { length: PROJECT_ITERATION_SCHEDULE_MAX_ITEMS + 1 },
      (_unused, index) => ({
        iterationId: itemId(index),
        dueAt: '2026-09-30',
        expectedVersion: 1,
      }),
    );
    expect(ProjectIterationScheduleSaveRequestSchema.safeParse(request(many)).success).toBe(false);
    expect(
      ProjectIterationScheduleSaveRequestSchema.safeParse(
        request(many.slice(0, PROJECT_ITERATION_SCHEDULE_MAX_ITEMS)),
      ).success,
    ).toBe(true);
  });

  it('⛔ 契约里没有账号字段、也没有开始日 / 时长（strictObject 让它们不可表达）', () => {
    const one = { iterationId: itemId(1), dueAt: '2026-09-30', expectedVersion: 1 };
    expect(
      ProjectIterationScheduleSaveRequestSchema.safeParse({ ...request([one]), accountKey: 'acc' })
        .success,
    ).toBe(false);
    expect(
      ProjectIterationScheduleSaveRequestSchema.safeParse(
        request([{ ...one, startAt: '2026-09-01' }]),
      ).success,
    ).toBe(false);
  });

  it('失败出参 conflicts 恒在（非冲突为空数组），缺席即不合契约', () => {
    const failure = {
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'version_conflict',
    };
    expect(ProjectIterationScheduleSaveResultSchema.safeParse(failure).success).toBe(false);
    expect(
      ProjectIterationScheduleSaveResultSchema.safeParse({
        ...failure,
        conflicts: [{ iterationId: itemId(1), currentVersion: 2 }],
      }).success,
    ).toBe(true);
  });
});

describe('安排需求整批保存与需求排期现状契约（MIL-09，ADR-0038）', () => {
  const REQUIREMENT = '44444444-4444-4444-8444-444444444444';
  const one = {
    requirementId: REQUIREMENT,
    iterationId: itemId(1),
    expectedRequirementVersion: 1,
    expectedIterationId: null,
  };

  it('「不排」与「没排」必须显式给 null（缺键即拒）；同一需求只许一次；条目 1..上界', () => {
    const parse = (items: ReadonlyArray<Record<string, unknown>>) =>
      ProjectRequirementScheduleSaveRequestSchema.safeParse(request(items)).success;
    expect(parse([one])).toBe(true);
    expect(parse([{ ...one, iterationId: null, expectedIterationId: itemId(2) }])).toBe(true);
    const noCurrent: Record<string, unknown> = { ...one };
    delete noCurrent.expectedIterationId;
    const noTarget: Record<string, unknown> = { ...one };
    delete noTarget.iterationId;
    expect(parse([noCurrent])).toBe(false);
    expect(parse([noTarget])).toBe(false);
    expect(parse([one, one])).toBe(false);
    expect(parse([])).toBe(false);
    const many = Array.from(
      { length: PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS + 1 },
      (_u, index) => ({
        ...one,
        requirementId: itemId(index),
      }),
    );
    expect(parse(many)).toBe(false);
    expect(parse(many.slice(0, PROJECT_REQUIREMENT_SCHEDULE_MAX_ITEMS))).toBe(true);
  });

  it('目标里程碑显式 null 与旧 UUID 都接受，缺键或额外键仍拒绝', () => {
    expect(
      ProjectRequirementScheduleSaveRequestSchema.safeParse({
        ...request([one]),
        milestoneId: null,
      }).success,
    ).toBe(true);
    expect(ProjectRequirementScheduleSaveRequestSchema.safeParse(request([one])).success).toBe(
      true,
    );

    const missingMilestone: Record<string, unknown> = { ...request([one]) };
    delete missingMilestone.milestoneId;
    expect(ProjectRequirementScheduleSaveRequestSchema.safeParse(missingMilestone).success).toBe(
      false,
    );
    expect(
      ProjectRequirementScheduleSaveRequestSchema.safeParse({
        ...request([one]),
        milestoneLabel: '未关联',
      }).success,
    ).toBe(false);
  });

  it('⛔ 契约里没有账号字段、也没有轮次版本（安排需求不改轮次字段）', () => {
    expect(
      ProjectRequirementScheduleSaveRequestSchema.safeParse({ ...request([one]), accountKey: 'a' })
        .success,
    ).toBe(false);
    expect(
      ProjectRequirementScheduleSaveRequestSchema.safeParse(
        request([{ ...one, expectedIterationVersion: 1 }]),
      ).success,
    ).toBe(false);
  });

  it('失败出参 conflicts 恒在；成功出参 moves 恒在', () => {
    const failure = {
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'version_conflict',
    };
    expect(ProjectRequirementScheduleSaveResultSchema.safeParse(failure).success).toBe(false);
    expect(
      ProjectRequirementScheduleSaveResultSchema.safeParse({
        ...failure,
        conflicts: [{ requirementId: REQUIREMENT, currentVersion: 2, currentIterationId: null }],
      }).success,
    ).toBe(true);
    const ok = { ok: true, changed: false, iterations: [] };
    expect(ProjectRequirementScheduleSaveResultSchema.safeParse(ok).success).toBe(false);
    expect(ProjectRequirementScheduleSaveResultSchema.safeParse({ ...ok, moves: [] }).success).toBe(
      true,
    );
  });

  it('排期现状：未排条数是服务端计数、不设上界；那一轮未关联目标时目标两字段同为 null', () => {
    const page = {
      ok: true,
      total: 1,
      page: 1,
      pageSize: 100,
      unscheduledTotal: 1_000_000,
    };
    const item = {
      requirementId: REQUIREMENT,
      title: '邀请码可撤销',
      status: 'done',
      version: 9,
      placement: {
        iterationId: itemId(1),
        iterationName: '未关联的一轮',
        iterationStatus: 'completed',
        milestoneId: null,
        milestoneName: null,
      },
    };
    expect(
      ProjectRequirementPlacementListResultSchema.safeParse({ ...page, items: [item] }).success,
    ).toBe(true);
    const noCount: Record<string, unknown> = { ...page };
    delete noCount.unscheduledTotal;
    expect(
      ProjectRequirementPlacementListResultSchema.safeParse({ ...noCount, items: [item] }).success,
    ).toBe(false);
  });

  it('文案：同名逐字照原型；版本冲突不在业务码文案里', () => {
    expect(projectMilestoneWriteServerCodeText('milestone_name_taken')).toBe(
      '已有同名业务目标，请使用其他名称。',
    );
    expect(projectRequirementScheduleServerCodeText('milestone_archived')).toBe(
      '该里程碑已归档，恢复后才能安排需求。',
    );
    expect(projectRequirementScheduleServerCodeText('version_conflict')).toBeNull();
  });
});
