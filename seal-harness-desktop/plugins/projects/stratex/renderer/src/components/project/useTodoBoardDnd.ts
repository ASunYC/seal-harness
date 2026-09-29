import { ref } from 'vue';

import type { Todo, TodoStatus } from '@shared/protocol/project-collab.js';

import { applyTodoStatus, todoStatusOptions } from './todo-status-flow';
import type { TodoStatusFlowHost } from './todo-status-flow';

/**
 * 看板「拖卡换列」的全部状态与手势。
 *
 * ⚠️ 流转本体不在这里——落库走 `todo-status-flow` 的 `applyTodoStatus`（与卡片上的
 *    状态下拉是同一支）。这里只多做两件下拉不需要的事：**乐观落位**与**失败弹回**。
 *
 * ⚠️ 拖拽是**附加**手势不是替代：卡上的状态下拉照旧在（键盘唯一可达的那条路）。
 *    只能拖不能敲，等于把这块功能从一部分人手里拿走。
 *
 * 依赖按结构声明（`todos` + `updateTodo` + `canEditTodo`），不直接吃 pinia store：
 * 与 `TodoStatusFlowHost` 同样的理由，也便于单独测。
 */
export interface TodoBoardDndHost extends TodoStatusFlowHost {
  /** G-11 对象级写入判定；服务端仍是权威，这里只决定「给不给拖」。 */
  canEditTodo(
    todo: Pick<Todo, 'assigneeSubject' | 'assigneeKind' | 'visibility' | 'itemKind' | 'parentId'>,
  ): boolean;
}

export interface TodoBoardDnd {
  /** 这条待办当前该落在哪一列（拖拽中读乐观落位，其余读 store 的权威值）。 */
  columnStatusOf(todo: Todo): TodoStatus;
  /** 这条卡片给不给拖（＝有没有对象级写权限）。 */
  canDragTodo(todo: Todo): boolean;
  isDraggingTodo(todoId: string): boolean;
  isDropTarget(status: TodoStatus): boolean;
  onDragStart(todo: Todo, event: DragEvent): void;
  onDragEnd(): void;
  onDragOver(status: TodoStatus, event: DragEvent): void;
  onDragLeave(status: TodoStatus): void;
  onDrop(status: TodoStatus, event: DragEvent): Promise<void>;
}

interface PendingMove {
  readonly todoId: string;
  readonly status: TodoStatus;
}

export function useTodoBoardDnd(host: TodoBoardDndHost): TodoBoardDnd {
  const draggingTodoId = ref<string | null>(null);
  const dropTargetStatus = ref<TodoStatus | null>(null);
  /** 乐观落位：请求还在路上时卡片先出现在目标列，落库失败即撤销。 */
  const pendingMove = ref<PendingMove | null>(null);

  function canDragTodo(todo: Todo): boolean {
    return host.canEditTodo(todo);
  }

  function columnStatusOf(todo: Todo): TodoStatus {
    const pending = pendingMove.value;
    return pending !== null && pending.todoId === todo.id ? pending.status : todo.status;
  }

  function resetDragState(): void {
    draggingTodoId.value = null;
    dropTargetStatus.value = null;
  }

  function onDragStart(todo: Todo, event: DragEvent): void {
    // 没有写权限的卡片连拖都不该起手：`draggable=false` 已经挡了一道，
    // 这里是第二道（拖拽可由辅助技术等别的路径发起）。
    if (!canDragTodo(todo)) {
      event.preventDefault();
      return;
    }
    draggingTodoId.value = todo.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // 带上 id：跨渲染帧丢了组件内状态时，落点仍能认出拖的是哪一条。
      event.dataTransfer.setData('text/plain', todo.id);
    }
  }

  function onDragEnd(): void {
    resetDragState();
  }

  /**
   * 拖到某一列合不合法——与卡上下拉的可选档同一份判据（`todoStatusOptions`）。
   *
   * 有验收清单的工作单**拖不进「已完成」**：那一档只能经「提交待验收 → 派单人认可」
   * 抵达。⛔ 不能只在下拉上收窄——拖拽是同一件事的另一种手势，只挡一边等于没挡。
   */
  function canDropInto(todoId: string | null, status: TodoStatus): boolean {
    if (todoId === null) return false;
    const todo = host.todos.find((candidate) => candidate.id === todoId);
    if (!todo || !canDragTodo(todo)) return false;
    return todoStatusOptions(todo).includes(status);
  }

  function onDragOver(status: TodoStatus, event: DragEvent): void {
    if (draggingTodoId.value === null) return;
    // 不合法的落点不 preventDefault ⇒ 浏览器给出「禁止」光标并拒收这一次投放，
    // 用户在松手之前就知道这一列去不了。
    if (!canDropInto(draggingTodoId.value, status)) return;
    // ⚠️ 不 preventDefault 就不是合法投放区，浏览器会直接拒收这一次拖拽。
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTargetStatus.value = status;
  }

  function onDragLeave(status: TodoStatus): void {
    if (dropTargetStatus.value === status) dropTargetStatus.value = null;
  }

  function readDroppedTodoId(event: DragEvent): string | null {
    if (draggingTodoId.value !== null) return draggingTodoId.value;
    const carried = event.dataTransfer?.getData('text/plain') ?? '';
    return carried === '' ? null : carried;
  }

  async function onDrop(status: TodoStatus, event: DragEvent): Promise<void> {
    event.preventDefault();
    const todoId = readDroppedTodoId(event);
    resetDragState();
    if (todoId === null) return;
    const todo = host.todos.find((candidate) => candidate.id === todoId);
    // 写权限门与卡上的下拉同判据（G-11 对象级）：⛔ 不许在这里放宽成 canWrite。
    // 可达档同样与下拉同判据（`canDropInto`）——onDragOver 已经挡了一道，这里是
    // 第二道（投放可由别的路径发起，且 dragover 与 drop 之间清单可能已变）。
    if (!todo || todo.status === status || !canDropInto(todoId, status)) return;

    pendingMove.value = { todoId, status };
    await applyTodoStatus(host, todo, status);
    // 只撤自己这一轮的落位（更晚的一次拖拽可能已经把它顶掉）。
    if (pendingMove.value?.todoId !== todoId) return;
    // 撤掉乐观落位：成功时 store 已是权威值，撤了卡片照样在目标列；失败时
    // （409 版本冲突 / 权限不足）撤销就是**弹回原列**——把它留在目标列会让人
    // 以为改成功了，而服务端那边根本没动。失败提示由 store 统一给。
    pendingMove.value = null;
  }

  return {
    columnStatusOf,
    canDragTodo,
    isDraggingTodo: (todoId) => draggingTodoId.value === todoId,
    isDropTarget: (status) => dropTargetStatus.value === status,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
