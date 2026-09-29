import { describe, expect, it } from 'vitest';

import {
  PROJECT_TEST_ROUND_ACTIVE_STATES,
  PROJECT_TEST_ROUND_MAX_ARTIFACTS,
  PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH,
  ProjectRequirementSubmissionsRequestSchema,
  ProjectRequirementSubmissionsResultSchema,
  ProjectRequirementSubmitRequestSchema,
  ProjectRequirementSubmitResultSchema,
  ProjectSubmissionDetailRequestSchema,
  ProjectSubmissionDetailResultSchema,
  ProjectTestRoundDetailSchema,
  ProjectTestRoundSchema,
  ProjectTestRoundSnapshotSchema,
  ProjectTestRoundStateSchema,
  isProjectTestRoundActive,
  projectRequirementSubmitServerCodeText,
  type ProjectTestRound,
} from '../../../../stratex/shared/protocol/project-testing.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';

const ROUND: ProjectTestRound = {
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
};

const TODO = {
  id: REQUIREMENT_ID,
  itemKind: 'requirement',
  parentId: null,
  source: 'manual',
  visibility: 'shared',
  title: '整条需求提测',
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
  childTotal: 2,
  childDone: 2,
  version: 4,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
} as const;

const SNAPSHOT = {
  requirement: {
    id: REQUIREMENT_ID,
    title: '整条需求提测',
    description: '',
    priority: 'high',
    status: 'inProgress',
    constraintsText: '',
    labels: ['检索'],
    itemKind: 'requirement',
  },
  tasks: [
    { id: TASK_ID, parentId: REQUIREMENT_ID, title: '补齐接口', status: 'done', itemKind: 'task' },
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
    gateVersion: 1,
    submissionGate: {
      requireTasks: false,
      requireAllTasksDone: true,
      requireCriteria: true,
      requireReadyArtifacts: false,
    },
    requiredItemCount: 1,
    requiredItemOrdinals: [1],
  },
} as const;

const FAILURE_BASE = {
  ok: false,
  code: 'rejected',
  message: '请求被服务端拒绝。',
  referenceCode: 'STRX-COLLAB-009',
} as const;

const NULL_EXTRAS = {
  currentVersion: null,
  unfinishedTaskIds: null,
  unfinishedTaskCount: null,
  legacyOpenReviewCount: null,
} as const;

describe('测试轮次模型', () => {
  it('状态闭集与服务端迁移 0025 的 CHECK 逐字一致，活动态只有 queued / testing', () => {
    expect(ProjectTestRoundStateSchema.options).toEqual([
      'queued',
      'testing',
      'passed',
      'returned',
      'withdrawn',
    ]);
    expect(PROJECT_TEST_ROUND_ACTIVE_STATES).toEqual(['queued', 'testing']);
    for (const state of ProjectTestRoundStateSchema.options) {
      expect(isProjectTestRoundActive({ state })).toBe(state === 'queued' || state === 'testing');
    }
  });

  it('摘要形态是 strict：带整体完成说明的行过不了（项目级判定不列正文）', () => {
    expect(ProjectTestRoundSchema.parse(ROUND)).toEqual(ROUND);
    expect(ProjectTestRoundSchema.safeParse({ ...ROUND, summary: '做完了' }).success).toBe(false);
    expect(ProjectTestRoundSchema.safeParse({ ...ROUND, state: 'pending' }).success).toBe(false);
    expect(ProjectTestRoundSchema.safeParse({ ...ROUND, roundNo: 0 }).success).toBe(false);
    // 轮号与版本是服务端计数：⛔ 不设客户端上界。
    expect(ProjectTestRoundSchema.safeParse({ ...ROUND, roundNo: 100_000 }).success).toBe(true);
  });

  it('详情形态 = 摘要 + 整体完成说明；说明缺席不兜空串', () => {
    const detail = { ...ROUND, summary: '全部任务已完成，交付物见附件。' };
    expect(ProjectTestRoundDetailSchema.parse(detail)).toEqual(detail);
    expect(ProjectTestRoundDetailSchema.safeParse(ROUND).success).toBe(false);
  });

  it('⭐ 入站说明按码点上界的两倍收（服务端按码点计 4000，四字节字符在这里占两个单元）', () => {
    const astral = '😀'.repeat(PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH);
    expect(ProjectTestRoundDetailSchema.safeParse({ ...ROUND, summary: astral }).success).toBe(
      true,
    );
  });

  it('五面快照逐面 strict：多带一个字段、少一面都过不了', () => {
    expect(ProjectTestRoundSnapshotSchema.parse(SNAPSHOT)).toEqual(SNAPSHOT);
    expect(
      ProjectTestRoundSnapshotSchema.safeParse({
        ...SNAPSHOT,
        gate: { ...SNAPSHOT.gate, submissionGate: { ...SNAPSHOT.gate.submissionGate, perTask: 1 } },
      }).success,
    ).toBe(false);
    const withoutAttachments: Record<string, unknown> = { ...SNAPSHOT };
    delete withoutAttachments.attachments;
    expect(ProjectTestRoundSnapshotSchema.safeParse(withoutAttachments).success).toBe(false);
    expect(
      ProjectTestRoundSnapshotSchema.safeParse({
        ...SNAPSHOT,
        attachments: [{ ...SNAPSHOT.attachments[0], contentSha256: 'not-a-hash' }],
      }).success,
    ).toBe(false);
  });
});

describe('整需求提交请求', () => {
  const REQUEST = {
    projectId: PROJECT_ID,
    requirementId: REQUIREMENT_ID,
    expectedVersion: 3,
    clientRequestId: 'req-1',
    summary: '全部任务已完成。',
    reviewerSubject: 'u-other',
    artifactVersionIds: [VERSION_ID],
  };

  it('合法请求原样通过；⛔ 不收任何快照字段与账号字段', () => {
    expect(ProjectRequirementSubmitRequestSchema.parse(REQUEST)).toEqual(REQUEST);
    for (const extra of ['tasksSnapshot', 'accountKey', 'submittedBySubject']) {
      expect(
        ProjectRequirementSubmitRequestSchema.safeParse({ ...REQUEST, [extra]: 'x' }).success,
      ).toBe(false);
    }
  });

  it('上界与服务端同界：说明 ≤4000、交付物 ≤50 且只收版本 uuid、请求号 1–128', () => {
    const check = (patch: Record<string, unknown>): boolean =>
      ProjectRequirementSubmitRequestSchema.safeParse({ ...REQUEST, ...patch }).success;
    expect(check({ summary: 'x'.repeat(PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH) })).toBe(true);
    expect(check({ summary: 'x'.repeat(PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH + 1) })).toBe(false);
    expect(check({ summary: '含\0的说明' })).toBe(false);
    expect(
      check({
        artifactVersionIds: Array.from(
          { length: PROJECT_TEST_ROUND_MAX_ARTIFACTS },
          () => VERSION_ID,
        ),
      }),
    ).toBe(true);
    expect(
      check({
        artifactVersionIds: Array.from(
          { length: PROJECT_TEST_ROUND_MAX_ARTIFACTS + 1 },
          () => VERSION_ID,
        ),
      }),
    ).toBe(false);
    expect(check({ artifactVersionIds: ['asset:not-a-version'] })).toBe(false);
    expect(check({ clientRequestId: '' })).toBe(false);
    expect(check({ clientRequestId: 'x'.repeat(129) })).toBe(false);
    expect(check({ reviewerSubject: '' })).toBe(false);
    expect(check({ expectedVersion: 0 })).toBe(false);
  });

  it('成功带回详情轮次、权威需求与「是否回放」；失败四个附加键恒在（缺席用 null）', () => {
    const success = {
      ok: true,
      submission: { ...ROUND, summary: '全部任务已完成。' },
      todo: TODO,
      replayed: false,
    };
    expect(ProjectRequirementSubmitResultSchema.safeParse(success).success).toBe(true);
    expect(
      ProjectRequirementSubmitResultSchema.safeParse({ ...success, replayed: undefined }).success,
    ).toBe(false);

    const unfinished = {
      ...FAILURE_BASE,
      serverCode: 'submission_tasks_unfinished',
      ...NULL_EXTRAS,
      unfinishedTaskIds: [TASK_ID],
      unfinishedTaskCount: 3,
    };
    expect(ProjectRequirementSubmitResultSchema.safeParse(unfinished).success).toBe(true);
    const missingKey: Record<string, unknown> = { ...unfinished };
    delete missingKey.legacyOpenReviewCount;
    expect(ProjectRequirementSubmitResultSchema.safeParse(missingKey).success).toBe(false);
  });
});

describe('轮次列表与单轮详情', () => {
  it('列表：游标与 hasMore 同生同灭；limit 1–50', () => {
    const request = { projectId: PROJECT_ID, requirementId: REQUIREMENT_ID, limit: 30 };
    expect(ProjectRequirementSubmissionsRequestSchema.parse(request)).toEqual(request);
    expect(
      ProjectRequirementSubmissionsRequestSchema.safeParse({ ...request, limit: 51 }).success,
    ).toBe(false);
    const page = {
      ok: true,
      submissions: [{ ...ROUND, summary: '说明' }],
      hasMore: false,
      nextCursor: null,
    };
    expect(ProjectRequirementSubmissionsResultSchema.safeParse(page).success).toBe(true);
    expect(
      ProjectRequirementSubmissionsResultSchema.safeParse({ ...page, hasMore: true }).success,
    ).toBe(false);
  });

  it('详情：轮次 + 五面快照；失败只带 serverCode', () => {
    expect(
      ProjectSubmissionDetailRequestSchema.safeParse({
        projectId: PROJECT_ID,
        submissionId: ROUND_ID,
      }).success,
    ).toBe(true);
    expect(
      ProjectSubmissionDetailResultSchema.safeParse({
        ok: true,
        submission: { ...ROUND, summary: '说明' },
        snapshot: SNAPSHOT,
      }).success,
    ).toBe(true);
    expect(
      ProjectSubmissionDetailResultSchema.safeParse({
        ...FAILURE_BASE,
        serverCode: 'submission_not_found',
      }).success,
    ).toBe(true);
  });
});

describe('整需求提交的服务端业务码文案', () => {
  const EXPECTED: Readonly<Record<string, string>> = {
    reviewer_not_independent: '测试负责人不能是需求处理人或本轮提交人，请选择其他成员。',
    reviewer_not_member: '所选测试负责人已不在项目里，请重新选择。',
    reviewer_not_editor: '观察者不能担任测试负责人，请选择可编辑成员。',
    submitter_not_assignee: '只有需求处理人可以整体提交测试。',
    submission_summary_required: '请填写整体完成说明。',
    submission_criteria_required: '请先填写这条需求的通过标准。',
    submission_tasks_required: '当前提交规则要求至少一项任务，请先拆分执行任务。',
    submission_tasks_unfinished: '当前提交规则要求完成全部任务，还有任务没有完成。',
    submission_tasks_restricted: '这条需求下有你看不到的任务，需管理者核对任务范围后再提交。',
    submission_artifacts_required: '当前提交规则要求至少一份本轮交付物。',
    artifact_not_found: '所选交付物已不可用，请重新选择。',
    artifact_not_ready: '所选交付物已不可用，请重新选择。',
    active_round_exists: '这条需求已在测试中，无需重复提交。',
    legacy_review_in_progress: '这条需求还在原流程待验收中，请先按原流程验收或打回。',
    requirement_not_submittable: '已完成或已取消的需求不能提交测试。',
    version_conflict: '需求已被他人修改，请刷新后重新提交。',
    idempotency_retry: '提交正在处理中，请稍后重试。',
    idempotency_conflict: '本次提交内容已变化，请关闭后重新提交。',
    not_a_requirement: '只有需求可以整体提测，子任务不单独提测。',
    personal_requirement_not_submittable: '私有需求须先共享给项目，才能提交测试。',
  };

  it.each(Object.entries(EXPECTED))('%s 有用户可读文案', (code, text) => {
    expect(projectRequirementSubmitServerCodeText(code)).toBe(text);
  });

  it('旧评审未结：取得到条数就说出条数，取不到就不编数字', () => {
    expect(
      projectRequirementSubmitServerCodeText('open_legacy_review', { legacyOpenReviewCount: 2 }),
    ).toBe('项目里还有 2 条旧评审未结，请先按旧流程完成评审再提测。');
    expect(projectRequirementSubmitServerCodeText('open_legacy_review')).toBe(
      '项目里还有旧评审未结，请先按旧流程完成评审再提测。',
    );
    expect(
      projectRequirementSubmitServerCodeText('open_legacy_review', { legacyOpenReviewCount: null }),
    ).toBe('项目里还有旧评审未结，请先按旧流程完成评审再提测。');
  });

  it('认不出的码、通用码与缺席一律 null（调用方退回通用句）', () => {
    expect(projectRequirementSubmitServerCodeText('forbidden')).toBeNull();
    expect(projectRequirementSubmitServerCodeText('todo_not_found')).toBeNull();
    expect(projectRequirementSubmitServerCodeText(undefined)).toBeNull();
    expect(projectRequirementSubmitServerCodeText(null)).toBeNull();
  });
});
