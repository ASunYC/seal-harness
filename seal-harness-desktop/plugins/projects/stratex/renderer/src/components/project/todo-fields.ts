import {
  isTodoRequirement,
  todoParentId,
  todoSource,
  todoVisibility,
} from '@shared/protocol/project-collab.js';
import type {
  Todo,
  TodoPriority,
  TodoSource,
  TodoStatus,
  TodoVisibility,
} from '@shared/protocol/project-collab.js';
import { projectDictionaryBindingState } from '@shared/protocol/project-collab-dictionaries.js';

import { REQUIREMENT_ARCHIVED_SUFFIX } from './requirement-detail';

import {
  TODO_PRIORITY_LABELS,
  TODO_SOURCE_LABELS,
  TODO_SOURCE_ORDER,
  TODO_STATUS_LABELS,
  TODO_STATUS_ORDER,
  TODO_VISIBILITY_LABELS,
  TODO_VISIBILITY_ORDER,
  formatProjectDate,
  formatProjectTime,
  todoRelationCount,
} from './project-format';

/**
 * 待办**字段描述符层**——筛选 / 分组 / 排序 / 字段显示四处共同的唯一字段真相源。
 *
 * 为什么不把字段写死在表格里：后续阶段要开放**项目自定义字段**。字段一旦写死，
 * 「加一个字段」就等于同时改四处代码（列定义、筛选的 if 分支、分组的 switch、
 * 字段开关的清单），四处里漏改一处就是一个只在某条路径上缺席的字段。
 *
 * 所以本层把「一个字段是什么」收成一个对象：`key / label / type / values()`。
 * 今天这张表由内置字段构成（`BUILTIN_TODO_FIELDS`），将来由「内置 + 项目自定义」
 * 拼成——**上面四处都只认这张表，不认具体字段名**。
 *
 * 判据（有机器载体，见 project-todo-view.test.ts「假想自定义字段」一组）：
 *   往描述符表里塞一个新字段，筛选/分组/排序/字段显示四处自动支持，四处代码不动。
 */

/** 排序方向。放在本层是因为「某字段首点朝哪边」是字段自己的属性（见 firstSortDirection）。 */
export type TodoSortDirection = 'asc' | 'desc';

/**
 * 字段类型闭集。类型决定两件事：可用的筛选运算符（见 todo-query 的运算符表）、
 * 以及缺省排序取值的解释方式（date 按时间戳，其余按文本）。
 */
export type TodoFieldType = 'text' | 'select' | 'member' | 'labels' | 'date';

export interface TodoFieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * 取候选值 / 取展示名时的上下文。
 *
 * 为什么要它：`member` 类字段的候选与显示名不在字段本身里，而在当前这批待办上
 * （处理人 subject → 显示名）。把它作为参数传进来，描述符就不必去够 store，
 * 本层保持纯函数、可单独跑。
 */
export interface TodoFieldContext {
  readonly todos: readonly Todo[];
}

export interface TodoFieldDescriptor {
  /** 字段标识。内置字段沿用既有排序键（title/status/...），自定义字段由项目侧给。 */
  readonly key: string;
  readonly label: string;
  readonly type: TodoFieldType;
  /**
   * **取值函数**——这条待办在该字段上的值。
   * 空数组＝没填（筛选的「未填写」、分组的「未设置」都以此为判据）；
   * 多值字段（标签）返回多项。筛选与分组都只吃这一个函数。
   */
  readonly values: (todo: Todo) => readonly string[];
  /** 值 → 展示文本（枚举中文名、日期格式化）。缺省即原样。 */
  readonly formatValue?: (value: string) => string;
  /** 候选值闭集（筛选的值下拉、分组的组次序都用它）。缺省＝候选来自数据本身。 */
  readonly options?: (context: TodoFieldContext) => readonly TodoFieldOption[];
  /**
   * 排序取值（`null` ⇒ 缺值恒沉底）。缺省按 type 推导，见 `todoFieldSortValue`。
   * 只有「文本序 ≠ 语义序」的字段才需要显式给（状态按看板列序、优先级按轻重）。
   */
  readonly sortValue?: (todo: Todo) => string | number | null;
  /** 首次按该字段排序的方向。缺省升序；时间类里「最近的在前」才是人的预期。 */
  readonly firstSortDirection?: TodoSortDirection;
  /** 能否在字段显示里关掉。缺省可关；标题是锚列，关掉后整张表认不出行。 */
  readonly hideable?: boolean;
  /** 能否作为分组依据。缺省可分组；自由文本与精确时间戳分组只会分出一堆单元素组。 */
  readonly groupable?: boolean;
}

/** 优先级序：高在前。与看板/表格「首点即最要紧的在上面」一致。 */
export const TODO_PRIORITY_ORDER: readonly TodoPriority[] = ['high', 'medium', 'low'];

/** 空值一律折成「没填」：`null` 与纯空白同义，别让空串在筛选里冒充一个真实取值。 */
function presentValues(value: string | null): readonly string[] {
  return value === null || value.trim().length === 0 ? [] : [value];
}

/** 枚举名 → 中文名。用宽 Record 索引，遇到闭集外的值原样返回而不是渲染出 undefined。 */
const STATUS_TEXT: Readonly<Record<string, string>> = TODO_STATUS_LABELS;
const PRIORITY_TEXT: Readonly<Record<string, string>> = TODO_PRIORITY_LABELS;
const SOURCE_TEXT: Readonly<Record<string, string>> = TODO_SOURCE_LABELS;
const VISIBILITY_TEXT: Readonly<Record<string, string>> = TODO_VISIBILITY_LABELS;

/** 处理人候选来自当前这批待办（同名同 subject 只留一条，未认领的不进候选）。 */
function assigneeOptions(todos: readonly Todo[]): readonly TodoFieldOption[] {
  const seen = new Map<string, string>();
  for (const todo of todos) {
    if (todo.assigneeSubject === null) continue;
    if (!seen.has(todo.assigneeSubject))
      seen.set(todo.assigneeSubject, todo.assigneeDisplayName ?? todo.assigneeSubject);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

/** 标签候选同样来自数据本身（标签是自由集合，没有服务端闭集可查）。 */
function labelOptions(todos: readonly Todo[]): readonly TodoFieldOption[] {
  const seen = new Set<string>();
  for (const todo of todos) for (const label of todo.labels) seen.add(label);
  return [...seen].map((value) => ({ value, label: value }));
}

/**
 * 内置字段表。次序＝表格默认列序（对齐原型：需求标识 · 标题 · … 截止 · 更新 · 标签 · 关联），
 * 也是筛选/分组/排序下拉里的次序。
 *
 * 「标签」「关联」默认展开（原型两列均在）：标签移出标题格、单独成列；关联渲染
 * `todoRelationCount` 的条数。默认收起的只剩「来源」「可见性」——它们的非缺省值已
 * 由标题格的徽标一眼报出（见 `DEFAULT_HIDDEN_TODO_FIELD_KEYS`）。
 */
export const BUILTIN_TODO_FIELDS: readonly TodoFieldDescriptor[] = [
  {
    // 需求标识列（原型 columns-v19 `id` 列 / `.requirement-id18`）：完整 UUID 单独成列、可复制，
    // ⛔ 不再挤在标题格里。只有需求才有这枚对外标识——任务行取空（列里渲染「—」），
    // 与此前标题格「只给需求挂 ID」的口径一致。可在字段显示里收起：标题列不可收，
    // 「需求名称与唯一标识至少保留一项」恒成立。
    key: 'reference',
    label: '需求标识',
    type: 'text',
    values: (todo) => (isTodoRequirement(todo) ? [todo.id] : []),
    groupable: false,
  },
  {
    key: 'title',
    label: '标题',
    type: 'text',
    values: (todo) => presentValues(todo.title),
    hideable: false,
    groupable: false,
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    values: (todo) => [todo.status],
    formatValue: (value) => STATUS_TEXT[value] ?? value,
    options: () =>
      TODO_STATUS_ORDER.map((status: TodoStatus) => ({
        value: status,
        label: TODO_STATUS_LABELS[status],
      })),
    // 状态的语义序是看板列序，不是拼音序——写死在这里，排序层不认识「状态」这回事。
    sortValue: (todo) => TODO_STATUS_ORDER.indexOf(todo.status),
  },
  {
    key: 'assignee',
    label: '处理人',
    type: 'member',
    values: (todo) => presentValues(todo.assigneeSubject),
    options: (context) => assigneeOptions(context.todos),
    // 未认领＝缺值（沉底）；认领了但没显示名的退到 subject，至少次序稳定。
    sortValue: (todo) =>
      todo.assigneeSubject === null ? null : (todo.assigneeDisplayName ?? todo.assigneeSubject),
  },
  {
    key: 'creator',
    label: '添加人',
    type: 'member',
    values: (todo) => presentValues(todo.creatorSubject ?? null),
    options: (context) =>
      [
        ...new Map(
          context.todos
            .filter((todo) => todo.creatorSubject)
            .map((todo) => [
              todo.creatorSubject ?? '',
              todo.creatorDisplayName ?? todo.creatorSubject ?? '未知添加人',
            ]),
        ).entries(),
      ].map(([value, label]) => ({ value, label })),
  },
  {
    key: 'priority',
    label: '优先级',
    type: 'select',
    values: (todo) => [todo.priority],
    formatValue: (value) => PRIORITY_TEXT[value] ?? value,
    options: () =>
      TODO_PRIORITY_ORDER.map((priority: TodoPriority) => ({
        value: priority,
        label: TODO_PRIORITY_LABELS[priority],
      })),
    sortValue: (todo) => TODO_PRIORITY_ORDER.indexOf(todo.priority),
  },
  {
    key: 'iteration',
    label: '迭代',
    type: 'text',
    groupable: false,
    values: (todo) => {
      if (!isTodoRequirement(todo)) return ['随父需求'];
      const binding = projectDictionaryBindingState(todo.iterationId);
      if (binding === 'uncategorized' && todo.iteration == null) return ['未安排'];
      if (binding !== 'bound' || !todo.iteration || todo.iteration.id !== todo.iterationId)
        return ['迭代信息未知'];
      return [
        todo.iteration.name +
          (todo.iteration.archivedAt === null ? '' : REQUIREMENT_ARCHIVED_SUFFIX),
      ];
    },
  },
  {
    key: 'start',
    label: '开始',
    type: 'date',
    values: (todo) => presentValues(todo.startAt),
    formatValue: formatProjectDate,
    groupable: false,
  },
  {
    key: 'due',
    label: '截止',
    type: 'date',
    values: (todo) => presentValues(todo.dueAt),
    formatValue: formatProjectDate,
    groupable: false,
  },
  {
    key: 'updated',
    label: '更新时间',
    type: 'date',
    values: (todo) => presentValues(todo.updatedAt),
    formatValue: formatProjectTime,
    firstSortDirection: 'desc',
    groupable: false,
  },
  {
    key: 'labels',
    label: '标签',
    type: 'labels',
    values: (todo) => todo.labels,
    options: (context) => labelOptions(context.todos),
  },
  {
    // 关联列（原型「关联」）：材料引用 + 关联会话的条数，与看板卡/详情弹层同一支
    // `todoRelationCount`。值给字符串是为了让搜索/筛选够得着「有几条关联」；0 折成
    // 空数组＝「未填」（列里渲染成「—」，不写 0）。单元格的精致形态（<> N 徽标）
    // 由表格的 `relations` 分支画，这里只提供描述符本身。
    key: 'relations',
    label: '关联',
    type: 'text',
    values: (todo) => (todoRelationCount(todo) > 0 ? [String(todoRelationCount(todo))] : []),
    sortValue: (todo) => todoRelationCount(todo),
    groupable: false,
  },
  {
    key: 'source',
    label: '来源',
    type: 'select',
    values: (todo) => [todoSource(todo)],
    formatValue: (value) => SOURCE_TEXT[value] ?? value,
    options: () =>
      TODO_SOURCE_ORDER.map((source: TodoSource) => ({
        value: source,
        label: TODO_SOURCE_LABELS[source],
      })),
    sortValue: (todo) => TODO_SOURCE_ORDER.indexOf(todoSource(todo)),
  },
  {
    key: 'visibility',
    label: '可见性',
    type: 'select',
    values: (todo) => [todoVisibility(todo)],
    formatValue: (value) => VISIBILITY_TEXT[value] ?? value,
    options: () =>
      TODO_VISIBILITY_ORDER.map((visibility: TodoVisibility) => ({
        value: visibility,
        label: TODO_VISIBILITY_LABELS[visibility],
      })),
    sortValue: (todo) => TODO_VISIBILITY_ORDER.indexOf(todoVisibility(todo)),
  },
];

/**
 * 「父项」字段——**只给任务页**用，不进内置表。
 *
 * 为什么不放内置表：需求页上这一列恒空（需求没有上级），摆一列空格子是噪声；
 * 筛选/分组下拉里多一个永远筛不出东西的选项更糟。字段全集的拼装点在
 * `ProjectBoardPane`（它知道自己是哪一页），这里只提供描述符本身。
 *
 * 取值是父级 id，展示名靠 `options` 把 id 换成任意种类父项标题——`todoFieldValueLabel`
 * 优先取候选表的 label，所以列里出现的是人话而不是 uuid。
 */
export const TODO_PARENT_FIELD: TodoFieldDescriptor = {
  key: 'parent',
  label: '父项',
  type: 'select',
  values: (todo) => presentValues(todoParentId(todo)),
  options: (context) => context.todos.map((todo) => ({ value: todo.id, label: todo.title })),
};

/**
 * 默认收起的列。
 *
 * 「来源」「可见性」的非缺省值已经由标题格的徽标一眼报出，单开两列会让表里多出
 * 两列、大部分行都写着「手动创建 / 协同」的重复文字。要按它们扫全量或做筛选时，
 * 从字段显示里开出来即可（描述符已在册，四处自动支持）。
 *
 * ⚠️「标签」「关联」不在此列——原型两列均默认展开，见 BUILTIN_TODO_FIELDS 注释。
 */
export const DEFAULT_HIDDEN_TODO_FIELD_KEYS: readonly string[] = ['source', 'visibility'];

export function findTodoField(
  fields: readonly TodoFieldDescriptor[],
  key: string,
): TodoFieldDescriptor | null {
  return fields.find((field) => field.key === key) ?? null;
}

/** 单个值的展示名：候选表里的 label 优先，其次字段自己的 formatValue，最后原样。 */
export function todoFieldValueLabel(
  field: TodoFieldDescriptor,
  value: string,
  context: TodoFieldContext,
): string {
  const option = field.options?.(context).find((candidate) => candidate.value === value);
  if (option) return option.label;
  return field.formatValue ? field.formatValue(value) : value;
}

/** 整格的展示文本（多值以空格相连）。搜索命中面与「未知字段」的兜底渲染都用它。 */
export function todoFieldText(
  field: TodoFieldDescriptor,
  todo: Todo,
  context: TodoFieldContext,
): string {
  return field
    .values(todo)
    .map((value) => todoFieldValueLabel(field, value, context))
    .join(' ');
}

/**
 * 排序取值。显式 `sortValue` 优先；否则按 type 推导——
 * date 解析成时间戳（解析不了当缺值），其余取第一个值的文本。
 */
export function todoFieldSortValue(field: TodoFieldDescriptor, todo: Todo): string | number | null {
  if (field.sortValue) return field.sortValue(todo);
  const [first] = field.values(todo);
  if (first === undefined) return null;
  if (field.type !== 'date') return first;
  const parsed = Date.parse(first);
  return Number.isNaN(parsed) ? null : parsed;
}

export function todoFieldFirstSortDirection(field: TodoFieldDescriptor): TodoSortDirection {
  return field.firstSortDirection ?? 'asc';
}

export function isTodoFieldHideable(field: TodoFieldDescriptor): boolean {
  return field.hideable ?? true;
}

export function isTodoFieldGroupable(field: TodoFieldDescriptor): boolean {
  return field.groupable ?? true;
}
