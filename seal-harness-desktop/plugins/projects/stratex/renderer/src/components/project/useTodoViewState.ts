import { projectStorage } from '../../../../../src/ui/runtime';
import { reactive, watch } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';

import {
  DEFAULT_HIDDEN_TODO_FIELD_KEYS,
  findTodoField,
  isTodoFieldGroupable,
  isTodoFieldHideable,
} from './todo-fields';
import type { TodoFieldContext, TodoFieldDescriptor } from './todo-fields';
import { filterTodos, searchTodos, todoFilterOperators } from './todo-query';
import type { TodoFilterCondition, TodoFilterOperator } from './todo-query';
import { DEFAULT_TODO_SORT, nextTodoSort, sortTodos } from './todo-sort';
import type { TodoSort } from './todo-sort';
import { isProjectView } from './project-views';
import type { ProjectView } from './project-views';
import {
  TODO_COLUMN_SCHEMA_VERSION,
  todoColumnLayoutSchema,
  todoColumnWidth,
} from './todo-column-layout';

/**
 * 看板页签的**视图配置**——筛选 / 搜索 / 分组 / 排序 / 字段显示的当前值。
 *
 * ⚠️ 为什么全收在这一个对象里：这组值将来要搬进服务端的「视图」记录（阶段 3 的
 * 「+ 新建视图」就是在建这种记录）。散成十个 ref 的话，搬家时要满仓找；收成一份
 * `TodoViewConfig` + 一组改它的方法，搬家只动本模块的读写两端（`readConfig` /
 * `persist`），调用方一行不改。
 *
 * 载体沿用仓内既有做法：`stratex.*` 前缀的 localStorage 键 + try/catch 静默降级
 * （见 stores/workbench.ts、theme.ts、SkillWorkbench.vue）。存的全是视图偏好，
 * 不含任何账号信息，所以不进 store 的换号作废清单。
 */

/**
 * 当前激活的单个视图。集合/默认/额外视图管理收在 `project-views.ts`（UX-03）——
 * 这里的 `view` 只记「此刻停在哪个视图」，是**跟着人走**的个人偏好（见下方存储键说明）；
 * 「启用了哪些额外视图」是**按账号×项目**隔离的另一份偏好，不在本模块。
 */
export type TodoBoardView = ProjectView;

export interface TodoViewConfig {
  view: TodoBoardView;
  search: string;
  filters: readonly TodoFilterCondition[];
  /** `null` = 不分组。 */
  groupKey: string | null;
  sort: TodoSort;
  /** 关掉的列（存「关掉的」而不是「打开的」：将来新增字段默认可见，无需迁移旧值）。 */
  hiddenFieldKeys: readonly string[];
  columnWidths?: Readonly<Record<string, number>>;
  pinnedFieldKeys?: readonly string[];
}

/**
 * 视图键沿用既有的 `stratex.project.board-view`（值仍是 `board` / `table` 裸串）。
 * 其余配置另开一个 JSON 键——把视图并进 JSON 会让老版本存下的偏好一次性作废。
 *
 * 「需求」「任务」两页各存各的（`storageKey` 后缀）：两页看的是不同层级的东西，
 * 在任务页按「所属需求」筛完切回需求页，那条件对需求一条都筛不出来——共用一份
 * 配置会让人以为数据没了。**需求页用无后缀的旧键**，原「看板」页签的偏好照常延续。
 */
const VIEW_STORAGE_KEY = 'stratex.project.board-view';
const CONFIG_STORAGE_KEY = 'stratex.project.board-view-config';

export function createDefaultTodoViewConfig(): TodoViewConfig {
  return {
    view: 'board',
    search: '',
    filters: [],
    groupKey: null,
    sort: DEFAULT_TODO_SORT,
    hiddenFieldKeys: [...DEFAULT_HIDDEN_TODO_FIELD_KEYS],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? (value as string[]) : null;
}

/** 存进去的是自由 JSON，读回来一律当不可信输入逐字段验；认不出的字段直接丢默认值。 */
function readStoredFilters(value: unknown): readonly TodoFilterCondition[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: TodoFilterCondition[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { id, fieldKey, operator, value: raw } = item;
    if (typeof id !== 'string' || typeof fieldKey !== 'string') return null;
    if (typeof operator !== 'string' || typeof raw !== 'string') return null;
    parsed.push({ id, fieldKey, operator: operator as TodoFilterOperator, value: raw });
  }
  return parsed;
}

function readStoredView(viewKey: string): TodoBoardView {
  try {
    const raw = projectStorage().getItem(viewKey);
    // 认得四个合法视图（含 UX-03 的 calendar/timeline）就用它，脏值/null 回落看板。
    // ⚠️ 存下的可能是当前项目已移除的额外视图——那由 ProjectBoardPane 的
    //    resolveActiveView 再对齐到启用集（回落表格），本函数只挡脏值不判启用。
    return isProjectView(raw) ? raw : 'board';
  } catch {
    // 渲染层存储不可用：本次会话按默认视图走，不影响任何数据。
    return 'board';
  }
}

function readStoredConfig(viewKey: string, configKey: string): TodoViewConfig {
  const config = createDefaultTodoViewConfig();
  config.view = readStoredView(viewKey);
  let raw: string | null = null;
  try {
    raw = projectStorage().getItem(configKey);
  } catch {
    return config;
  }
  if (raw === null) return config;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return config;
    if (typeof parsed['search'] === 'string') config.search = parsed['search'];
    if (typeof parsed['groupKey'] === 'string') config.groupKey = parsed['groupKey'];
    const filters = readStoredFilters(parsed['filters']);
    if (filters) config.filters = filters;
    const hidden = readStrings(parsed['hiddenFieldKeys']);
    if (hidden) config.hiddenFieldKeys = hidden;
    const sort = parsed['sort'];
    if (isRecord(sort) && typeof sort['key'] === 'string')
      config.sort = { key: sort['key'], direction: sort['direction'] === 'desc' ? 'desc' : 'asc' };
  } catch {
    // 存的是坏 JSON（手改过 / 旧格式）：按默认视图走，下一次写入会把它覆盖掉。
  }
  return config;
}

export interface TodoViewState {
  /** 当前值（响应式）。⚠️ 只读——改它一律走下面的方法，别在组件里就地赋值。 */
  readonly config: TodoViewConfig;
  setView(view: TodoBoardView): void;
  setSearch(value: string): void;
  toggleSort(key: string, fields: readonly TodoFieldDescriptor[]): void;
  setSort(sort: TodoSort): void;
  setGroupKey(key: string | null): void;
  isFieldVisible(key: string): boolean;
  setFieldVisible(field: TodoFieldDescriptor, visible: boolean): void;
  visibleFields(fields: readonly TodoFieldDescriptor[]): readonly TodoFieldDescriptor[];
  addFilter(fields: readonly TodoFieldDescriptor[]): void;
  updateFilter(id: string, patch: Partial<Omit<TodoFilterCondition, 'id'>>): void;
  removeFilter(id: string): void;
  setColumnWidth(key: string, width: number): void;
  setColumnPinned(key: string, pinned: boolean): void;
  resetColumns(): void;
}

let filterSeq = 0;

function nextFilterId(): string {
  filterSeq += 1;
  return `f${String(filterSeq)}`;
}

export interface TodoViewStateOptions {
  /** 关掉持久化（组件默认态、测试夹具用）。 */
  readonly persist?: boolean;
  /**
   * 存储键后缀（`''` ＝需求页，沿用原「看板」页签的旧键；`'.tasks'` ＝任务页）。
   * ⚠️ 后缀是**页签身份**，不是随手起的名字：改了它等于把用户存下的偏好作废。
   */
  readonly storageKey?: string;
  /** Account + project + pane identity; null suspends preference access during sign-out. */
  readonly contextKey?: () => string | null;
}

export function useTodoViewState(options: TodoViewStateOptions = {}): TodoViewState {
  const persist = options.persist ?? true;
  const suffix = options.storageKey ?? '';
  const viewKey = `${VIEW_STORAGE_KEY}${suffix}`;
  const configKey = `${CONFIG_STORAGE_KEY}${suffix}`;
  const config = reactive<TodoViewConfig>(
    persist ? readStoredConfig(viewKey, configKey) : createDefaultTodoViewConfig(),
  );
  if (options.contextKey) {
    let restoring = false;
    let layoutKey: string | null = null;
    watch(
      () => [options.contextKey?.(), config.view] as const,
      ([context, view]) => {
        restoring = true;
        layoutKey = context
          ? `${CONFIG_STORAGE_KEY}.columns.v${String(TODO_COLUMN_SCHEMA_VERSION)}.${encodeURIComponent(context)}.${view}`
          : null;
        config.columnWidths = {};
        config.pinnedFieldKeys = [];
        config.hiddenFieldKeys = [...DEFAULT_HIDDEN_TODO_FIELD_KEYS];
        if (persist && layoutKey) {
          try {
            const parsed = todoColumnLayoutSchema.safeParse(
              JSON.parse(projectStorage().getItem(layoutKey) ?? 'null'),
            );
            if (parsed.success) {
              config.columnWidths = parsed.data.widths;
              config.pinnedFieldKeys = parsed.data.pinned;
              config.hiddenFieldKeys = parsed.data.hidden.filter((key) => key !== 'title');
            }
          } catch {
            // Corrupt or unavailable preference storage keeps this context's defaults.
          }
        }
        restoring = false;
      },
      { immediate: true, flush: 'sync' },
    );
    watch(
      () => [config.columnWidths, config.pinnedFieldKeys, config.hiddenFieldKeys],
      () => {
        if (!persist || restoring || !layoutKey) return;
        try {
          projectStorage().setItem(
            layoutKey,
            JSON.stringify({
              widths: config.columnWidths ?? {},
              pinned: config.pinnedFieldKeys ?? [],
              hidden: config.hiddenFieldKeys,
            }),
          );
        } catch {
          // Layout remains usable for this session when preference storage is full.
        }
      },
      { deep: true, flush: 'sync' },
    );
  }

  if (persist) {
    watch(
      () => config.view,
      (view) => {
        try {
          projectStorage().setItem(viewKey, view);
        } catch {
          // 偏好保存失败只影响下次进入，不改变当前视图。
        }
      },
    );
    watch(
      () => [config.search, config.filters, config.groupKey, config.sort, config.hiddenFieldKeys],
      () => {
        try {
          projectStorage().setItem(
            configKey,
            JSON.stringify({
              search: config.search,
              filters: config.filters,
              groupKey: config.groupKey,
              sort: config.sort,
              hiddenFieldKeys: config.hiddenFieldKeys,
            }),
          );
        } catch {
          // 同上：存不下只是下次进来回到默认，当前这次视图照常工作。
        }
      },
      { deep: true },
    );
  }

  return {
    config,
    setView(view) {
      config.view = view;
    },
    setSearch(value) {
      config.search = value;
    },
    toggleSort(key, fields) {
      config.sort = nextTodoSort(config.sort, key, fields);
    },
    setSort(sort) {
      config.sort = sort;
    },
    setGroupKey(key) {
      config.groupKey = key;
    },
    isFieldVisible(key) {
      return key === 'title' || !config.hiddenFieldKeys.includes(key);
    },
    setFieldVisible(field, visible) {
      // 锚列关不掉：全关之后表格只剩行号，认不出哪行是哪条。
      if (!visible && !isTodoFieldHideable(field)) return;
      config.hiddenFieldKeys = visible
        ? config.hiddenFieldKeys.filter((key) => key !== field.key)
        : [...config.hiddenFieldKeys.filter((key) => key !== field.key), field.key];
    },
    visibleFields(fields) {
      return fields.filter(
        (field) => !isTodoFieldHideable(field) || !config.hiddenFieldKeys.includes(field.key),
      );
    },
    addFilter(fields) {
      // 新条件默认落在**锚列**（不可收起的那一列，即标题），⛔ 不取字段表首位：首位是「需求标识」，
      // 任务行没有它、需求行只是一串 UUID——默认筛它，用户随手输入标题片段就会把行全筛没。
      const field = fields.find((candidate) => !isTodoFieldHideable(candidate)) ?? fields[0];
      if (!field) return;
      const [operator] = todoFilterOperators(field);
      if (!operator) return;
      config.filters = [
        ...config.filters,
        { id: nextFilterId(), fieldKey: field.key, operator, value: '' },
      ];
    },
    updateFilter(id, patch) {
      config.filters = config.filters.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      );
    },
    removeFilter(id) {
      config.filters = config.filters.filter((condition) => condition.id !== id);
    },
    setColumnWidth(key, width) {
      if (!Number.isFinite(width)) return;
      config.columnWidths = {
        ...config.columnWidths,
        [key]: todoColumnWidth(key, { [key]: width }),
      };
    },
    setColumnPinned(key, pinned) {
      const previous = config.pinnedFieldKeys ?? [];
      config.pinnedFieldKeys = pinned
        ? [...previous.filter((item) => item !== key), key]
        : previous.filter((item) => item !== key);
    },
    resetColumns() {
      config.columnWidths = {};
      config.pinnedFieldKeys = [];
      config.hiddenFieldKeys = [...DEFAULT_HIDDEN_TODO_FIELD_KEYS];
    },
  };
}

/**
 * 视图配置 → 行集合的**唯一**管线：筛选 → 搜索 → 排序。
 *
 * 看板列与表格行都走这一支。两个视图各写一遍的话，「搜索命中了但看板不动」这类
 * 分叉迟早出现——它们读的是同一份 `store.todos`，就该按同一套规则收窄。
 * （分组只作用于表格：看板本身已经按状态分列了。）
 */
export function selectTodoRows(
  todos: readonly Todo[],
  config: TodoViewConfig,
  fields: readonly TodoFieldDescriptor[],
  context: TodoFieldContext,
): Todo[] {
  const filtered = filterTodos(todos, config.filters, fields);
  const searched = searchTodos(filtered, config.search, fields, context);
  return sortTodos(searched, config.sort, fields);
}

/** 可作为分组依据的字段（分组下拉的候选）。 */
export function groupableFields(
  fields: readonly TodoFieldDescriptor[],
): readonly TodoFieldDescriptor[] {
  return fields.filter((field) => isTodoFieldGroupable(field));
}

/** 当前分组字段；`groupKey` 为空或认不出时返回 null（＝不分组）。 */
export function activeGroupField(
  config: TodoViewConfig,
  fields: readonly TodoFieldDescriptor[],
): TodoFieldDescriptor | null {
  if (config.groupKey === null) return null;
  const field = findTodoField(fields, config.groupKey);
  return field !== null && isTodoFieldGroupable(field) ? field : null;
}
