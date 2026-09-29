import type { Todo } from '@shared/protocol/project-collab.js';

export interface PagedTodoRow {
  readonly todo: Todo;
  readonly number: number | null;
  readonly depth: number;
  readonly childCount: number;
  readonly parentId: string | null;
}

/**
 * Project pages contain all visible requirements, including children. The page
 * itself is still the root source for pagination, while children that belong to
 * another row in the same group are projected under that parent when expanded.
 * This prevents a child from being rendered once as a page root and again from
 * the loaded subtree.
 */
export function pagedTodoRows(
  roots: readonly Todo[],
  subtrees: Readonly<Record<string, readonly Todo[]>>,
  expanded: ReadonlySet<string>,
  offset: number,
  pageRoots: readonly Todo[] = roots,
): readonly PagedTodoRow[] {
  const rows: PagedTodoRow[] = [];
  const seen = new Set<string>();
  const pageIds = new Set(pageRoots.map((todo) => todo.id));
  const groupIds = new Set(roots.map((todo) => todo.id));
  const pageChildren = new Map<string, Todo[]>();
  for (const todo of pageRoots) {
    if (todo.parentId === null || !groupIds.has(todo.parentId) || !groupIds.has(todo.id)) continue;
    const children = pageChildren.get(todo.parentId) ?? [];
    children.push(todo);
    pageChildren.set(todo.parentId, children);
  }
  const topLevelRoots = roots.filter(
    (todo) => todo.parentId === null || !groupIds.has(todo.parentId),
  );

  function childCandidates(parentId: string): readonly Todo[] {
    const merged = new Map<string, Todo>();
    for (const child of subtrees[parentId] ?? []) {
      if (child.parentId === parentId && (!pageIds.has(child.id) || groupIds.has(child.id)))
        merged.set(child.id, child);
    }
    for (const child of pageChildren.get(parentId) ?? []) {
      const prior = merged.get(child.id);
      if (!prior || child.version >= prior.version) merged.set(child.id, child);
    }
    return [...merged.values()];
  }

  function visit(todo: Todo, depth: number, number: number | null): void {
    if (seen.has(todo.id)) return;
    seen.add(todo.id);
    const children = childCandidates(todo.id);
    rows.push({
      todo,
      depth,
      number,
      parentId: todo.parentId,
      childCount: Math.max(todo.childTotal ?? 0, children.length),
    });
    if (!expanded.has(todo.id)) return;
    for (const child of children) visit(child, depth + 1, null);
  }
  topLevelRoots.forEach((todo, index) => visit(todo, 0, offset + index + 1));
  return rows;
}
