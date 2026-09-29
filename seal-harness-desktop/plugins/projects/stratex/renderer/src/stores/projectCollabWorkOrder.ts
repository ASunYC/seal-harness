import {
  projectTodoDraftDropServerCodeText,
  projectTodoDraftResolveServerCodeText,
  projectTodoWriteServerCodeText,
  type ProjectTodoAcceptanceSetRequest,
  type ProjectTodoReviewRequest,
  type ProjectTodoSubmitReviewRequest,
  type Todo,
  type TodoAcceptanceItem,
  type TodoCompletionRecord,
  type TodoDraftBatch,
} from '@shared/protocol/project-collab.js';

import { projectCollabErrorNotice, projectCollabInfoNotice } from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 工作单域（验收清单 / 提交待验收 / 验收与打回）与拆解草案闸的动作。
 *
 * 与看板域分开的理由是**语义**而不是体量：看板域管的是「一条待办的字段」，
 * 这里管的是「一张单怎么算做完、谁说了算」。两者共用 `todos` 那一格——工作单的
 * 每一次写入都会回一条权威待办，就地替换掉列表里的旧快照，⛔ 不本地推算状态。
 */
export type ProjectWorkOrderHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    'todos' | 'draftBatches' | 'draftsLoading' | 'draftsRequestId' | 'draftsError'
  >;

/** 同一 store 内只允许最后发起的草案列表请求写回，避免旧空响应覆盖事件刷新。 */
/** 一张工作单的完整规格（逐条判据 + 完成记录时间线）。 */
export interface TodoDetailSnapshot {
  readonly todo: Todo;
  readonly acceptanceItems: readonly TodoAcceptanceItem[];
  readonly completionRecords: readonly TodoCompletionRecord[];
}

/**
 * 一次工作单写入的结局。
 *
 * `conflict` 与普通改单同义（旧快照已失效，已提示并重取）；`error` 时用户输入
 * 必须留在原地——完成记录与打回理由是用户亲笔敲的几百字，丢了就是重写。
 */
export type WorkOrderOutcome = 'ok' | 'conflict' | 'error';

function replaceTodo(host: ProjectWorkOrderHost, todo: Todo): void {
  host.todos = host.todos.map((item) => (item.id === todo.id ? todo : item));
}

/**
 * 读路径的就地替换：详情端点**不算** `requirementTaskTotal`（那是列表读路径才补的数），
 * 直接整条替换会把清单里那一格抹成缺席，任务页那条需求随即显示「任务 未知」——而这次
 * 只是**读**了一下，子项一条没变。⇒ 详情投影缺这一键时沿用清单里已有的值。
 *
 * ⛔ 不是 `?? 0`：清单里也没有就照旧缺席（不替服务端宣布「无子任务」）。
 * ⛔ 只用于读：写路径换回的是改后的权威待办，随后的 `todo.changed` 会整表重取。
 */
function replaceTodoFromDetail(host: ProjectWorkOrderHost, todo: Todo): void {
  host.todos = host.todos.map((item) => {
    if (item.id !== todo.id) return item;
    if (todo.requirementTaskTotal !== undefined || item.requirementTaskTotal === undefined) {
      return todo;
    }
    return { ...todo, requirementTaskTotal: item.requirementTaskTotal };
  });
}

/** 单条工作单的完整规格；失败回 null（提示已落 actionNotice）。 */
export async function loadTodoDetail(
  host: ProjectWorkOrderHost,
  todoId: string,
): Promise<TodoDetailSnapshot | null> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoDetail({ todoId });
    if (epoch !== host.projectEpoch) return null;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return null;
    }
    replaceTodoFromDetail(host, result.todo);
    return {
      todo: result.todo,
      acceptanceItems: result.acceptanceItems,
      completionRecords: result.completionRecords,
    };
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return null;
  }
}

/**
 * 三个写端点共用的外壳：纪元守 + 权威待办就地替换 + 回执文案。
 *
 * 409 单独一档：与 `updateTodo` 同一条纪律——冲突已就地自愈（调用方随后重取详情），
 * 用户无需上报 ⇒ 回执不带参考编号，⛔ 绝不拿旧版本重试。
 *
 * ⚠️ **两档回执走两个出口**（判据见 `projectCollabReceipts.ts`）：
 *  - 成功那句是纯报告（清单已存 / 已提交 / 已验收 / 已打回），卡片当场换状态 ⇒ toast；
 *  - 409 那句**点名要用户「刷新后重试」**——球踢回去了，而且他刚才那次写入没落地
 *    ⇒ 留常驻条，等他自己关。
 */
async function runWorkOrderWrite(
  host: ProjectWorkOrderHost,
  action: () => Promise<
    | { ok: true; todo: Todo }
    | {
        ok: false;
        code: Parameters<typeof projectCollabErrorNotice>[0];
        serverCode?: string | undefined;
      }
  >,
  successNotice: string,
): Promise<WorkOrderOutcome> {
  const epoch = host.projectEpoch;
  try {
    const result = await action();
    if (epoch !== host.projectEpoch) return 'error';
    if (!result.ok) {
      // 被拒的真实原因（如助理单只由派单人或管理者提交验收）就地覆盖通用句。
      // ⚠️ 先查业务码再判冲突：新测试模式挡旧链路的两枚也是 409（需求改走整体提测
      //    `requirement_test_mode_required` / 在测需求 `test_round_in_progress`，TST-02），
      //    它们不是「已被他人更新」——刷新重试照样被拒，⛔ 不走冲突那一档。
      const serverText = projectTodoWriteServerCodeText(result.serverCode);
      if (result.code === 'conflict' && serverText === null) {
        host.actionNotice = projectCollabInfoNotice('该工作单已被他人更新，请刷新后重试。');
        return 'conflict';
      }
      host.actionNotice = projectCollabErrorNotice(result.code, serverText ?? undefined);
      return 'error';
    }
    replaceTodo(host, result.todo);
    pushProjectCollabReceipt(successNotice);
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return 'error';
  }
}

/**
 * 整表替换验收清单。
 *
 * ⚠️ 结局带回**权威待办**：调用方（编辑弹层）紧接着还要发一次普通改单，得用这里
 * 回来的新版本号，不能再用手上那份旧快照——那必然 409。
 */
export async function setAcceptanceItems(
  host: ProjectWorkOrderHost,
  request: ProjectTodoAcceptanceSetRequest,
): Promise<{ readonly outcome: WorkOrderOutcome; readonly todo: Todo | null }> {
  let saved: Todo | null = null;
  const outcome = await runWorkOrderWrite(
    host,
    async () => {
      const result = await projectCollabApi.todoAcceptanceSet(request);
      if (result.ok) saved = result.todo;
      return result;
    },
    request.items.length === 0 ? '验收清单已清空，这条回到普通待办。' : '验收清单已保存。',
  );
  return { outcome, todo: outcome === 'ok' ? saved : null };
}

/** 执行方推到「待验收」并写完成记录（进入这一档的唯一入口）。 */
export async function submitTodoReview(
  host: ProjectWorkOrderHost,
  request: ProjectTodoSubmitReviewRequest,
): Promise<WorkOrderOutcome> {
  return runWorkOrderWrite(
    host,
    () => projectCollabApi.todoSubmitReview(request),
    '已提交待验收，等派单人确认。',
  );
}

/** 派单方验收（→已完成）或打回（→进行中）。 */
export async function reviewTodo(
  host: ProjectWorkOrderHost,
  request: ProjectTodoReviewRequest,
): Promise<WorkOrderOutcome> {
  return runWorkOrderWrite(
    host,
    () => projectCollabApi.todoReview(request),
    request.decision === 'accept' ? '验收通过，这张单已完成。' : '已打回，执行方会看到原因。',
  );
}

/* ----------------------------- 拆解草案闸 ----------------------------- */

/**
 * 我看得见的草案批次。
 *
 * 草案通过定向 `todo.draft` 事件通知可见者，再由渲染层重取权威列表；不解析事件
 * payload，也不开轮询。
 * 看不见的批次服务端回的是「不存在」而不是「没权限」，所以空列表既可能是
 * 「没有草案」也可能是「不关我事」——两者对界面是同一回事：什么都不出。
 */
export async function loadDraftBatches(
  host: ProjectWorkOrderHost,
  projectId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = (host.draftsRequestId += 1);
  host.draftsLoading = true;
  try {
    const result = await projectCollabApi.todoDraftList({ projectId });
    if (epoch !== host.projectEpoch || requestId !== host.draftsRequestId) return;
    if (!result.ok) {
      host.draftsError = projectCollabErrorNotice(result.code);
      return;
    }
    host.draftBatches = result.batches;
    host.draftsError = null;
  } catch {
    if (epoch === host.projectEpoch && requestId === host.draftsRequestId) {
      host.draftsError = projectCollabErrorNotice('transient');
    }
  } finally {
    if (epoch === host.projectEpoch && requestId === host.draftsRequestId) {
      host.draftsLoading = false;
    }
  }
}

function replaceBatch(host: ProjectWorkOrderHost, batch: TodoDraftBatch): void {
  host.draftBatches = host.draftBatches.map((item) => (item.id === batch.id ? batch : item));
}

/**
 * 逐条剔除一条草案（留痕：谁、什么时候；⛔ 不删行）。
 *
 * 被拒时按服务端业务码说清原因（这条已处理 / 这批已处理），认不出才回落通用句；审阅弹层会把
 * 这条报错就地挂到那条草案旁（FLOW-12，与整批处理同一手法）。
 */
export async function dropDraft(host: ProjectWorkOrderHost, draftId: string): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoDraftDrop({ draftId });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(
        result.code,
        projectTodoDraftDropServerCodeText(result.serverCode) ?? undefined,
      );
      return false;
    }
    replaceBatch(host, result.batch);
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/**
 * 整批确认成单 / 整批丢弃。
 *
 * 确认只把还是 `pending` 的草案落成待办（被逐条剔除的已是终态），所以成功之后
 * 要**重取待办清单**：新生成的那几条得出现在看板上，而草案面不发事件、
 * 待办面的事件又不为草案而发。
 *
 * 被拒时按服务端业务码说清原因（认领门 / 来源已删 / 批次已处理），认不出才回落通用句；
 * 编号照旧取 `code` 那一格。审阅弹层会把这条报错就地挂到出错那一批旁（页顶在弹层背后）。
 */
export async function resolveDraftBatch(
  host: ProjectWorkOrderHost,
  batchId: string,
  decision: 'confirm' | 'discard',
): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoDraftResolve({ batchId, decision });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(
        result.code,
        projectTodoDraftResolveServerCodeText(result.serverCode) ?? undefined,
      );
      return false;
    }
    replaceBatch(host, result.batch);
    // 两句都是纯报告：确认完新任务就在清单里、丢弃完这一批就从审阅界面消失，
    // 用户接下来做什么与这句话无关 ⇒ toast，⛔ 不挂在页顶等人来关。
    pushProjectCollabReceipt(
      decision === 'confirm'
        ? `已确认 ${result.todos.length} 条草案成单。`
        : '这批草案已整批丢弃。',
    );
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}
