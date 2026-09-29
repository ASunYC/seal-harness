import { z } from 'zod';

/**
 * 项目组桌面系统通知（G-6）的两端契约。
 *
 * 产品承诺的三级触达是「应用内未读 → 桌面系统通知 → 企微外送」。本文件管中间那级：
 * 主进程在**需要打扰**的事件到达时弹一条系统通知 + 更新未读角标。
 *
 * ⚠️ 三条红线由本文件结构性承载：
 *
 *  1. 【正文不出站】通知标题与正文是**固定中性文案**（`PROJECT_NOTIFICATION_COPY`），
 *     契约里**没有**任何自由文本字段——调用方即便想把消息正文塞进通知也没有位置放。
 *     系统通知中心是操作系统持有的落地面（Windows 会留存在「通知中心」里），
 *     正文进去就等于把项目正文抄送给了客户端之外的系统面。项目名同理不带。
 *  2. 【只打扰两类】`ProjectNotificationReason` 是闭集：被 @ 提及、待办指派给我、
 *     我派发的单进入待验收。其余域事件一律只更新应用内未读，不弹系统通知——
 *     全弹＝骚扰＝用户第一天就把开关关掉，等于没做。
 *  3. 【白标】标识符、注释与文案一律中性词，不含内核品牌词根。
 */

/** 打扰理由闭集。新增一类必须同时给出中性文案，`Record` 穷尽性由类型强制。 */
export const ProjectNotificationReasonSchema = z.enum([
  /** 讨论/动态里 @ 了我。 */
  'mention',
  /** 待办被指派/流转到我名下。 */
  'assigned',
  /** 我派发的待办进入待验收，等我处理。 */
  'reviewRequested',
  /** 有人从我建的需求拆出了一批草案，等我审阅。 */
  'draftsReady',
]);

export type ProjectNotificationReason = z.infer<typeof ProjectNotificationReasonSchema>;

/**
 * 系统通知的固定中性文案。
 *
 * ⛔ 这张表是**唯一**的文案来源，且逐条都不含消息内容、项目名与人名。要改文案改这里，
 * 不要在调用点拼串——拼串是正文泄进通知中心的最短路径。
 */
export const PROJECT_NOTIFICATION_COPY: Readonly<
  Record<ProjectNotificationReason, { readonly title: string; readonly body: string }>
> = Object.freeze({
  mention: Object.freeze({ title: '项目组', body: '有新的@提及' }),
  assigned: Object.freeze({ title: '项目组', body: '有待办指派给你' }),
  reviewRequested: Object.freeze({ title: '项目组', body: '有待办等你验收' }),
  /*
   * ⚠️ 这里**刻意不带条数、不带需求名**，与上面三条同规矩。
   *
   * 通知会出现在锁屏上，而这张表的红线（本文件头 ①）是「正文、项目名、人名一律不进」；
   * 需求标题就是项目正文。条数虽不是正文，但要带上它就得在调用点拼串，而拼串正是
   * 正文泄进通知中心的最短路径——为一个数字开这道口子不划算。
   *
   * 「〈某需求〉拆出 N 条草案待审阅」这句话有它的位置：**应用内**的需求行徽标
   * （`TodoDraftBadge`）。那里既没有锁屏，也拿得到权威的需求标题。
   */
  draftsReady: Object.freeze({ title: '项目组', body: '有拆解草案等你审阅' }),
});

/**
 * 「待验收」状态集合。
 *
 * 目前服务端 `todos.status` 闭集是 notStarted/inProgress/done/cancelled，`inReview`
 * 由工作单机制（技术落地方案第二部分 §2.1，迁移 `0006_worklist.sql`）引入。
 * 这里先按目标态收口：迁移落地当天本规则自动生效，不需要回头改判定。
 */
export const PROJECT_REVIEW_STATUSES: readonly string[] = Object.freeze(['inReview']);

/** 桌面通知开关（用户可关，默认开）。 */
export const ProjectNotificationSettingsSchema = z.strictObject({
  desktopNotifications: z.boolean(),
});
export const ProjectNotificationSettingsUpdateSchema = ProjectNotificationSettingsSchema;

/**
 * `project:notification-navigate`：点击系统通知后 Main → 渲染层的导航请求。
 *
 * 只带 projectId——落到哪个页面由渲染层的路由决定，Main 不表达界面结构。
 */
export const ProjectNotificationNavigateSchema = z.strictObject({
  projectId: z.string().uuid(),
});

export type ProjectNotificationSettings = z.infer<typeof ProjectNotificationSettingsSchema>;
export type ProjectNotificationSettingsUpdate = z.infer<
  typeof ProjectNotificationSettingsUpdateSchema
>;
export type ProjectNotificationNavigate = z.infer<typeof ProjectNotificationNavigateSchema>;
