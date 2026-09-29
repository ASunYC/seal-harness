import { basename } from 'node:path';

import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  ProjectAvailabilityRequestSchema,
  ProjectChatHistoryRequestSchema,
  ProjectChatHistoryResultSchema,
  ProjectChatRevokeRequestSchema,
  ProjectChatRevokeResultSchema,
  ProjectChatSendRequestSchema,
  ProjectChatSendResultSchema,
  ProjectCollabAvailabilitySchema,
  ProjectCommentPostRequestSchema,
  ProjectCommentPostResultSchema,
  ProjectCreateRequestSchema,
  ProjectCreateResultSchema,
  ProjectDetailRequestSchema,
  ProjectDetailResultSchema,
  ProjectFeedListRequestSchema,
  ProjectFeedListResultSchema,
  ProjectFeedPostRequestSchema,
  ProjectFeedPostResultSchema,
  ProjectFileDeleteRequestSchema,
  ProjectFileDeleteResultSchema,
  ProjectFileDownloadRequestSchema,
  ProjectFileDownloadResultSchema,
  ProjectFileListRequestSchema,
  ProjectFileListResultSchema,
  ProjectFilePromoteRequestSchema,
  ProjectFilePromoteResultSchema,
  ProjectFileUploadRequestSchema,
  ProjectFileUploadResultSchema,
  ProjectFileUploadCancelRequestSchema,
  ProjectFileUploadCancelResultSchema,
  ProjectFileUploadProgressSchema,
  ProjectInviteRequestSchema,
  ProjectInviteResultSchema,
  ProjectArchiveRequestSchema,
  ProjectListRequestSchema,
  ProjectListResultSchema,
  ProjectMemberAdminResultSchema,
  ProjectMemberRemoveRequestSchema,
  ProjectMemberUpdateRequestSchema,
  ProjectOpenInvitationListRequestSchema,
  ProjectOpenInvitationListResultSchema,
  ProjectInvitationRevokeRequestSchema,
  ProjectInvitationRevokeResultSchema,
  ProjectReadCursorRequestSchema,
  ProjectReadCursorResultSchema,
  ProjectRedeemInvitationRequestSchema,
  ProjectRedeemInvitationResultSchema,
  ProjectTodoAcceptanceSetRequestSchema,
  ProjectTodoAcceptanceSetResultSchema,
  ProjectTodoCreateRequestSchema,
  ProjectTodoCreateResultSchema,
  ProjectTodoDeleteRequestSchema,
  ProjectTodoDeleteResultSchema,
  ProjectTodoDetailRequestSchema,
  ProjectTodoDetailResultSchema,
  ProjectTodoDraftCreateRequestSchema,
  ProjectTodoDraftCreateResultSchema,
  ProjectTodoDraftDropRequestSchema,
  ProjectTodoDraftDropResultSchema,
  ProjectTodoDraftListRequestSchema,
  ProjectTodoDraftListResultSchema,
  ProjectTodoDraftResolveRequestSchema,
  ProjectTodoDraftResolveResultSchema,
  ProjectTodoListRequestSchema,
  ProjectTodoListResultSchema,
  ProjectRequirementPageRequestSchema,
  ProjectRequirementPageResultSchema,
  ProjectTodoReviewRequestSchema,
  ProjectTodoReviewResultSchema,
  ProjectTodoSubmitReviewRequestSchema,
  ProjectTodoSubmitReviewResultSchema,
  ProjectTodoUpdateRequestSchema,
  ProjectTodoUpdateResultSchema,
  ProjectRequirementClaimRequestSchema,
  ProjectRequirementClaimResultSchema,
  ProjectTransferOwnershipRequestSchema,
  ProjectUpdateRequestSchema,
  ProjectUpdateResultSchema,
  ProjectConventionsRequestSchema,
  ProjectConventionsResultSchema,
  ProjectConventionsUpdateRequestSchema,
  ProjectConventionsUpdateResultSchema,
  type ProjectCollabErrorCode,
  type ProjectFileQuota,
  type ProjectFileUploadProgress,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectTestModeRequestSchema,
  ProjectTestModeResultSchema,
  ServiceCapabilitiesRequestSchema,
  ServiceCapabilitiesResultSchema,
  SERVICE_CAPABILITY,
  hasCapability,
} from '../../shared/protocol/project-collab-capabilities.js';
import {
  ProjectNotificationSettingsSchema,
  ProjectNotificationSettingsUpdateSchema,
  type ProjectNotificationSettings,
} from '../../shared/protocol/project-notifications.js';
import type { CollabClient } from '../services/collab/collabClient.js';
import {
  ProjectSubmissionGateRequestSchema,
  ProjectSubmissionGateUpdateRequestSchema,
  ProjectSubmissionGateResultSchema,
} from '../../shared/protocol/project-submission-gate.js';
import { registerProjectAssetHandlers } from './projectCollabHandlersAssets.js';
import { registerProjectTodoCollaborationHandlers } from './projectCollabHandlersTodoCollaboration.js';
import { registerProjectWorkOverviewHandlers } from './projectCollabHandlersWorkOverview.js';
import {
  registerProjectPlanningHandlers,
  type ProjectPlanningClientPort,
} from './projectCollabHandlersPlanning.js';
import {
  registerProjectTestCaseHandlers,
  type ProjectTestCaseClientPort,
} from './projectCollabHandlersTestCases.js';
import {
  registerProjectTestingHandlers,
  type ProjectTestingClientPort,
} from './projectCollabHandlersTesting.js';

/**
 * 项目组多人协作（`project:*`）的 IPC 处理器。
 *
 * 边界纪律（capabilityRegistryHandlers 形态）：鉴权 → activeAccount → 入参
 * strictObject 校验 → 取令牌 → 调 `CollabClient` → **每次 await 后重验
 * accountKey + authEpoch**（换账号期间在飞的请求一律 denied，不把上一个账号
 * 的数据发给下一个账号）→ 出参 schema 校验。
 *
 * ⚠️ 【账号】账号一律由 Main 从会话态推导——请求契约里结构性没有账号字段。
 * ⚠️ 【路径】文件上传的路径由主进程 `dialog` 弹框自取（`pickUploadFile` 注入），
 *    渲染层递不进路径也见不到路径；下载只回落盘绝对路径（用户自己的下载目录）。
 * ⚠️ 服务未装配（非 dev/test 渠道 / 离线构建 / 地址未注入）时 availability 回
 *    `{enabled:false}`，其余通道回 `unavailable`——fail-safe，不报错不泄露。
 */

/** 客户端网络面（结构性子集，测试可用对象字面量替身）。 */
export type ProjectCollabClientPort = Pick<
  CollabClient,
  | 'listProjects'
  | 'createProject'
  | 'readProjectDetail'
  | 'updateProject'
  | 'readConventions'
  | 'updateConventions'
  | 'readSubmissionGate'
  | 'updateSubmissionGate'
  | 'createInvitation'
  | 'redeemInvitation'
  | 'listOpenInvitations'
  | 'revokeInvitation'
  | 'updateMemberRole'
  | 'removeMember'
  | 'transferOwnership'
  | 'setProjectArchived'
  | 'listFeed'
  | 'postFeedEntry'
  | 'postFeedComment'
  | 'listChatHistory'
  | 'searchChatHistory'
  | 'sendChatMessage'
  | 'revokeChatMessage'
  | 'setReadCursor'
  | 'fetchCapabilities'
  | 'fetchProjectTestMode'
  | 'listTodos'
  | 'readRequirementPage'
  | 'createTodo'
  | 'updateTodo'
  | 'claimRequirement'
  | 'deleteTodo'
  | 'deleteTodosBatch'
  | 'getTodoDetail'
  | 'getTodoCollaborators'
  | 'replaceTodoCollaborators'
  | 'listTodoComments'
  | 'createTodoComment'
  | 'previewTodoDeletion'
  | 'readWorkOverview'
  | 'setAcceptanceItems'
  | 'submitTodoReview'
  | 'reviewTodo'
  | 'listDraftBatches'
  | 'createDraftBatch'
  | 'dropDraft'
  | 'resolveDraftBatch'
  | 'listFiles'
  | 'uploadFile'
  | 'downloadFile'
  | 'promoteFile'
  | 'deleteFile'
  /*
   * 资产版本域十条方法（RPT-01 的五条 + RPT-02 为预览加的取字节入口 + RPT-08 的回收站
   * 列表 / 回收站恢复 / 历史版本恢复）。
   * ⭐ 落在**同一个 `client`** 上而不是像规划面那样另开一个键：它们本来就是
   *    `CollabClient` 的方法（RPT-01 加在那里），装配束因此一个字都不用改。
   */
  | 'listProjectAssets'
  | 'listAssetVersions'
  | 'getAssetVersion'
  | 'registerAssetVersion'
  | 'deleteAsset'
  | 'downloadFileBytes'
  | 'listDeletedProjectAssets'
  | 'restoreAsset'
  | 'restoreAssetVersion'
>;

/** 装配层注入的依赖束（index.ts 组装；令牌与路径都只在主进程流转）。 */
export interface ProjectCollabIpcDependencies {
  readonly client: ProjectCollabClientPort;
  /**
   * 规划域（业务目标 / 多轮迭代）的 HTTP 客户端。
   *
   * 与 `client` 分开是因为那份已按协作面九个实体长满，本域还要接着长；但装配束仍是
   * **同一个对象**，所以 `register.ts` 与访问策略都不用为它多开一条路。
   */
  readonly planning: ProjectPlanningClientPort;
  /**
   * 整需求提测域（TST-02）的 HTTP 客户端：同规划面，按域另起一个客户端，装配束仍是同一个对象。
   * 测试轮次的用例（TST-04）是同一个客户端上的另五个方法，⛔ 不另起依赖键（生产与 e2e 两处装配不动）。
   */
  readonly testing: ProjectTestingClientPort & ProjectTestCaseClientPort;
  /** 逐请求取 AEP access token；null＝当前拿不到凭据。 */
  readonly accessToken: () => Promise<string | null>;
  /** 上传选档：主进程 `dialog.showOpenDialog`；null＝用户取消。 */
  readonly pickUploadFile: () => Promise<string | null>;
  /** 下载落点目录（系统下载目录）。 */
  readonly downloadsDirectory: () => string;
  /** 证据引用里的外部链接交系统浏览器（ADR-0036）；地址的二次校验在规划域处理器里。 */
  readonly openExternalLink: (url: string) => Promise<void | string>;
}

export interface ProjectCollabHandlerOptions {
  readonly dependencies?: ProjectCollabIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  /**
   * 在场账号（Main 会话态真相源）。`subject` = 平台身份主体（与协作服务端成员
   * `subject` 同一量纲），只进 availability 结果供 UI 显隐判据；防串校验仍只
   * 比对 accountKey + authEpoch。
   */
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
    readonly subject: string;
  } | null;
  /**
   * 桌面系统通知开关的落盘（G-6「用户可关」）。缺省（未装配）时读恒回默认开、
   * 写原样回显——设置面不因存储缺席而报错，行为与「装配了但用户没改过」一致。
   */
  readonly notificationSettings?: ProjectNotificationSettingsPort | null;
}

/** 通知开关存储的结构性子集（测试用对象字面量替身）。 */
export interface ProjectNotificationSettingsPort {
  read(): ProjectNotificationSettings;
  write(settings: ProjectNotificationSettings): ProjectNotificationSettings;
}

/** 未装配存储时的兜底：默认开（三级触达是产品承诺的默认行为）。 */
const DEFAULT_NOTIFICATION_SETTINGS: ProjectNotificationSettings = Object.freeze({
  desktopNotifications: true,
});

export interface ProjectCollabIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/** 固定文案表：不回显服务端文本（错误体是不可信输入，也可能夹带内部细节）。 */
const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再使用项目组。',
  invalidRequest: '请求无效，请刷新后重试。',
  tooLarge: '文件超过 1 GiB 大小上限，或超过当前读取预算。',
  rateLimited: '操作过于频繁，请稍后再试。',
  conflict: '内容已被他人更新，请刷新后重试。',
  // 触顶的**具体数字**由结果里的 `quota` 带回，渲染层据此换成一句带数的话；
  // 这里的兜底文案只在拿不到那两个数时出现（也仍然指向配额，不是通用失败）。
  quotaExceeded: '项目文件已达容量上限。',
  credentialRejected: '登录状态已失效，请重新登录。',
  forbidden: '没有执行该操作的权限。',
  rejected: '请求被服务端拒绝。',
  transient: '网络暂时不可用，请稍后重试。',
  writeFailed: '文件保存失败，请检查磁盘后重试。',
};

function failureBody(
  code: ProjectCollabErrorCode,
  serverCode?: string,
): {
  readonly ok: false;
  readonly code: ProjectCollabErrorCode;
  readonly message: string;
  readonly referenceCode: string;
  readonly serverCode?: string;
} {
  // 参考编号只有这一个签发点：所有 `project:*` 通道的失败体都从这里出，
  // 编号表在共享协议里（渲染层展示时读同一张表，两边不各自造串）。
  //
  // `serverCode`（可选）是服务端业务码短标识符（`collabClient` 仅 4xx 时从
  // `{ "error": "<code>" }` 挑出）：**原样透传**给渲染层区分同一通用 `code` 下的不同
  // 业务原因（开放邀请三码：关闭 / 满员 / 角色）。⛔ 只透传这一个短标识符，不带
  // 服务端自由文案（`ProjectCollabServerCodeSchema` 正则闸已在共享层结构性挡住）。
  // exactOptionalPropertyTypes 下缺席即不带该键。
  return serverCode === undefined
    ? {
        ok: false,
        code,
        message: FAILURE_MESSAGES[code],
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
      }
    : {
        ok: false,
        code,
        message: FAILURE_MESSAGES[code],
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
        serverCode,
      };
}

export function registerProjectCollabHandlers(
  registrar: ProjectCollabIpcRegistrar,
  options: ProjectCollabHandlerOptions,
): void {
  type ActiveAccount = NonNullable<ReturnType<ProjectCollabHandlerOptions['activeAccount']>>;
  const uploads = new Map<
    string,
    {
      readonly controller: AbortController;
      readonly sender: object;
      readonly account: ActiveAccount;
      readonly name: string;
      size: number | null;
      progress: number;
    }
  >();
  const sameAccount = (expected: ActiveAccount): boolean => {
    const current = options.activeAccount();
    return (
      current !== null &&
      current.accountKey === expected.accountKey &&
      current.authEpoch === expected.authEpoch
    );
  };
  /**
   * 统一包装：鉴权/账号/装配三道闸 → 业务 → await 后重验账号。
   * `fail` 为各通道结果形状的失败工厂（todo-update 带 currentVersion，其余同形）。
   */
  const register = <Result>(
    channel: string,
    fail: (code: ProjectCollabErrorCode) => Result,
    run: (
      deps: ProjectCollabIpcDependencies,
      input: unknown,
      event: unknown,
      account: ActiveAccount,
    ) => Promise<Result>,
  ): void => {
    registrar.handle(channel, async (event, input) => {
      const account = options.authorize(event) ? options.activeAccount() : null;
      if (!account) return fail('authRequired');
      const deps = options.dependencies ?? null;
      if (!deps) return fail('unavailable');
      let result: Result;
      try {
        result = await run(deps, input, event, account);
      } catch {
        // 意外异常不跨 IPC 泄露：一律收敛为瞬时失败（可重试）。
        result = fail('transient');
      }
      const current = options.authorize(event) ? options.activeAccount() : null;
      if (
        !current ||
        current.accountKey !== account.accountKey ||
        current.authEpoch !== account.authEpoch
      ) {
        return fail('authRequired');
      }
      return result;
    });
  };

  /** 逐请求取令牌；拿不到凭据＝credentialRejected（已登录态下令牌刷新失败）。 */
  const withToken = async <Result>(
    deps: ProjectCollabIpcDependencies,
    fail: (code: ProjectCollabErrorCode) => Result,
    action: (accessToken: string) => Promise<Result>,
  ): Promise<Result> => {
    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      token = null;
    }
    if (token === null) return fail('credentialRejected');
    return action(token);
  };

  // 能力探测：静态装配事实 + 本人 subject（UI 撤回/删除按钮显隐判据；服务端仍强判）。
  // 未授权/未装配一律 {enabled:false, mySubject:null}（安全侧，不泄露身份）。
  registrar.handle(IPC.PROJECT_AVAILABILITY, async (event, input) => {
    const requestValid = ProjectAvailabilityRequestSchema.safeParse(input ?? {}).success;
    const account = requestValid && options.authorize(event) ? options.activeAccount() : null;
    const enabled = account !== null && Boolean(options.dependencies);
    return ProjectCollabAvailabilitySchema.parse({
      enabled,
      mySubject: enabled && account && account.subject ? account.subject : null,
    });
  });

  // 桌面通知开关（G-6）：不经服务端、不需要令牌，只读写本机偏好。
  // 未登录/非主窗仍按统一门禁挡下（读也挡：偏好是本人设置，不给旁窗看）。
  registrar.handle(IPC.PROJECT_NOTIFICATION_SETTINGS_READ, async (event, input) => {
    if (!options.authorize(event) || !options.activeAccount()) {
      return ProjectNotificationSettingsSchema.parse(DEFAULT_NOTIFICATION_SETTINGS);
    }
    if (input !== undefined)
      return ProjectNotificationSettingsSchema.parse(DEFAULT_NOTIFICATION_SETTINGS);
    const settings = options.notificationSettings?.read() ?? DEFAULT_NOTIFICATION_SETTINGS;
    return ProjectNotificationSettingsSchema.parse(settings);
  });

  registrar.handle(IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE, async (event, input) => {
    const request = ProjectNotificationSettingsUpdateSchema.safeParse(input);
    if (!request.success)
      return ProjectNotificationSettingsSchema.parse(DEFAULT_NOTIFICATION_SETTINGS);
    if (!options.authorize(event) || !options.activeAccount()) {
      // 写被门禁挡下时回**当前**真值，不回请求值——否则 UI 会显示成已生效。
      return ProjectNotificationSettingsSchema.parse(
        options.notificationSettings?.read() ?? DEFAULT_NOTIFICATION_SETTINGS,
      );
    }
    const settings = options.notificationSettings?.write(request.data) ?? request.data;
    return ProjectNotificationSettingsSchema.parse(settings);
  });

  const listFail = (code: ProjectCollabErrorCode) =>
    ProjectListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_LIST, listFail, async (deps, input) => {
    const request = ProjectListRequestSchema.safeParse(input ?? {});
    if (!request.success) return listFail('invalidRequest');
    return withToken(deps, listFail, async (token) => {
      const outcome = await deps.client.listProjects(token, {
        includeArchived: request.data.includeArchived,
      });
      if (!outcome.ok) return listFail(outcome.code);
      return ProjectListResultSchema.parse({ ok: true, projects: outcome.value });
    });
  });

  const createFail = (code: ProjectCollabErrorCode) =>
    ProjectCreateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_CREATE, createFail, async (deps, input) => {
    const request = ProjectCreateRequestSchema.safeParse(input);
    if (!request.success) return createFail('invalidRequest');
    return withToken(deps, createFail, async (token) => {
      const outcome = await deps.client.createProject(token, request.data);
      if (!outcome.ok) return createFail(outcome.code);
      return ProjectCreateResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  const detailFail = (code: ProjectCollabErrorCode) =>
    ProjectDetailResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DETAIL, detailFail, async (deps, input) => {
    const request = ProjectDetailRequestSchema.safeParse(input);
    if (!request.success) return detailFail('invalidRequest');
    return withToken(deps, detailFail, async (token) => {
      const outcome = await deps.client.readProjectDetail(token, request.data);
      if (!outcome.ok) return detailFail(outcome.code);
      return ProjectDetailResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  const updateFail = (code: ProjectCollabErrorCode) =>
    ProjectUpdateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_UPDATE, updateFail, async (deps, input) => {
    const request = ProjectUpdateRequestSchema.safeParse(input);
    if (!request.success) return updateFail('invalidRequest');
    return withToken(deps, updateFail, async (token) => {
      const outcome = await deps.client.updateProject(token, request.data);
      if (!outcome.ok) return updateFail(outcome.code);
      return ProjectUpdateResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  const gateFail = (code: ProjectCollabErrorCode) =>
    ProjectSubmissionGateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_SUBMISSION_GATE_GET, gateFail, async (deps, input, event, account) => {
    const request = ProjectSubmissionGateRequestSchema.safeParse(input);
    if (!request.success) return gateFail('invalidRequest');
    return withToken(deps, gateFail, async (token) => {
      if (!options.authorize(event) || !sameAccount(account)) return gateFail('authRequired');
      const outcome = await deps.client.readSubmissionGate(token, request.data);
      return outcome.ok
        ? ProjectSubmissionGateResultSchema.parse({ ok: true, gate: outcome.value })
        : gateFail(outcome.code);
    });
  });
  register(IPC.PROJECT_SUBMISSION_GATE_UPDATE, gateFail, async (deps, input, event, account) => {
    const request = ProjectSubmissionGateUpdateRequestSchema.safeParse(input);
    if (!request.success) return gateFail('invalidRequest');
    return withToken(deps, gateFail, async (token) => {
      if (!options.authorize(event) || !sameAccount(account)) return gateFail('authRequired');
      const outcome = await deps.client.updateSubmissionGate(token, request.data);
      return outcome.ok
        ? ProjectSubmissionGateResultSchema.parse({ ok: true, gate: outcome.value })
        : gateFail(outcome.code);
    });
  });
  const conventionsGetFail = (code: ProjectCollabErrorCode) =>
    ProjectConventionsResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_CONVENTIONS_GET, conventionsGetFail, async (deps, input) => {
    const request = ProjectConventionsRequestSchema.safeParse(input);
    if (!request.success) return conventionsGetFail('invalidRequest');
    return withToken(deps, conventionsGetFail, async (token) => {
      const outcome = await deps.client.readConventions(token, request.data);
      if (!outcome.ok) return conventionsGetFail(outcome.code);
      return ProjectConventionsResultSchema.parse({ ok: true, conventions: outcome.value });
    });
  });

  const conventionsUpdateFail = (code: ProjectCollabErrorCode) =>
    ProjectConventionsUpdateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_CONVENTIONS_UPDATE, conventionsUpdateFail, async (deps, input) => {
    const request = ProjectConventionsUpdateRequestSchema.safeParse(input);
    if (!request.success) return conventionsUpdateFail('invalidRequest');
    return withToken(deps, conventionsUpdateFail, async (token) => {
      // 冲突（409）经 `outcome.code === 'conflict'` 原样透传；发布是**独立于改说明**的
      // 一条写路径（服务端 /conventions 端点，CTX-02 落地），⛔ 不复用 project:update。
      const outcome = await deps.client.updateConventions(token, request.data);
      if (!outcome.ok) return conventionsUpdateFail(outcome.code);
      return ProjectConventionsUpdateResultSchema.parse({ ok: true, conventions: outcome.value });
    });
  });

  const inviteFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectInviteResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_INVITE, inviteFail, async (deps, input) => {
    const request = ProjectInviteRequestSchema.safeParse(input);
    if (!request.success) return inviteFail('invalidRequest');
    return withToken(deps, inviteFail, async (token) => {
      // 邀请码明文只在结果里出现一次：不落库、不进日志（服务端只存 HMAC 摘要）。
      // 开放邀请的 kind / ttlHours / maxUses 由请求透传（single 缺省沿用服务端配置）。
      const outcome = await deps.client.createInvitation(token, {
        projectId: request.data.projectId,
        role: request.data.role,
        // exactOptionalPropertyTypes：可选键要么不出现、要么带值，不能显式传 undefined。
        ...(request.data.kind !== undefined ? { kind: request.data.kind } : {}),
        ...(request.data.ttlHours !== undefined ? { ttlHours: request.data.ttlHours } : {}),
        ...(request.data.maxUses !== undefined ? { maxUses: request.data.maxUses } : {}),
      });
      if (!outcome.ok) return inviteFail(outcome.code, outcome.serverCode);
      return ProjectInviteResultSchema.parse({
        ok: true,
        code: outcome.value.code,
        expiresAt: outcome.value.expiresAt,
        invitationId: outcome.value.invitationId,
        kind: outcome.value.kind,
        maxUses: outcome.value.maxUses,
      });
    });
  });

  const openInvitationsFail = (code: ProjectCollabErrorCode) =>
    ProjectOpenInvitationListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_LIST_OPEN_INVITATIONS, openInvitationsFail, async (deps, input) => {
    const request = ProjectOpenInvitationListRequestSchema.safeParse(input);
    if (!request.success) return openInvitationsFail('invalidRequest');
    return withToken(deps, openInvitationsFail, async (token) => {
      const outcome = await deps.client.listOpenInvitations(token, request.data);
      if (!outcome.ok) return openInvitationsFail(outcome.code);
      return ProjectOpenInvitationListResultSchema.parse({ ok: true, invitations: outcome.value });
    });
  });

  const revokeInvitationFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectInvitationRevokeResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REVOKE_INVITATION, revokeInvitationFail, async (deps, input) => {
    const request = ProjectInvitationRevokeRequestSchema.safeParse(input);
    if (!request.success) return revokeInvitationFail('invalidRequest');
    return withToken(deps, revokeInvitationFail, async (token) => {
      const outcome = await deps.client.revokeInvitation(token, request.data);
      if (!outcome.ok) return revokeInvitationFail(outcome.code, outcome.serverCode);
      return ProjectInvitationRevokeResultSchema.parse({
        ok: true,
        projectId: outcome.value.projectId,
        invitationId: outcome.value.invitationId,
      });
    });
  });

  const redeemFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRedeemInvitationResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REDEEM_INVITATION, redeemFail, async (deps, input) => {
    const request = ProjectRedeemInvitationRequestSchema.safeParse(input);
    if (!request.success) return redeemFail('invalidRequest');
    return withToken(deps, redeemFail, async (token) => {
      const outcome = await deps.client.redeemInvitation(token, request.data);
      if (!outcome.ok) return redeemFail(outcome.code, outcome.serverCode);
      return ProjectRedeemInvitationResultSchema.parse({
        ok: true,
        projectId: outcome.value.projectId,
        role: outcome.value.role,
      });
    });
  });

  /*
   * 成员管理四通道（owner-only）。这里**不做角色判定**——渲染层的 owner 收窄只是
   * 不给点了必错的按钮，真正的门在服务端（按令牌强判 + 落审计）。四条同形回详情。
   */
  const memberAdminFail = (code: ProjectCollabErrorCode) =>
    ProjectMemberAdminResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_MEMBER_UPDATE, memberAdminFail, async (deps, input) => {
    const request = ProjectMemberUpdateRequestSchema.safeParse(input);
    if (!request.success) return memberAdminFail('invalidRequest');
    return withToken(deps, memberAdminFail, async (token) => {
      const outcome = await deps.client.updateMemberRole(token, request.data);
      if (!outcome.ok) return memberAdminFail(outcome.code);
      return ProjectMemberAdminResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  register(IPC.PROJECT_MEMBER_REMOVE, memberAdminFail, async (deps, input) => {
    const request = ProjectMemberRemoveRequestSchema.safeParse(input);
    if (!request.success) return memberAdminFail('invalidRequest');
    return withToken(deps, memberAdminFail, async (token) => {
      const outcome = await deps.client.removeMember(token, request.data);
      if (!outcome.ok) return memberAdminFail(outcome.code);
      return ProjectMemberAdminResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  register(IPC.PROJECT_TRANSFER, memberAdminFail, async (deps, input) => {
    const request = ProjectTransferOwnershipRequestSchema.safeParse(input);
    if (!request.success) return memberAdminFail('invalidRequest');
    return withToken(deps, memberAdminFail, async (token) => {
      const outcome = await deps.client.transferOwnership(token, request.data);
      if (!outcome.ok) return memberAdminFail(outcome.code);
      return ProjectMemberAdminResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  register(IPC.PROJECT_ARCHIVE, memberAdminFail, async (deps, input) => {
    const request = ProjectArchiveRequestSchema.safeParse(input);
    if (!request.success) return memberAdminFail('invalidRequest');
    return withToken(deps, memberAdminFail, async (token) => {
      const outcome = await deps.client.setProjectArchived(token, request.data);
      if (!outcome.ok) return memberAdminFail(outcome.code);
      return ProjectMemberAdminResultSchema.parse({ ok: true, project: outcome.value });
    });
  });

  const feedListFail = (code: ProjectCollabErrorCode) =>
    ProjectFeedListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FEED_LIST, feedListFail, async (deps, input) => {
    const request = ProjectFeedListRequestSchema.safeParse(input);
    if (!request.success) return feedListFail('invalidRequest');
    return withToken(deps, feedListFail, async (token) => {
      const outcome = await deps.client.listFeed(token, request.data);
      if (!outcome.ok) return feedListFail(outcome.code);
      return ProjectFeedListResultSchema.parse({ ok: true, entries: outcome.value });
    });
  });

  const feedPostFail = (code: ProjectCollabErrorCode) =>
    ProjectFeedPostResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FEED_POST, feedPostFail, async (deps, input) => {
    const request = ProjectFeedPostRequestSchema.safeParse(input);
    if (!request.success) return feedPostFail('invalidRequest');
    return withToken(deps, feedPostFail, async (token) => {
      const outcome = await deps.client.postFeedEntry(token, request.data);
      if (!outcome.ok) return feedPostFail(outcome.code);
      return ProjectFeedPostResultSchema.parse({ ok: true, entry: outcome.value });
    });
  });

  const commentFail = (code: ProjectCollabErrorCode) =>
    ProjectCommentPostResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_COMMENT_POST, commentFail, async (deps, input) => {
    const request = ProjectCommentPostRequestSchema.safeParse(input);
    if (!request.success) return commentFail('invalidRequest');
    return withToken(deps, commentFail, async (token) => {
      const outcome = await deps.client.postFeedComment(token, request.data);
      if (!outcome.ok) return commentFail(outcome.code);
      return ProjectCommentPostResultSchema.parse({ ok: true, comment: outcome.value });
    });
  });

  const chatHistoryFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectChatHistoryResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_CHAT_HISTORY, chatHistoryFail, async (deps, input, event, account) => {
    const request = ProjectChatHistoryRequestSchema.safeParse(input);
    if (!request.success) return chatHistoryFail('invalidRequest');
    return withToken(deps, chatHistoryFail, async (token) => {
      if (request.data.search !== undefined) {
        if (!options.authorize(event) || !sameAccount(account))
          return chatHistoryFail('authRequired');
        const capabilities = await deps.client.fetchCapabilities(token);
        if (!options.authorize(event) || !sameAccount(account))
          return chatHistoryFail('authRequired');
        if (!capabilities.ok) return chatHistoryFail(capabilities.code, capabilities.serverCode);
        if (!hasCapability(capabilities.value, SERVICE_CAPABILITY.chatSearch)) {
          return chatHistoryFail('rejected', 'service_upgrade_required');
        }
        const outcome = await deps.client.searchChatHistory(token, request.data);
        if (!outcome.ok) return chatHistoryFail(outcome.code, outcome.serverCode);
        return ProjectChatHistoryResultSchema.parse({ ok: true, ...outcome.value });
      }
      const outcome = await deps.client.listChatHistory(token, request.data);
      if (!outcome.ok) return chatHistoryFail(outcome.code);
      return ProjectChatHistoryResultSchema.parse({ ok: true, messages: outcome.value });
    });
  });

  const chatSendFail = (code: ProjectCollabErrorCode) =>
    ProjectChatSendResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_CHAT_SEND, chatSendFail, async (deps, input, event, account) => {
    const request = ProjectChatSendRequestSchema.safeParse(input);
    if (!request.success) return chatSendFail('invalidRequest');
    const isCurrent = (): boolean => options.authorize(event) && sameAccount(account);
    return withToken(deps, chatSendFail, async (token) => {
      if (!isCurrent()) return chatSendFail('authRequired');
      const outcome = await deps.client.sendChatMessage(token, request.data, isCurrent);
      if (!outcome.ok) return chatSendFail(outcome.code);
      return ProjectChatSendResultSchema.parse({ ok: true, message: outcome.value });
    });
  });

  const chatRevokeFail = (code: ProjectCollabErrorCode) =>
    ProjectChatRevokeResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_CHAT_REVOKE, chatRevokeFail, async (deps, input) => {
    const request = ProjectChatRevokeRequestSchema.safeParse(input);
    if (!request.success) return chatRevokeFail('invalidRequest');
    return withToken(deps, chatRevokeFail, async (token) => {
      const outcome = await deps.client.revokeChatMessage(token, request.data);
      if (!outcome.ok) return chatRevokeFail(outcome.code);
      return ProjectChatRevokeResultSchema.parse({ ok: true, message: outcome.value });
    });
  });

  const readCursorFail = (code: ProjectCollabErrorCode) =>
    ProjectReadCursorResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_READ_CURSOR, readCursorFail, async (deps, input) => {
    const request = ProjectReadCursorRequestSchema.safeParse(input);
    if (!request.success) return readCursorFail('invalidRequest');
    return withToken(deps, readCursorFail, async (token) => {
      const outcome = await deps.client.setReadCursor(token, request.data);
      if (!outcome.ok) return readCursorFail(outcome.code);
      return ProjectReadCursorResultSchema.parse({ ok: true });
    });
  });

  const todoListFail = (code: ProjectCollabErrorCode) =>
    ProjectTodoListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_TODO_LIST, todoListFail, async (deps, input) => {
    const request = ProjectTodoListRequestSchema.safeParse(input);
    if (!request.success) return todoListFail('invalidRequest');
    return withToken(deps, todoListFail, async (token) => {
      const outcome = await deps.client.listTodos(token, request.data);
      if (!outcome.ok) return todoListFail(outcome.code);
      return ProjectTodoListResultSchema.parse({
        ok: true,
        todos: outcome.value.todos,
        hasMore: outcome.value.hasMore,
        nextCursor: outcome.value.nextCursor,
      });
    });
  });

  // 服务能力协商（CORE-05）：只读，回能力清单 + 服务版本；旧服务端 404 由 client 折成
  // legacy 空能力集（成功态），供渲染层显示升级提示、写门拦下新字段。
  const capabilitiesFail = (code: ProjectCollabErrorCode) =>
    ServiceCapabilitiesResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_SERVICE_CAPABILITIES, capabilitiesFail, async (deps, input) => {
    if (!ServiceCapabilitiesRequestSchema.safeParse(input ?? {}).success) {
      return capabilitiesFail('invalidRequest');
    }
    return withToken(deps, capabilitiesFail, async (token) => {
      const outcome = await deps.client.fetchCapabilities(token);
      if (!outcome.ok) return capabilitiesFail(outcome.code);
      return ServiceCapabilitiesResultSchema.parse({ ok: true, capabilities: outcome.value });
    });
  });

  const testModeFail = (code: ProjectCollabErrorCode) =>
    ProjectTestModeResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_TEST_MODE, testModeFail, async (deps, input) => {
    const request = ProjectTestModeRequestSchema.safeParse(input);
    if (!request.success) return testModeFail('invalidRequest');
    return withToken(deps, testModeFail, async (token) => {
      const outcome = await deps.client.fetchProjectTestMode(token, request.data);
      if (!outcome.ok) return testModeFail(outcome.code);
      return ProjectTestModeResultSchema.parse({ ok: true, testMode: outcome.value });
    });
  });

  const requirementPageFail = (code: ProjectCollabErrorCode) =>
    ProjectRequirementPageResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_REQUIREMENT_PAGE, requirementPageFail, async (deps, input) => {
    const request = ProjectRequirementPageRequestSchema.safeParse(input);
    if (!request.success) return requirementPageFail('invalidRequest');
    return withToken(deps, requirementPageFail, async (token) => {
      const outcome = await deps.client.readRequirementPage(token, request.data);
      if (!outcome.ok) return requirementPageFail(outcome.code);
      return ProjectRequirementPageResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
        queryRevision: outcome.value.queryRevision,
      });
    });
  });

  // 建单 / 改单 / 提交验收的失败体透传 serverCode（需求派给助理、承接人是观察者、
  // 未认领需求须走认领、助理单只由派单人提交…），渲染层按 `projectTodoWriteServerCodeText`
  // 给出真实原因，而不是一句「请求被服务端拒绝」。起止成对的 `start_requires_due` 与
  // `invalid_date_range` 同是 400（通用码都是 rejected），也靠它区分（CORE-08，ADR-0042）。
  const todoCreateFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectTodoCreateResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_TODO_CREATE, todoCreateFail, async (deps, input) => {
    const request = ProjectTodoCreateRequestSchema.safeParse(input);
    if (!request.success) return todoCreateFail('invalidRequest');
    return withToken(deps, todoCreateFail, async (token) => {
      const outcome = await deps.client.createTodo(token, request.data);
      if (!outcome.ok) return todoCreateFail(outcome.code, outcome.serverCode);
      return ProjectTodoCreateResultSchema.parse({ ok: true, todo: outcome.value });
    });
  });

  // 待办更新失败形状独有 currentVersion：仅 conflict 非空（服务端 409 带回）。serverCode 同建单透传。
  const todoUpdateFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) => ProjectTodoUpdateResultSchema.parse({ ...failureBody(code, serverCode), currentVersion });
  register(
    IPC.PROJECT_TODO_UPDATE,
    (code) => todoUpdateFail(code),
    async (deps, input) => {
      const request = ProjectTodoUpdateRequestSchema.safeParse(input);
      if (!request.success) return todoUpdateFail('invalidRequest');
      return withToken(
        deps,
        (code) => todoUpdateFail(code),
        async (token) => {
          const outcome = await deps.client.updateTodo(token, request.data);
          if (!outcome.ok) {
            return todoUpdateFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectTodoUpdateResultSchema.parse({ ok: true, todo: outcome.value });
        },
      );
    },
  );

  // 认领（FLOW-02）：与改单分开，只对无主生效。失败体透传 serverCode
  // （requirement_already_claimed），供渲染层给出「已被他人认领」的真实提示——
  // ⛔ 这里绝不把失败折成成功（失败方伪成功＝用户以为认领到了、下次刷新才被默默纠正）。
  const requirementClaimFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRequirementClaimResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REQUIREMENT_CLAIM, requirementClaimFail, async (deps, input) => {
    const request = ProjectRequirementClaimRequestSchema.safeParse(input);
    if (!request.success) return requirementClaimFail('invalidRequest');
    return withToken(deps, requirementClaimFail, async (token) => {
      const outcome = await deps.client.claimRequirement(token, request.data);
      if (!outcome.ok) return requirementClaimFail(outcome.code, outcome.serverCode);
      return ProjectRequirementClaimResultSchema.parse({ ok: true, todo: outcome.value });
    });
  });

  // 删除（manager+，服务端强判）：单条走单条端点、多条走批量端点，两端响应同形。
  // 失败体透传 serverCode（todo_not_found / draft_source_deleted / project_archived …），
  // 供渲染层区分「已删/不存在」（静默移除）与其它拒绝。这里不做角色判定——门在服务端。
  const todoDeleteFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectTodoDeleteResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_TODO_DELETE, todoDeleteFail, async (deps, input) => {
    const request = ProjectTodoDeleteRequestSchema.safeParse(input);
    if (!request.success) return todoDeleteFail('invalidRequest');
    return withToken(deps, todoDeleteFail, async (token) => {
      // ids 恒 ≥1（schema min(1)）：length===1 即单条删除，走单条端点；否则走批量。
      const { projectId, ids } = request.data;
      const outcome =
        ids.length === 1
          ? await deps.client.deleteTodo(token, { todoId: ids[0]! })
          : await deps.client.deleteTodosBatch(token, { projectId, ids });
      if (!outcome.ok) return todoDeleteFail(outcome.code, outcome.serverCode);
      return ProjectTodoDeleteResultSchema.parse({
        ok: true,
        deletedIds: outcome.value.deletedIds,
        count: outcome.value.count,
      });
    });
  });

  // -- 工作单：单条读取 / 验收清单 / 提交验收 / 验收与打回 --------------------

  const todoDetailFail = (code: ProjectCollabErrorCode) =>
    ProjectTodoDetailResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_TODO_DETAIL, todoDetailFail, async (deps, input) => {
    const request = ProjectTodoDetailRequestSchema.safeParse(input);
    if (!request.success) return todoDetailFail('invalidRequest');
    return withToken(deps, todoDetailFail, async (token) => {
      const outcome = await deps.client.getTodoDetail(token, request.data);
      if (!outcome.ok) return todoDetailFail(outcome.code);
      return ProjectTodoDetailResultSchema.parse({ ok: true, ...outcome.value });
    });
  });

  // 以下四个通道的失败形状都带 currentVersion（乐观锁写路径），与 todo-update 同款：
  // 仅 conflict 非空，其余失败码恒 null。
  const acceptanceSetFail = (code: ProjectCollabErrorCode, currentVersion: number | null = null) =>
    ProjectTodoAcceptanceSetResultSchema.parse({ ...failureBody(code), currentVersion });
  register(
    IPC.PROJECT_TODO_ACCEPTANCE_SET,
    (code) => acceptanceSetFail(code),
    async (deps, input) => {
      const request = ProjectTodoAcceptanceSetRequestSchema.safeParse(input);
      if (!request.success) return acceptanceSetFail('invalidRequest');
      return withToken(
        deps,
        (code) => acceptanceSetFail(code),
        async (token) => {
          const outcome = await deps.client.setAcceptanceItems(token, request.data);
          if (!outcome.ok) {
            return acceptanceSetFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
            );
          }
          return ProjectTodoAcceptanceSetResultSchema.parse({ ok: true, ...outcome.value });
        },
      );
    },
  );

  const submitReviewFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectTodoSubmitReviewResultSchema.parse({ ...failureBody(code, serverCode), currentVersion });
  register(
    IPC.PROJECT_TODO_SUBMIT_REVIEW,
    (code) => submitReviewFail(code),
    async (deps, input) => {
      const request = ProjectTodoSubmitReviewRequestSchema.safeParse(input);
      if (!request.success) return submitReviewFail('invalidRequest');
      return withToken(
        deps,
        (code) => submitReviewFail(code),
        async (token) => {
          const outcome = await deps.client.submitTodoReview(token, request.data);
          if (!outcome.ok) {
            return submitReviewFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectTodoSubmitReviewResultSchema.parse({ ok: true, ...outcome.value });
        },
      );
    },
  );

  // serverCode 透传（TST-02）：在测需求走原验收 / 打回，服务端回 409 `test_round_in_progress`——
  // 丢了这枚码，渲染层只能把它说成「已被他人更新」，而那不是刷新重试能好的。
  const reviewFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) => ProjectTodoReviewResultSchema.parse({ ...failureBody(code, serverCode), currentVersion });
  register(
    IPC.PROJECT_TODO_REVIEW,
    (code) => reviewFail(code),
    async (deps, input) => {
      // ⚠️ 打回必须带理由这条闸在**契约层**（refine）：请求解析不过就是
      // invalidRequest，压根到不了网络面。服务端另有同一条判定，两道门都在。
      const request = ProjectTodoReviewRequestSchema.safeParse(input);
      if (!request.success) return reviewFail('invalidRequest');
      return withToken(
        deps,
        (code) => reviewFail(code),
        async (token) => {
          const outcome = await deps.client.reviewTodo(token, request.data);
          if (!outcome.ok) {
            return reviewFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectTodoReviewResultSchema.parse({ ok: true, ...outcome.value });
        },
      );
    },
  );

  // -- 拆解草案闸 -------------------------------------------------------------

  const draftListFail = (code: ProjectCollabErrorCode) =>
    ProjectTodoDraftListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_TODO_DRAFT_LIST, draftListFail, async (deps, input) => {
    const request = ProjectTodoDraftListRequestSchema.safeParse(input);
    if (!request.success) return draftListFail('invalidRequest');
    return withToken(deps, draftListFail, async (token) => {
      const outcome = await deps.client.listDraftBatches(token, request.data);
      if (!outcome.ok) return draftListFail(outcome.code);
      return ProjectTodoDraftListResultSchema.parse({ ok: true, batches: outcome.value });
    });
  });

  const draftCreateFail = (code: ProjectCollabErrorCode) =>
    ProjectTodoDraftCreateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_TODO_DRAFT_CREATE, draftCreateFail, async (deps, input) => {
    const request = ProjectTodoDraftCreateRequestSchema.safeParse(input);
    if (!request.success) return draftCreateFail('invalidRequest');
    return withToken(deps, draftCreateFail, async (token) => {
      const outcome = await deps.client.createDraftBatch(token, request.data);
      if (!outcome.ok) return draftCreateFail(outcome.code);
      return ProjectTodoDraftCreateResultSchema.parse({ ok: true, batch: outcome.value });
    });
  });

  // 逐条剔除：失败体同样透传 serverCode（draft_already_resolved / draft_batch_closed …）。
  const draftDropFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectTodoDraftDropResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_TODO_DRAFT_DROP, draftDropFail, async (deps, input) => {
    const request = ProjectTodoDraftDropRequestSchema.safeParse(input);
    if (!request.success) return draftDropFail('invalidRequest');
    return withToken(deps, draftDropFail, async (token) => {
      const outcome = await deps.client.dropDraft(token, request.data);
      if (!outcome.ok) return draftDropFail(outcome.code, outcome.serverCode);
      return ProjectTodoDraftDropResultSchema.parse({ ok: true, batch: outcome.value });
    });
  });

  // 整批处理：失败体透传 serverCode（requirement_not_claimed / draft_source_deleted /
  // draft_source_not_found / draft_batch_closed …）——这几种都是 409，丢了码渲染层只能说
  // 「数据已被他人更新」，而没有一种是刷新重试能好的。
  const draftResolveFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectTodoDraftResolveResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_TODO_DRAFT_RESOLVE, draftResolveFail, async (deps, input) => {
    const request = ProjectTodoDraftResolveRequestSchema.safeParse(input);
    if (!request.success) return draftResolveFail('invalidRequest');
    return withToken(deps, draftResolveFail, async (token) => {
      const outcome = await deps.client.resolveDraftBatch(token, request.data);
      if (!outcome.ok) return draftResolveFail(outcome.code, outcome.serverCode);
      return ProjectTodoDraftResolveResultSchema.parse({ ok: true, ...outcome.value });
    });
  });

  const fileListFail = (code: ProjectCollabErrorCode) =>
    ProjectFileListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FILE_LIST, fileListFail, async (deps, input) => {
    const request = ProjectFileListRequestSchema.safeParse(input);
    if (!request.success) return fileListFail('invalidRequest');
    return withToken(deps, fileListFail, async (token) => {
      const outcome = await deps.client.listFiles(token, request.data);
      if (!outcome.ok) return fileListFail(outcome.code);
      return ProjectFileListResultSchema.parse({ ok: true, files: outcome.value });
    });
  });

  // 上传失败形状独有 quota：仅 quotaExceeded 非空（服务端 409 带回的上限与已用量）。
  const uploadFail = (code: ProjectCollabErrorCode, quota: ProjectFileQuota | null = null) =>
    ProjectFileUploadResultSchema.parse({ ...failureBody(code), quota });
  register(
    IPC.PROJECT_FILE_UPLOAD,
    (code) => uploadFail(code),
    async (deps, input, event, account) => {
      const request = ProjectFileUploadRequestSchema.safeParse(input);
      if (!request.success) return uploadFail('invalidRequest');
      if (uploads.has(request.data.operationId)) return uploadFail('invalidRequest');
      // 路径由主进程弹框自取（注入 dialog），渲染层递不进也见不到路径。
      const filePath = await deps.pickUploadFile();
      if (filePath === null) {
        return ProjectFileUploadResultSchema.parse({ ok: true, cancelled: true });
      }
      const sender = senderOf(event);
      if (sender === null || senderDestroyed(sender)) return uploadFail('invalidRequest');
      const controller = new AbortController();
      const name = basename(filePath);
      const operation = {
        controller,
        sender,
        account,
        name,
        size: null as number | null,
        progress: 0,
      };
      uploads.set(request.data.operationId, operation);
      const removeDestroyedListener = senderOnceDestroyed(sender, () => controller.abort());
      const emit = (snapshot: ProjectFileUploadProgress): void => {
        if (!sameAccount(account) || senderDestroyed(sender)) return;
        senderSend(
          sender,
          IPC.PROJECT_FILE_UPLOAD_PROGRESS,
          ProjectFileUploadProgressSchema.parse(snapshot),
        );
      };
      return withToken(
        deps,
        (code) => uploadFail(code),
        async (token) => {
          const outcome = await deps.client.uploadFile(token, {
            projectId: request.data.projectId,
            filePath,
            kind: request.data.kind,
            signal: controller.signal,
            onProgress: (uploadedBytes, totalBytes) => {
              operation.size = totalBytes;
              operation.progress = uploadedBytes;
              emit({
                operationId: request.data.operationId,
                name,
                size: totalBytes,
                progress: uploadedBytes,
                phase: uploadedBytes >= totalBytes ? 'finalizing' : 'uploading',
                error: null,
              });
            },
          });
          if (controller.signal.aborted) {
            if (operation.size !== null)
              emit({
                operationId: request.data.operationId,
                name,
                size: operation.size,
                progress: operation.progress,
                phase: 'cancelled',
                error: null,
              });
            return ProjectFileUploadResultSchema.parse({ ok: true, cancelled: true });
          }
          if (!outcome.ok) {
            if (operation.size !== null)
              emit({
                operationId: request.data.operationId,
                name,
                size: operation.size,
                progress: operation.progress,
                phase: 'failed',
                error: outcome.code,
              });
            return uploadFail(
              outcome.code,
              outcome.code === 'quotaExceeded' ? (outcome.quota ?? null) : null,
            );
          }
          emit({
            operationId: request.data.operationId,
            name: outcome.value.filename,
            size: outcome.value.bytes,
            progress: outcome.value.bytes,
            phase: 'completed',
            error: null,
          });
          return ProjectFileUploadResultSchema.parse({ ok: true, file: outcome.value });
        },
      ).finally(() => {
        removeDestroyedListener();
        uploads.delete(request.data.operationId);
      });
    },
  );

  registrar.handle(IPC.PROJECT_FILE_UPLOAD_CANCEL, async (event, input) => {
    const fail = (code: ProjectCollabErrorCode) =>
      ProjectFileUploadCancelResultSchema.parse(failureBody(code));
    if (!options.authorize(event) || !options.activeAccount()) return fail('authRequired');
    const request = ProjectFileUploadCancelRequestSchema.safeParse(input);
    if (!request.success) return fail('invalidRequest');
    const operation = uploads.get(request.data.operationId);
    const sender = senderOf(event);
    // 换账号后 current account 必然与旧 operation 不同，但同一窗口仍必须能终止旧上传。
    // sender + 不透明 operationId 是取消归属边界；不能用当前账号相等性阻断清理。
    if (operation && sender && operation.sender === sender) {
      operation.controller.abort();
    }
    return ProjectFileUploadCancelResultSchema.parse({ ok: true });
  });

  const downloadFail = (code: ProjectCollabErrorCode) =>
    ProjectFileDownloadResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FILE_DOWNLOAD, downloadFail, async (deps, input) => {
    const request = ProjectFileDownloadRequestSchema.safeParse(input);
    if (!request.success) return downloadFail('invalidRequest');
    return withToken(deps, downloadFail, async (token) => {
      const outcome = await deps.client.downloadFile(token, {
        fileId: request.data.fileId,
        targetDirectory: deps.downloadsDirectory(),
      });
      if (!outcome.ok) return downloadFail(outcome.code);
      return ProjectFileDownloadResultSchema.parse({
        ok: true,
        savedPath: outcome.value.savedPath,
      });
    });
  });

  const promoteFail = (code: ProjectCollabErrorCode) =>
    ProjectFilePromoteResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FILE_PROMOTE, promoteFail, async (deps, input) => {
    const request = ProjectFilePromoteRequestSchema.safeParse(input);
    if (!request.success) return promoteFail('invalidRequest');
    return withToken(deps, promoteFail, async (token) => {
      const outcome = await deps.client.promoteFile(token, request.data);
      if (!outcome.ok) return promoteFail(outcome.code);
      return ProjectFilePromoteResultSchema.parse({ ok: true, file: outcome.value });
    });
  });

  const deleteFail = (code: ProjectCollabErrorCode) =>
    ProjectFileDeleteResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_FILE_DELETE, deleteFail, async (deps, input) => {
    const request = ProjectFileDeleteRequestSchema.safeParse(input);
    if (!request.success) return deleteFail('invalidRequest');
    return withToken(deps, deleteFail, async (token) => {
      const outcome = await deps.client.deleteFile(token, request.data);
      if (!outcome.ok) return deleteFail(outcome.code);
      return ProjectFileDeleteResultSchema.parse({ ok: true });
    });
  });

  // 规划域六条通道：**同一个装配束、同一批门禁**，只是处理器分文件放
  // （projectCollabHandlersPlanning.ts，理由是单文件行数）。
  // ⭐ 在这里一并挂上而不是让 register.ts 再调一次：接线点多一处，就多一个
  //    「忘了挂」的可能，而忘了挂的表现是通道静默不存在（invoke 直接 reject）。
  registerProjectPlanningHandlers(registrar, {
    dependencies: options.dependencies ?? null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
  });

  // 整需求提测三条（TST-02）：同一个装配束、同一批门禁、同一处接线（projectCollabHandlersTesting.ts）。
  registerProjectTestingHandlers(registrar, {
    dependencies: options.dependencies ?? null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
  });

  // 测试轮次的用例五条（TST-04）：同上（projectCollabHandlersTestCases.ts）。
  registerProjectTestCaseHandlers(registrar, {
    dependencies: options.dependencies ?? null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
  });

  // 任务协作五条复用实际客户端与会话鉴权；未装配时仍注册结构化失败出口。
  registerProjectTodoCollaborationHandlers(registrar, {
    dependencies: options.dependencies
      ? {
          collaboration: options.dependencies.client,
          accessToken: options.dependencies.accessToken,
        }
      : null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
  });

  // 工作概览读取使用相同客户端、凭据提供器和发送帧鉴权。
  registerProjectWorkOverviewHandlers(registrar, {
    dependencies: options.dependencies
      ? { overview: options.dependencies.client, accessToken: options.dependencies.accessToken }
      : null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
  });

  // 资产版本域十三条通道：同款处理（同一个装配束、同一批门禁、同一处接线）。
  // ⭐ 进度回推**复用本文件已有的那一套 sender 判定**（销毁即停、换账号即停），
  //    ⛔ 不在资产那一侧重写一份「这个窗口还在不在」。
  registerProjectAssetHandlers(registrar, {
    dependencies: options.dependencies ?? null,
    authorize: options.authorize,
    activeAccount: options.activeAccount,
    sendProgress: (event, snapshot) => {
      const account = options.activeAccount();
      const sender = senderOf(event);
      if (account === null || sender === null || senderDestroyed(sender)) return;
      senderSend(sender, IPC.PROJECT_FILE_UPLOAD_PROGRESS, snapshot);
    },
  });
}

type IpcSender = {
  readonly isDestroyed?: () => boolean;
  readonly send?: (channel: string, payload: unknown) => void;
  readonly once?: (event: 'destroyed', listener: () => void) => void;
  readonly removeListener?: (event: 'destroyed', listener: () => void) => void;
};

function senderOf(event: unknown): object | null {
  if (typeof event !== 'object' || event === null) return null;
  const sender = (event as { readonly sender?: unknown }).sender;
  return typeof sender === 'object' && sender !== null ? sender : null;
}

function senderDestroyed(sender: object): boolean {
  return (sender as IpcSender).isDestroyed?.() === true;
}

function senderSend(sender: object, channel: string, payload: unknown): void {
  (sender as IpcSender).send?.(channel, payload);
}

function senderOnceDestroyed(sender: object, listener: () => void): () => void {
  const target = sender as IpcSender;
  target.once?.('destroyed', listener);
  return () => target.removeListener?.('destroyed', listener);
}
