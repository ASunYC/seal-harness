import { isTodoRequirement, isTodoWorkOrder } from '@shared/protocol/project-collab.js';
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import { TODO_DELETE_ACTION_LABEL, TODO_OPEN_EXECUTION_LABEL } from './project-format';
import {
  REQUIREMENT_DECOMPOSE_ACTION_LABEL,
  TASK_DECOMPOSE_ACTION_LABEL,
  canDecomposeRequirement,
  canDecomposeTodo,
} from './todo-decompose';
import type { TodoScope } from './todo-hierarchy';

/**
 * 一条工作项上**有哪些动作**的判据（纯函数，不碰 store、不碰 DOM）。
 *
 * 表格行 / 看板卡（`TodoRowActions`）与单屏需求详情（`ProjectRequirementDetail`）共用这一份：
 * 两处各写一遍条件，迟早一处改了另一处没改——那正是「行上能认领、详情里认领不了」这类
 * 漂移的来路。⛔ 别在模板里再拼一次条件。
 *
 * ⚠️ 全部是**入口收窄不是权限**：真正的判定在服务端（403 / 409），这里只负责不摆一个
 *    点了必错的按钮。
 */

/** 判据要的上下文：页签语境 + 项目级角色门。`page` 省略＝独立挂表（不带页签语义）。 */
export interface TodoActionContext {
  readonly page?: TodoScope | undefined;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
}

/**
 * 「认领」只出在**需求池**的**无主需求**上，且写得动（原型 `renderResults` 的
 * `r.owner==='none'&&canWrite()`，claim 只作用于 requirement）。任务页不出——那里的条目
 * 要么已是我处理的需求，要么是它的子项，都没有「认领」这一动作（FLOW-01 判据 2）。
 */
export function canClaimRequirement(
  todo: Pick<Todo, 'itemKind' | 'assigneeSubject'>,
  context: Pick<TodoActionContext, 'page' | 'canWrite'>,
): boolean {
  return (
    context.page === 'requirement' &&
    isTodoRequirement(todo) &&
    todo.assigneeSubject === null &&
    context.canWrite
  );
}

/**
 * 「让助理拆解」按页签收窄出的目标种类（FLOW-01 判据 2）：需求池永远拆成子需求、
 * 任务页永远拆成子任务；`page` 省略时两个入口都在（独立挂表的旧行为）。
 * ⛔ 需求池不出「拆任务」、任务页不出「拆需求」（哪怕行是需求）。
 */
export function decomposeTargetsFor(
  todo: Pick<Todo, 'itemKind'>,
  context: TodoActionContext,
): readonly TodoItemKind[] {
  if (!canDecomposeTodo(todo, context)) return [];
  const targets: TodoItemKind[] = [];
  if (canDecomposeRequirement(todo) && context.page !== 'task') targets.push('requirement');
  if (context.page !== 'requirement') targets.push('task');
  return targets;
}

/** 拆解目标种类 → 按钮上那几个字（行上与详情里同词）。 */
export function decomposeActionLabel(target: TodoItemKind): string {
  return target === 'requirement'
    ? REQUIREMENT_DECOMPOSE_ACTION_LABEL
    : TASK_DECOMPOSE_ACTION_LABEL;
}

/** 详情「更多操作」里一项动作的标识（闭集：新增一项要在这里加，模板与测试随之可枚举）。 */
export type RequirementMenuActionId = 'work-order' | 'open-execution' | 'delete';

export interface RequirementMenuItem {
  readonly id: RequirementMenuActionId;
  readonly label: string;
  /** `AppIcon` 的既有映射键——⛔ 不引第二图标库、不新增映射键。 */
  readonly icon: string;
  /** 破坏性动作（删除）：菜单里压到最后一项并换危险色。 */
  readonly danger: boolean;
}

/**
 * 单屏需求详情「更多操作」菜单的条目（顺序即显示顺序，单列）。
 *
 * 只收**次级 / 破坏性**动作；主动作在详情里就地出（编辑在「需求说明与完成标准」面板标题旁、
 * 认领与助理拆解在底部动作区——位置照原型 requirement-card12），⛔ 同一动作不在两处各摆一个。
 *
 * ⛔ 这里没有「整需求提测」：产品里还没有可用的提测通道（服务端无建轮次端点、协议无该
 *    IPC，`requirement.test_mode` 刻意不在能力清单里）——⛔ 不摆点了什么也不会发生的假按钮。
 */
export function requirementDetailMenuItems(
  todo: Pick<Todo, 'acceptanceTotal' | 'sessionRef'>,
  context: { readonly canDelete: boolean },
): readonly RequirementMenuItem[] {
  const items: RequirementMenuItem[] = [];
  // 工作单入口不受改单权限收窄：验收是派单人的动作，派单人未必是处理人（同 TodoRowActions）。
  if (isTodoWorkOrder(todo))
    items.push({ id: 'work-order', label: '工作单', icon: 'plan', danger: false });
  // 只在真绑了会话时出：没绑就没有可打开的东西。
  if (todo.sessionRef) {
    items.push({
      id: 'open-execution',
      label: TODO_OPEN_EXECUTION_LABEL,
      icon: 'session',
      danger: false,
    });
  }
  // 删除只给 manager+ 且项目未归档（`store.canDeleteTodos`，服务端同判）。
  if (context.canDelete) {
    items.push({ id: 'delete', label: TODO_DELETE_ACTION_LABEL, icon: 'close', danger: true });
  }
  return items;
}
