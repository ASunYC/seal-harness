import { isTodoWorkOrder } from '@shared/protocol/project-collab.js';
import type {
  ProjectTodoUpdateRequest,
  Todo,
  TodoStatus,
} from '@shared/protocol/project-collab.js';

import { TODO_STATUS_ORDER } from './project-format';

/**
 * 待办状态流转的**唯一实现**——看板卡片与表格行共用这一份。
 *
 * 为什么单拎出来：两个视图各有一个状态下拉，逐字复制一份的代价不是多几行，而是
 * 乐观锁那两条纪律（`expectedVersion` 带的是**卡片快照上的版本**、失败要把下拉复位
 * 到 store 里的权威值）以后只会被改对一边。⛔ 不许出现第二份。
 *
 * 依赖按结构声明而不是直接吃 pinia store：这样它能被单独跑，也不把 store 的其余
 * 三十来个字段拖进本模块的可见面。
 */
export interface TodoStatusFlowHost {
  readonly todos: readonly Todo[];
  updateTodo(request: ProjectTodoUpdateRequest): Promise<'ok' | 'conflict' | 'error'>;
}

/** 一次流转的结局。`unchanged` ＝目标状态与当前一致，压根没发请求。 */
export type TodoStatusFlowOutcome = 'ok' | 'conflict' | 'error' | 'unchanged';

/**
 * 普通改单**这条路**上这张单能挑哪几档——状态下拉与拖卡换列同读这一份。
 *
 * 判据与服务端 `ensure_todo_status_transition` 同口径，三条：
 *  1. 可直接进入「待验收」，不要求完成记录或先提测；状态变更不代表验收通过；
 *  2. 已经在待验收的单，普通改单只剩「取消」——通过与打回是派单方的判断，
 *     走验收通道。取消放行是因为它不是一次完成判定，不会把自证洗白；
 *  3. **有验收清单的工作单没有「已完成」这一项**——想标完成得先提交待验收、
 *     再由派单人认可。摆一个必然被服务端拒的「已完成」，用户点下去只会收到
 *     一句看不懂的失败，还以为是界面坏了。没有清单的普通待办不受此限，
 *     行为与迁移 0009 之前逐字一致。
 *
 * 当前档**恒在**返回值里：下拉的选中项必须有对应的 option，否则控件会显示成空。
 */
export function todoStatusOptions(
  todo: Pick<Todo, 'acceptanceTotal' | 'status'>,
): readonly TodoStatus[] {
  let reachable: readonly TodoStatus[];
  if (todo.status === 'inReview') {
    reachable = ['cancelled'];
  } else if (isTodoWorkOrder(todo)) {
    reachable = ['notStarted', 'inProgress', 'inReview', 'cancelled'];
  } else {
    reachable = ['notStarted', 'inProgress', 'inReview', 'done', 'cancelled'];
  }
  return TODO_STATUS_ORDER.filter((status) => status === todo.status || reachable.includes(status));
}

/**
 * 流转本体：带**卡片快照上的版本**去写，把结局交回调用方。
 *
 * 下拉与拖拽是同一件事的两种手势，所以只有这一个函数发请求；两个手势各自的
 * 「失败之后现场怎么复位」不一样（下拉复位选中项、拖拽弹回原列），那部分留给
 * 各自的适配层——⛔ 但**不许**在适配层里再写一遍 `updateTodo`。
 */
export async function applyTodoStatus(
  host: TodoStatusFlowHost,
  todo: Todo,
  nextStatus: TodoStatus,
): Promise<TodoStatusFlowOutcome> {
  if (nextStatus === todo.status) return 'unchanged';
  return host.updateTodo({
    todoId: todo.id,
    expectedVersion: todo.version,
    status: nextStatus,
  });
}

/** 下拉手势的适配层：读下拉的新值走流转，失败把下拉复位到 store 里的权威值。 */
export async function changeTodoStatus(
  host: TodoStatusFlowHost,
  todo: Todo,
  event: Event,
): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const outcome = await applyTodoStatus(host, todo, select.value as TodoStatus);
  if (outcome === 'ok' || outcome === 'unchanged') return;
  // 失败（含 409）时 store 已提示并按需刷新；把下拉复位到 store 里的权威值。
  select.value = host.todos.find((t) => t.id === todo.id)?.status ?? todo.status;
}
