import { isTodoWorkOrder, todoAcceptanceProgress } from '@shared/protocol/project-collab.js';
import type {
  Todo,
  TodoAcceptanceItem,
  TodoDraft,
  TodoDraftBatch,
} from '@shared/protocol/project-collab.js';

/**
 * 工作单面的**入口收窄判据与文案**——「这张单现在能做什么」只有这一份。
 *
 * ⚠️ 全部是**入口收窄不是权限**：服务端逐条强判（推不进待验收要同时交完成记录、
 * 通过要清单全勾、打回要带理由、执行方不能自证验收），这里只负责不摆一个点了
 * 必错的按钮。⛔ 别把这里的放行读成「服务端会放行」。
 */

/** 完成记录两类条目的中文名（执行方的自述 / 派单方的打回理由）。 */
export const COMPLETION_ENTRY_LABELS = {
  completion: '完成记录',
  rejection: '打回原因',
} as const;

/** 逐条自述那一栏的说明——问的是「怎么满足的」，不是「做了什么」。 */
export const ACCEPTANCE_NOTE_PLACEHOLDER = '这条我是怎么满足的、证据在哪';

/** 「做了什么」必填的原因，写成一句用户读得懂的话。 */
export const COMPLETION_SUMMARY_HINT = '交待清楚做了什么、产出在哪——验收人只能看到这些。';

/** 打回理由必填：不写理由的打回等于让执行方猜。 */
export const REJECT_REASON_REQUIRED_HINT = '打回必须写清哪里不满足，否则执行方只能猜。';

/** 有验收清单的单不给「直接标完成」这条路，界面上说清替代路径在哪。 */
export const WORK_ORDER_NO_DIRECT_DONE_HINT =
  '这张单有验收清单：完成要先提交待验收，再由派单人认可。';

/** 执行方不能给自己的活盖章（服务端第二道闸，这里同口径收窄入口）。 */
export const SELF_REVIEW_BLOCKED_HINT = '不能验收自己承接的工作单。';

/** 草案是半成品：说清它现在还不在正式清单里。 */
export const DRAFT_NOT_YET_TODO_HINT = '草案还不是任务：确认之后才会进清单，丢弃则一条都不生成。';

/**
 * 「助手补的假设」那枚标记。
 *
 * ⚠️ 这句话的措辞是**行动指令**而不是分类名：写「假设」只说了它是什么，写「你没提，
 *    我按常见做法补的」才说得出该拿它怎么办——审阅的人要知道这几条得自己过一遍。
 */
export const DRAFT_ASSUMED_BADGE_TEXT = '助手补的';
export const DRAFT_ASSUMED_HINT = '你的输入里没有这一条，是助手按常见做法补的——请重点核对。';

/** 单条草案的三档状态中文名。 */
export const DRAFT_STATE_LABELS: Readonly<Record<TodoDraft['state'], string>> = {
  pending: '待审阅',
  accepted: '已成单',
  dropped: '已剔除',
};

/** 一张工作单的验收进度文案（`3 / 5 条已勾`）。非工作单不该调到这里。 */
export function acceptanceProgressText(todo: Pick<Todo, 'acceptanceTotal' | 'acceptanceChecked'>): {
  readonly total: number;
  readonly checked: number;
  readonly text: string;
} {
  const { total, checked } = todoAcceptanceProgress(todo);
  return { total, checked, text: `${checked} / ${total} 条已勾` };
}

/**
 * 「这张单能不能提交待验收」。
 *
 * 三个条件缺一不可：它是工作单（有判据才谈得上验收）、对象级可写（与卡上下拉、
 * 拖拽同一个 `canEditTodo`）、当前在可提交档（服务端 `TODO_SUBMITTABLE_STATUSES`
 * ＝未开始 / 进行中）。
 *
 * ⛔ 普通待办不给这个入口：它没有判据，提交待验收只会造出一个没人知道该看什么的
 * 缓冲档；普通待办照旧可以直接标完成，行为与迁移 0009 之前逐字一致。
 */
export function canSubmitWorkOrder(
  todo: Pick<Todo, 'acceptanceTotal' | 'status'>,
  options: { readonly canEdit: boolean },
): boolean {
  if (!isTodoWorkOrder(todo)) return false;
  if (!options.canEdit) return false;
  return todo.status === 'notStarted' || todo.status === 'inProgress';
}

/**
 * 「这张单我能不能验收 / 打回」。
 *
 * 服务端两道闸：① 只有**派单人（建单人）或项目拥有者**能验收；② 执行方
 * （处理人）不能自证验收。
 *
 * ⚠️ 客户端只收窄得了第 ② 道：`Todo` 投影里**没有建单人**这一列（列表出参不带
 * `creatorSubject`），所以「我是不是派单人」在渲染层判不出来。判不出的那一半留给
 * 服务端 403 —— ⛔ 别为了收窄而拿别的字段近似它（把处理人当派单人、把可写当可验收
 * 都会放行错的人，界面上却显得很确定）。
 */
export function canReviewWorkOrder(
  todo: Pick<Todo, 'status' | 'assigneeSubject'>,
  options: { readonly canWrite: boolean; readonly mySubject: string | null },
): boolean {
  if (!options.canWrite) return false;
  if (todo.status !== 'inReview') return false;
  return !isWorkOrderSelfReview(todo, options.mySubject);
}

/**
 * 「我就是这张单的执行方」——自证验收的那一档。
 * `mySubject` 缺席（身份暂不可得）时恒 false：判不出「是不是我」就不假装是我。
 *
 * ⚠️ **助理档（0010）下恒 false，这不是漏判**：派给助理的单处理人列为空，执行方是
 * 助理跑在谁账号上——那要看这张单最近一条完成记录的作者，而列表投影里没有完成记录。
 * 服务端在那一档按「谁把单推进待验收」判，并对派单人本人放行（那是正常链路）。
 * ⛔ 别在这里拿处理人以外的字段近似它：客户端连「我是不是派单人」都判不出
 * （投影里没有建单人），近似出来的收窄只会放行错的人却显得很确定。
 * 判不出的那一半留给服务端 403 —— 与本文件头注的「入口收窄不是权限」同一条纪律。
 */
export function isWorkOrderSelfReview(
  todo: Pick<Todo, 'assigneeSubject'>,
  mySubject: string | null,
): boolean {
  return mySubject !== null && todo.assigneeSubject !== null && todo.assigneeSubject === mySubject;
}

/**
 * 还没勾的判据。
 *
 * 通过要求清单**全部**勾选，服务端不满足时回的是一个计数（`pending_items`）；
 * 界面这一侧手上有逐条正文，所以把「还差哪几条」原样列出来，而不是丢一句
 * 「操作失败」让人回去自己数。
 *
 * @param checkedOrdinals 本次要一起提交的勾选（界面上刚勾的那些）。
 */
export function pendingAcceptanceItems(
  items: readonly TodoAcceptanceItem[],
  checkedOrdinals: readonly number[],
): readonly TodoAcceptanceItem[] {
  const staged = new Set(checkedOrdinals);
  return items.filter((item) => !item.checked && !staged.has(item.ordinal));
}

/**
 * 「这批草案是不是给我看的」——与服务端 `draft_batch_is_visible_to` 同一条判据。
 *
 * 可见集合**至多两人**：拆解发起方与派单方。比个人条目还窄一档——项目拥有者也
 * 看不见。草案是半成品；半成品对全组可见就等于它已经成了既成事实，而这道闸存在的
 * 全部理由就是不让它成为既成事实。
 *
 * ⚠️ 服务端已经按同一条判据过滤过（看不见的批次对外与「不存在」不可区分），这里
 * 是**第二道**：草案一旦漏到不该看的人眼前就再也收不回去，这类东西值得两侧各判一次。
 * `mySubject` 缺席（身份暂不可得）时恒 false ⇒ 什么都不显示——判不出「是不是给我看的」
 * 就不显示，与「本人」判据同一条 fail-safe。
 */
export function isDraftBatchVisibleTo(
  batch: Pick<TodoDraftBatch, 'createdBySubject' | 'dispatcherSubject'>,
  mySubject: string | null,
): boolean {
  if (mySubject === null) return false;
  if (batch.createdBySubject === mySubject) return true;
  return batch.dispatcherSubject !== null && batch.dispatcherSubject === mySubject;
}

/**
 * 「哪条需求下有几条草案在等我审阅」——需求行徽标的取数。
 *
 * 通知可能被错过（关了开关、当时不在电脑前、锁屏划掉了），徽标是那条闭环的另一半：
 * 事后回到这一页照样找得到。所以两者**判据必须同源**——都只认「我看得见的、还开着
 * 的批次里，状态仍为 pending 的那些条」。
 *
 * ⚠️ 无源批次（`sourceTodoId` 为空）不进这张表：它没有需求行可挂，
 *    由页顶那条横幅承载，⛔ 不要为它编一个归属。
 */
export function pendingDraftCountsBySourceTodo(
  batches: readonly TodoDraftBatch[],
  mySubject: string | null,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const batch of batches) {
    if (batch.state !== 'open') continue;
    if (!isDraftBatchVisibleTo(batch, mySubject)) continue;
    const sourceTodoId = batch.sourceTodoId;
    if (sourceTodoId === null) continue;
    const pending = batch.drafts.filter((draft) => draft.state === 'pending').length;
    if (pending === 0) continue;
    counts.set(sourceTodoId, (counts.get(sourceTodoId) ?? 0) + pending);
  }
  return counts;
}

/**
 * 「一共有几条草案在等我审阅」——会话内那张行动卡的取数。
 *
 * ⚠️ 它是 `pendingDraftCountsBySourceTodo` 的**投影**，不是第二份判据：同一支函数
 * 算出来的逐需求计数加起来而已。⛔ 别在卡片里另写一遍遍历——写第二份的那天起，
 * 「卡片说 3 条、点进去只有 2 条」就成了必然，而这类不一致查起来极贵。
 *
 * 无源批次（`sourceTodoId` 为空）随那支函数一起被排除：它没有需求行可挂，
 * 徽标与通知都不认它，行动卡也就不该认。
 */
export function pendingDraftTotal(
  batches: readonly TodoDraftBatch[],
  mySubject: string | null,
): number {
  let total = 0;
  for (const count of pendingDraftCountsBySourceTodo(batches, mySubject).values()) total += count;
  return total;
}

/** 需求行徽标文案。⛔ 不带草案标题——半成品不该在看板上先占一个说法。 */
export function pendingDraftBadgeText(count: number): string {
  return `${count} 条草案待审阅`;
}

/**
 * 会话内行动卡上那一行字。
 *
 * ⚠️ 与徽标**同词**（`pendingDraftBadgeText`）：同一件事在会话里和在需求行上必须叫
 * 同一个名字，否则用户会以为是两批东西。⛔ 同样不带草案标题（半成品 + 会出现在
 * 通知里，红线 2）。
 */
export const DRAFT_REVIEW_CARD_ACTION_LABEL = '去审阅';

export function draftReviewCardText(count: number): string {
  return pendingDraftBadgeText(count);
}
