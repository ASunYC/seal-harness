import {
  PROJECT_COLLAB_REFERENCE_CODES,
  projectOpenInvitationErrorText,
  type ProjectCollabErrorCode,
  type ProjectConnectionState,
} from '@shared/protocol/project-collab.js';

/**
 * 域事件的合帧窗（毫秒）。服务端一轮操作可能连发多帧（如待办流转 = todo.changed +
 * feed.created），按 `kind:projectId` 合并成一次重取，形态照 `workspace.ts` 的
 * FILES_CHANGED_COALESCE_MS 先例。
 */
export const PROJECT_EVENT_COALESCE_MS = 400;

/** 讨论/动态单页拉取条数（≤ 协议上界 200）。 */
export const PROJECT_CHAT_PAGE_SIZE = 50;
export const PROJECT_FEED_PAGE_SIZE = 30;

/**
 * 报错条/回执条的展示形态：文案 + 可选参考编号。
 *
 * 与 `LocalConversationNotice` 同形（`message` + 编号），报错条组件的用法也一样：
 * 有编号才渲染 `<ReferenceIdCopy>`。成功回执没有编号（`null`）。
 */
export interface ProjectCollabNotice {
  readonly message: string;
  /** 参考编号（`STRX-COLLAB-0xx`）；成功回执为 null。 */
  readonly referenceCode: string | null;
}

/**
 * 公开失败码 → 固定文案（契约要求不回显服务端文本）。
 * 集中一处，视图与各域动作不各自造句。
 *
 * 【措辞】文案里**不出现内部服务名**：用户看到的是「项目组」这个产品概念，
 * 「协作服务」是我们的部署单元，说给用户听等于让他去查一个他没有的东西。
 */
export function projectCollabErrorText(code: ProjectCollabErrorCode): string {
  switch (code) {
    case 'unavailable':
      return '项目组能力未启用。';
    case 'authRequired':
      return '请先登录后再使用项目组。';
    case 'invalidRequest':
      return '请求不合法，请刷新后重试。';
    case 'tooLarge':
      return '内容或文件超出大小上限。';
    case 'rateLimited':
      return '操作过于频繁，请稍后再试。';
    case 'conflict':
      return '数据已被他人更新，请刷新后重试。';
    // 带数字的那一句由 `projectFileQuotaNotice` 现场拼（触顶要说得出上限与已用量）；
    // 这一条是拿不到那两个数时的兜底，仍然指向配额而不是一句通用失败。
    case 'quotaExceeded':
      return '项目文件已达容量上限，请删除不再需要的文件后重试。';
    case 'credentialRejected':
      return '登录状态已失效，请重新登录。';
    case 'forbidden':
      return '没有执行该操作的权限。';
    case 'rejected':
      return '请求被服务端拒绝。';
    case 'writeFailed':
      return '文件保存到本地失败。';
    case 'transient':
    default:
      return '项目组暂时连不上，请稍后重试。';
  }
}

/**
 * 失败码 → 报错条（文案 + 参考编号）。渲染层的**唯一**失败展示工厂。
 *
 * 编号取共享协议的登记表，与 Main 的签发点同一张——用户报出来的号和我们日志里
 * 认得的号必须是同一个。
 *
 * @param overrideMessage 就地更贴切的说法（如撤回超时之于 `forbidden`）。
 *   只换文案，**编号照旧**：说法是给人看的，编号是给排查用的，两者不同步就白登记了。
 */
export function projectCollabErrorNotice(
  code: ProjectCollabErrorCode,
  overrideMessage?: string,
): ProjectCollabNotice {
  return {
    message: overrideMessage ?? projectCollabErrorText(code),
    referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
  };
}

/** 成功回执（无参考编号）。 */
export function projectCollabInfoNotice(message: string): ProjectCollabNotice {
  return { message, referenceCode: null };
}

/**
 * 开放邀请特有的**服务端业务码** → 报错条（就地覆盖通用文案）。
 *
 * 文案**唯一收口在共享层** `projectOpenInvitationErrorText`（三枚：关闭 / 满员 /
 * 角色不合法）——⛔ 渲染层不再手抄一份中文，改一处两端同改。业务码不是客户端失败
 * 分档（`ProjectCollabErrorCode`），没有 `STRX-COLLAB-0xx` 参考编号，故 `referenceCode`
 * 为 null（与成功回执同形）。认不出的码 / 缺席（`undefined`）一律返回 null，
 * 调用方退回通用失败文案。
 *
 * 载体：失败信封的可选 `serverCode`（`projectCollabErrorShape`）——网络面
 * `collabClient.failureFromResponse` 仅 4xx 时从 `{ "error": "<code>" }` 挑出、
 * IPC 失败体（`projectCollabHandlers.failureBody`）透传、store 的
 * `createInvitation` / `revokeInvitation` / `redeemInvitation` 原样带回。缺席即回落
 * 通用 `code` 文案（400/409/410 的通用桶 rejected/conflict）。
 */
export function projectOpenInvitationNotice(
  serverCode: string | null | undefined,
): ProjectCollabNotice | null {
  if (!serverCode) return null;
  const message = projectOpenInvitationErrorText(serverCode);
  return message === null ? null : { message, referenceCode: null };
}

/**
 * 临时文件配额触顶的报错条：**说清上限多少、现在用了多少**，并给出下一步。
 *
 * ⚠️ 这条不是「让文案更好听」：一句「上传失败」在这个场景下是错的诊断——
 * 用户会去查网络、查权限、换个文件重试，而真正该做的是把几个随手件转存或删掉。
 * `quota` 拿不到时退回固定文案（`projectCollabErrorText('quotaExceeded')`），
 * ⛔ 不编一个数出来。
 */
export function projectFileQuotaNotice(
  quota: { readonly limitBytes: number; readonly usedBytes: number } | null,
  formatBytes: (bytes: number) => string,
): ProjectCollabNotice {
  if (quota === null) return projectCollabErrorNotice('quotaExceeded');
  return projectCollabErrorNotice(
    'quotaExceeded',
    `项目文件已达容量上限（上限 ${formatBytes(quota.limitBytes)}，` +
      `已用 ${formatBytes(quota.usedBytes)}）。请删除不再需要的文件后再试。`,
  );
}

/**
 * 事件流连接状态 → 顶栏提示；`null` = 一切正常，不占位。
 *
 * 与失败文案同住一个模块，用户可见的项目组措辞只有这一处要看——
 * 措辞体检（`project-collab-copy.test.ts`）也就只需盯这一处。
 */
export function projectConnectionLabel(connection: ProjectConnectionState | null): string | null {
  if (connection === 'degraded') return '实时同步降级中，正在定时补拉';
  if (connection === 'offline') return '项目组同步已断开，内容可能不是最新';
  return null;
}

/**
 * 顶栏那枚圆点旁的**短**标签，与上面的长句分工：长句解释「发生了什么、会怎样」，
 * 短标签只答「现在是哪一档」。两处同屏时不重复长句。
 *
 * ⚠️ 这三档原先写死在 `ProjectDetailView.vue` 里——那正好绕过了本模块头注说的
 * 「用户可见的项目组措辞只有这一处要看」。项目列表页也要显示同一枚指示器，
 * 若各自抄一份，措辞体检就盯不住了。⇒ 归位到这里，两个视图共用。
 *
 * `null`（首帧尚无连接帧）按在线呈现：页面能打开即说明链路是通的。
 */
export function projectConnectionIndicatorLabel(connection: ProjectConnectionState | null): string {
  if (connection === 'degraded') return '同步降级中';
  if (connection === 'offline') return '同步已断开';
  return '实时同步中';
}
