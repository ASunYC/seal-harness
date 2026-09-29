import { projectTodoWriteServerCodeText } from '@shared/protocol/project-collab.js';
import type {
  ProjectCollabErrorCode,
  ProjectRequirementClaimRequest,
  ProjectTodoCreateRequest,
  ProjectTodoUpdateRequest,
  Todo,
} from '@shared/protocol/project-collab.js';
import { projectTodoPlanDatesServerCodeText } from '@shared/protocol/project-collab-plan-dates.js';

import {
  projectCollabErrorNotice,
  projectCollabErrorText,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import {
  refreshRequirementPage,
  type ProjectRequirementPageHost,
} from './projectCollabRequirementPage';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/** 看板域动作（列表/新建/乐观锁更新）。域文件形态见 `projectCollabFeed.ts` 注释。 */
export type ProjectBoardHost = ProjectDomainHost &
  ProjectRequirementPageHost &
  Pick<ProjectCollabState, 'todos' | 'todosLoading' | 'todosError' | 'activeProjectId'>;

/** 单页上限（协议 max 50）；翻页页数封顶，防一个失控的游标把渲染层拖进死循环。 */
const TODO_LIST_PAGE_LIMIT = 50;
const TODO_LIST_MAX_PAGES = 40;

/**
 * 看板全量取数——**必须翻到最后一页**。
 *
 * 服务端列表是游标分页（缺省 30 条、最多 50 条）；此前只取第一页就当全量，项目一超过一页，
 * 后面的子需求/任务根本没进 store：树上那些行明明带着服务端算的「0/13」子项进度，却没有
 * 展开箭头（2026-09-08 现场，两百多条）。翻页封顶 40 页（2000 条），到顶即按已取到的部分
 * 呈现并如实标记出错，不静默截断。
 */
export async function loadTodos(host: ProjectBoardHost, projectId: string): Promise<void> {
  if (host.requirementPageActive) return refreshRequirementPage(host, projectId);
  const epoch = host.projectEpoch;
  host.todosLoading = true;
  try {
    const collected: ProjectBoardHost['todos'][number][] = [];
    let cursor: string | undefined;
    for (let page = 0; page < TODO_LIST_MAX_PAGES; page += 1) {
      const result = await projectCollabApi.todoList({
        projectId,
        limit: TODO_LIST_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      if (epoch !== host.projectEpoch) return;
      if (!result.ok) {
        host.todosError = projectCollabErrorNotice(result.code);
        return;
      }
      collected.push(...result.todos);
      if (!result.hasMore || result.nextCursor === null) {
        host.todos = collected;
        host.todosError = null;
        return;
      }
      cursor = result.nextCursor;
    }
    // 翻到封顶仍有下一页：把已取到的摆出来，但如实说明列表不完整。
    host.todos = collected;
    host.todosError = projectCollabErrorNotice('transient');
  } catch {
    if (epoch === host.projectEpoch) host.todosError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.todosLoading = false;
  }
}

/**
 * 待办写入（新建 / 修改 / 认领）失败的提示：服务端业务码认得出就就地覆盖通用句，编号照旧取失败分档的那一个。
 *  - 日期类（`start_requires_due` / `invalid_date_range`，CORE-08，ADR-0042）：与编辑框就地提示逐字相同的那一句；
 *  - 写路径守卫类（观察者不能承接、需求不能派给助理、已被他人认领…）：`projectTodoWriteServerCodeText`。
 * 两张表的码不相交；都认不出退回按通用码取的句子。
 */
function todoWriteFailureNotice(
  code: ProjectCollabErrorCode,
  serverCode: string | undefined,
): ProjectCollabNotice {
  return projectCollabErrorNotice(
    code,
    projectTodoPlanDatesServerCodeText(serverCode) ??
      projectTodoWriteServerCodeText(serverCode) ??
      undefined,
  );
}

export async function createTodo(
  host: ProjectBoardHost,
  request: ProjectTodoCreateRequest,
): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoCreate(request);
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = todoWriteFailureNotice(result.code, result.serverCode);
      return false;
    }
    host.todos = [...host.todos, result.todo];
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/**
 * 乐观锁更新。409（版本冲突）不算普通失败：提示「已被他人更新」并立即重取，
 * 让用户在新版本上重下决定——绝不拿旧版本重试。返回三态给调用方：
 * 编辑弹层据此决定「关（ok/conflict，旧快照已失效）还是留（error，别丢用户输入）」。
 */
export async function updateTodo(
  host: ProjectBoardHost,
  request: ProjectTodoUpdateRequest,
): Promise<'ok' | 'conflict' | 'error'> {
  return (await updateTodoDetailed(host, request)).outcome;
}

export type TodoUpdateOutcome =
  | { readonly outcome: 'ok'; readonly todo: Todo }
  | { readonly outcome: 'conflict' | 'error'; readonly todo: null };

/** 保留本次写入响应，避免后续刷新将第三方版本误认成本次成功版本。 */
export async function updateTodoDetailed(
  host: ProjectBoardHost,
  request: ProjectTodoUpdateRequest,
): Promise<TodoUpdateOutcome> {
  const projectId = host.activeProjectId;
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoUpdate(request);
    if (epoch !== host.projectEpoch) return { outcome: 'error', todo: null };
    if (!result.ok) {
      // 改单把无主协同需求设成本人 ＝ 认领（负责人 2026-09-14 拍板），输了认领的一方服务端回 409
      // `requirement_already_claimed`。它和版本冲突同在 conflict 分档，却**不是**可自愈的冲突：
      // ⛔ 不说「已为你刷新」、⛔ 不当成功——与 `claimRequirement` 同一句真实失败，回 'error'
      // （编辑框留在原地，批量计入未成功）。必须排在下面通用 conflict 分支之前。
      if (result.serverCode === 'requirement_already_claimed') {
        host.actionNotice = todoWriteFailureNotice(result.code, result.serverCode);
        return { outcome: 'error', todo: null };
      }
      // ⚠️ 409 不只版本冲突一种：新测试模式下在测需求改成已取消回 `test_round_in_progress`（TST-02）。
      //    认得出的业务码先就地说清原因、回 error（⛔ 不自愈重取——重取之后再改一次照样被拒）。
      if (
        result.code === 'conflict' &&
        projectTodoWriteServerCodeText(result.serverCode) === null
      ) {
        // 冲突已就地自愈（下面立刻重取），用户无需上报 ⇒ 回执不带参考编号。
        //
        // ⚠️ **这一条留常驻，⛔ 不走 toast**（判据见 `projectCollabReceipts.ts`）。
        // 措辞像在报告一件做完的事（「已为你刷新」），但它把球踢回去了：用户刚才那次
        // 编辑**没保存上**，弹层已经关掉，他手上的判断建立在被顶掉的那份旧数据上——
        // 接下来必须回到新版本重下一次决定。让这句话 3 秒后自己消失，等于把一次
        // 没落地的写入伪装成静默成功。同一件事的另一半（工作单 409）本来就是常驻，
        // 两处形态也必须一致。
        host.actionNotice = projectCollabInfoNotice('该待办已被他人更新，已为你刷新到最新版本。');
        if (projectId) await loadTodos(host, projectId);
        return { outcome: 'conflict', todo: null };
      }
      // 转交 / 派单被拒的真实原因（观察者不能承接、需求不能派给助理…）与起止成对被拒
      // 的那一句，都就地覆盖通用句；编号照旧取失败分档的那一个（见 `todoWriteFailureNotice`）。
      host.actionNotice = todoWriteFailureNotice(result.code, result.serverCode);
      return { outcome: 'error', todo: null };
    }
    host.todos = host.todos.map((todo) => (todo.id === result.todo.id ? result.todo : todo));
    return { outcome: 'ok', todo: result.todo };
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return { outcome: 'error', todo: null };
  }
}

/**
 * 认领无主需求并写计划日期（FLOW-02）。与 `updateTodo` **刻意不同**：认领的 409
 * （已被他人认领）**不是可自愈的版本冲突**——它是一次真实失败，调用方据此保留一条真实
 * 失败提示、请用户换一条需求，⛔ 绝不伪成功（显示成功再被下次刷新默默纠正是最糟形态）。
 *
 * 成功：把认领后的需求并进/替换进 `todos`（于是它出现在「我的任务页」assignee 筛选里），
 * 回 'ok'；失败：设一条真实失败提示，回 'error'（弹层据此保留、不关、不当成功）。
 */
export async function claimRequirement(
  host: ProjectBoardHost,
  request: ProjectRequirementClaimRequest,
): Promise<'ok' | 'error'> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.requirementClaim(request);
    if (epoch !== host.projectEpoch) return 'error';
    if (!result.ok) {
      // ⛔ 认领的 conflict ≠ 改单的 conflict：这里**不自愈、不当成功**。已被他人认领要让
      //    用户看见一条真实失败（而不是「已为你刷新」那种把没落地的写伪装成完成的话术）。
      host.actionNotice = todoWriteFailureNotice(
        result.code,
        result.code === 'conflict' ? 'requirement_already_claimed' : result.serverCode,
      );
      return 'error';
    }
    host.todos = host.todos.some((todo) => todo.id === result.todo.id)
      ? host.todos.map((todo) => (todo.id === result.todo.id ? result.todo : todo))
      : [...host.todos, result.todo];
    return 'ok';
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return 'error';
  }
}

/**
 * 删除结果三态给调用方（确认弹层）决定接下来怎么办：
 *  - `ok:true`     删成了（就地摘除子树），或单根幂等（它确已不在，静默摘掉那行）；
 *  - `realigned`   多根整批事务里有一条已不在 ⇒ 一条都没删，已重取列表对齐，选中集已陈旧；
 *  - 其余 `ok:false` 普通失败（403/网络等），`message` 是固定分档文案，弹层就地展示可重试。
 */
export type TodoDeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly realigned: boolean; readonly message: string };

/**
 * 软删若干**根** id 及其整棵子树（manager+，服务端强判）。
 *
 * ⚠️ 单条与批量端点的失败语义**不对称**（协议 `ProjectTodoDeleteResultSchema` 注释）：
 *  - 单根（`ids` 恰一个）走 `DELETE /todos/{id}`，幂等——`todo_not_found` 即「它确已不在」，
 *    静默把那行摘掉、不弹错、当成功；
 *  - 多根走 `delete-batch`，整批事务——`todo_not_found` 意味着**一条都没删**（服务端回滚），
 *    ⛔ 不可据此摘任何一行，改为重取列表对齐。
 *
 * 成功后**按服务端权威 `deletedIds` 就地摘除**整棵子树——⛔ 不本地数子树（服务端按看的人算，
 * 本地那份列表不等于它）。父项进度计数随后由 `todo.changed` 事件驱动的重取校正。
 */
export async function deleteTodos(
  host: ProjectBoardHost,
  projectId: string,
  ids: readonly string[],
): Promise<TodoDeleteResult> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.todoDelete({ projectId, ids: [...ids] });
    if (epoch !== host.projectEpoch) {
      return { ok: false, realigned: false, message: projectCollabErrorText('transient') };
    }
    if (!result.ok) {
      if (result.serverCode === 'todo_not_found') {
        if (ids.length === 1) {
          // 单根幂等：它确已不在，静默摘掉该行（不弹错、不留回执），当成功。
          const [rootId] = ids;
          host.todos = host.todos.filter((todo) => todo.id !== rootId);
          return { ok: true };
        }
        // 多根整批事务：一条都没删，重取对齐——⛔ 别摘行（否则与服务端脱同步）。
        await loadTodos(host, projectId);
        host.actionNotice = projectCollabInfoNotice('清单有变化，已刷新到最新，请重新选择后再试。');
        return {
          ok: false,
          realigned: true,
          message: '清单有变化，已刷新到最新，请重新选择后再试。',
        };
      }
      return { ok: false, realigned: false, message: projectCollabErrorText(result.code) };
    }
    const removed = new Set(result.deletedIds);
    host.todos = host.todos.filter((todo) => !removed.has(todo.id));
    // 纯报告：删掉的行当场就消失了，没把球踢回给用户 ⇒ 3 秒 toast。条数以服务端权威 count 为准。
    pushProjectCollabReceipt(`已删除 ${String(result.count)} 条需求/任务。`);
    return { ok: true };
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return { ok: false, realigned: false, message: projectCollabErrorText('transient') };
  }
}

/** 「能不能改这条」要读的待办字段（判据见 `canEditTodo`）。 */
export type TodoEditGateFields = Pick<
  Todo,
  'assigneeSubject' | 'assigneeKind' | 'visibility' | 'itemKind' | 'parentId'
>;

/**
 * 任务所属需求（沿 `parentId` 上溯到的**最近**一条需求）的处理人——与服务端
 * `repository_todo_access.nearest_requirement_assignee` 同口径。
 *
 * 需求行、旧孤立任务、祖先不在手上（没取到那一页）一律 null：判不出就不假装是我的。
 */
export function nearestRequirementAssignee(
  todo: Pick<Todo, 'itemKind' | 'parentId'>,
  todosById: ReadonlyMap<string, Todo>,
): string | null {
  if (todo.itemKind !== 'task') return null;
  const seen = new Set<string>();
  let parentId = todo.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = todosById.get(parentId);
    if (parent === undefined) return null;
    if (parent.itemKind === 'requirement') return parent.assigneeSubject;
    parentId = parent.parentId;
  }
  return null;
}

/**
 * 「这张卡我能不能编辑」（G-11）——与服务端 `todo_patch_decision` 同一判据
 * （D-MODEL-01 第六节「动作 → 允许身份集合」，测试提单 2554）：
 *
 *  - 个人条目：只有创建者看得见，创建者可改；
 *  - 协同条目：manager 及以上 ∪ 对象级负责人——
 *      需求 ＝ 添加人 ∪ 处理人；任务 ＝ 执行人 ∪ 所属需求处理人；助理档 ＋ 派单人。
 *
 * ⛔【处理人为空不再等于谁都能改】此前 `assigneeSubject === null` 直接放行任何成员。
 *    服务端已按上面的集合收紧；客户端判得出的部分跟着收紧——**未分配的成员档任务**
 *    只有所属需求处理人（与管理者）能改，别人点开保存时才撞 403 的那类按钮收掉。
 *
 * ⚠️【判不出的那一半留给服务端】线协议的待办投影里**没有添加人**（`creator_subject` 进
 *    REST 投影归 CORE-06「添加人与完整标识贯通授权读模型」，本项不顺手打开）。于是
 *    需要「我是不是添加人 / 派单人」才判得出的两类——**未分配（含助理档）的需求**、
 *    **助理档任务**——这里照旧放行，由服务端按令牌判 403。
 *    ⛔ 别为了收窄拿别的字段近似添加人（把处理人当添加人会挡住真正的添加人，
 *    而添加人恰恰是改自己刚建的未分配需求最常见的那个人）。
 *    ⇒ CORE-06 把添加人接进 `Todo` 之后，这两支应收紧成「且我是添加人」。
 *
 * ⚠️ 这是**入口收窄**，不是权限：服务端仍按令牌强判 403。收窄的意义是别给用户
 * 一个点了必错的按钮。
 *
 * ⚠️ 第二个判据是 `canTransfer` 而**不是** `isOwner`：加 `manager` 那档时才发现，
 * 写成 `isOwner` 的地方混着两类问题——「谁是拥有者」和「谁能做这件事」。前者加角色
 * 时不该动，后者该动，而字符串比较**编译期一处也拦不住**（实测加一档角色只炸出
 * 一处 `Record<ProjectRole, …>`）。⛔ 别改回 `isOwner`。
 *
 * `mySubject` 为 null（身份暂不可得）时判不出「处理人 / 所属需求处理人是不是我」，
 * 这两支一律不成立——判不出「是不是我的」就不假装是我的。
 */
export function canEditTodo(
  todo: TodoEditGateFields,
  options: {
    readonly canWrite: boolean;
    /** manager 及以上：项目级负责人，协同条目一律可改。 */
    readonly canTransfer: boolean;
    readonly mySubject: string | null;
    /** 任务所属需求的处理人（`nearestRequirementAssignee`）；非任务或取不到为 null。 */
    readonly requirementAssigneeSubject: string | null;
  },
): boolean {
  if (!options.canWrite) return false;
  /*
   * 个人条目：创建者恒可改，**不看处理人是谁**——照抄服务端第一支
   * （`personal ⇒ 'self'`，在负责人闸之前）。
   *
   * 此前少了这一支，症状很窄但一旦发生就是**死局**：个人条目按定义只有创建者看得见，
   * 所以被自己客户端锁住的那个人**就是唯一能操作它的人**——没有任何拥有者能替他改，
   * 他也没有别的出路。窄 ≠ 可忽略：发生概率低，但发生时脱困概率是 0。
   *
   * ⚠️ 判据只看 `visibility`，**没有**「我是不是创建者」那一半——`Todo` 上没有创建者字段。
   * 这一支的正确性依赖一个**外部前提**：服务端的列表闸只把个人条目发给它的创建者。
   * ⇒ 若哪天 `Todo` 补了创建者字段（CORE-06），这一支应当收紧成「且我是创建者」。
   */
  if (todo.visibility === 'personal') return true;
  if (options.canTransfer) return true;
  const me = options.mySubject;
  if (me !== null && todo.assigneeSubject === me) return true;
  if (todo.itemKind === 'requirement') {
    // 未分配（含助理档旧行）的需求：添加人可改，判不出 ⇒ 放行交服务端判。
    // 他人名下的需求：添加人同样可改，但此前这一档就不给成员入口，维持不放。
    return todo.assigneeSubject === null;
  }
  if (me !== null && options.requirementAssigneeSubject === me) return true;
  // 助理档任务：派单人可改，判不出 ⇒ 放行交服务端判。成员档任务到这里一律不放。
  return todo.assigneeKind === 'assistant';
}
