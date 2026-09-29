import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  ProjectFileUploadProgressSchema,
  type ProjectCollabErrorCode,
  type ProjectFileQuota,
  type ProjectFileUploadProgress,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectAssetDeleteRequestSchema,
  ProjectAssetDeleteResultSchema,
  ProjectAssetListRequestSchema,
  ProjectAssetListResultSchema,
  ProjectAssetRestoreRequestSchema,
  ProjectAssetRestoreResultSchema,
  ProjectAssetTrashListRequestSchema,
  ProjectAssetTrashListResultSchema,
  ProjectAssetUploadAttemptDiscardRequestSchema,
  ProjectAssetUploadAttemptDiscardResultSchema,
  ProjectAssetVersionChainRequestSchema,
  ProjectAssetVersionChainResultSchema,
  ProjectAssetVersionPreviewRequestSchema,
  ProjectAssetVersionPreviewResultSchema,
  ProjectAssetVersionRegisterRequestSchema,
  ProjectAssetVersionRegisterResultSchema,
  ProjectAssetVersionResolveRequestSchema,
  ProjectAssetVersionResolveResultSchema,
  ProjectAssetVersionRestoreRequestSchema,
  ProjectAssetVersionRestoreResultSchema,
  ProjectAssetVersionUploadRequestSchema,
  ProjectAssetVersionUploadResultSchema,
  ProjectAssetVersionUploadResumeRequestSchema,
} from '../../shared/protocol/project-collab-assets.js';
import type { CollabClient } from '../services/collab/collabClient.js';
import { previewAssetVersion } from '../services/collab/projectAssetPreviewService.js';
import {
  ProjectAssetUploadFlow,
  type ProjectAssetUploadOutcome,
} from '../services/collab/projectAssetUploadFlow.js';

/**
 * 资产版本域的 IPC 处理器：十三条通道（清单与共同纪律见 ADR-0037）。
 *
 * 与 `projectCollabHandlers` 是**同一批门禁**：鉴权 → activeAccount → 入参 strictObject
 * 校验 → 取令牌 → 调服务 → **每次 await 后重验 accountKey + authEpoch** → 出参 schema
 * 校验。分文件只为单文件行数（协作面那份已 1000+ 行），装配期由
 * `registerProjectCollabHandlers` 一并挂上，所以 `register.ts` 与主进程接线不变
 * （规划面 `projectCollabHandlersPlanning.ts` 同款先例）。
 *
 * ⛔ **这一层不做角色判定**：谁能传新版本（editor+）、谁能删资产（本人或 owner）全部由
 *    服务端强判。渲染层按 `myRole` 收窄入口只是不给点了必错的按钮。
 *
 * ⚠️ 【路径】上传路径由主进程 `dialog` 弹框自取（复用协作面注入的 `pickUploadFile`），
 *    渲染层递不进也见不到路径；续传记录里的那一份也只活在 Main。
 * ⚠️ 【进度】进度帧走**既有** `project:file-upload-progress` 通道（按 `operationId` 对号）：
 *    多开一条只多一个名字，渲染层反而要订两处。
 */

/**
 * 本组通道要用到的客户端网络面（结构性子集，测试可用对象字面量替身）。
 *
 * 取自真客户端那一份（`CollabClient`）而不是另写一套签名：`listProjectAssets` 等三条是
 * RPT-01 已经落地的方法，`downloadFileBytes` 是 RPT-02 为预览加的取字节入口，
 * 末三条是 RPT-08 的回收站与恢复。
 */
export type ProjectAssetClientPort = Pick<
  CollabClient,
  | 'listProjectAssets'
  | 'listAssetVersions'
  | 'getAssetVersion'
  | 'registerAssetVersion'
  | 'deleteAsset'
  | 'uploadFile'
  | 'downloadFileBytes'
  | 'listDeletedProjectAssets'
  | 'restoreAsset'
  | 'restoreAssetVersion'
>;

export interface ProjectAssetIpcDependencies {
  readonly client: ProjectAssetClientPort;
  readonly accessToken: () => Promise<string | null>;
  /** 上传选档：主进程 `dialog.showOpenDialog`；null＝用户取消。 */
  readonly pickUploadFile: () => Promise<string | null>;
}

export interface ProjectAssetHandlerOptions {
  readonly dependencies?: ProjectAssetIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
  } | null;
  /** 进度定向回推（由协作面注入：只发给发起窗口，窗口销毁即停）。 */
  readonly sendProgress?: (event: unknown, snapshot: ProjectFileUploadProgress) => void;
}

export interface ProjectAssetIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/**
 * 固定文案表：⛔ 不回显服务端文本。
 *
 * 取值闭集与参考编号都来自协作面那一份（`PROJECT_COLLAB_REFERENCE_CODES`），只有文案
 * 按本域改写——同一个页面里不该出现两族参考编号。
 * ⚠️ 业务码另有更贴切的说法（`projectAssetServerCodeText`，共享层），由渲染层按
 *    `serverCode` 就地覆盖；这里给的是拿不到业务码时的那一句。
 */
const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再使用项目资产。',
  invalidRequest: '请求无效，请刷新后重试。',
  tooLarge: '文件超过大小上限。',
  rateLimited: '操作过于频繁，请稍后再试。',
  conflict: '资产版本已被他人更新，请刷新后重试。',
  quotaExceeded: '项目文件已达容量上限。',
  credentialRejected: '登录状态已失效，请重新登录。',
  forbidden: '没有执行该操作的权限。',
  rejected: '请求被服务端拒绝。',
  transient: '网络暂时不可用，请稍后重试。',
  writeFailed: '文件保存失败，请检查磁盘后重试。',
};

function failureBody(code: ProjectCollabErrorCode, serverCode?: string): Record<string, unknown> {
  // 参考编号只从这张登记表取：用户报出来的号与我们日志里认得的号必须是同一个。
  const base = {
    ok: false as const,
    code,
    message: FAILURE_MESSAGES[code],
    referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
  };
  // exactOptionalPropertyTypes 下缺席即不带该键。
  return serverCode === undefined ? base : { ...base, serverCode };
}

export function registerProjectAssetHandlers(
  registrar: ProjectAssetIpcRegistrar,
  options: ProjectAssetHandlerOptions,
): void {
  type ActiveAccount = NonNullable<ReturnType<ProjectAssetHandlerOptions['activeAccount']>>;
  /**
   * 续传记录活在这一层（**进程内**，一个装配束一份），⛔ 不落盘。
   *
   * 不落盘是一次权衡而不是省事：断点里含本机路径，落盘等于把「用户选过哪个文件」留在
   * 磁盘上，而收益只有「重启后还能续」这一件。⚠️ 代价要说清：重启后那份**已上传但未
   * 登记**的字节仍在服务端（配额也仍算着），得由用户在文件列表里显式处理——
   * 服务端侧不会丢、也不会被重复计费（`UNIQUE(file_id)` 让重复登记恒收敛）。
   *
   * 懒构造：挂通道时 `dependencies` 可能还没装配；装配束在进程生命周期内是同一个对象，
   * 所以首次使用时捕获它是安全的，而且能让续传记录跨请求存活（它必须是单例）。
   */
  let uploadFlow: ProjectAssetUploadFlow | null = null;
  const flowFor = (deps: ProjectAssetIpcDependencies): ProjectAssetUploadFlow => {
    // ⚠️ 两个端口都用箭头包一层：直接把方法引用传出去会丢 `this`（客户端是类实例）。
    uploadFlow ??= new ProjectAssetUploadFlow({
      client: {
        uploadFile: (token, input) => deps.client.uploadFile(token, input),
        registerAssetVersion: (token, input) => deps.client.registerAssetVersion(token, input),
        getAssetVersion: (token, input) => deps.client.getAssetVersion(token, input),
      },
      pickFile: () => deps.pickUploadFile(),
    });
    return uploadFlow;
  };

  const ownerKeyOf = (account: ActiveAccount): string =>
    `${account.accountKey}#${account.authEpoch}`;

  const register = <Result>(
    channel: string,
    fail: (code: ProjectCollabErrorCode) => Result,
    run: (
      deps: ProjectAssetIpcDependencies,
      input: unknown,
      event: unknown,
      account: ActiveAccount,
      isCurrent: () => boolean,
    ) => Promise<Result>,
  ): void => {
    registrar.handle(channel, async (event, input) => {
      const account = options.authorize(event) ? options.activeAccount() : null;
      if (!account) return fail('authRequired');
      const deps = options.dependencies ?? null;
      if (!deps) return fail('unavailable');
      const isCurrent = (): boolean => {
        const current = options.authorize(event) ? options.activeAccount() : null;
        return (
          current !== null &&
          current.accountKey === account.accountKey &&
          current.authEpoch === account.authEpoch
        );
      };
      let result: Result;
      try {
        result = await run(deps, input, event, account, isCurrent);
      } catch {
        // 意外异常不跨 IPC 泄露：一律收敛为瞬时失败（可重试）。
        result = fail('transient');
      }
      // 即便续传在取 token 后被拦住、尚未进入 flow，也要释放旧上下文的断点。
      uploadFlow?.invalidateStaleAttempts();
      // 换账号期间在飞的请求一律 denied：不把上一个账号的数据发给下一个账号。
      if (!isCurrent()) {
        return fail('authRequired');
      }
      return result;
    });
  };

  const withToken = async <Result>(
    deps: ProjectAssetIpcDependencies,
    fail: (code: ProjectCollabErrorCode) => Result,
    isCurrent: () => boolean,
    action: (accessToken: string) => Promise<Result>,
  ): Promise<Result> => {
    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      token = null;
    }
    if (!isCurrent()) return fail('authRequired');
    if (token === null) return fail('credentialRejected');
    return action(token);
  };

  /* ── 目录 / 版本链 / 冻结引用 / 登记 / 软删 ───────────────────────────── */

  const listFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_ASSET_LIST, listFail, async (deps, input, _event, _account, isCurrent) => {
    const request = ProjectAssetListRequestSchema.safeParse(input);
    if (!request.success) return listFail('invalidRequest');
    return withToken(deps, listFail, isCurrent, async (token) => {
      const outcome = await deps.client.listProjectAssets(token, request.data);
      if (!outcome.ok) return listFail(outcome.code);
      return ProjectAssetListResultSchema.parse({ ok: true, assets: outcome.value });
    });
  });

  const chainFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetVersionChainResultSchema.parse(failureBody(code));
  register(
    IPC.PROJECT_ASSET_VERSION_LIST,
    chainFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetVersionChainRequestSchema.safeParse(input);
      if (!request.success) return chainFail('invalidRequest');
      return withToken(deps, chainFail, isCurrent, async (token) => {
        const outcome = await deps.client.listAssetVersions(token, request.data);
        if (!outcome.ok) return chainFail(outcome.code);
        return ProjectAssetVersionChainResultSchema.parse({
          ok: true,
          asset: outcome.value.asset,
          // 服务端定序（新版在前），⛔ 这里不重排、不截断。
          versions: outcome.value.versions,
        });
      });
    },
  );

  const resolveFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetVersionResolveResultSchema.parse(failureBody(code));
  register(
    IPC.PROJECT_ASSET_VERSION_RESOLVE,
    resolveFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetVersionResolveRequestSchema.safeParse(input);
      if (!request.success) return resolveFail('invalidRequest');
      return withToken(deps, resolveFail, isCurrent, async (token) => {
        const outcome = await deps.client.getAssetVersion(token, request.data);
        if (!outcome.ok) return resolveFail(outcome.code);
        return ProjectAssetVersionResolveResultSchema.parse({ ok: true, ...outcome.value });
      });
    },
  );

  const registerFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectAssetVersionRegisterResultSchema.parse(failureBody(code, serverCode));
  register(
    IPC.PROJECT_ASSET_VERSION_REGISTER,
    registerFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetVersionRegisterRequestSchema.safeParse(input);
      if (!request.success) return registerFail('invalidRequest');
      return withToken(deps, registerFail, isCurrent, async (token) => {
        const outcome = await deps.client.registerAssetVersion(token, request.data);
        if (!isCurrent()) return registerFail('authRequired');
        if (outcome.ok) {
          return ProjectAssetVersionRegisterResultSchema.parse({
            ok: true,
            ...outcome.value,
            reused: false,
          });
        }
        // ⭐ 已经是某个版本了：把那一版读回来判成成功（幂等收敛），⛔ 不重复落一笔。
        if (outcome.existingVersionId !== undefined) {
          const resolved = await deps.client.getAssetVersion(token, {
            versionId: outcome.existingVersionId,
          });
          if (resolved.ok) {
            return ProjectAssetVersionRegisterResultSchema.parse({
              ok: true,
              ...resolved.value,
              reused: true,
            });
          }
          return registerFail(resolved.code, outcome.serverCode);
        }
        // 业务码透传：「已经是某个版本」与「血统已删」要用户做的事完全不同。
        return registerFail(outcome.code, outcome.serverCode);
      });
    },
  );

  const deleteFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectAssetDeleteResultSchema.parse(failureBody(code, serverCode));
  register(
    IPC.PROJECT_ASSET_DELETE,
    deleteFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetDeleteRequestSchema.safeParse(input);
      if (!request.success) return deleteFail('invalidRequest');
      return withToken(deps, deleteFail, isCurrent, async (token) => {
        const outcome = await deps.client.deleteAsset(token, request.data);
        if (!outcome.ok) return deleteFail(outcome.code);
        return ProjectAssetDeleteResultSchema.parse({ ok: true, id: request.data.assetId });
      });
    },
  );

  /* ── 上传一版 / 取消 / 续传 / 放弃 ───────────────────────────────────── */

  const uploadFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetVersionUploadResultSchema.parse({
      ...failureBody(code),
      quota: null,
      resume: null,
    });

  /** 服务层出参 → 通道出参（失败侧原样带上 quota 与 resume 两个键）。 */
  const uploadResult = (outcome: ProjectAssetUploadOutcome, serverCode?: string) =>
    ProjectAssetVersionUploadResultSchema.parse(
      outcome.ok
        ? outcome
        : {
            ...failureBody(outcome.code, serverCode),
            quota: outcome.quota,
            resume: outcome.resume,
          },
    );

  register(
    IPC.PROJECT_ASSET_VERSION_UPLOAD,
    uploadFail,
    async (deps, input, event, account, isCurrent) => {
      const request = ProjectAssetVersionUploadRequestSchema.safeParse(input);
      if (!request.success) return uploadFail('invalidRequest');
      return withToken(deps, uploadFail, isCurrent, async (token) => {
        const outcome = await flowFor(deps).begin(token, request.data, {
          ownerKey: ownerKeyOf(account),
          isCurrent,
          onProgress: (snapshot) => emitProgress(event, snapshot),
        });
        return uploadResult(outcome);
      });
    },
  );

  register(
    IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME,
    uploadFail,
    async (deps, input, event, account, isCurrent) => {
      const request = ProjectAssetVersionUploadResumeRequestSchema.safeParse(input);
      if (!request.success) return uploadFail('invalidRequest');
      return withToken(deps, uploadFail, isCurrent, async (token) => {
        const outcome = await flowFor(deps).resume(token, request.data, {
          ownerKey: ownerKeyOf(account),
          isCurrent,
          onProgress: (snapshot) => emitProgress(event, snapshot),
        });
        return uploadResult(outcome);
      });
    },
  );

  const attemptFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetUploadAttemptDiscardResultSchema.parse(failureBody(code));

  register(IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL, attemptFail, async (deps, input) => {
    const request = ProjectAssetUploadAttemptDiscardRequestSchema.safeParse(input);
    if (!request.success) return attemptFail('invalidRequest');
    // ⚠️ 幂等回成功：取消一个已经结束（或已越过断点）的操作不是错误，
    //    界面该做的只是收起「取消」按钮，而不是弹一条报错。
    flowFor(deps).cancel(request.data);
    return ProjectAssetUploadAttemptDiscardResultSchema.parse({ ok: true });
  });

  register(
    IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD,
    attemptFail,
    async (deps, input, _event, account) => {
      const request = ProjectAssetUploadAttemptDiscardRequestSchema.safeParse(input);
      if (!request.success) return attemptFail('invalidRequest');
      // 同样幂等：记录不在（已放弃/已完成）也回成功，⛔ 不把「没什么可放弃」报成失败。
      flowFor(deps).discard(request.data, { ownerKey: ownerKeyOf(account) });
      return ProjectAssetUploadAttemptDiscardResultSchema.parse({ ok: true });
    },
  );

  /* ── 预览 ───────────────────────────────────────────────────────────── */

  const previewFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetVersionPreviewResultSchema.parse(failureBody(code));
  register(
    IPC.PROJECT_ASSET_VERSION_PREVIEW,
    previewFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetVersionPreviewRequestSchema.safeParse(input);
      if (!request.success) return previewFail('invalidRequest');
      return withToken(deps, previewFail, isCurrent, async (token) => {
        const outcome = await previewAssetVersion(
          {
            client: {
              getAssetVersion: (accessToken, value) =>
                isCurrent()
                  ? deps.client.getAssetVersion(accessToken, value)
                  : Promise.resolve({ ok: false, code: 'credentialRejected' }),
              downloadFileBytes: (accessToken, value) =>
                isCurrent()
                  ? deps.client.downloadFileBytes(accessToken, value)
                  : Promise.resolve({ ok: false, code: 'credentialRejected' }),
            },
          },
          token,
          request.data,
        );
        if (!outcome.ok) return previewFail(outcome.code);
        return ProjectAssetVersionPreviewResultSchema.parse(outcome);
      });
    },
  );

  /* ── 回收站与历史版本恢复（RPT-08）──────────────────────────────────────── */

  // 回收站列表与目录同一口径：失败只给固定文案 + 参考编号（读路径没有要用户分辨的业务原因）。
  const trashFail = (code: ProjectCollabErrorCode) =>
    ProjectAssetTrashListResultSchema.parse(failureBody(code));
  register(
    IPC.PROJECT_ASSET_TRASH_LIST,
    trashFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetTrashListRequestSchema.safeParse(input);
      if (!request.success) return trashFail('invalidRequest');
      return withToken(deps, trashFail, isCurrent, async (token) => {
        const outcome = await deps.client.listDeletedProjectAssets(token, request.data);
        if (!outcome.ok) return trashFail(outcome.code);
        // 服务端定序（最近删的在前），⛔ 这里不重排、不截断。
        return ProjectAssetTrashListResultSchema.parse({ ok: true, assets: outcome.value });
      });
    },
  );

  // ⭐ 两条恢复都**透传业务码**：「不是本人也不是拥有者」「已不在回收站」「已在回收站」
  //    「指纹不符」「字节缺失」要用户做的事各不相同，⛔ 不塌缩成一句「请求被服务端拒绝」。
  //    业务码只是短标识符（网络面按正则挑出），服务端的自由文案仍一个字不回显。
  const restoreFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectAssetRestoreResultSchema.parse(failureBody(code, serverCode));
  register(
    IPC.PROJECT_ASSET_RESTORE,
    restoreFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetRestoreRequestSchema.safeParse(input);
      if (!request.success) return restoreFail('invalidRequest');
      return withToken(deps, restoreFail, isCurrent, async (token) => {
        const outcome = await deps.client.restoreAsset(token, request.data);
        if (!outcome.ok) return restoreFail(outcome.code, outcome.serverCode);
        return ProjectAssetRestoreResultSchema.parse({ ok: true, asset: outcome.value });
      });
    },
  );

  const versionRestoreFail = (
    code: ProjectCollabErrorCode,
    serverCode?: string,
    quota: ProjectFileQuota | null = null,
  ) => ProjectAssetVersionRestoreResultSchema.parse({ ...failureBody(code, serverCode), quota });
  const versionRestoreGateFail = (code: ProjectCollabErrorCode) => versionRestoreFail(code);
  register(
    IPC.PROJECT_ASSET_VERSION_RESTORE,
    versionRestoreGateFail,
    async (deps, input, _event, _account, isCurrent) => {
      const request = ProjectAssetVersionRestoreRequestSchema.safeParse(input);
      if (!request.success) return versionRestoreGateFail('invalidRequest');
      return withToken(deps, versionRestoreGateFail, isCurrent, async (token) => {
        const outcome = await deps.client.restoreAssetVersion(token, request.data);
        if (!outcome.ok) {
          return versionRestoreFail(outcome.code, outcome.serverCode, outcome.quota ?? null);
        }
        return ProjectAssetVersionRestoreResultSchema.parse({ ok: true, ...outcome.value });
      });
    },
  );

  function emitProgress(event: unknown, snapshot: ProjectFileUploadProgress): void {
    // 契约校验放在发送前：坏帧不进渲染层（与既有上传进度同一条纪律）。
    const parsed = ProjectFileUploadProgressSchema.safeParse(snapshot);
    if (!parsed.success) return;
    options.sendProgress?.(event, parsed.data);
  }
}
