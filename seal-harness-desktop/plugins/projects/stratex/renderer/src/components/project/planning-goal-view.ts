import type {
  ProjectIterationListItem,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import type { ProjectPlanningLifecycleAction } from '@shared/protocol/project-planning-lifecycle.js';

import { isIterationOverdue } from './iteration-list-view';
import { formatPlanningTime } from './planning-lifecycle-view';

/**
 * 业务目标「记录达成 / 重新打开」、达成信息与「目标记录 N」的纯呈现逻辑（MIL-07 界面段）。
 *
 * ⭐ 文案逐字取自合并原型 `[业务目标达成·已定稿 2026-09-13]`：`goalGateG1`、`completeGoalG1`、
 *    `reopenGoalG1`、`goalActionsG1`、`goalRecordG1`。⛔ 改字之前先对原型。
 * ⚠️ 本模块不碰 store、不发请求、不读时钟（「今天」由调用方传入）。
 */

/** 两个弹层与头部入口的文案，按动作取。 */
export const GOAL_LIFECYCLE_COPY: Readonly<
  Record<
    ProjectPlanningLifecycleAction,
    {
      readonly title: string;
      readonly reasonLabel: string;
      readonly submit: string;
      /** 头部入口按钮（原型 `goalActionsG1`）。 */
      readonly entry: string;
      /** 弹层底部的范围说明。 */
      readonly scopeNote: string;
      /** 成功后的页级回执（原型 `planSave27` 的第三个参数）。 */
      readonly success: string;
    }
  >
> = {
  complete: {
    title: '记录业务目标达成',
    reasonLabel: '验收说明',
    submit: '确认达成',
    entry: '记录达成',
    scopeNote: '该操作只更新目标记录，不改变迭代、需求或测试结果。',
    success: '业务目标已记录达成。',
  },
  reopen: {
    title: '重新打开业务目标',
    reasonLabel: '重新打开原因',
    submit: '确认重新打开',
    entry: '重新打开',
    scopeNote: '重新打开不会改动各轮迭代与需求的状态。',
    success: '业务目标已重新打开，各轮迭代与需求状态保持不变。',
  },
};

/** 其余逐字文案。 */
export const GOAL_TEXT = {
  objectiveMissing: '尚未填写目标说明',
  roundsHeading: '各轮迭代达成情况',
  noteRequired: '请填写验收说明。',
  evidenceRequired: '请至少引用一条证据后再确认达成。',
  achieved: '已达成',
  acceptanceLabel: '验收说明',
  achievedRegion: '业务目标达成信息',
} as const;

export type GoalCompletionGate =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * 记录达成的门槛（原型 `goalGateG1`，与服务端 `milestone_needs_a_round` / `milestone_has_open_rounds`
 * 同口径）：至少一轮**未归档**迭代，且全部未归档迭代都已达成。
 *
 * ⭐ 数取服务端聚合 `iterationSummary`（只数未归档轮次）：⛔ 不按本地已载的迭代行自算——
 *    列表可能没取全，也可能被筛选收窄。门在服务端，这里只决定入口置不置灰、写不写原因。
 */
export function goalCompletionGate(
  summary: ProjectMilestoneListItem['iterationSummary'],
): GoalCompletionGate {
  if (summary.total === 0) return { ok: false, reason: '至少需要一轮迭代' };
  if (summary.open > 0) return { ok: false, reason: `还有 ${summary.open} 轮迭代未达成` };
  return { ok: true };
}

/** 门槛在弹层开着时变了（别人重开了一轮）：确认时的那一句。 */
export function goalGateBlockedText(reason: string): string {
  return `${reason}，暂不能记录业务目标达成。`;
}

/** 重新打开弹层的副标题：上一次记录达成的时刻。 */
export function goalReopenSubline(completedAt: string): string {
  return `已于 ${formatPlanningTime(completedAt)} 记录达成。`;
}

/** 达成信息里的时刻。 */
export function goalAchievedAtText(completedAt: string): string {
  return `达成时间 ${formatPlanningTime(completedAt)}`;
}

/** 「目标记录 N」。 */
export function goalHistoryTitle(total: number): string {
  return `目标记录 ${total}`;
}

export interface GoalRoundLine {
  readonly id: string;
  /** 已达成 ✓，其余 ○（原型只作装饰，读屏不念）。 */
  readonly mark: '✓' | '○';
  readonly name: string;
  readonly detail: string;
}

/**
 * 弹层「各轮迭代达成情况」的一行（原型 `completeGoalG1`）：已达成写「已达成 · 时刻」，时刻取那一轮
 * 最近一次确认达成的记录（还没取到就只写「已达成」）；未达成写状态——过期未达成是「已逾期」，
 * 其余「待达成」（原型 `milestoneStatus27`）。
 */
export function goalRoundLine(
  round: ProjectIterationListItem,
  context: { readonly acceptedAt: string | null; readonly today: string },
): GoalRoundLine {
  if (round.status === 'completed') {
    return {
      id: round.id,
      mark: '✓',
      name: round.name,
      detail: context.acceptedAt
        ? `${GOAL_TEXT.achieved} · ${formatPlanningTime(context.acceptedAt)}`
        : GOAL_TEXT.achieved,
    };
  }
  return {
    id: round.id,
    mark: '○',
    name: round.name,
    detail: isIterationOverdue(round, context.today) ? '已逾期' : '待达成',
  };
}
