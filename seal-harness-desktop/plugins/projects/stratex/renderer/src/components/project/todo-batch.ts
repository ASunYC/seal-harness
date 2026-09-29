import type {
  ProjectTodoUpdateRequest,
  Todo,
  TodoStatus,
} from '@shared/protocol/project-collab.js';

import { todoAlreadyAssignedTo } from './todo-assignee';
import { projectCollabErrorText } from '../../stores/projectCollabErrors';

/**
 * 批量操作的执行本体（不碰 DOM，只认一个最小宿主接口 ⇒ 可单独跑）。
 *
 * 三条纪律：
 *
 *  ① **只作用于传进来的这一批**。调用方传的是「当前选中且渲染在表里的行」；
 *     这里绝不去够 store 的全量待办——一次误改整表是不可撤销的（没有删除端点，
 *     更没有撤销），所以「作用域」必须是入参而不是隐式全局。
 *
 *  ② **逐条串行**，不并发。每条都带自己的 `expectedVersion` 走乐观锁；并发发出去
 *     一旦服务端连带刷新了版本，后面的全撞 409。串行还让失败计数是准的。
 *
 *  ③ **不可编辑的跳过而不是硬试**（G-11 同一道 `canEditTodo` 判据）：成员对他人
 *     名下的单点了必撞 403，白报一串失败。跳过的条数如实回给调用方去说明。
 *
 *  ④ **已在目标处理人名下的不发**：只改处理人的请求目标就是当前处理人，服务端回 400
 *     `assignee_unchanged`（测试提单 2539）。它不是失败——那条本来就在目标名下——单独计数。
 *
 *  ⑤ **没改成的逐条带原因**：原因取宿主（store）为那一条写下的提示（共享文案表），回执据此
 *     点名或分组计数——⛔ 不只报「Y 项未成功」（负责人 2026-09-14 现场，见 `todoBatchReceipt`）。
 */

export interface TodoBatchPatch {
  readonly status?: TodoStatus;
  /** `null` ＝清空处理人（未分配）；缺席＝不改处理人。 */
  readonly assigneeSubject?: string | null;
}

/** 批量里没改成的一条：标题 + 原因（原因取宿主写下的那一句，文案来自共享文案表）。 */
export interface TodoBatchFailure {
  readonly title: string;
  readonly reason: string;
}

export interface TodoBatchOutcome {
  /** 选中的总条数（含被跳过的）。 */
  readonly selected: number;
  /** 实际发出去的条数。 */
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  /** 因入口收窄（他人名下）而没发的条数。 */
  readonly skipped: number;
  /** 批量改处理人时本来就在目标名下、因而没发的条数（不算失败，也不算他人名下）。 */
  readonly unchanged: number;
  /** 没改成的逐条原因（顺序同发送顺序；长度恒等于 `failed`）。 */
  readonly failures: readonly TodoBatchFailure[];
}

export interface TodoBatchHost {
  updateTodo(request: ProjectTodoUpdateRequest): Promise<'ok' | 'conflict' | 'error'>;
  canEditTodo(
    todo: Pick<Todo, 'assigneeSubject' | 'assigneeKind' | 'visibility' | 'itemKind' | 'parentId'>,
  ): boolean;
  /**
   * 宿主（store）在一次改单失败时写下的那一句提示——文案来自共享文案表（观察者不能承接、需求不能
   * 派给助理、已被他人认领…）。批量逐条取它当失败原因，回执不另起一套措辞。
   */
  readonly actionNotice: { readonly message: string } | null;
}

/**
 * 这一条的失败原因：宿主为**这一条**写下了新提示就用它；没写（提示还是发送前那一个，例如回来时已换了项目）
 * ⇒ ⛔ 不拿上一条的原因冒名，退回共享文案表里按失败分档的通用句。
 */
function batchFailureReason(
  after: TodoBatchHost['actionNotice'],
  before: TodoBatchHost['actionNotice'],
  outcome: 'conflict' | 'error',
): string {
  if (after !== null && after !== before) return after.message;
  return projectCollabErrorText(outcome === 'conflict' ? 'conflict' : 'transient');
}

function isEmptyPatch(patch: TodoBatchPatch): boolean {
  return patch.status === undefined && patch.assigneeSubject === undefined;
}

export async function applyTodoBatch(
  host: TodoBatchHost,
  todos: readonly Todo[],
  patch: TodoBatchPatch,
): Promise<TodoBatchOutcome> {
  const selected = todos.length;
  if (isEmptyPatch(patch)) {
    return {
      selected,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      unchanged: 0,
      failures: [],
    };
  }
  const editable = todos.filter((todo) => host.canEditTodo(todo));
  let attempted = 0;
  let succeeded = 0;
  let unchanged = 0;
  const failures: TodoBatchFailure[] = [];
  for (const todo of editable) {
    // 处理人已是目标：处理人这一键不发（发了必 400 assignee_unchanged）；没有别的要改就整条不发。
    const assigneeInPlace =
      patch.assigneeSubject !== undefined && todoAlreadyAssignedTo(todo, patch.assigneeSubject);
    if (assigneeInPlace && patch.status === undefined) {
      unchanged += 1;
      continue;
    }
    attempted += 1;
    const noticeBefore = host.actionNotice;
    const outcome = await host.updateTodo({
      todoId: todo.id,
      expectedVersion: todo.version,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.assigneeSubject !== undefined && !assigneeInPlace
        ? { assigneeSubject: patch.assigneeSubject }
        : {}),
    });
    // 409 已被 store 就地自愈（提示 + 重取），但这一条**没改成**，算失败。
    if (outcome === 'ok') succeeded += 1;
    else {
      failures.push({
        title: todo.title,
        reason: batchFailureReason(host.actionNotice, noticeBefore, outcome),
      });
    }
  }
  return {
    selected,
    attempted,
    succeeded,
    failed: failures.length,
    skipped: selected - editable.length,
    unchanged,
    failures,
  };
}

/** 少于等于这么多条失败时逐条点名；再多就按原因分组计数（主会话 2026-09-14 定）。 */
export const TODO_BATCH_FAILURE_LIST_LIMIT = 3;
/** 回执里点名时标题的上限字数（按字符算）：长标题会把一句回执撑成一段。 */
const TODO_BATCH_TITLE_MAX_CHARS = 24;

function receiptTitle(title: string): string {
  const chars = Array.from(title);
  return chars.length > TODO_BATCH_TITLE_MAX_CHARS
    ? `${chars.slice(0, TODO_BATCH_TITLE_MAX_CHARS).join('')}…`
    : title;
}

/** 原因句收尾没有句号时补一个，逐条拼接才不会连成一串。 */
function sentence(text: string): string {
  return /[。！？.!?]$/u.test(text) ? text : `${text}。`;
}

/**
 * 回执里「为什么没改成」那一段：少量逐条点名（「标题」：原因），多了按原因分组计数
 * （其中 N 项：原因，条数多的在前，同数按首次出现）。
 */
function todoBatchFailureDetail(failures: readonly TodoBatchFailure[]): string {
  if (failures.length <= TODO_BATCH_FAILURE_LIST_LIMIT) {
    return failures
      .map((failure) => `「${receiptTitle(failure.title)}」：${sentence(failure.reason)}`)
      .join('');
  }
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const reason = sentence(failure.reason);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return `其中 ${groups.map(([reason, count]) => `${String(count)} 项：${reason}`).join('')}`;
}

/**
 * 批量执行完的回执文案。
 *
 * 全成功也报数：批量操作没有逐行的视觉反馈，不报数用户不知道到底动了几条。
 * 有跳过必须说出来——「我选了 5 条只改了 3 条」不解释就是一次静默的部分失败。
 *
 * ⭐ 有没改成的**必须带上原因**（主会话 2026-09-14 定）：回执会整句盖掉 store 逐条写下的提示，
 *    只剩「已更新 0 项，1 项未成功」时用户无从知道是被谁、为什么拒——负责人现场正是这一句。
 */
export function todoBatchReceipt(outcome: TodoBatchOutcome): string {
  const parts = [`已更新 ${String(outcome.succeeded)} 项`];
  if (outcome.failed > 0) parts.push(`${String(outcome.failed)} 项未成功`);
  if (outcome.skipped > 0) parts.push(`${String(outcome.skipped)} 项在他人名下、未改动`);
  if (outcome.unchanged > 0) parts.push(`${String(outcome.unchanged)} 项已在该处理人名下`);
  const summary = `${parts.join('，')}。`;
  return outcome.failures.length === 0
    ? summary
    : `${summary}${todoBatchFailureDetail(outcome.failures)}`;
}

/**
 * 这次批量**有没有把球踢回给用户** —— 决定回执走 3 秒 toast 还是常驻条
 * （判据本体见 `stores/projectCollabReceipts.ts`）。
 *
 * 判据是「选中的条目有没有全部落地」，**不是成功还是失败**：
 *  - 全落地 ⇒ 纯报告（表里那几行当场变了），toast 说一声就够；
 *  - 差一条都算踢了球——不管是发出去没成（要重来）还是被入口收窄跳过（改不动、
 *    得去找拥有者），用户接下来都还有一件事要做。让「我选了 5 条只改了 3 条」
 *    在 3 秒后自己消失，就是一次静默的部分失败。
 *
 * ⚠️ 选中数取 `selected` 而不是 `attempted`：被跳过的那几条压根没发出去，用
 * `attempted` 当分母会让「跳过 2 条」这一档恒判为全成功。
 *
 * ⚠️ 本来就在目标处理人名下的（`unchanged`）**算落地**：用户要的结果已经是事实，
 * 没有下一件事要做——把它算成没落地，会让「把三条都转给鲍勃，其中一条本来就是他的」
 * 留下一条常驻条，逼用户去找一个不存在的问题。
 */
export function todoBatchLeavesWorkToUser(outcome: TodoBatchOutcome): boolean {
  return outcome.succeeded + outcome.unchanged < outcome.selected;
}
