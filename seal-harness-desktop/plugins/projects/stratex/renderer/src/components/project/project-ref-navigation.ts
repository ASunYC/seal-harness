import { isTodoRequirement, todoParentId } from '@shared/protocol/project-collab.js';
import type { ProjectFile, ProjectMember, Todo } from '@shared/protocol/project-collab.js';

import type { ProjectRefTarget } from './project-refs';
import { findTodoById } from './todo-hierarchy';

/**
 * 引用芯片点下去之后「去哪儿」（测试提单 2552）。纯函数，不碰 store、不碰 DOM、不切页签——
 * 项目页拿到规划后自己切页签、递请求、出提示。
 *
 * 判据只有两样：**已载清单**（服务端按身份过滤过，看不见的对象不在里面）与对象级写入门
 * `canEditTodo`。点击那一刻再判一次，是因为芯片渲染之后对象可能已被删、权限可能已变。
 *
 * 落点：
 *  - 需求 ⇒ 需求池的单屏需求详情（UX-02；看得见就能看详情，不看改单权限）；
 *  - 任务 ⇒ 改得动：任务页的编辑弹层（与点任务卡 / 任务行同一入口）；改不动：没有只读的任务
 *    详情，回落到**最近一层可见的上级需求**的详情（它的「执行进展」列着子项），并说明原因；
 *  - 资产 ⇒ 资产页定位文件行（引用里是**文件 id**，⛔ 不是资产版本 id，别走版本弹层）；
 *  - 成员 ⇒ 成员与权限弹层定位这个人（右栏会随宽度 / 助手分栏收起，定位右栏不可靠）。
 *
 * ⛔ 提示文案不回显 id，也不说「为什么看不到」之外的任何东西——看不见的对象连存在与否都不该多透露。
 */

/** 递给需求 / 任务面板的聚焦请求：打开需求详情，或打开任务编辑弹层。 */
export type ProjectRefTodoFocusMode = 'detail' | 'edit';

export interface ProjectRefTodoFocus {
  readonly todoId: string;
  readonly mode: ProjectRefTodoFocusMode;
  /** 授权补取的对象单独交给详情，不插入当前分页清单。 */
  readonly todo?: Todo;
  readonly projectId?: string;
}

export type ProjectRefTodoTab = 'requirements' | 'tasks';

export type ProjectRefNavigation =
  | {
      readonly kind: 'todo';
      readonly tab: ProjectRefTodoTab;
      readonly focus: ProjectRefTodoFocus;
      /** 落点不是被点的那条时（任务回落到上级需求）要告诉用户的话；否则 null。 */
      readonly notice: string | null;
    }
  | { readonly kind: 'asset'; readonly fileId: string }
  | { readonly kind: 'member'; readonly subject: string }
  | { readonly kind: 'unavailable'; readonly notice: string };

export interface ProjectRefNavigationContext {
  readonly todos: readonly Todo[];
  readonly files: readonly ProjectFile[];
  readonly members: readonly ProjectMember[];
  readonly canEditTodo: (todo: Todo) => boolean;
}

/** 引用跳转的用户可见提示（单一收口，页面与测试都从这里取）。 */
export const PROJECT_REF_NOTICES = {
  retry: '暂时无法打开引用，请稍后重试。',
  todoUnavailable: '引用的需求或任务已删除，或你没有查看权限。',
  taskOpenedParent: '你没有这条任务的编辑权限，已打开它所属的需求。',
  taskNoDetail: '你没有这条任务的编辑权限，也没有可查看的所属需求。',
  assetUnavailable: '引用的资产已删除，或你没有查看权限。',
  memberUnavailable: '这位成员已不在本项目中。',
} as const;

/**
 * 最近一层可见的上级需求。沿父链往上走，遇到不在清单里的父项（被删 / 看不到）就停；
 * 父链成环（脏数据）也停——⛔ 不死循环。
 */
function nearestVisibleRequirement(todos: readonly Todo[], start: Todo): Todo | null {
  const seen = new Set<string>([start.id]);
  let parentId = todoParentId(start);
  while (parentId !== null && !seen.has(parentId)) {
    const parent = findTodoById(todos, parentId);
    if (parent === null) return null;
    if (isTodoRequirement(parent)) return parent;
    seen.add(parent.id);
    parentId = todoParentId(parent);
  }
  return null;
}

function planTodo(todoId: string, context: ProjectRefNavigationContext): ProjectRefNavigation {
  const todo = findTodoById(context.todos, todoId);
  if (todo === null) return { kind: 'unavailable', notice: PROJECT_REF_NOTICES.todoUnavailable };
  if (isTodoRequirement(todo)) {
    return {
      kind: 'todo',
      tab: 'requirements',
      focus: { todoId: todo.id, mode: 'detail' },
      notice: null,
    };
  }
  if (context.canEditTodo(todo)) {
    return { kind: 'todo', tab: 'tasks', focus: { todoId: todo.id, mode: 'edit' }, notice: null };
  }
  const requirement = nearestVisibleRequirement(context.todos, todo);
  if (requirement === null) {
    return { kind: 'unavailable', notice: PROJECT_REF_NOTICES.taskNoDetail };
  }
  return {
    kind: 'todo',
    tab: 'requirements',
    focus: { todoId: requirement.id, mode: 'detail' },
    notice: PROJECT_REF_NOTICES.taskOpenedParent,
  };
}

export function planRefNavigation(
  target: ProjectRefTarget,
  context: ProjectRefNavigationContext,
): ProjectRefNavigation {
  if (target.kind === 'todo') return planTodo(target.id, context);
  if (target.kind === 'asset') {
    return context.files.some((file) => file.id === target.id)
      ? { kind: 'asset', fileId: target.id }
      : { kind: 'unavailable', notice: PROJECT_REF_NOTICES.assetUnavailable };
  }
  const onRoster = context.members.some(
    (member) => member.subject === target.id && member.state !== 'removed',
  );
  return onRoster
    ? { kind: 'member', subject: target.id }
    : { kind: 'unavailable', notice: PROJECT_REF_NOTICES.memberUnavailable };
}
