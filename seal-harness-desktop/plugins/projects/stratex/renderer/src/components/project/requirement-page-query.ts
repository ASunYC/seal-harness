import type { TodoStatus } from '@shared/protocol/project-collab.js';
import { TodoStatusSchema } from '@shared/protocol/project-collab.js';
import type { RequirementPageFilters } from '../../stores/projectCollabState';
import type { TodoFieldDescriptor } from './todo-fields';
import type { TodoFilterOperator } from './todo-query';
import type { TodoViewConfig } from './useTodoViewState';

export const REQUIREMENT_SORT_KEYS = ['priority', 'due', 'created', 'title', 'status'] as const;
const SORT_FIELDS = {
  priority: 'priority',
  due: 'dueAt',
  created: 'createdAt',
  title: 'title',
  status: 'status',
} as const;
export function requirementFilterOperators(
  field: TodoFieldDescriptor,
): readonly TodoFilterOperator[] {
  return field.key === 'title' ? ['contains'] : ['is'];
}

/** Every active condition is represented before COUNT/LIMIT; unsupported legacy conditions are visible errors. */
export function requirementPageQuery(
  config: TodoViewConfig,
  taskScope: boolean,
): { filters: RequirementPageFilters; error: string | null } {
  const values = new Map<string, string>();
  for (const condition of config.filters) {
    const value = condition.value.trim();
    if (!value && !['isEmpty', 'isNotEmpty'].includes(condition.operator)) continue;
    const keys = taskScope
      ? ['title', 'status', 'creator']
      : ['title', 'status', 'assignee', 'creator'];
    if (
      !keys.includes(condition.fieldKey) ||
      condition.operator !== (condition.fieldKey === 'title' ? 'contains' : 'is')
    ) {
      return { filters: {}, error: '此筛选条件暂不支持分页查询，请删除或调整该条件。' };
    }
    if (values.has(condition.fieldKey) && values.get(condition.fieldKey) !== value) {
      return { filters: {}, error: '分页查询中同一字段只能设置一个筛选值。' };
    }
    values.set(condition.fieldKey, value);
  }
  const search = config.search.trim();
  const title = values.get('title');
  if (search && title && search !== title)
    return { filters: {}, error: '请使用一个标题搜索条件，或清空搜索框后按标题筛选。' };
  const keyword = search || title;
  if (keyword && keyword.length > 200)
    return { filters: {}, error: '搜索内容不能超过 200 个字符。' };
  const rawStatus = values.get('status');
  let status: TodoStatus | undefined;
  if (rawStatus) {
    const parsed = TodoStatusSchema.safeParse(rawStatus);
    if (!parsed.success) return { filters: {}, error: '状态筛选已失效，请重新选择。' };
    status = parsed.data;
  }
  const key = REQUIREMENT_SORT_KEYS.find((candidate) => candidate === config.sort.key);
  if (!key)
    return { filters: {}, error: '当前排序暂不支持分页查询，请选择标题、状态、优先级或截止时间。' };
  const creatorSubject = values.get('creator');
  const assigneeSubject = values.get('assignee');
  return {
    filters: {
      ...(taskScope ? { view: 'claimed' as const } : { itemKind: 'requirement' as const }),
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
      ...(creatorSubject ? { creatorSubject } : {}),
      ...(!taskScope && assigneeSubject ? { assigneeSubject } : {}),
      sortBy: SORT_FIELDS[key],
      sortDirection: config.sort.direction,
    },
    error: null,
  };
}
