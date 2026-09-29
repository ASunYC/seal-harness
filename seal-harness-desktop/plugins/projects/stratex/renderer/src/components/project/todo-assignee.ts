import { projectRoleAtLeast } from '@shared/protocol/project-collab.js';
import type {
  ProjectMember,
  Todo,
  TodoAssigneeKind,
  TodoItemKind,
} from '@shared/protocol/project-collab.js';

/**
 * 处理人（承接人）候选的取集合——纯函数，不碰 store、不碰 DOM。
 *
 * 服务端的转交闸（`scripts/collab-service/server/domain_todo_writes.py`）按下面三条拒绝，
 * 这里把**点了必被拒**的选项先收掉；判定仍在服务端，这里只是入口收窄：
 *
 *  ① 观察者只读，不能承接（400 `assignee_not_editor`，D-MODEL-01 第二节）；
 *  ② 需求不能派给项目助理（400 `requirement_assistant_forbidden`，工作单设计方案 §2.1）；
 *  ③ 转交给当前处理人是空操作（400 `assignee_unchanged`）——批量转交逐条跳过，
 *     编辑弹窗里当前处理人是**当前值**不是候选，原样保存时根本不发处理人字段。
 *
 * ⭐ 把未认领的协同需求设成**自己**不再被拒：负责人 2026-09-14 拍板「认领和手动变更需求人效力
 *    应该是一样的」，服务端按认领落库（认领审计 / 动态、并发只一人成功，输的一方 409
 *    `requirement_already_claimed`）。但它的前提是改得动这条需求（manager+、需求添加人）——
 *    判不出这一点的成员由 `todoSelfAssignNeedsClaimEntry` 改走认领入口。
 */

/**
 * 某位成员可以出现在处理人下拉里吗：在册且成员（editor）及以上。
 *
 * ⚠️ 当前处理人**例外保留**（`currentSubject`）：存量「处理人是观察者」的旧行打开编辑时，
 *    下拉里得有它才显示得出当前值；不改它原样保存不发处理人字段，服务端不会拒。
 */
export function todoAssigneeMemberOptions(
  members: readonly ProjectMember[],
  currentSubject: string | null,
): ProjectMember[] {
  return members.filter(
    (member) =>
      member.state === 'active' &&
      (projectRoleAtLeast(member.role, 'editor') ||
        (currentSubject !== null && member.subject === currentSubject)),
  );
}

/**
 * 处理人下拉里给不给「项目助理」这一档。
 *
 * 需求不给；⚠️ 存量「需求 + 助理档」旧行例外保留（当前值要显示得出来），用户改回成员档
 * 服务端照常放行，只是不能再派回助理。
 */
export function todoAssigneeOffersAssistant(
  itemKind: TodoItemKind,
  currentKind: TodoAssigneeKind | null,
): boolean {
  return itemKind !== 'requirement' || currentKind === 'assistant';
}

/**
 * 编辑框里「把这条需求设成我」要不要改走**认领入口**（口径 A，主会话 2026-09-14 定）。
 *
 * 服务端把「无主协同需求设成本人」按认领落库，但 2554 负责人闸不放宽：只有改得动这条需求的人
 * （manager+、需求添加人）经改单才走得通，其余成员改单一律 403、走认领端点。线协议的 `Todo` 投影里
 * **没有添加人**（归 CORE-06），客户端分不出一位非管理者成员是不是添加人——添加人点「我」会成功，
 * 非添加人点了必然 403。⇒ 对这些成员不给「我」，给认领入口：认领端点对任何成员都成立（永不 403），
 * 计划日期按现值预填，效果与改单自设一致。
 *
 * ⚠️ 选的是「给认领入口」而不是「禁用并写原因」：判不出添加人就写不出一句对所有人都成立的原因，
 *    禁用还会误拦本来改得通的添加人，而且只挡不给出路。
 * ⚠️ 代价：添加人（成员档）不能在编辑框里「设成自己 + 同时改别的字段」一次保存，得先认领。
 *    ⇒ CORE-06 把添加人接进 `Todo` 之后，这里应当对添加人放行（恢复「我」）。
 * manager+（`canTransfer`）一定改得动协同需求，照常给「我」。
 */
export function todoSelfAssignNeedsClaimEntry(
  todo: Pick<Todo, 'itemKind' | 'visibility' | 'assigneeKind' | 'assigneeSubject'> | null,
  canTransfer: boolean,
): boolean {
  return (
    todo !== null &&
    !canTransfer &&
    todo.itemKind === 'requirement' &&
    todo.visibility === 'shared' &&
    todo.assigneeKind === 'member' &&
    todo.assigneeSubject === null
  );
}

/**
 * 批量转交时这一条是不是已经在目标处理人名下（⇒ 不发，服务端会回 `assignee_unchanged`）。
 *
 * 批量下拉只有「成员 / 未分配」两类目标（没有项目助理），所以「已在目标名下」＝成员档且
 * 处理人等于目标；目标是未分配（null）时，只有成员档且处理人为空的那些才算已到位——
 * 助理档的处理人列也是空，但把它改成「未分配」是一次真实改派。
 */
export function todoAlreadyAssignedTo(
  todo: Pick<Todo, 'assigneeKind' | 'assigneeSubject'>,
  targetSubject: string | null,
): boolean {
  return todo.assigneeKind === 'member' && todo.assigneeSubject === targetSubject;
}
