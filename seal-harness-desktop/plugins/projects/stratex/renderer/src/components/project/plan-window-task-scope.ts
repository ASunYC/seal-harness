import type { ProjectTodoDetailResult, Todo } from '@shared/protocol/project-collab.js';
import { projectCollabErrorNotice } from '../../stores/projectCollabErrors';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';

export const PLAN_WINDOW_ANCESTOR_MAX_DEPTH = 64;
export const PLAN_WINDOW_ANCESTOR_MAX_READS = 200;

type ScopeResult =
  | { readonly ok: true; readonly items: readonly Todo[]; readonly contextTodos: readonly Todo[] }
  | { readonly ok: false; readonly error: ProjectCollabNotice };

/** 只补当前日期结果所缺的父链，不查询全量清单，也不把段外祖先放进结果行。 */
export async function resolvePlanWindowTaskScope(options: {
  readonly items: readonly Todo[];
  readonly projectId: string;
  readonly subject: string;
  readonly readTodo: (todoId: string) => Promise<ProjectTodoDetailResult>;
  readonly stale: () => boolean;
}): Promise<ScopeResult> {
  const invalid = (): ScopeResult => ({
    ok: false,
    error: projectCollabErrorNotice('rejected', '无法确认此时间段内任务的归属，请刷新后重试。'),
  });
  const limited = (): ScopeResult => ({
    ok: false,
    error: projectCollabErrorNotice(
      'tooLarge',
      '此时间段的任务层级或关联数量过多，请缩小时间范围后重试。',
    ),
  });
  const nodes = new Map<string, Todo>();
  for (const item of options.items) {
    if (item.projectId !== options.projectId) return invalid();
    if ((nodes.get(item.id)?.version ?? -1) <= item.version) nodes.set(item.id, item);
  }
  const ownership = new Map<string, boolean>();
  let reads = 0;
  try {
    for (const item of options.items) {
      let current = item;
      const chain = new Set<string>();
      let mine = false;
      while (true) {
        if (options.stale()) return invalid();
        if (chain.has(current.id)) return invalid();
        if (chain.size >= PLAN_WINDOW_ANCESTOR_MAX_DEPTH) return limited();
        chain.add(current.id);
        const cached = ownership.get(current.id);
        if (cached !== undefined) {
          mine = cached;
          break;
        }
        if (
          current.assigneeSubject === options.subject &&
          (current.itemKind === 'requirement' || current.parentId === null)
        ) {
          mine = true;
          break;
        }
        if (current.parentId === null) break;
        const parentId = current.parentId;
        const parent = nodes.get(parentId);
        if (parent) {
          current = parent;
          continue;
        }
        if (reads >= PLAN_WINDOW_ANCESTOR_MAX_READS) return limited();
        reads += 1;
        const result = await options.readTodo(parentId);
        if (options.stale()) return invalid();
        if (!result.ok) return { ok: false, error: projectCollabErrorNotice(result.code) };
        if (result.todo.id !== parentId || result.todo.projectId !== options.projectId)
          return invalid();
        nodes.set(parentId, result.todo);
        current = result.todo;
      }
      for (const id of chain) ownership.set(id, mine);
    }
    return {
      ok: true,
      items: options.items.filter((item) => ownership.get(item.id)),
      contextTodos: [...nodes.values()],
    };
  } catch {
    return { ok: false, error: projectCollabErrorNotice('transient') };
  }
}
