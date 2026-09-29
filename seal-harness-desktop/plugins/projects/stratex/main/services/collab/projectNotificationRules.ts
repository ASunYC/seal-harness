import { z } from 'zod';

import type { ProjectEvent } from '../../../shared/protocol/project-collab.js';
import {
  PROJECT_REVIEW_STATUSES,
  type ProjectNotificationReason,
} from '../../../shared/protocol/project-notifications.js';

/**
 * 「这条事件值不值得打扰用户」的**纯判定**（G-6）。
 *
 * 判定与副作用分家：本文件不碰 Electron、不碰设置、不碰窗口焦点，只回答
 * 「按事件内容该不该弹、弹哪一类」。副作用（开关/前后台/角标/弹窗）在
 * `projectNotificationService.ts`。
 *
 * 【负载是不可信输入】服务端事件负载在客户端契约里是**不透明透传**
 * （`ProjectEventSchema` 的 `payload: z.json()`），形状归线协议管。所以这里
 * 逐字段 safeParse、缺字段一律按「不打扰」处理——**判不出来就不弹**，
 * 而不是拿默认值凑一个。误弹的代价是用户关掉开关，等于整个能力作废。
 *
 * 【只打扰两类】
 *  ① 讨论/动态里 @ 了我；
 *  ② 我名下待办被指派/流转，或我派发的单进入待验收。
 * 其余域事件（文件变更、项目改名、成员进出、他人的待办动静）一律不弹。
 *
 * 【不给自己发通知】三条规则都排除 `actor === 我`：自己刚做完的动作再弹一条
 * 系统通知是纯噪音。
 */

/** @ 提及可能出现的三种载体（讨论 + 动态 + 评论）。 */
const MENTION_EVENT_KINDS = new Set(['feed.created', 'feed.commented', 'chat.message']);

/**
 * 提及负载。
 *
 * ⚠️ **跨线契约**：`mentions` 由服务端 `domain.py::extract_mentions` 从 `refs` 里按
 * `member:` 前缀提出（G-9），只放 subject 列表，正文一个字不进事件面。前缀常量的
 * 两个端点是服务端 `MENTION_REF_PREFIX` 与共享契约 `PROJECT_REF_KIND_MEMBER`。
 * 字段名与服务端事件负载的 snake_case 口径一致。
 *
 * `feed.commented`（评论）目前没有 refs 写入面 ⇒ 该键缺席 ⇒ 判不出提及就不弹，
 * **不做兜底猜测**；评论支持 @ 的那天规则自动生效，不必回头改这里。
 */
const mentionPayloadSchema = z.object({
  author_subject: z.string().min(1).max(256).optional(),
  mentions: z.array(z.string().min(1).max(256)).max(200).optional(),
});

/**
 * 待办变更负载（服务端 `todo.changed`）。
 *
 * `previous_*` 只在 `reason='updated'` 时出现；`created` 事件没有前值；`reason='deleted'`
 * 事件携整棵子树的 `ids`（客户端收到即从看板移除并重取）。全是 id 类元数据与状态枚举
 * ——不含标题、描述与任何正文（事件面红线）。
 */
const todoPayloadSchema = z.object({
  reason: z.string().max(64).optional(),
  actor_subject: z.string().min(1).max(256).optional(),
  creator_subject: z.string().min(1).max(256).nullish(),
  assignee_subject: z.string().min(1).max(256).nullish(),
  previous_assignee_subject: z.string().min(1).max(256).nullish(),
  status: z.string().max(64).optional(),
  previous_status: z.string().max(64).nullish(),
  // 删除事件携整棵子树的 id 全集。⛔ **不设数组长度上界**：一棵需求树可远超批量根上限，
  // 给它封顶会把一次删大树的正常事件误判成坏帧丢弃（本分支刚因过期上界出过整页故障）。
  ids: z.array(z.string().min(1).max(256)).optional(),
});

/**
 * 拆解草案负载（服务端 `todo.draft`）。
 *
 * ⛔ 全是 id 与计数：**草案标题不在这里，也不该在这里**——草案是半成品，而系统
 * 通知会出现在锁屏上。要显示「哪个需求」，客户端拿 `source_todo_id` 去查它已有的
 * 清单，正文一个字不经过事件面。
 */
const draftPayloadSchema = z.object({
  batch_id: z.string().min(1).max(64).optional(),
  source_todo_id: z.string().min(1).max(64).nullish(),
  draft_count: z.number().int().nonnegative().max(1000).optional(),
  actor_subject: z.string().min(1).max(256).optional(),
});

export interface ProjectNotificationDecision {
  readonly reason: ProjectNotificationReason;
  readonly projectId: string;
}

/**
 * 判定一条项目组事件是否值得弹系统通知。
 *
 * @param event 已过 `ProjectEventSchema` 的事件帧（连接状态帧直接返回 null）。
 * @param mySubject 当前账号在协作服务端的身份主体；null＝身份不明 ⇒ 一律不弹
 *   （判不出「是不是找我」就不打扰，也避免换账号窗口期把上一个账号的事弹给下一个）。
 */
export function decideProjectNotification(
  event: ProjectEvent,
  mySubject: string | null,
): ProjectNotificationDecision | null {
  if (mySubject === null || mySubject.length === 0) return null;
  if (event.kind === 'connection') return null;

  if (MENTION_EVENT_KINDS.has(event.kind)) {
    return decideMention(event.kind, event.projectId, event.payload, mySubject);
  }
  if (event.kind === 'todo.changed') {
    return decideTodo(event.projectId, event.payload, mySubject);
  }
  if (event.kind === 'todo.draft') {
    return decideDraft(event.projectId, event.payload, mySubject);
  }
  return null;
}

/**
 * ③ 有人从我建的需求拆出了一批草案。
 *
 * ⚠️ **收件人不由这里判**：服务端已经给每个可见者各写了一行定向事件，第三个人
 *    连事件都读不到。这里只剩「值不值得打扰」这一问——所以**不要**在这里重算
 *    一遍可见性，重算一份判据就是给它一次与服务端漂移的机会。
 *
 * 排除 `actor === 我`：拆解是我自己在会话里让助理做的，屏幕上正在流式打印，
 * 再弹一条系统通知是纯噪音。我那份「有几条待审」由需求行徽标承载。
 */
function decideDraft(
  projectId: string,
  payload: unknown,
  mySubject: string,
): ProjectNotificationDecision | null {
  const parsed = draftPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.actor_subject === mySubject) return null;
  if ((parsed.data.draft_count ?? 0) <= 0) return null;
  return { reason: 'draftsReady', projectId };
}

function decideMention(
  _kind: string,
  projectId: string,
  payload: unknown,
  mySubject: string,
): ProjectNotificationDecision | null {
  const parsed = mentionPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { author_subject: author, mentions } = parsed.data;
  if (author === mySubject) return null;
  if (!mentions?.includes(mySubject)) return null;
  return { reason: 'mention', projectId };
}

function decideTodo(
  projectId: string,
  payload: unknown,
  mySubject: string,
): ProjectNotificationDecision | null {
  const parsed = todoPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (data.actor_subject === mySubject) return null;
  // 删除是 `todo.changed` 的一种（`reason:'deleted'`，携子树 ids）：客户端收到即从看板
  // 移除并重取，但删除本身**不弹系统通知**——它既不是「派到我名下」也不是「进待验收」。
  // ⛔ 早返回必须在派单/验收两支**之前**：删除事件可能携带 assignee/creator 一类字段，
  //    漏了这道闸就会让一次删除被误判成 assigned/reviewRequested。这就是「与既有 changed
  //    分支合流、受众与既有一致、不新增广播面」的落点。
  if (data.reason === 'deleted') return null;
  const created = data.reason === 'created';

  // ② -a 待办落到我名下：新建时直接派给我，或更新把处理人**换成**了我。
  // 更新事件必须带上前值才判——「更新后是我」单独说明不了这次改的是处理人，
  // 拿它当判据会让「我名下待办的任何一次改动」都弹一条（判不出来就不弹）。
  if (data.assignee_subject === mySubject) {
    if (created) return { reason: 'assigned', projectId };
    const previous = data.previous_assignee_subject;
    if (previous !== undefined && previous !== mySubject) {
      return { reason: 'assigned', projectId };
    }
  }

  // ② -b 我派发的单进入待验收：状态**变**进待验收集合才算（停在该状态的其他
  // 改动不重复弹）。新建即待验收不可能由他人代我派单触发，故只判更新。
  if (
    !created &&
    data.creator_subject === mySubject &&
    typeof data.status === 'string' &&
    PROJECT_REVIEW_STATUSES.includes(data.status) &&
    data.previous_status !== undefined &&
    data.previous_status !== data.status
  ) {
    return { reason: 'reviewRequested', projectId };
  }
  return null;
}
