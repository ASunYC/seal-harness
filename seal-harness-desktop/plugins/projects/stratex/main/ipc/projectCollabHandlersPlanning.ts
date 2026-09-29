import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectIterationCreateRequestSchema,
  ProjectIterationCreateResultSchema,
  ProjectIterationListRequestSchema,
  ProjectIterationListResultSchema,
  ProjectIterationRequirementLinkRequestSchema,
  ProjectIterationRequirementLinkResultSchema,
  ProjectIterationRequirementListRequestSchema,
  ProjectIterationRequirementListResultSchema,
  ProjectIterationRequirementUnlinkRequestSchema,
  ProjectIterationRequirementUnlinkResultSchema,
  ProjectIterationUpdateRequestSchema,
  ProjectIterationUpdateResultSchema,
  ProjectMilestoneCreateRequestSchema,
  ProjectMilestoneCreateResultSchema,
  ProjectMilestoneListRequestSchema,
  ProjectMilestoneListResultSchema,
  ProjectMilestoneUpdateRequestSchema,
  ProjectMilestoneUpdateResultSchema,
  type ProjectIterationListItem,
  type ProjectMilestoneListItem,
} from '../../shared/protocol/project-planning.js';
import {
  openablePlanningEvidenceLink,
  ProjectEvidenceLinkOpenRequestSchema,
  ProjectEvidenceLinkOpenResultSchema,
  ProjectIterationLifecycleEventListRequestSchema,
  ProjectIterationLifecycleEventListResultSchema,
  ProjectIterationLifecycleRequestSchema,
  ProjectIterationLifecycleResultSchema,
  ProjectMilestoneLifecycleEventListRequestSchema,
  ProjectMilestoneLifecycleEventListResultSchema,
  ProjectMilestoneLifecycleRequestSchema,
  ProjectMilestoneLifecycleResultSchema,
  type ProjectIterationLifecycleRequest,
  type ProjectMilestoneLifecycleRequest,
} from '../../shared/protocol/project-planning-lifecycle.js';
import {
  ProjectIterationScheduleSaveRequestSchema,
  ProjectIterationScheduleSaveResultSchema,
  ProjectRequirementPlacementListRequestSchema,
  ProjectRequirementPlacementListResultSchema,
  ProjectRequirementScheduleSaveRequestSchema,
  ProjectRequirementScheduleSaveResultSchema,
  type ProjectIterationScheduleConflict,
  type ProjectRequirementScheduleConflict,
} from '../../shared/protocol/project-planning-schedule.js';
import { isPermittedExternalLink } from '../app/externalLinkPolicy.js';
import type { CollabClientOutcome } from '../services/collab/collabClient.js';
import type { IterationRequirementWrite } from '../services/collab/collabPlanningClient.js';
import type { CollabPlanningClient } from '../services/collab/collabPlanningClient.js';

/**
 * 规划域（业务目标 / 多轮迭代 / 迭代↔需求关联历史 / 完成·重开留证）的 IPC 处理器：
 * 九条 CRUD 与关联通道 + 六条生命周期通道（MIL-07）。
 *
 * 与 `projectCollabHandlers` 是**同一批门禁**：鉴权 → activeAccount → 入参
 * strictObject 校验 → 取令牌 → 调客户端 → **每次 await 后重验 accountKey + authEpoch**
 * → 出参 schema 校验。分文件只为单文件行数（那份已 1000+ 行），装配期由
 * `registerProjectCollabHandlers` 一并挂上，所以 `register.ts` 与主进程接线不变。
 *
 * ⛔ **这一层不做角色判定**：角色档位（目标 manager+ / 轮次新建与修改 manager+，轮次
 *    PATCH 只有 manager+ 一档——排期归管理者和拥有者）全部由服务端强判。渲染层的按钮
 *    显隐只是不给点了必错的入口——把判定挪到这里会得到两份会各自演化的权限表，而只有
 *    服务端那份拦得住绕过界面的调用。
 *
 * ⚠️ 【账号】账号一律由 Main 从会话态推导——请求契约里结构性没有账号字段。
 * ⚠️ 幂等键 `clientRequestId` 由调用方（渲染层）生成并在重试时**保持不变**；本层原样
 *    透传，不替它重新生成——在这里生成等于每次重试都是一个新请求，幂等就没了。
 */

/** 客户端网络面（结构性子集，测试可用对象字面量替身）。 */
export type ProjectPlanningClientPort = Pick<
  CollabPlanningClient,
  | 'listMilestones'
  | 'createMilestone'
  | 'updateMilestone'
  | 'listIterations'
  | 'createIteration'
  | 'updateIteration'
  | 'listIterationRequirements'
  | 'linkIterationRequirement'
  | 'unlinkIterationRequirement'
  | 'saveIterationSchedule'
  | 'saveRequirementSchedule'
  | 'listRequirementPlacements'
  | 'completeMilestone'
  | 'reopenMilestone'
  | 'completeIteration'
  | 'reopenIteration'
  | 'listMilestoneEvents'
  | 'listIterationEvents'
>;

/** 本组通道需要的依赖切片（与协作面共用同一个 dependencies 对象上的两个键）。 */
export interface ProjectPlanningIpcDependencies {
  readonly planning: ProjectPlanningClientPort;
  readonly accessToken: () => Promise<string | null>;
  /**
   * 把一个已过二次校验的外部链接交系统浏览器（生产接 `shell.openExternal`，ADR-0036）。
   * ⚠️ 只在 `project:evidence-link-open` 处理器里、乙档判定（ADR-0041）与 `openablePlanningEvidenceLink` 之后调用。
   */
  readonly openExternalLink: (url: string) => Promise<void | string>;
}

export interface ProjectPlanningHandlerOptions {
  readonly dependencies?: ProjectPlanningIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
  } | null;
}

export interface ProjectPlanningIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/**
 * 固定文案表：⛔ 不回显服务端文本（错误体是不可信输入，也可能夹带内部细节）。
 *
 * 取值闭集与参考编号都来自协作面那一份（`PROJECT_COLLAB_REFERENCE_CODES`），
 * 只有文案按本域改写——同一个页面里不该出现两族参考编号。
 */
const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再维护业务目标与迭代。',
  invalidRequest: '填写的内容不合法，请检查后重试。',
  tooLarge: '内容超出大小上限。',
  rateLimited: '操作过于频繁，请稍后再试。',
  // 本域 409 有三种来路：版本冲突、同编号异内容、同编号并发在途。
  // 具体哪一种由 serverCode 带给渲染层；这句是拿不到业务码时的兜底。
  conflict: '内容已被他人更新，请刷新后重试。',
  quotaExceeded: '已达容量上限。',
  credentialRejected: '登录状态已失效，请重新登录。',
  forbidden: '没有执行该操作的权限。',
  rejected: '请求被服务端拒绝。',
  transient: '网络暂时不可用，请稍后重试。',
  writeFailed: '保存失败，请稍后重试。',
};

function failureBody(code: ProjectCollabErrorCode, serverCode?: string): Record<string, unknown> {
  const base = {
    ok: false as const,
    code,
    message: FAILURE_MESSAGES[code],
    referenceCode: PROJECT_COLLAB_REFERENCE_CODES[code],
  };
  // exactOptionalPropertyTypes 下缺席即不带该键。
  return serverCode === undefined ? base : { ...base, serverCode };
}

export function registerProjectPlanningHandlers(
  registrar: ProjectPlanningIpcRegistrar,
  options: ProjectPlanningHandlerOptions,
): void {
  type ActiveAccount = NonNullable<ReturnType<ProjectPlanningHandlerOptions['activeAccount']>>;

  const register = <Result>(
    channel: string,
    fail: (code: ProjectCollabErrorCode) => Result,
    run: (
      deps: ProjectPlanningIpcDependencies,
      input: unknown,
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
        result = await run(deps, input, account);
      } catch {
        // 意外异常不跨 IPC 泄露：一律收敛为瞬时失败（可重试）。
        result = fail('transient');
      }
      // 换账号期间在飞的请求一律 denied：不把上一个账号的数据发给下一个账号。
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

  const withToken = async <Result>(
    deps: ProjectPlanningIpcDependencies,
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

  /* ── 业务目标 ─────────────────────────────────────────────────────────── */

  const milestoneListFail = (code: ProjectCollabErrorCode) =>
    ProjectMilestoneListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_MILESTONE_LIST, milestoneListFail, async (deps, input) => {
    const request = ProjectMilestoneListRequestSchema.safeParse(input);
    if (!request.success) return milestoneListFail('invalidRequest');
    return withToken(deps, milestoneListFail, async (token) => {
      const outcome = await deps.planning.listMilestones(token, request.data);
      if (!outcome.ok) return milestoneListFail(outcome.code);
      return ProjectMilestoneListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
      });
    });
  });

  const milestoneCreateFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectMilestoneCreateResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_MILESTONE_CREATE, milestoneCreateFail, async (deps, input) => {
    const request = ProjectMilestoneCreateRequestSchema.safeParse(input);
    if (!request.success) return milestoneCreateFail('invalidRequest');
    return withToken(deps, milestoneCreateFail, async (token) => {
      const outcome = await deps.planning.createMilestone(token, request.data);
      // serverCode 透传：`idempotency_conflict`（换个编号）与 `idempotency_retry`
      // （重试一次即可）对用户要做的下一步完全不同，塌缩成一句就等于什么都没说。
      if (!outcome.ok) return milestoneCreateFail(outcome.code, outcome.serverCode);
      return ProjectMilestoneCreateResultSchema.parse({ ok: true, milestone: outcome.value });
    });
  });

  // 更新失败形状独有 currentVersion：仅 conflict 且服务端带回版本时非空。
  const milestoneUpdateFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectMilestoneUpdateResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  register(
    IPC.PROJECT_MILESTONE_UPDATE,
    (code) => milestoneUpdateFail(code),
    async (deps, input) => {
      const request = ProjectMilestoneUpdateRequestSchema.safeParse(input);
      if (!request.success) return milestoneUpdateFail('invalidRequest');
      return withToken(
        deps,
        (code) => milestoneUpdateFail(code),
        async (token) => {
          const outcome = await deps.planning.updateMilestone(token, request.data);
          if (!outcome.ok) {
            return milestoneUpdateFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectMilestoneUpdateResultSchema.parse({ ok: true, milestone: outcome.value });
        },
      );
    },
  );

  /* ── 多轮迭代 ─────────────────────────────────────────────────────────── */

  const iterationListFail = (code: ProjectCollabErrorCode) =>
    ProjectIterationListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_ITERATION_LIST, iterationListFail, async (deps, input) => {
    const request = ProjectIterationListRequestSchema.safeParse(input);
    if (!request.success) return iterationListFail('invalidRequest');
    return withToken(deps, iterationListFail, async (token) => {
      const outcome = await deps.planning.listIterations(token, request.data);
      if (!outcome.ok) return iterationListFail(outcome.code);
      return ProjectIterationListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
        // ⚠️ 分组计数原样透传：⛔ 不在这里相加当总数（同一轮会同时进两组）。
        groupCounts: outcome.value.groupCounts,
      });
    });
  });

  const iterationCreateFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectIterationCreateResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_ITERATION_CREATE, iterationCreateFail, async (deps, input) => {
    const request = ProjectIterationCreateRequestSchema.safeParse(input);
    if (!request.success) return iterationCreateFail('invalidRequest');
    return withToken(deps, iterationCreateFail, async (token) => {
      const outcome = await deps.planning.createIteration(token, request.data);
      // `milestone_archived` / `milestone_not_found` 同样经 serverCode 到渲染层：
      // 「那个目标已归档」与「网络不好」要用户做的事完全不同。
      if (!outcome.ok) return iterationCreateFail(outcome.code, outcome.serverCode);
      return ProjectIterationCreateResultSchema.parse({ ok: true, iteration: outcome.value });
    });
  });

  const iterationUpdateFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectIterationUpdateResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  register(
    IPC.PROJECT_ITERATION_UPDATE,
    (code) => iterationUpdateFail(code),
    async (deps, input) => {
      const request = ProjectIterationUpdateRequestSchema.safeParse(input);
      if (!request.success) return iterationUpdateFail('invalidRequest');
      return withToken(
        deps,
        (code) => iterationUpdateFail(code),
        async (token) => {
          const outcome = await deps.planning.updateIteration(token, request.data);
          if (!outcome.ok) {
            return iterationUpdateFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectIterationUpdateResultSchema.parse({ ok: true, iteration: outcome.value });
        },
      );
    },
  );
  /* ── 迭代 ↔ 需求：关联历史 ─────────────────────────────────────────────── */

  const requirementListFail = (code: ProjectCollabErrorCode) =>
    ProjectIterationRequirementListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_ITERATION_REQUIREMENT_LIST, requirementListFail, async (deps, input) => {
    const request = ProjectIterationRequirementListRequestSchema.safeParse(input);
    if (!request.success) return requirementListFail('invalidRequest');
    return withToken(deps, requirementListFail, async (token) => {
      const outcome = await deps.planning.listIterationRequirements(token, request.data);
      if (!outcome.ok) return requirementListFail(outcome.code);
      return ProjectIterationRequirementListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
      });
    });
  });

  /**
   * 关联 / 移出两条写通道的成功出参**形状只拼一次**。
   *
   * ⚠️ `changed=false` 走**成功**分支：它是「幂等命中 / 本来就是这个状态」，不是失败。
   *    ⛔ 把它翻成 conflict 会让渲染层给用户弹一个不存在的错误。
   */
  const requirementWriteBody = (value: IterationRequirementWrite): Record<string, unknown> => ({
    ok: true,
    changed: value.changed,
    link: value.link,
    iteration: value.iteration,
    requirementId: value.requirementId,
    previousIterationId: value.previousIterationId,
  });

  // 失败形状与目标/轮次更新同款：仅 conflict 且服务端带回版本时 currentVersion 非空。
  const requirementLinkFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectIterationRequirementLinkResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  register(
    IPC.PROJECT_ITERATION_REQUIREMENT_LINK,
    (code) => requirementLinkFail(code),
    async (deps, input) => {
      const request = ProjectIterationRequirementLinkRequestSchema.safeParse(input);
      if (!request.success) return requirementLinkFail('invalidRequest');
      return withToken(
        deps,
        (code) => requirementLinkFail(code),
        async (token) => {
          const outcome = await deps.planning.linkIterationRequirement(token, request.data);
          if (!outcome.ok) {
            // serverCode 透传：`iteration_archived` / `milestone_archived` /
            // `requirement_kind_required` / `idempotency_*` 对用户要做的下一步各不相同。
            return requirementLinkFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectIterationRequirementLinkResultSchema.parse(
            requirementWriteBody(outcome.value),
          );
        },
      );
    },
  );

  const requirementUnlinkFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectIterationRequirementUnlinkResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  register(
    IPC.PROJECT_ITERATION_REQUIREMENT_UNLINK,
    (code) => requirementUnlinkFail(code),
    async (deps, input) => {
      const request = ProjectIterationRequirementUnlinkRequestSchema.safeParse(input);
      if (!request.success) return requirementUnlinkFail('invalidRequest');
      return withToken(
        deps,
        (code) => requirementUnlinkFail(code),
        async (token) => {
          const outcome = await deps.planning.unlinkIterationRequirement(token, request.data);
          if (!outcome.ok) {
            return requirementUnlinkFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
              outcome.serverCode,
            );
          }
          return ProjectIterationRequirementUnlinkResultSchema.parse(
            requirementWriteBody(outcome.value),
          );
        },
      );
    },
  );

  /* ── 迭代排期整批保存（MIL-06）──────────────────────────────────────────── */

  // 失败形状独有 conflicts：恒在，仅版本冲突时非空（服务端一次收齐全部过期条目）。
  const scheduleSaveFail = (
    code: ProjectCollabErrorCode,
    conflicts: readonly ProjectIterationScheduleConflict[] = [],
    serverCode?: string,
  ) =>
    ProjectIterationScheduleSaveResultSchema.parse({
      ...failureBody(code, serverCode),
      conflicts,
    });
  register(
    IPC.PROJECT_ITERATION_SCHEDULE_SAVE,
    (code) => scheduleSaveFail(code),
    async (deps, input) => {
      const request = ProjectIterationScheduleSaveRequestSchema.safeParse(input);
      if (!request.success) return scheduleSaveFail('invalidRequest');
      return withToken(
        deps,
        (code) => scheduleSaveFail(code),
        async (token) => {
          const outcome = await deps.planning.saveIterationSchedule(token, request.data);
          if (!outcome.ok) {
            // serverCode 透传：version_conflict / idempotency_conflict / idempotency_retry /
            // iteration_completed / schedule_out_of_period 对用户要做的下一步各不相同。
            return scheduleSaveFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.conflicts ?? []) : [],
              outcome.serverCode,
            );
          }
          return ProjectIterationScheduleSaveResultSchema.parse({
            ok: true,
            changed: outcome.value.changed,
            iterations: outcome.value.iterations,
          });
        },
      );
    },
  );

  /* ── 安排需求整批保存（MIL-09，ADR-0038）──────────────────────────────────── */

  // 失败形状同排期保存：conflicts 恒在，仅冲突时可能非空（当前版本 + 当前排在哪一轮）。
  const requirementScheduleFail = (
    code: ProjectCollabErrorCode,
    conflicts: readonly ProjectRequirementScheduleConflict[] = [],
    serverCode?: string,
  ) =>
    ProjectRequirementScheduleSaveResultSchema.parse({
      ...failureBody(code, serverCode),
      conflicts,
    });
  register(
    IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE,
    (code) => requirementScheduleFail(code),
    async (deps, input) => {
      const request = ProjectRequirementScheduleSaveRequestSchema.safeParse(input);
      if (!request.success) return requirementScheduleFail('invalidRequest');
      return withToken(
        deps,
        (code) => requirementScheduleFail(code),
        async (token) => {
          const outcome = await deps.planning.saveRequirementSchedule(token, request.data);
          if (!outcome.ok) {
            // serverCode 透传：version_conflict / milestone_archived / iteration_archived /
            // idempotency_* 对用户要做的下一步各不相同。
            return requirementScheduleFail(
              outcome.code,
              outcome.code === 'conflict' ? (outcome.conflicts ?? []) : [],
              outcome.serverCode,
            );
          }
          return ProjectRequirementScheduleSaveResultSchema.parse({
            ok: true,
            changed: outcome.value.changed,
            iterations: outcome.value.iterations,
            moves: outcome.value.moves,
          });
        },
      );
    },
  );

  // 需求排期现状（读）：失败只带 serverCode；成功原样透传服务端未排条数（⛔ 不在这里重算）。
  const placementListFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRequirementPlacementListResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST, placementListFail, async (deps, input) => {
    const request = ProjectRequirementPlacementListRequestSchema.safeParse(input);
    if (!request.success) return placementListFail('invalidRequest');
    return withToken(deps, placementListFail, async (token) => {
      const outcome = await deps.planning.listRequirementPlacements(token, request.data);
      if (!outcome.ok) return placementListFail(outcome.code, outcome.serverCode);
      return ProjectRequirementPlacementListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
        unscheduledTotal: outcome.value.unscheduledTotal,
        ...(outcome.value.selectionScope !== undefined
          ? { selectionScope: outcome.value.selectionScope }
          : {}),
        ...(outcome.value.groupRootId !== undefined
          ? { groupRootId: outcome.value.groupRootId }
          : {}),
        ...(outcome.value.groupComplete !== undefined
          ? { groupComplete: outcome.value.groupComplete }
          : {}),
      });
    });
  });

  /* ── 生命周期：记录达成 / 重新打开 / 阶段记录（MIL-07）───────────────────── */
  /*
   * ⭐ 失败形状与更新同款：仅 conflict 且服务端带回版本时 currentVersion 非空；serverCode 原样
   *    透传——`completion_evidence_required`（去补证据）、`milestone_has_open_rounds`（先收口
   *    轮次）、`idempotency_conflict`（换号）对用户要做的下一步各不相同，塌成一句等于没说。
   * ⛔ 本层不判「完成要证据、重开要原因」：必填差异是服务端业务规则，挪到这里就有了第二份。
   * ⛔ 说明 / 证据 / 原因只在请求体与阶段记录出参里过手，本层不记录、不打印。
   */

  const milestoneLifecycleFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectMilestoneLifecycleResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  const registerMilestoneLifecycle = (
    channel: string,
    send: (
      deps: ProjectPlanningIpcDependencies,
      token: string,
      request: ProjectMilestoneLifecycleRequest,
    ) => Promise<CollabClientOutcome<ProjectMilestoneListItem>>,
  ): void =>
    register(
      channel,
      (code) => milestoneLifecycleFail(code),
      async (deps, input) => {
        const request = ProjectMilestoneLifecycleRequestSchema.safeParse(input);
        if (!request.success) return milestoneLifecycleFail('invalidRequest');
        return withToken(
          deps,
          (code) => milestoneLifecycleFail(code),
          async (token) => {
            const outcome = await send(deps, token, request.data);
            if (!outcome.ok) {
              return milestoneLifecycleFail(
                outcome.code,
                outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
                outcome.serverCode,
              );
            }
            return ProjectMilestoneLifecycleResultSchema.parse({
              ok: true,
              milestone: outcome.value,
            });
          },
        );
      },
    );
  registerMilestoneLifecycle(IPC.PROJECT_MILESTONE_COMPLETE, (deps, token, request) =>
    deps.planning.completeMilestone(token, request),
  );
  registerMilestoneLifecycle(IPC.PROJECT_MILESTONE_REOPEN, (deps, token, request) =>
    deps.planning.reopenMilestone(token, request),
  );

  const iterationLifecycleFail = (
    code: ProjectCollabErrorCode,
    currentVersion: number | null = null,
    serverCode?: string,
  ) =>
    ProjectIterationLifecycleResultSchema.parse({
      ...failureBody(code, serverCode),
      currentVersion,
    });
  const registerIterationLifecycle = (
    channel: string,
    send: (
      deps: ProjectPlanningIpcDependencies,
      token: string,
      request: ProjectIterationLifecycleRequest,
    ) => Promise<CollabClientOutcome<ProjectIterationListItem>>,
  ): void =>
    register(
      channel,
      (code) => iterationLifecycleFail(code),
      async (deps, input) => {
        const request = ProjectIterationLifecycleRequestSchema.safeParse(input);
        if (!request.success) return iterationLifecycleFail('invalidRequest');
        return withToken(
          deps,
          (code) => iterationLifecycleFail(code),
          async (token) => {
            const outcome = await send(deps, token, request.data);
            if (!outcome.ok) {
              return iterationLifecycleFail(
                outcome.code,
                outcome.code === 'conflict' ? (outcome.currentVersion ?? null) : null,
                outcome.serverCode,
              );
            }
            return ProjectIterationLifecycleResultSchema.parse({
              ok: true,
              iteration: outcome.value,
            });
          },
        );
      },
    );
  registerIterationLifecycle(IPC.PROJECT_ITERATION_COMPLETE, (deps, token, request) =>
    deps.planning.completeIteration(token, request),
  );
  registerIterationLifecycle(IPC.PROJECT_ITERATION_REOPEN, (deps, token, request) =>
    deps.planning.reopenIteration(token, request),
  );

  // 阶段记录：读侧失败只带 serverCode（`milestone_not_found` 等），没有版本号。
  const milestoneEventsFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectMilestoneLifecycleEventListResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_MILESTONE_EVENTS, milestoneEventsFail, async (deps, input) => {
    const request = ProjectMilestoneLifecycleEventListRequestSchema.safeParse(input);
    if (!request.success) return milestoneEventsFail('invalidRequest');
    return withToken(deps, milestoneEventsFail, async (token) => {
      const outcome = await deps.planning.listMilestoneEvents(token, request.data);
      if (!outcome.ok) return milestoneEventsFail(outcome.code, outcome.serverCode);
      return ProjectMilestoneLifecycleEventListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
      });
    });
  });

  const iterationEventsFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectIterationLifecycleEventListResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_ITERATION_EVENTS, iterationEventsFail, async (deps, input) => {
    const request = ProjectIterationLifecycleEventListRequestSchema.safeParse(input);
    if (!request.success) return iterationEventsFail('invalidRequest');
    return withToken(deps, iterationEventsFail, async (token) => {
      const outcome = await deps.planning.listIterationEvents(token, request.data);
      if (!outcome.ok) return iterationEventsFail(outcome.code, outcome.serverCode);
      return ProjectIterationLifecycleEventListResultSchema.parse({
        ok: true,
        items: outcome.value.items,
        total: outcome.value.total,
        page: outcome.value.page,
        pageSize: outcome.value.pageSize,
      });
    });
  });

  /* ── 打开证据引用里的外部链接（ADR-0036）───────────────────────────────────── */

  const evidenceLinkFail = (code: ProjectCollabErrorCode) =>
    ProjectEvidenceLinkOpenResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_EVIDENCE_LINK_OPEN, evidenceLinkFail, async (deps, input) => {
    const request = ProjectEvidenceLinkOpenRequestSchema.safeParse(input);
    if (!request.success) return evidenceLinkFail('invalidRequest');
    // ⛔ 乙档判定（安全编码规范 1.6，ADR-0041）判**原始输入**，必须排在文法层规范化之前：解析器会把主机段里的
    //    变体选择符、软连字符静默吞掉，把路径里的字母标记、标签字符转成百分号编码——规范化之后再判就看不见了，
    //    界面上的地址与真正打开的地址会对不上。这一道只收紧、不替代下面的文法层。
    //    这一行由同名测试文件里的四条码点用例守护，guard-external-link-open 不见证它（登记表第 7 条只见证下面的
    //    openablePlanningEvidenceLink）——删掉它守卫照样绿。
    if (!isPermittedExternalLink(request.data.url)) return evidenceLinkFail('invalidRequest');
    // ⛔ 主进程二次校验：渲染层判过「可点」也不作数——先过外部链接文法，再用 Node 的 WHATWG 解析器解一遍
    //    （仍是 http/https、无账号密码、主机非空）。去掉这一道，`javascript:` / `file:` 与根本不是地址的串
    //    就会被交给系统去处理。交出去的是解析器规范化后的地址。
    const link = openablePlanningEvidenceLink(request.data.url, (raw) => new URL(raw));
    if (link === null) return evidenceLinkFail('invalidRequest');
    try {
      const url = await deps.openExternalLink(link.href);
      if (url) return ProjectEvidenceLinkOpenResultSchema.parse({ ok: true, url });
    } catch {
      // ⛔ 失败不回显、不记录地址（地址是用户写的正文，不进日志）。
      return evidenceLinkFail('transient');
    }
    return ProjectEvidenceLinkOpenResultSchema.parse({ ok: true });
  });
}
