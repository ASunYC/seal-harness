import { isTodoRequirement, todoParentId } from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

import { projectCollabApi } from '../../sdk/projectCollab';
import { PROJECT_REF_NOTICES, planRefNavigation } from './project-ref-navigation';
import type { ProjectRefNavigation, ProjectRefNavigationContext } from './project-ref-navigation';
import type { ProjectRefTarget } from './project-refs';

export interface ProjectRefResolverContext extends ProjectRefNavigationContext {
  readonly projectId: string | null;
  readonly accountEpoch: number;
  readonly projectEpoch: number;
}

export interface ProjectRefNavigatorOptions {
  readonly getContext: () => ProjectRefResolverContext;
  readonly fetchTodo: (todoId: string) => Promise<Todo | null>;
}

/** 仅授权不可见映射为空；服务异常交由导航入口转为可重试提示。 */
export async function fetchProjectRefTodo(todoId: string): Promise<Todo | null> {
  const result = await projectCollabApi.todoDetail({ todoId });
  if (!result.ok) {
    if (result.code === 'forbidden' || result.serverCode === 'todo_not_found') return null;
    throw new Error(PROJECT_REF_NOTICES.retry);
  }
  // 旧服务没有项目归属时不能把当前页项目当作对象归属。
  if (!('projectId' in result.todo) || typeof result.todo.projectId !== 'string') {
    throw new Error(PROJECT_REF_NOTICES.retry);
  }
  return result.todo;
}

export interface ProjectRefNavigator {
  readonly resolve: (target: ProjectRefTarget) => Promise<ProjectRefNavigation | null>;
}

/** 引用入口的异步规划；空结果表示请求所属页面已经失效。 */
export function createProjectRefNavigator(
  options: ProjectRefNavigatorOptions,
): ProjectRefNavigator {
  let request = 0;
  return {
    async resolve(target) {
      const token = ++request;
      const { projectId, accountEpoch, projectEpoch } = options.getContext();
      const isCurrent = (): boolean => {
        const current = options.getContext();
        return (
          token === request &&
          current.projectId === projectId &&
          current.accountEpoch === accountEpoch &&
          current.projectEpoch === projectEpoch
        );
      };
      if (projectId === null) return null;
      if (target.kind !== 'todo') return planRefNavigation(target, options.getContext());
      try {
        const fetched: Todo[] = [];
        const seen = new Set<string>();
        let id: string | null = target.id;
        // 父链上限防止损坏数据触发无界请求；每层均独立授权，不能用缓存补齐权限缺口。
        while (id !== null && !seen.has(id) && seen.size < 100) {
          seen.add(id);
          const todo = await options.fetchTodo(id);
          if (!isCurrent()) return null;
          if (
            todo === null ||
            !('projectId' in todo) ||
            todo.projectId !== projectId ||
            todo.id !== id
          )
            break;
          fetched.push(todo);
          if (
            isTodoRequirement(todo) ||
            (id === target.id && options.getContext().canEditTodo(todo))
          )
            break;
          id = todoParentId(todo);
        }
        const plan = planRefNavigation(target, { ...options.getContext(), todos: fetched });
        if (plan.kind !== 'todo') return plan;
        const focusedTodo = fetched.find((todo) => todo.id === plan.focus.todoId);
        if (!focusedTodo)
          return { kind: 'unavailable', notice: PROJECT_REF_NOTICES.todoUnavailable };
        return { ...plan, focus: { ...plan.focus, todo: focusedTodo, projectId } };
      } catch {
        // 网络/服务错误与权限失效分开呈现；错误内容可能含私有材料，不回显也不记录正文。
        return isCurrent() ? { kind: 'unavailable', notice: PROJECT_REF_NOTICES.retry } : null;
      }
    },
  };
}
