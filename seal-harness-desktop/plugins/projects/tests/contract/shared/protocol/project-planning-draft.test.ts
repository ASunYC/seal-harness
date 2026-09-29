import { describe, expect, it } from 'vitest';

import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';
import {
  PROJECT_PLANNING_DRAFTS_PER_ACCOUNT,
  PROJECT_PLANNING_DRAFTS_PER_SESSION,
  PROJECT_PLANNING_DRAFT_MAX_CRITERIA,
  PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH,
  ProjectPlanningDraftDiscardRequestSchema,
  ProjectPlanningDraftDiscardResultSchema,
  ProjectPlanningDraftListRequestSchema,
  ProjectPlanningDraftListResultSchema,
  ProjectPlanningDraftSchema,
} from '../../../../stratex/shared/protocol/project-planning-draft.js';
import {
  PROJECT_ITERATION_MAX_CRITERIA_LENGTH,
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH,
} from '../../../../stratex/shared/protocol/project-planning.js';

const DRAFT_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const MILESTONE_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';

function milestoneDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'milestone',
    draftId: DRAFT_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-09-14T08:00:00.000Z',
    name: '成员邀请与权限管理',
    objectiveMd: '',
    startAt: null,
    dueAt: null,
    ownerSubject: null,
    ...overrides,
  };
}

function iterationDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'iteration',
    draftId: DRAFT_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-09-14T08:00:00.000Z',
    milestoneId: MILESTONE_ID,
    milestoneName: '成员邀请与权限管理',
    name: '第一轮：邀请链接',
    criteriaMd: '',
    dueAt: null,
    ownerSubject: null,
    ...overrides,
  };
}

describe('规划草案本体', () => {
  it('里程碑草案与迭代计划草案各自按种类解析，可选项写得出「没有」', () => {
    expect(ProjectPlanningDraftSchema.parse(milestoneDraft())).toStrictEqual(milestoneDraft());
    expect(
      ProjectPlanningDraftSchema.parse(
        milestoneDraft({
          objectiveMd: '覆盖邀请、角色与移除',
          startAt: '2026-09-15',
          dueAt: '2026-10-31',
          ownerSubject: 'subject-a',
        }),
      ).kind,
    ).toBe('milestone');
    expect(ProjectPlanningDraftSchema.parse(iterationDraft()).kind).toBe('iteration');
    expect(
      ProjectPlanningDraftSchema.parse(
        iterationDraft({ criteriaMd: '可复制邀请链接\n过期链接不可用', dueAt: '2026-09-30' }),
      ),
    ).toMatchObject({ criteriaMd: '可复制邀请链接\n过期链接不可用', dueAt: '2026-09-30' });
  });

  it('多带任何字段都表达不出（账号字段、提示词、另一种草案的字段）', () => {
    for (const extra of [{ accountKey: 'acct' }, { prompt: '帮我建里程碑' }, { criteriaMd: '' }]) {
      expect(ProjectPlanningDraftSchema.safeParse(milestoneDraft(extra)).success).toBe(false);
    }
    expect(ProjectPlanningDraftSchema.safeParse(iterationDraft({ objectiveMd: '' })).success).toBe(
      false,
    );
  });

  it('日期只收真实日历日 YYYY-MM-DD，与表单的日期输入同形', () => {
    for (const bad of ['2026-02-30', '2026-9-1', '2026-09-15T00:00:00Z', '', '20260915']) {
      expect(
        ProjectPlanningDraftSchema.safeParse(milestoneDraft({ startAt: bad, dueAt: '2026-10-01' }))
          .success,
        bad,
      ).toBe(false);
      expect(
        ProjectPlanningDraftSchema.safeParse(iterationDraft({ dueAt: bad })).success,
        bad,
      ).toBe(false);
    }
  });

  it('名称必填、去空白后不空、不含 NUL，长度与手工新建同界', () => {
    for (const name of ['', '   ', 'a\0b', 'x'.repeat(PROJECT_MILESTONE_MAX_NAME_LENGTH + 1)]) {
      expect(ProjectPlanningDraftSchema.safeParse(milestoneDraft({ name })).success).toBe(false);
      expect(ProjectPlanningDraftSchema.safeParse(iterationDraft({ name })).success).toBe(false);
    }
    expect(
      ProjectPlanningDraftSchema.safeParse(
        milestoneDraft({ name: 'x'.repeat(PROJECT_MILESTONE_MAX_NAME_LENGTH) }),
      ).success,
    ).toBe(true);
    expect(
      ProjectPlanningDraftSchema.safeParse(
        milestoneDraft({ objectiveMd: 'x'.repeat(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH + 1) }),
      ).success,
    ).toBe(false);
    expect(
      ProjectPlanningDraftSchema.safeParse(
        iterationDraft({ criteriaMd: 'x'.repeat(PROJECT_ITERATION_MAX_CRITERIA_LENGTH + 1) }),
      ).success,
    ).toBe(false);
  });

  it('上限常量：每会话 10 份、每账号 50 份、完成标准至多 20 条每条 500 字', () => {
    expect(PROJECT_PLANNING_DRAFTS_PER_SESSION).toBe(10);
    expect(PROJECT_PLANNING_DRAFTS_PER_ACCOUNT).toBe(50);
    expect(PROJECT_PLANNING_DRAFT_MAX_CRITERIA).toBe(20);
    expect(PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH).toBe(500);
    // 拼成一段后仍在迭代完成标准的长度上界内（20 条 × 500 字 + 19 个换行）。
    expect(
      PROJECT_PLANNING_DRAFT_MAX_CRITERIA * PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH +
        PROJECT_PLANNING_DRAFT_MAX_CRITERIA -
        1,
    ).toBeLessThanOrEqual(PROJECT_ITERATION_MAX_CRITERIA_LENGTH);
  });
});

describe('读取与清除两条入站通道的请求 / 响应', () => {
  it('读取请求只有会话编号：会话编号采用 DSH 非空字符串，多带字段即拒', () => {
    expect(ProjectPlanningDraftListRequestSchema.parse({ sessionId: SESSION_ID })).toStrictEqual({
      sessionId: SESSION_ID,
    });
    for (const input of [
      {},
      { sessionId: '' },
      { sessionId: SESSION_ID, accountKey: 'acct' },
      { sessionId: SESSION_ID, projectId: PROJECT_ID },
    ]) {
      expect(ProjectPlanningDraftListRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it('读取结果：成功带草案列表（至多每会话上限份），失败带参考编号', () => {
    expect(
      ProjectPlanningDraftListResultSchema.parse({
        ok: true,
        drafts: [milestoneDraft(), iterationDraft({ draftId: SESSION_ID })],
      }),
    ).toMatchObject({ ok: true });
    expect(
      ProjectPlanningDraftListResultSchema.safeParse({
        ok: true,
        drafts: Array.from({ length: PROJECT_PLANNING_DRAFTS_PER_SESSION + 1 }, () =>
          milestoneDraft(),
        ),
      }).success,
    ).toBe(false);
    expect(
      ProjectPlanningDraftListResultSchema.parse({
        ok: false,
        code: 'rejected',
        message: '会话不属于当前账号。',
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected,
      }),
    ).toMatchObject({ ok: false, code: 'rejected' });
    expect(
      ProjectPlanningDraftListResultSchema.safeParse({ ok: false, code: 'rejected', message: 'x' })
        .success,
    ).toBe(false);
  });

  it('清除请求：处置结果只有 confirmed / dismissed，渲染层表达不出 cleared', () => {
    const base = { sessionId: SESSION_ID, draftId: DRAFT_ID };
    expect(
      ProjectPlanningDraftDiscardRequestSchema.parse({ ...base, outcome: 'confirmed' }),
    ).toStrictEqual({ ...base, outcome: 'confirmed' });
    expect(
      ProjectPlanningDraftDiscardRequestSchema.safeParse({ ...base, outcome: 'dismissed' }).success,
    ).toBe(true);
    for (const input of [
      { ...base, outcome: 'cleared' },
      { ...base },
      { ...base, outcome: 'confirmed', draftId: 'draft-1' },
      { ...base, outcome: 'confirmed', entityId: MILESTONE_ID },
    ]) {
      expect(ProjectPlanningDraftDiscardRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it('清除结果：成功只有 ok，失败带参考编号', () => {
    expect(ProjectPlanningDraftDiscardResultSchema.parse({ ok: true })).toStrictEqual({ ok: true });
    expect(ProjectPlanningDraftDiscardResultSchema.safeParse({ ok: true, extra: 1 }).success).toBe(
      false,
    );
    expect(
      ProjectPlanningDraftDiscardResultSchema.parse({
        ok: false,
        code: 'rejected',
        message: '这份草案已不在该会话里。',
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected,
      }),
    ).toMatchObject({ ok: false });
  });
});
