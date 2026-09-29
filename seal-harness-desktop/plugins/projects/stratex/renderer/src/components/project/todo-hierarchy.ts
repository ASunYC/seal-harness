import { isTodoRequirement, todoParentId } from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

/**
 * 需求 / 任务显式种类的**取集合**（纯函数，不碰 store，不碰 DOM）。
 * `itemKind` 与 `parentId` 正交；此处绝不从是否有父项推断业务种类。
 *
 * ⚠️ 两个页签的种类判据**只有 `selectTodosInScope` 这一处**。
 *    两个页签共用同一批组件（工具栏 / 表格 / 看板），差别全在传下去的 scope；
 *    把过滤写进某个组件的模板里，另一个视图就会跟着漏。
 */

/** `all` ＝不按工作项种类收窄。 */
export type TodoScope = 'all' | 'requirement' | 'task';

export function selectTodosInScope(todos: readonly Todo[], scope: TodoScope): Todo[] {
  if (scope === 'all') return [...todos];
  const wantRequirement = scope === 'requirement';
  return todos.filter((todo) => isTodoRequirement(todo) === wantRequirement);
}

/** 挂在某条需求下的任务（次序原样，排序归调用方的视图管线）。 */
export function childTasksOf(todos: readonly Todo[], requirementId: string): Todo[] {
  return todos.filter((todo) => todoParentId(todo) === requirementId);
}

/**
 * 任务页的取集合（FLOW-01 判据 1 中段）：**当前身份认领(处理人)的原需求**及其整棵子树，
 * 外加本人名下的旧 standalone 任务（兼容入口）。
 *
 * ⚠️ 与需求池的**根本区别**：需求池按种类收窄（`selectTodosInScope(_,'requirement')`），
 * 任务页按**需求处理人**收窄——`requirement.assigneeSubject === mySubject`。
 * ⛔ **不是按任务执行人筛**：负责别人某条需求下的一个任务，不会把那条需求带进这里
 * （原型 `index.html:858` `filtered()` 的 `r.owner===actor`，及 `:859` inline-guide
 * 「个人视图：这里只按需求处理人筛选；负责别人的某项任务，不会让那条需求进入这里」）。
 *
 * ⚠️ 执行人独立于处理人：我认领的需求下的子任务**照常出现**（哪怕派给了别人）——它们是
 * 我要跟的交付，展开就看得到（判据「可展开子任务」）。
 *
 * ⛔ `mySubject` 为 null（身份暂不可得）时返回空——判不出「哪些是我的」就不猜，与
 * `canEditTodo` 同纪律（不假装某条是我的）。
 */
export function selectTaskPageTodos(todos: readonly Todo[], mySubject: string | null): Todo[] {
  if (mySubject === null) return [];
  const childrenByParent = new Map<string, Todo[]>();
  for (const todo of todos) {
    const parent = todoParentId(todo);
    if (parent === null) continue;
    const bucket = childrenByParent.get(parent);
    if (bucket) bucket.push(todo);
    else childrenByParent.set(parent, [todo]);
  }
  const keep = new Set<string>();
  const queue: string[] = [];
  const seedRoot = (todo: Todo): void => {
    if (keep.has(todo.id)) return;
    keep.add(todo.id);
    queue.push(todo.id);
  };
  for (const todo of todos) {
    // 根一：我处理的需求。根二（兼容）：本人名下、无父项的旧 standalone 任务。
    const mine = todo.assigneeSubject === mySubject;
    if (mine && isTodoRequirement(todo)) seedRoot(todo);
    else if (mine && !isTodoRequirement(todo) && todoParentId(todo) === null) seedRoot(todo);
  }
  // 从根展开整棵子树（子孙的处理人是谁不影响：它们挂在我的根下）。
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (!keep.has(child.id)) {
        keep.add(child.id);
        queue.push(child.id);
      }
    }
  }
  // 保持传入次序（排序归视图管线）；返回新数组，⛔ 不原地改快照。
  return todos.filter((todo) => keep.has(todo.id));
}

export interface TodoTreeRow {
  readonly todo: Todo;
  readonly depth: number;
  readonly childCount: number;
}

/** 稳定展开任意深度森林；孤儿作为根，循环/重复 id 每项最多显示一次。 */
export function flattenTodoTree(todos: readonly Todo[]): TodoTreeRow[] {
  const byId = new Map(todos.map((todo) => [todo.id, todo] as const));
  const children = new Map<string, Todo[]>();
  const roots: Todo[] = [];
  for (const todo of todos) {
    const parent = todoParentId(todo);
    if (parent === null || !byId.has(parent) || parent === todo.id) roots.push(todo);
    else {
      const bucket = children.get(parent);
      if (bucket) bucket.push(todo);
      else children.set(parent, [todo]);
    }
  }
  const rows: TodoTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (todo: Todo, depth: number): void => {
    if (visited.has(todo.id)) return;
    visited.add(todo.id);
    const direct = children.get(todo.id) ?? [];
    rows.push({ todo, depth, childCount: direct.length });
    for (const child of direct) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const todo of todos) visit(todo, 0);
  return rows;
}

/** 是否有直接子项。保留给计数/展示调用方，不参与限制深度。 */
export function hasChildTasks(todos: readonly Todo[], requirementId: string): boolean {
  return todos.some((todo) => todoParentId(todo) === requirementId);
}

/**
 * 需求的**权威**子任务总数（CORE-04 `requirement_task_total`：服务端在**列表读路径**、
 * 按看的人算出「最近 requirement 祖先落在这条需求上」的未删可见 task 有几条）。
 *
 * 三态，⛔ 不折叠：
 *  - `number`     ＝服务端给的权威总数（含 `0` ＝确实没有子任务）；
 *  - `undefined`  ＝服务端**没算**这个数（detail / 写路径 / 旧服务端 / 非需求行）。
 *
 * ⛔ **不在这里补 `?? 0`**：缺席（`undefined`）与 `0` 是两种含义，塌成 0 会把「服务端没给」
 *    伪装成「无子任务」——那正是 FLOW-05 判据 1「总数非当前页计算」要禁的方向。
 * ⛔ task 行不带这个字段（需求专属）——非需求恒回 `undefined`。
 *
 * ⚠️⚠️ 调用点**绝不许**拿 `childTasksOf(...).length` / 当前页数组长度替代它：分页时手里
 *    只有一部分子任务，那个长度会随翻页变；这条需求究竟拆了多少 task 只有服务端知道。
 */
export function requirementTaskTotalOf(
  todo: Pick<Todo, 'itemKind' | 'requirementTaskTotal'>,
): number | undefined {
  return isTodoRequirement(todo) ? todo.requirementTaskTotal : undefined;
}

/** 权威子任务总数缺席（服务端没算）时的显示文案。⛔ 缺席显示这个，不显示 `0`。 */
export const REQUIREMENT_TASK_TOTAL_UNKNOWN_LABEL = '未知';

/**
 * 权威子任务总数的显示文案：`number` 直接成字（含 `0`），`undefined` ＝「未知」。
 * ⛔ 不做 `?? 0`——缺席与 0 分得开（见 `requirementTaskTotalOf`）。
 */
export function requirementTaskTotalText(total: number | undefined): string {
  return total === undefined ? REQUIREMENT_TASK_TOTAL_UNKNOWN_LABEL : String(total);
}

/**
 * 可作为父级的候选（＝全部需求）。`excludeId` 用来把「自己」摘掉——
 * 一条待办挂到自己身上是个环，服务端会拒，界面不该把它摆出来。
 */
export function requirementCandidates(
  todos: readonly Todo[],
  excludeId?: string | undefined,
): Todo[] {
  return todos.filter((todo) => isTodoRequirement(todo) && todo.id !== excludeId);
}

/**
 * 返回符合父子种类矩阵且不会形成环的父项候选。层级深度不参与判断：需求只能挂需求，
 * 任务可挂需求或任务；自己及自己的任意深度后代均排除。
 */
export function hierarchyParentCandidates(
  todos: readonly Todo[],
  childKind: Todo['itemKind'],
  excludeId?: string | undefined,
): Todo[] {
  const descendants = new Set<string>();
  if (excludeId) {
    const pending = [excludeId];
    while (pending.length > 0) {
      const parentId = pending.pop()!;
      for (const todo of todos) {
        if (todo.parentId === parentId && !descendants.has(todo.id)) {
          descendants.add(todo.id);
          pending.push(todo.id);
        }
      }
    }
  }
  return todos.filter(
    (todo) =>
      todo.id !== excludeId &&
      !descendants.has(todo.id) &&
      (childKind === 'task' || todo.itemKind === 'requirement'),
  );
}

/** 按 id 取一条（找不到回 null——服务端快照可能还没刷到这条）。 */
export function findTodoById(todos: readonly Todo[], id: string | null): Todo | null {
  if (id === null) return null;
  return todos.find((todo) => todo.id === id) ?? null;
}

/**
 * 把任务按所属需求分桶。桶里的次序＝传进来的次序（调用方已经排过序了）。
 * 顶层条目（需求）不进任何桶——它们是桶的键，不是桶里的东西。
 */
export function groupTasksByRequirement(tasks: readonly Todo[]): Map<string, Todo[]> {
  const buckets = new Map<string, Todo[]>();
  for (const task of tasks) {
    const parent = todoParentId(task);
    if (parent === null) continue;
    const bucket = buckets.get(parent);
    if (bucket) bucket.push(task);
    else buckets.set(parent, [task]);
  }
  return buckets;
}
