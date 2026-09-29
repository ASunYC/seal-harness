import { projectDictionaryBindingState } from '@shared/protocol/project-collab-dictionaries.js';
import {
  isTodoAssignedToAssistant,
  todoChildProgress,
  todoParentId,
  todoSource,
} from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectRequirementPlacement } from '@shared/protocol/project-planning-schedule.js';

import { PLANNING_FORM_TEXT } from './planning-form-view';
import {
  TODO_PRIORITY_LABELS,
  TODO_SOURCE_LABELS,
  TODO_STATUS_LABELS,
  formatProjectTime,
  todoAssigneeLabel,
} from './project-format';
import { formatPlanningDate } from './project-planning-view';
import type { TodoScope } from './todo-hierarchy';

/**
 * 单屏需求详情的**呈现模型**（纯函数，不碰 store、不碰 DOM）。
 *
 * 版式照协作原型渲染后最后生效的那层（`requirement-card12` 单屏卡片 + 紧凑任务层）与负责人给的
 * 目标画面：返回 + 更多操作 → 编号 / 状态 → 标题 → 「需求关键字段」4 列 × 2 行 → 两栏
 * （需求说明与完成标准 / 子任务·测试记录·需求讨论 页签）→ 底部认领。
 *
 * ⛔ **没有的不编**：字段只接产品已有的，取不到一律「—」；需求讨论在产品里还没有读取通道，页签只出
 *    空态，计数也是「—」而不是 0（0 是一个事实，「—」是不知道）。测试记录（TST-02）只在协商到整需求
 *    提测能力时有读取通道，不支持时同样是「暂未开放」与「—」。
 */

/** 返回按钮的字：说清回到哪一页（原型 `‹ 返回需求池` / `‹ 返回任务`）。 */
export const REQUIREMENT_DETAIL_BACK_LABELS: Readonly<Record<TodoScope, string>> = {
  requirement: '返回需求池',
  task: '返回任务',
  all: '返回列表',
};

/** 取不到 / 没填 / 服务端没给：一律这一个占位（负责人口径）。 */
export const REQUIREMENT_DETAIL_EMPTY = '—';
/** 旧协作服务缺归类能力时「模块 / 分类」的取值——与页面顶部升级提示「相关字段已停用」同一口径。 */
export const REQUIREMENT_CLASSIFICATION_DISABLED_LABEL = '已停用';
/** 「迭代信息」排期还在读。 */
export const REQUIREMENT_PLACEMENT_LOADING_LABEL = '正在读取…';
/** 引用摘要带 `archivedAt` 时的后缀：历史需求绑着已归档条目是常态，标出来而不是藏掉。 */
export const REQUIREMENT_ARCHIVED_SUFFIX = '（已归档）';

export type RequirementDetailFieldKey =
  | 'assignee'
  | 'dueAt'
  | 'source'
  | 'priority'
  | 'iteration'
  | 'classification'
  | 'completed'
  | 'statusChanged';

export interface RequirementDetailField {
  /** 稳定键（测试与 `data-field` 用）。 */
  readonly key: RequirementDetailFieldKey;
  readonly label: string;
  readonly value: string;
  /** 取值是占位（「—」/「已停用」/「正在读取…」）而不是真实内容：样式压弱。 */
  readonly placeholder: boolean;
}

/** 「迭代信息」查过的排期（与 store 的 `RequirementPlacementLookup` 同形，只读要用的三项）。 */
export interface RequirementPlacementView {
  readonly placement: ProjectRequirementPlacement | null;
  readonly loaded: boolean;
  readonly error: unknown;
}

export interface RequirementDetailFieldContext {
  /** `store.requirementPlacementLookups[需求 id]`；还没查过＝null。 */
  readonly placement: RequirementPlacementView | null;
  /** 旧协作服务（缺归类能力）：模块 / 分类按升级提示口径停用。 */
  readonly classificationDisabled: boolean;
}

function field(
  key: RequirementDetailFieldKey,
  label: string,
  value: string | null,
  placeholder = value === null,
): RequirementDetailField {
  return { key, label, value: value ?? REQUIREMENT_DETAIL_EMPTY, placeholder };
}

function refName(ref: { readonly name: string; readonly archivedAt: string | null }): string {
  return ref.archivedAt === null ? ref.name : `${ref.name}${REQUIREMENT_ARCHIVED_SUFFIX}`;
}

/** 一格归类取值：绑定了给名称（含归档后缀）；没分、服务端没给都是 null（渲染成「—」）。 */
function bindingName(
  id: string | null | undefined,
  ref: { readonly name: string; readonly archivedAt: string | null } | null | undefined,
): string | null {
  if (projectDictionaryBindingState(id) !== 'bound' || !ref) return null;
  return refName(ref);
}

function classificationValue(todo: Todo, context: RequirementDetailFieldContext): string | null {
  if (context.classificationDisabled) return REQUIREMENT_CLASSIFICATION_DISABLED_LABEL;
  const moduleName = bindingName(todo.moduleId, todo.module);
  const categoryName = bindingName(todo.categoryId, todo.category);
  if (moduleName === null && categoryName === null) return null;
  return `${moduleName ?? REQUIREMENT_DETAIL_EMPTY} / ${categoryName ?? REQUIREMENT_DETAIL_EMPTY}`;
}

/**
 * 「迭代信息」：读服务端排期现状（与需求编辑器同一份查询），⛔ 不从本地列表猜。
 * 字段格里不带编辑器那句「当前排在：」前缀——标签已经说了这是迭代信息（目标画面「Sprint 12 · 协作闭环」）。
 */
function iterationValue(context: RequirementDetailFieldContext): {
  readonly value: string | null;
  readonly placeholder: boolean;
} {
  const lookup = context.placement;
  if (lookup?.loaded) {
    const placement = lookup.placement;
    if (placement === null) {
      return { value: PLANNING_FORM_TEXT.unscheduledRequirement, placeholder: false };
    }
    const goal = placement.milestoneName;
    return {
      value: goal === null ? placement.iterationName : `${goal} · ${placement.iterationName}`,
      placeholder: false,
    };
  }
  // 取失败：说不出排在哪，给「—」（失败提示不挤进字段格）。
  if (lookup?.error) return { value: null, placeholder: true };
  return { value: REQUIREMENT_PLACEMENT_LOADING_LABEL, placeholder: true };
}

/** 时间事实：服务端没给（旧服务）与 `null`（当前没有）都给「—」。 */
function timeFactValue(value: string | null | undefined): string | null {
  return value ? formatProjectTime(value) : null;
}

/**
 * 「需求关键字段」一节（原型 `.req-card-fields12`、目标画面 4 列 × 2 行，窄时降 2 列）。
 *
 * 固定八格、固定次序（第一行：需求处理人 / 计划完成时间 / 来源 / 优先级；第二行：迭代信息 /
 * 模块 / 分类 / 实际完成时间 / 状态变更时间）。每格恒在——取不到给「—」，不让格子忽有忽无把网格挤乱。
 * 状态与可见性不在这里：状态药丸在标题行（可直接流转），「个人」徽标也在标题行。
 */
export function requirementDetailFields(
  todo: Todo,
  context: RequirementDetailFieldContext,
): readonly RequirementDetailField[] {
  const iteration = iterationValue(context);
  const classification = classificationValue(todo, context);
  return [
    field('assignee', '需求处理人', todoAssigneeLabel(todo), false),
    field('dueAt', '计划完成时间', todo.dueAt ? formatPlanningDate(todo.dueAt) : null),
    field('source', '来源', TODO_SOURCE_LABELS[todoSource(todo)], false),
    field('priority', '优先级', TODO_PRIORITY_LABELS[todo.priority], false),
    field('iteration', '迭代信息', iteration.value, iteration.placeholder),
    field(
      'classification',
      '模块 / 分类',
      classification,
      classification === null || classification === REQUIREMENT_CLASSIFICATION_DISABLED_LABEL,
    ),
    field('completed', '实际完成时间', timeFactValue(todo.actualCompletedAt)),
    field('statusChanged', '状态变更时间', timeFactValue(todo.statusChangedAt)),
  ];
}

/* ── 右栏页签 ─────────────────────────────────────────────────────────────── */

export type RequirementWorkTabId = 'tasks' | 'tests' | 'discussion';

export interface RequirementWorkTab {
  readonly id: RequirementWorkTabId;
  readonly label: string;
  /** 页签上的计数；产品取不到的给「—」。 */
  readonly count: string;
}

/**
 * 右栏页签（原型 `detail-tabs`：子任务 N｜测试记录 N｜需求讨论 N）。
 *
 * - 「子任务 N」读服务端的 `requirementTaskTotal`（与表格行「任务 N」徽标同一个数）。它只在列表读路径
 *   上有，缺席时给「—」——⛔ 不许 `?? 0`，那等于替服务端宣布「没有子任务」。
 * - 「测试记录 N」（TST-02）：协商到 `requirement.test_mode` 且这条需求的轮次取到之后，给轮次条数
 *   （只取了第一页、服务端说还有更早的就标「+」）；服务不支持或还没取到仍是「—」（不知道不是 0）。
 * - 需求讨论：产品里**没有读取通道**（讨论只挂在项目动态上，不挂需求），计数给「—」，内容给空态。
 */
export function requirementWorkTabs(
  todo: Pick<Todo, 'requirementTaskTotal'>,
  options: {
    readonly testRecordCount?: { readonly count: number; readonly hasMore: boolean } | null;
  } = {},
): readonly RequirementWorkTab[] {
  const tests = options.testRecordCount ?? null;
  return [
    {
      id: 'tasks',
      label: '子任务',
      count:
        todo.requirementTaskTotal === undefined
          ? REQUIREMENT_DETAIL_EMPTY
          : String(todo.requirementTaskTotal),
    },
    {
      id: 'tests',
      label: '测试记录',
      count:
        tests === null
          ? REQUIREMENT_DETAIL_EMPTY
          : `${String(tests.count)}${tests.hasMore ? '+' : ''}`,
    },
    { id: 'discussion', label: '需求讨论', count: REQUIREMENT_DETAIL_EMPTY },
  ];
}

/**
 * 没有读取通道时两个页签的空态（如实说「还没开放」，⛔ 不说「暂无记录」——那是在断言没有）。
 * ⚠️ 「测试记录」只在服务不支持整需求提测时用这一句；支持时列出轮次，真没有轮次才说「暂无测试记录。」。
 */
export const REQUIREMENT_WORK_TAB_UNAVAILABLE: Readonly<
  Record<Exclude<RequirementWorkTabId, 'tasks'>, string>
> = {
  tests: '测试记录暂未开放。',
  discussion: '需求讨论暂未开放。',
};

/**
 * 子任务页签的计数行：**只认服务端的** `childDone / childTotal`（按看的人算）。
 * ⛔ 不拿手里已加载的子行条数当分母——看不见的、没载入的都不在那个数组里。
 */
export function requirementDetailProgressText(
  todo: Pick<Todo, 'childTotal' | 'childDone'>,
): string {
  const progress = todoChildProgress(todo);
  return `${progress.done} / ${progress.total} 项完成`;
}

/** 计数行后半句（原型同词）：执行任务的人不必是需求处理人。 */
export const REQUIREMENT_EXECUTOR_HINT = '执行人独立于需求处理人';

/**
 * 子任务页签没有子项行时的那句话。
 *  - 服务端说有子项、手里一条没载入：如实说没载入（⛔ 不说「还没有」）；
 *  - 没人认领：原型那句「领取需求后，在这里拆分执行任务。」；
 *  - 已有处理人：还没拆。
 */
export function requirementChildrenEmptyText(
  todo: Pick<Todo, 'childTotal' | 'assigneeKind' | 'assigneeSubject'>,
): string {
  if (todo.childTotal > 0) return '子项暂未载入。';
  if (!isTodoAssignedToAssistant(todo) && todo.assigneeSubject === null) {
    return '领取需求后，在这里拆分执行任务。';
  }
  return '还没有拆分执行任务。';
}

export interface RequirementChildSummary {
  readonly todo: Todo;
  /** 「需求」/「任务」——层级是显式种类，不从有无父项推断。 */
  readonly kindLabel: string;
  readonly statusLabel: string;
  readonly assigneeLabel: string;
}

/**
 * 直接子项的摘要行（次序＝清单原样）。只列**手里已有**的直接子项，用来点进去；
 * 进度数字不从这里算（见 `requirementDetailProgressText`）。
 */
export function requirementDetailChildren(
  todos: readonly Todo[],
  requirementId: string,
): readonly RequirementChildSummary[] {
  return todos
    .filter((todo) => todoParentId(todo) === requirementId)
    .map((todo) => ({
      todo,
      kindLabel: todo.itemKind === 'requirement' ? '需求' : '任务',
      statusLabel: TODO_STATUS_LABELS[todo.status],
      assigneeLabel: todoAssigneeLabel(todo),
    }));
}
