import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';

import type { ProjectTodoUpdateRequest, Todo } from '@shared/protocol/project-collab.js';

import {
  SCHEDULE_DAY_WIDTH_PX,
  isValidScheduleInterval,
  resolveStartKey,
  scheduleDayKey,
  shiftDayKey,
} from './schedule-layout';

/**
 * 时间轴「拖动排期」的全部状态与手势——UX-04 判据 2。
 *
 * ⚠️ 落库仍走 store 现有的乐观锁改单出口 `updateTodo`（带 `expectedVersion`，冲突 409 由
 *    store 就地提示+重取，见 `projectCollabBoard.updateTodo`）——⛔ 不新增 IPC 通道、
 *    ⛔ 不在这里复制第二份 `updateTodo`。这里只多做拖拽需要的三件事：
 *      ① **先手校验** `start ≤ due`（`isValidScheduleInterval`；非法即不发请求）；
 *      ② **乐观落位**（请求在途时条先动到新区间）；
 *      ③ **失败弹回**（409/error 时撤销乐观区间——判据 2「409 回滚」）。
 *
 * ⚠️ 判据 2「观察者不可改排期」是**负向**要求：既在 UI 收起把手（`canDrag`），又在
 *    落库前**第二道门**（`commitDrag` 复核 `canDrag`）——⛔ 只隐藏把手不算，触发了拖动路径
 *    也绝不发写请求。两道门同读 `host.canEditTodo`（＝服务端 `todo_patch_decision` 同口径，
 *    观察者 `canWrite=false` ⇒ 恒 false）。
 *
 * 依赖按**结构**声明（`todos` + `updateTodo` + `canEditTodo`），不直接吃 pinia store——
 * 与 `useTodoBoardDnd` 同一路数，便于单独测（fake host 注入 `canEditTodo`/`updateTodo`）。
 */
export interface ScheduleDndHost {
  readonly todos: readonly Todo[];
  updateTodo(request: ProjectTodoUpdateRequest): Promise<'ok' | 'conflict' | 'error'>;
  /** G-11 对象级写入判定；服务端仍是权威，这里只决定「给不给拖 + 让不让写」。 */
  canEditTodo(
    todo: Pick<Todo, 'assigneeSubject' | 'assigneeKind' | 'visibility' | 'itemKind' | 'parentId'>,
  ): boolean;
}

/** 拖动模式（闭集）：整体平移 / 拖左端改开始 / 拖右端改截止。 */
export type ScheduleDragMode = 'move' | 'resize-start' | 'resize-end';

/** 一次拖动的**乐观预览区间**（date-only 日键，与建单弹层同一 wire 口径）。 */
export interface SchedulePreview {
  readonly todoId: string;
  readonly startAt: string | null;
  readonly dueAt: string;
}

export interface ScheduleDnd {
  /** 这条给不给拖（＝有没有对象级写权限；观察者恒 false）。UI 据此决定出不出把手。 */
  canDrag(todo: Todo): boolean;
  /** 拖动中的乐观预览（供组件把这条的区间临时替换成预览区间重算几何）；否则 null。 */
  readonly preview: ComputedRef<SchedulePreview | null>;
  isDragging(todoId: string): boolean;
  /** 把一批需求应用当前乐观预览后返回（拖动中那条用预览区间，其余原样）。 */
  applyPreview(todos: readonly Todo[]): Todo[];
  beginDrag(todo: Todo, mode: ScheduleDragMode, clientX: number): void;
  updateDrag(clientX: number): void;
  commitDrag(): Promise<void>;
  cancelDrag(): void;
}

interface DragState {
  readonly todo: Todo;
  readonly mode: ScheduleDragMode;
  readonly originClientX: number;
  /** 拖动起点的**原始**区间（回滚与增量计算都以它为基准）。 */
  readonly baseStartAt: string | null;
  readonly baseDueKey: string;
}

export function useScheduleDnd(
  host: ScheduleDndHost,
  dayWidthPx = SCHEDULE_DAY_WIDTH_PX,
): ScheduleDnd {
  const drag = ref<DragState | null>(null);
  const previewRef = ref<SchedulePreview | null>(null);

  function canDrag(todo: Todo): boolean {
    return host.canEditTodo(todo);
  }

  /** 由拖动位移算出预览区间：平移动两端、拖端只动一端；start 夹到 ≤ due 不做（交给校验拦）。 */
  function computePreview(state: DragState, clientX: number): SchedulePreview {
    const deltaDays = Math.round((clientX - state.originClientX) / dayWidthPx);
    const baseStartKey = resolveStartKey(state.baseStartAt, state.baseDueKey);
    if (state.mode === 'move') {
      // 整体平移：有开始就跟着移，没有就保持单日节点（只移截止）。
      const nextStart = state.baseStartAt === null ? null : shiftDayKey(baseStartKey, deltaDays);
      return {
        todoId: state.todo.id,
        startAt: nextStart,
        dueAt: shiftDayKey(state.baseDueKey, deltaDays),
      };
    }
    if (state.mode === 'resize-start') {
      // 拖左端改开始（截止不动）；正向拖过头会越过截止 ⇒ 交给 commitDrag 的校验拦。
      return {
        todoId: state.todo.id,
        startAt: shiftDayKey(baseStartKey, deltaDays),
        dueAt: state.baseDueKey,
      };
    }
    // resize-end：拖右端改截止（开始不动）；反向拖过头会早于开始 ⇒ 同样交给校验拦。
    return {
      todoId: state.todo.id,
      startAt: state.baseStartAt,
      dueAt: shiftDayKey(state.baseDueKey, deltaDays),
    };
  }

  function beginDrag(todo: Todo, mode: ScheduleDragMode, clientX: number): void {
    // 第一道门（UI）：观察者/无写权限的条不起手拖。
    if (!canDrag(todo)) return;
    const dueKey = scheduleDayKey(todo.dueAt);
    if (dueKey === null) return; // 未排期的条没有可拖的区间
    drag.value = {
      todo,
      mode,
      originClientX: clientX,
      baseStartAt: todo.startAt,
      baseDueKey: dueKey,
    };
    previewRef.value = { todoId: todo.id, startAt: todo.startAt, dueAt: dueKey };
  }

  function updateDrag(clientX: number): void {
    const state = drag.value;
    if (state === null) return;
    previewRef.value = computePreview(state, clientX);
  }

  function cancelDrag(): void {
    drag.value = null;
    previewRef.value = null;
  }

  async function commitDrag(): Promise<void> {
    const state = drag.value;
    const proposed = previewRef.value;
    drag.value = null;
    if (state === null || proposed === null) {
      previewRef.value = null;
      return;
    }
    // 第二道门（写入）：即便拖动路径被触发，观察者也发不出写请求（判据 2 负向）。
    if (!canDrag(state.todo)) {
      previewRef.value = null;
      return;
    }
    // 先手校验 start ≤ due：非法就地弹回、⛔ 不发请求（服务端仍会二次校验，见 schedule-layout）。
    if (!isValidScheduleInterval(proposed.startAt, proposed.dueAt)) {
      previewRef.value = null;
      return;
    }
    // 没实际改动（拖了个来回 / 位移不足一天）⇒ 不发请求、无回执噪音。
    if (proposed.startAt === state.baseStartAt && proposed.dueAt === state.baseDueKey) {
      previewRef.value = null;
      return;
    }
    // 乐观落位保留到请求回来：在途期间条停在新区间。落库走 store 现有乐观锁出口，
    // 冲突/失败的**显示**由 store 统一给（常驻提示 + 重取），⛔ 这里不吞、不静默。
    await host.updateTodo({
      todoId: state.todo.id,
      expectedVersion: state.todo.version,
      startAt: proposed.startAt,
      dueAt: proposed.dueAt,
    });
    // 只撤自己这一轮（更晚一次拖动可能已顶掉预览）。
    if (previewRef.value?.todoId !== proposed.todoId) return;
    // 成功：store 已是权威区间，撤预览后条照样停在新处；
    // 失败（409 版本冲突 / error）：撤预览＝**弹回原区间**——把它留在新处会让人以为改成功了，
    // 而服务端根本没动。
    previewRef.value = null;
  }

  function applyPreview(todos: readonly Todo[]): Todo[] {
    const p = previewRef.value;
    if (p === null) return [...todos];
    return todos.map((todo) =>
      todo.id === p.todoId ? { ...todo, startAt: p.startAt, dueAt: p.dueAt } : todo,
    );
  }

  return {
    canDrag,
    preview: computed(() => previewRef.value),
    isDragging: (todoId) => drag.value?.todo.id === todoId,
    applyPreview,
    beginDrag,
    updateDrag,
    commitDrag,
    cancelDrag,
  };
}
