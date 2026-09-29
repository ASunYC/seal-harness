import {
  assetAttachmentSelectability,
  type ProjectAssetCatalogueEntry,
} from '@shared/protocol/project-collab-assets.js';
import { todoChildProgress } from '@shared/protocol/project-collab.js';
import type { ProjectMember, Todo } from '@shared/protocol/project-collab.js';
import {
  isProjectTestRoundActive,
  type ProjectTestRound,
  type ProjectTestRoundState,
} from '@shared/protocol/project-testing.js';

import { assetEntryTitle } from './asset-recovery';
import { formatProjectTime } from './project-format';
import { todoAssigneeMemberOptions } from './todo-assignee';

/**
 * 整需求提测（TST-02）的**入口收窄判据与呈现模型**——纯函数，不碰 store、不碰 DOM。
 *
 * 版式照协作原型最后生效的那层：需求详情底部的提交块（原型 `renderDetail` 的 `.submission`）、
 * 提交弹窗（`submitDialog`，末层把标题改成「整条需求提测 · 标题」并只许处理人打开）、
 * 「测试记录」页签的轮次行（`reviewCard` 的提交人 → 测试负责人一行）。
 *
 * ⚠️ 全部是**入口收窄不是权限**：只有处理人能提交、测试负责人独立于处理人与提交人（D-TEST-01 选 A）、
 *    在册可编辑、个人需求须先共享、项目提交门槛——服务端逐条强判。这里只负责不摆点了必错的入口。
 * ⛔ 提测入口只在需求详情底部：不进更多菜单、不进任务行（`requirement-actions.test.ts` /
 *    `project-flow05-task-tree.test.ts` 两处封闭集合判定守着）。
 */

/** 轮次状态中文（与服务端迁移 0025 的五档一一对应）。 */
export const TEST_ROUND_STATE_LABELS: Readonly<Record<ProjectTestRoundState, string>> = {
  queued: '待测试',
  testing: '测试中',
  passed: '已通过',
  returned: '已退回',
  withdrawn: '已撤回',
};

/** 提测面的固定文案（组件零默认文案：句子都在这里，改一处两端同改）。 */
export const REQUIREMENT_SUBMIT_TEXT = {
  firstSubmitTitle: '任务完成后，检查整条需求的交付',
  resubmitTitle: '整改后，再次提交整条需求',
  submitNote: '提交保存本轮快照，测试负责人依据标准检查交付物。',
  firstSubmitAction: '提交需求测试 →',
  resubmitAction: '再次提交测试 →',
  dialogTitle: (title: string): string => `整条需求提测 · ${title}`,
  summaryLabel: '整体完成说明',
  artifactsLabel: '本轮交付物',
  artifactsLoading: '正在读取项目资产…',
  artifactsError: '项目资产暂时没有取到。',
  artifactsEmpty: '项目资产里还没有文件，可不选。',
  reviewerLabel: '测试负责人',
  reviewerMissing: '待认领',
  dialogNote:
    '一次提交由一位其他成员验证；提交时保存需求标准、任务和交付物快照。待测试期间需撤回后修改。',
  cancel: '取消',
  submit: '提交测试',
  submitting: '提交中…',
  unfinishedTitle: '提交前还需要完成',
  unfinishedRest: (count: number): string => `另有 ${String(count)} 项任务未完成`,
  retry: '重试',
  recordsEmpty: '暂无测试记录。',
  recordsLoading: '正在读取测试记录…',
  recordsError: '测试记录暂时没有取到。',
  recordsTruncated: (count: number): string => `仅显示最近 ${String(count)} 轮。`,
  /** 轮次卡上的「进入测试」与条数单位（TST-04，原型 `reviewCard`）。 */
  enterTesting: '进入测试',
  caseCountUnit: '个用例',
} as const;

/** 「能不能整体提交测试」要看的上下文（store 与能力协商喂进来）。 */
export interface RequirementSubmitGateContext {
  readonly mySubject: string | null;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  /** 协商到 `requirement.test_mode`（未加载 / 加载失败按不支持）。 */
  readonly supportsTestMode: boolean;
  /** 这条需求当前的活动轮次；没有＝null。 */
  readonly activeRound: Pick<ProjectTestRound, 'state'> | null;
}

/**
 * 「这条需求我现在能不能整体提交测试」。
 *
 * 缺一不可：是需求（子任务不单独提测）、协同条目（个人需求须先共享给项目，服务端 422
 * `personal_requirement_not_submittable`）、成员档且处理人是我（管理者不能代处理人提交）、在办
 * （未开始 / 进行中）、可写、项目未归档、服务支持整需求提测、没有活动轮次。
 * `mySubject` 为 null（身份暂不可得）时判不出「是不是我」，一律不成立。
 */
export function canSubmitRequirementForTest(
  todo: Pick<Todo, 'itemKind' | 'visibility' | 'assigneeKind' | 'assigneeSubject' | 'status'>,
  context: RequirementSubmitGateContext,
): boolean {
  if (!context.supportsTestMode || !context.canWrite || context.isArchived) return false;
  if (todo.itemKind !== 'requirement' || todo.visibility === 'personal') return false;
  if (todo.assigneeKind !== 'member') return false;
  if (context.mySubject === null || todo.assigneeSubject !== context.mySubject) return false;
  if (todo.status !== 'notStarted' && todo.status !== 'inProgress') return false;
  return context.activeRound === null;
}

/**
 * 测试负责人候选：在册且可编辑（与处理人下拉同一条 `todoAssigneeMemberOptions` 规则），再排除我与
 * 需求处理人（D-TEST-01 选 A）。保持名册顺序，缺省选第一个。
 * ⚠️ 这只是「不摆必错入口」：提交后改派、并发移出成员由服务端 403 / 422 兜住。
 */
export function submissionReviewerOptions(
  members: readonly ProjectMember[],
  context: { readonly mySubject: string | null; readonly assigneeSubject: string | null },
): ProjectMember[] {
  return todoAssigneeMemberOptions(members, null).filter(
    (member) => member.subject !== context.mySubject && member.subject !== context.assigneeSubject,
  );
}

/** 最近一轮：取轮号最大的那一轮（⛔ 不依赖列表定序，缓存里可能混着不同来源的页）。 */
export function latestRound<T extends Pick<ProjectTestRound, 'roundNo'>>(
  rounds: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const round of rounds) {
    if (latest === null || round.roundNo > latest.roundNo) latest = round;
  }
  return latest;
}

/** 活动轮次（一条需求同时至多一个，库层兜底）：没有＝null。 */
export function activeRound<T extends Pick<ProjectTestRound, 'state'>>(
  rounds: readonly T[],
): T | null {
  return rounds.find((round) => isProjectTestRoundActive(round)) ?? null;
}

/** 下一轮的轮号（呈现用；真正的轮号由服务端在事务里定）。 */
export function nextRoundNo(rounds: readonly Pick<ProjectTestRound, 'roundNo'>[]): number {
  return (latestRound(rounds)?.roundNo ?? 0) + 1;
}

/** 成员显示名：从名册取，取不到用 subject（⛔ 不显示成「未知」——subject 至少说得出是谁）。 */
export function memberDisplayName(members: readonly ProjectMember[], subject: string): string {
  const name = members.find((member) => member.subject === subject)?.displayName ?? '';
  return name.trim().length > 0 ? name : subject;
}

export type RequirementSubmissionBlock =
  | {
      readonly kind: 'submit';
      readonly title: string;
      readonly note: string;
      readonly actionLabel: string;
    }
  | { readonly kind: 'waiting'; readonly title: string; readonly note: string };

export interface RequirementSubmissionBlockContext {
  readonly rounds: readonly ProjectTestRound[];
  /** 这条需求的轮次取过（成功或失败）：还没取到时判不出有没有活动轮次，整块先不出。 */
  readonly roundsReady: boolean;
  readonly members: readonly ProjectMember[];
  readonly mySubject: string | null;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  readonly supportsTestMode: boolean;
}

/**
 * 详情底部的提测块（原型 `.submission`）：
 *  - 有活动轮次 ⇒ 所有成员可见的「第 N 轮 · 等待 某某 验证」（⛔ 撤回属 TST-03，这里不给）；
 *  - 我能提交 ⇒ 提交块（上一轮被退回时换成「整改后，再次提交」）；
 *  - 其余（服务不支持、轮次还没取到、不是我的在办需求）⇒ null。
 */
export function requirementSubmissionBlock(
  todo: Pick<Todo, 'itemKind' | 'visibility' | 'assigneeKind' | 'assigneeSubject' | 'status'>,
  context: RequirementSubmissionBlockContext,
): RequirementSubmissionBlock | null {
  if (!context.supportsTestMode || !context.roundsReady) return null;
  const active = activeRound(context.rounds);
  if (active !== null) {
    const owner =
      todo.assigneeSubject === null
        ? '—'
        : memberDisplayName(context.members, todo.assigneeSubject);
    return {
      kind: 'waiting',
      title: `第 ${String(active.roundNo)} 轮 · ${active.reviewerSubject === null ? '待认领' : `等待 ${memberDisplayName(context.members, active.reviewerSubject)} 验证`}`,
      note: `需求归属仍为 ${owner}。本轮内容已冻结。`,
    };
  }
  if (!canSubmitRequirementForTest(todo, { ...context, activeRound: null })) return null;
  const latest = latestRound(context.rounds);
  return {
    kind: 'submit',
    title:
      latest?.state === 'returned'
        ? REQUIREMENT_SUBMIT_TEXT.resubmitTitle
        : REQUIREMENT_SUBMIT_TEXT.firstSubmitTitle,
    note: REQUIREMENT_SUBMIT_TEXT.submitNote,
    actionLabel:
      latest === null
        ? REQUIREMENT_SUBMIT_TEXT.firstSubmitAction
        : REQUIREMENT_SUBMIT_TEXT.resubmitAction,
  };
}

export interface RequirementTestRecordRow {
  readonly id: string;
  readonly roundLabel: string;
  readonly state: ProjectTestRoundState;
  readonly stateLabel: string;
  readonly line: string;
}

/** 「测试记录」页签要呈现的一整份（行 + 取数状态）。 */
export interface RequirementTestRecordsView {
  readonly rows: readonly RequirementTestRecordRow[];
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly hasMore: boolean;
}

/** 「测试记录」页签的轮次行（次序＝服务端定序，最新在前）。 */
export function requirementTestRecordRows(
  rounds: readonly ProjectTestRound[],
  members: readonly ProjectMember[],
): readonly RequirementTestRecordRow[] {
  return rounds.map((round) => ({
    id: round.id,
    roundLabel: `第 ${String(round.roundNo)} 轮`,
    state: round.state,
    stateLabel: TEST_ROUND_STATE_LABELS[round.state],
    line:
      `${memberDisplayName(members, round.submittedBySubject)} 提交 → ` +
      `${round.reviewerSubject === null ? '待认领' : memberDisplayName(members, round.reviewerSubject)} 测试 · ${formatProjectTime(round.createdAt)}`,
  }));
}

/**
 * 提交弹窗副行：`第 N 轮 · done/total 项任务完成`。进度与详情「子任务」页签同源（服务端按看的人算的
 * `childDone / childTotal`，⛔ 不本地数子行）；轮次还不知道（没取到）时只说进度，⛔ 不编轮号。
 */
export function submitDialogSubline(
  todo: Pick<Todo, 'childTotal' | 'childDone'>,
  roundNo: number | null,
): string {
  const progress = todoChildProgress(todo);
  const tasks = `${String(progress.done)}/${String(progress.total)} 项任务完成`;
  return roundNo === null ? tasks : `第 ${String(roundNo)} 轮 · ${tasks}`;
}

/**
 * 422 `submission_tasks_unfinished` 的「提交前还需要完成」：手上找得到的任务列标题，找不到的（没载入 /
 * 超出服务端带回的 50 个 id）合并成「另有 N 项」，N 以服务端总数为准。⛔ 不编标题、不猜是哪几条。
 */
export function unfinishedTaskSummary(
  ids: readonly string[],
  count: number | null,
  todos: readonly Pick<Todo, 'id' | 'title'>[],
): { readonly titles: readonly string[]; readonly restCount: number } {
  const byId = new Map(todos.map((item) => [item.id, item.title]));
  const titles = ids.flatMap((id) => {
    const title = byId.get(id);
    return title === undefined ? [] : [title];
  });
  return { titles, restCount: Math.max(0, (count ?? ids.length) - titles.length) };
}

export interface SubmissionArtifactOption {
  readonly assetId: string;
  /** 当前版本 id（提交带的是它，不是资产 id）；资产还没有版本时为 null。 */
  readonly versionId: string | null;
  readonly label: string;
  /** 不可选的原因；null＝可选。 */
  readonly disabledReason: string | null;
}

const ARTIFACT_DISABLED_REASONS = {
  assetDeleted: '资产已删除',
  noVersion: '还没有版本',
  contentDeleted: '这一版内容已删除',
} as const;

/**
 * 「本轮交付物」候选：项目资产目录的每一行，选的是它的**当前版本**。可不可选走共享层
 * `assetAttachmentSelectability`（与报告附件同一份判据）；多选的「已选」由勾选框自己表达，
 * 这里按「还没选」判基础可用性。
 */
export function submissionArtifactOptions(
  assets: readonly ProjectAssetCatalogueEntry[],
): readonly SubmissionArtifactOption[] {
  return assets.map((entry) => {
    const selectability = assetAttachmentSelectability(entry, { selectedVersionIds: [] });
    const current = entry.currentVersion;
    return {
      assetId: entry.id,
      versionId: current?.id ?? null,
      label:
        current === null
          ? assetEntryTitle(entry)
          : `${assetEntryTitle(entry)} · 第 ${String(current.versionNo)} 版`,
      disabledReason:
        selectability === 'selectable' || selectability === 'alreadySelected'
          ? null
          : ARTIFACT_DISABLED_REASONS[selectability],
    };
  });
}
