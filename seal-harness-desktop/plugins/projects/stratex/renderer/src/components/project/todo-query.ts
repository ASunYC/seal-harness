import type { Todo } from '@shared/protocol/project-collab.js';

import { findTodoField, todoFieldText, todoFieldValueLabel } from './todo-fields';
import type { TodoFieldContext, TodoFieldDescriptor, TodoFieldType } from './todo-fields';

/**
 * 待办的筛选 / 搜索 / 分组（纯函数，不碰 store，不碰 DOM）。
 *
 * ⚠️ 本模块**一次都不提字段名**。条件的形态是「字段描述符 + 运算符 + 值」，
 *    取值一律走 `field.values(todo)`——「状态」不比「某个自定义下拉」特殊，
 *    所以这里没有、也不许有为某个字段单开的 if 分支。
 */

export type TodoFilterOperator =
  'is' | 'isNot' | 'contains' | 'notContains' | 'isEmpty' | 'isNotEmpty' | 'before' | 'after';

export const TODO_FILTER_OPERATOR_LABELS: Readonly<Record<TodoFilterOperator, string>> = {
  is: '等于',
  isNot: '不等于',
  contains: '包含',
  notContains: '不包含',
  isEmpty: '未填写',
  isNotEmpty: '已填写',
  before: '早于',
  after: '晚于',
};

/**
 * 运算符可选集**由字段类型决定**——这是「不为状态单写一条分支」的落点：
 * 加一个 select 类的自定义字段，它自动拿到与「状态」完全相同的运算符集合。
 */
export const TODO_FILTER_OPERATORS_BY_TYPE: Readonly<
  Record<TodoFieldType, readonly TodoFilterOperator[]>
> = {
  text: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  member: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  labels: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  date: ['before', 'after', 'isEmpty', 'isNotEmpty'],
};

export function todoFilterOperators(field: TodoFieldDescriptor): readonly TodoFilterOperator[] {
  return TODO_FILTER_OPERATORS_BY_TYPE[field.type];
}

/** 「未填写 / 已填写」问的是有没有值，不需要再给一个值。 */
export function todoFilterOperatorNeedsValue(operator: TodoFilterOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

export interface TodoFilterCondition {
  /** 条件行的稳定标识（同字段可加多条，故不能用 fieldKey 当键）。 */
  readonly id: string;
  readonly fieldKey: string;
  readonly operator: TodoFilterOperator;
  /** 空串＝「未设置」：条件行还没填完，此时该条**不生效**（见 matchesTodoCondition）。 */
  readonly value: string;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 单条件判定。
 *
 * 两条「宁可放行」的纪律：
 *   ① 认不出的字段（自定义字段被移除后残留的旧条件）→ 放行。
 *   ② 需要值却没填的条件（新加的一行）→ 放行。
 * 反过来做的话，用户点一下「添加筛选条件」表就空了，看起来像数据丢了。
 */
export function matchesTodoCondition(
  todo: Todo,
  condition: TodoFilterCondition,
  fields: readonly TodoFieldDescriptor[],
): boolean {
  const field = findTodoField(fields, condition.fieldKey);
  if (field === null) return true;
  const values = field.values(todo);
  if (condition.operator === 'isEmpty') return values.length === 0;
  if (condition.operator === 'isNotEmpty') return values.length > 0;
  const wanted = condition.value.trim();
  if (wanted.length === 0) return true;

  switch (condition.operator) {
    case 'is':
      return values.includes(wanted);
    case 'isNot':
      return !values.includes(wanted);
    case 'contains':
      return values.some((value) => value.toLowerCase().includes(wanted.toLowerCase()));
    case 'notContains':
      return !values.some((value) => value.toLowerCase().includes(wanted.toLowerCase()));
    case 'before':
    case 'after': {
      const bound = timestamp(wanted);
      if (bound === null) return true;
      // 没填日期的既不算早于也不算晚于——把它当「极早」会让「早于下周」把空值全捞进来。
      return values.some((value) => {
        const at = timestamp(value);
        if (at === null) return false;
        return condition.operator === 'before' ? at < bound : at > bound;
      });
    }
  }
}

/**
 * 多条件**按「与」合取**：每条都成立才留下。
 *
 * ⚠️ 这里改成 `some`（析取）是个静默的语义翻转——筛得越多留得越多，界面上看着
 * 「还在工作」。project-todo-view.test.ts 的「多条件按与生效」是它的机器载体。
 */
export function filterTodos(
  todos: readonly Todo[],
  conditions: readonly TodoFilterCondition[],
  fields: readonly TodoFieldDescriptor[],
): Todo[] {
  if (conditions.length === 0) return [...todos];
  return todos.filter((todo) =>
    conditions.every((condition) => matchesTodoCondition(todo, condition, fields)),
  );
}

/**
 * 搜索：在**所有字段的展示文本**上做**不区分大小写**的子串命中。
 *
 * 为什么钉在展示文本而不是原始值：用户搜的是他在屏幕上看到的字（「已完成」），
 * 不是线协议里的枚举名（`done`）。
 */
export function searchTodos(
  todos: readonly Todo[],
  query: string,
  fields: readonly TodoFieldDescriptor[],
  context: TodoFieldContext,
): Todo[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...todos];
  return todos.filter((todo) =>
    fields.some((field) => todoFieldText(field, todo, context).toLowerCase().includes(needle)),
  );
}

export interface TodoGroup {
  readonly key: string;
  readonly label: string;
  readonly todos: readonly Todo[];
}

/** 「这一格没填」的组键。空串不可能与真实取值相撞——空值在取值函数里就被折成 []。 */
export const TODO_GROUP_UNSET_KEY = '';
export const TODO_GROUP_UNSET_LABEL = '未设置';

/**
 * 按字段分组。
 *
 * - 多值字段（标签）一条待办会**落进多个组**——这是标签的本义，不是 bug。
 * - 组次序：字段有候选闭集就按闭集序（状态按看板列序），其余按出现序；
 *   「未设置」恒最后——它是残留项而不是一个真实取值。
 */
export function groupTodos(
  todos: readonly Todo[],
  field: TodoFieldDescriptor,
  context: TodoFieldContext,
): TodoGroup[] {
  const buckets = new Map<string, Todo[]>();
  const push = (key: string, todo: Todo): void => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(todo);
    else buckets.set(key, [todo]);
  };
  for (const todo of todos) {
    const values = field.values(todo);
    if (values.length === 0) push(TODO_GROUP_UNSET_KEY, todo);
    else for (const value of values) push(value, todo);
  }

  const ordered: string[] = [];
  for (const option of field.options?.(context) ?? [])
    if (buckets.has(option.value) && !ordered.includes(option.value)) ordered.push(option.value);
  for (const key of buckets.keys())
    if (key !== TODO_GROUP_UNSET_KEY && !ordered.includes(key)) ordered.push(key);
  if (buckets.has(TODO_GROUP_UNSET_KEY)) ordered.push(TODO_GROUP_UNSET_KEY);

  return ordered.map((key) => ({
    key,
    label:
      key === TODO_GROUP_UNSET_KEY
        ? TODO_GROUP_UNSET_LABEL
        : todoFieldValueLabel(field, key, context),
    todos: buckets.get(key) ?? [],
  }));
}
