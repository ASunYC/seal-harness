import { describe, expect, it } from 'vitest';

import { ProjectRequirementPageRequestSchema } from '../../../../stratex/shared/protocol/project-collab.js';
import {
  PROJECT_TODO_PLAN_DATE_TEXT,
  ProjectPlanWindowBoundSchema,
  projectTodoPlanDatesServerCodeText,
} from '../../../../stratex/shared/protocol/project-collab-plan-dates.js';
import {
  ProjectMilestoneListRequestSchema,
  projectMilestoneWriteServerCodeText,
} from '../../../../stratex/shared/protocol/project-planning.js';

/**
 * 计划起止日期的共享契约（CORE-08，ADR-0042）：时间段两端的形状、两条请求模式共用同一份字段与倒挂判定、
 * 日期类服务端码与提示句一一对应。
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SEPTEMBER = { planFrom: '2026-08-31T00:00:00.000Z', planTo: '2026-10-12T00:00:00.000Z' };

describe('时间段一端', () => {
  it('只收带时区偏移的 RFC 3339 时刻', () => {
    expect(ProjectPlanWindowBoundSchema.safeParse('2026-09-01T00:00:00.000Z').success).toBe(true);
    expect(ProjectPlanWindowBoundSchema.safeParse('2026-09-01T08:00:00+08:00').success).toBe(true);
    // 日期串与不带时区的时刻都拒：两端的含义必须不依赖任何一端机器的时区。
    expect(ProjectPlanWindowBoundSchema.safeParse('2026-09-01').success).toBe(false);
    expect(ProjectPlanWindowBoundSchema.safeParse('2026-09-01T00:00:00').success).toBe(false);
  });
});

describe('两条请求模式共用同一份时间段字段', () => {
  it('需求分页：两端各自可缺，给了就原样带上', () => {
    const base = { projectId: PROJECT_ID, page: 1, pageSize: 20 as const };
    expect(ProjectRequirementPageRequestSchema.parse({ ...base, ...SEPTEMBER })).toMatchObject(
      SEPTEMBER,
    );
    expect(
      ProjectRequirementPageRequestSchema.parse({ ...base, planFrom: SEPTEMBER.planFrom }),
    ).not.toHaveProperty('planTo');
    expect(ProjectRequirementPageRequestSchema.parse(base)).not.toHaveProperty('planFrom');
  });

  it('需求分页与业务目标列表：倒挂或两端相同的时间段先手拒绝', () => {
    const inverted = { planFrom: SEPTEMBER.planTo, planTo: SEPTEMBER.planFrom };
    const empty = { planFrom: SEPTEMBER.planFrom, planTo: SEPTEMBER.planFrom };
    for (const window of [inverted, empty]) {
      expect(
        ProjectRequirementPageRequestSchema.safeParse({
          projectId: PROJECT_ID,
          page: 1,
          pageSize: 20,
          ...window,
        }).success,
      ).toBe(false);
      expect(
        ProjectMilestoneListRequestSchema.safeParse({ projectId: PROJECT_ID, ...window }).success,
      ).toBe(false);
    }
  });

  it('业务目标列表：带时间段照常解析，未知字段仍被严格模式拒绝', () => {
    expect(
      ProjectMilestoneListRequestSchema.parse({ projectId: PROJECT_ID, ...SEPTEMBER }),
    ).toEqual({
      projectId: PROJECT_ID,
      ...SEPTEMBER,
    });
    expect(
      ProjectMilestoneListRequestSchema.safeParse({ projectId: PROJECT_ID, window: SEPTEMBER })
        .success,
    ).toBe(false);
  });
});

describe('日期类服务端码与提示句一一对应', () => {
  it('待办写入：两个码各对应编辑框的一句，认不出的码回 null', () => {
    expect(projectTodoPlanDatesServerCodeText('start_requires_due')).toBe(
      PROJECT_TODO_PLAN_DATE_TEXT.startRequiresDue,
    );
    expect(projectTodoPlanDatesServerCodeText('invalid_date_range')).toBe(
      PROJECT_TODO_PLAN_DATE_TEXT.dateOrder,
    );
    expect(projectTodoPlanDatesServerCodeText('forbidden')).toBeNull();
    expect(projectTodoPlanDatesServerCodeText(undefined)).toBeNull();
    expect(new Set(Object.values(PROJECT_TODO_PLAN_DATE_TEXT)).size).toBe(2);
  });

  it('业务目标写入：起止成对有自己的一句，不与必填 / 日期顺序那两句重合', () => {
    const pairing = projectMilestoneWriteServerCodeText('start_requires_due');
    expect(pairing).toBe('填写开始日期后请同时填写结束日期。');
    expect(pairing).not.toBe(projectMilestoneWriteServerCodeText('milestone_name_required'));
    expect(pairing).not.toBe(projectMilestoneWriteServerCodeText('invalid_date_range'));
  });
});
