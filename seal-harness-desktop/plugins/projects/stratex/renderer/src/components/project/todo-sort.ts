import type { Todo } from '@shared/protocol/project-collab.js';

import {
  BUILTIN_TODO_FIELDS,
  findTodoField,
  todoFieldFirstSortDirection,
  todoFieldSortValue,
} from './todo-fields';
import type { TodoFieldDescriptor, TodoSortDirection } from './todo-fields';

/**
 * 表格视图的排序（纯函数，不碰 store，不碰 DOM）。
 *
 * 看板列适合看流转，不适合扫全量——一个项目 48 项堆在「未开始」那一列，纵向拖很久
 * 才看得完。表格补的就是「一屏扫出该先做哪个」，所以排序是它的主功能而不是装饰。
 *
 * ⚠️ 本模块**只管比较机制**（缺值沉底、中文按拼音、方向翻转、兜底键），
 *    「某个字段该拿什么值来比」归 `todo-fields` 的描述符管。这条分工是自定义字段的
 *    前提：新字段进了描述符表，这里一行不改就能按它排序。⛔ 不许在这里出现字段名。
 */

export type { TodoSortDirection };

/**
 * 排序键 = 字段描述符的 `key`。
 *
 * ⚠️ 它是**开放集合**（string）而不是六个内置列的字面量联合——自定义字段的 key
 * 由项目侧给，编译期列不出来。认不出的 key 走缺值路径（见 sortValue），不炸。
 */
export type TodoSortKey = string;

export interface TodoSort {
  readonly key: TodoSortKey;
  readonly direction: TodoSortDirection;
}

/**
 * 默认排序 = 状态升序（与看板列同序：未开始 → 进行中 → 已完成 → 已取消）。
 *
 * 为什么不是「截止升序」：截止最能表达紧迫，但按它排会把**上周做完的**单顶到首屏
 * （已完成的单也有截止日），第一屏就废了。为什么不是「更新时间倒序」：那回答的是
 * 「谁最近动过」，不是「该做哪个」。
 *
 * 选状态升序还有一条：从看板切到表格时条目的相对次序不翻天覆地——同一批未开始
 * 仍在最前，闭环的自然沉底，认知是连续的。要按紧迫排就点「截止」表头，一次点击。
 */
export const DEFAULT_TODO_SORT: TodoSort = { key: 'status', direction: 'asc' };

/**
 * 首次点某列时的方向。时间列首点给倒序（最近的在前是人对时间的默认预期），
 * 其余列首点给升序。再点同一列则反向。
 *
 * 表由内置字段描述符派生——⛔ 不再手写一份键名清单，那必然与字段表漂移。
 */
export const TODO_SORT_FIRST_DIRECTION: Readonly<Record<string, TodoSortDirection>> =
  Object.fromEntries(
    BUILTIN_TODO_FIELDS.map((field) => [field.key, todoFieldFirstSortDirection(field)]),
  );

/** 该列用于比较的值；`null` = 这一格没值（认不出的字段同样按缺值处理）。 */
function sortValue(
  todo: Todo,
  key: TodoSortKey,
  fields: readonly TodoFieldDescriptor[],
): string | number | null {
  const field = findTodoField(fields, key);
  return field === null ? null : todoFieldSortValue(field, todo);
}

function rawCompare(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  // 同一列两侧取值类型恒一致；走到这里两边都是文本。中文按拼音序而不是码位序。
  return String(left).localeCompare(String(right), 'zh-Hans-CN');
}

function compareByKey(
  a: Todo,
  b: Todo,
  key: TodoSortKey,
  direction: TodoSortDirection,
  fields: readonly TodoFieldDescriptor[],
): number {
  const left = sortValue(a, key, fields);
  const right = sortValue(b, key, fields);
  // 缺值**恒沉底**，与升降序无关：「没填截止」不是一种极早也不是一种极晚，
  // 让它随方向在首屏和末屏之间跳只会让人以为数据丢了。
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  const raw = rawCompare(left, right);
  return direction === 'asc' ? raw : -raw;
}

/**
 * 主键相等时一律回退到「更新时间倒序」。
 *
 * 没有兜底键的话，同一批未开始的先后就取决于服务端返回次序——那是可变的，用户会
 * 看到「什么都没动，行却换了位置」。兜底到更新时间让结果只由数据本身决定。
 */
export function compareTodos(
  a: Todo,
  b: Todo,
  sort: TodoSort,
  fields: readonly TodoFieldDescriptor[] = BUILTIN_TODO_FIELDS,
): number {
  const primary = compareByKey(a, b, sort.key, sort.direction, fields);
  if (primary !== 0 || sort.key === 'updated') return primary;
  return compareByKey(a, b, 'updated', 'desc', BUILTIN_TODO_FIELDS);
}

/** 排序后的新数组（⛔ 不就地改 store.todos——那是服务端权威快照）。 */
export function sortTodos(
  todos: readonly Todo[],
  sort: TodoSort,
  fields: readonly TodoFieldDescriptor[] = BUILTIN_TODO_FIELDS,
): Todo[] {
  return [...todos].sort((a, b) => compareTodos(a, b, sort, fields));
}

/** 点表头：同列反向，换列取该列的首点方向（方向归字段描述符所有）。 */
export function nextTodoSort(
  current: TodoSort,
  key: TodoSortKey,
  fields: readonly TodoFieldDescriptor[] = BUILTIN_TODO_FIELDS,
): TodoSort {
  if (current.key !== key) {
    const field = findTodoField(fields, key);
    return { key, direction: field === null ? 'asc' : todoFieldFirstSortDirection(field) };
  }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}
