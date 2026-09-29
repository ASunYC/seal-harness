import { IPC } from '../../shared/ipc/channels.js';
import type { z } from 'zod';
import type { CollabClientOutcome } from '../services/collab/collabClient.js';
import {
  ProjectTestCaseExecuteRequestSchema,
  ProjectTestCaseExecuteResultSchema,
  ProjectTestExecutionsRequestSchema,
  ProjectTestExecutionsResultSchema,
} from '../../shared/protocol/project-testing-cases.js';
import {
  ProjectTestDefectActionRequestSchema,
  ProjectTestDefectActionResultSchema,
  ProjectTestDefectsRequestSchema,
  ProjectTestDefectsResultSchema,
  ProjectTestDefectDetailRequestSchema,
  ProjectTestDefectDetailResultSchema,
} from '../../shared/protocol/project-testing-defects.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectRequirementSubmissionsRequestSchema,
  ProjectRequirementSubmissionsResultSchema,
  ProjectRequirementSubmitRequestSchema,
  ProjectRequirementSubmitResultSchema,
  ProjectSubmissionDetailRequestSchema,
  ProjectSubmissionDetailResultSchema,
  ProjectTestRoundActionRequestSchema,
  ProjectTestRoundActionResultSchema,
  ProjectTestRoundActionsRequestSchema,
  ProjectTestRoundActionsResultSchema,
  ProjectTestRoundsRequestSchema,
  ProjectTestRoundsResultSchema,
} from '../../shared/protocol/project-testing.js';
import type { CollabTestingClient } from '../services/collab/collabTestingClient.js';

/**
 * 整需求测试域的 IPC 处理器：提交、轮次详情，以及执行、缺陷和结论的生命周期入口。
 *
 * 与 `projectCollabHandlers` 是**同一批门禁**：鉴权 → activeAccount → 入参 strictObject 校验 → 取令牌 →
 * 调客户端 → **每次 await 后重验 accountKey + authEpoch** → 出参 schema 校验。分文件只为单文件行数
 * （同 `projectCollabHandlersPlanning.ts` 的先例），装配期由 `registerProjectCollabHandlers` 一并挂上，
 * 所以 `register.ts` 与主进程接线不变。⛔ 本文件不直接碰 ipcMain：一律经注入的 registrar 注册，
 * 所有通道均受发送帧门禁（ADR-0039）保护。
 *
 * ⛔ **这一层不做角色与独立性判定**：只有需求处理人能提交、测试负责人不能是处理人或本轮提交人
 *    （D-TEST-01 选 A）、测试负责人须在册可编辑、项目提交门槛——全部由服务端强判。
 * ⚠️ 【账号】账号一律由 Main 从会话态推导——请求契约里结构性没有账号字段。
 * ⚠️ 幂等键 `clientRequestId` 由渲染层生成、在同一次打开弹窗的重试里保持不变；本层原样透传，⛔ 不重新生成。
 * ⚠️ 失败体透传 `serverCode`：同一个 409 / 422 底下是十几种要用户做不同事的原因（版本冲突 / 已在测 /
 *    旧评审未结 / 任务没做完…），⛔ 丢了码渲染层只剩一句「请求被服务端拒绝」。
 */

/** 客户端网络面（结构性子集，测试可用对象字面量替身）。 */
export type ProjectTestingClientPort = Pick<
  CollabTestingClient,
  | 'submitRequirementForTest'
  | 'listRequirementSubmissions'
  | 'fetchRequirementSubmission'
  | 'actOnTestRound'
  | 'listTestRoundActions'
  | 'listProjectTestRounds'
  | 'executeTestCase'
  | 'listTestExecutions'
  | 'actOnTestDefect'
  | 'listTestDefects'
  | 'fetchTestDefect'
>;

/** 本组通道需要的依赖切片（与协作面共用同一个 dependencies 对象上的两个键）。 */
export interface ProjectTestingIpcDependencies {
  readonly testing: ProjectTestingClientPort;
  readonly accessToken: () => Promise<string | null>;
}

export interface ProjectTestingHandlerOptions {
  readonly dependencies?: ProjectTestingIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
  } | null;
}

export interface ProjectTestingIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/**
 * 固定文案表：⛔ 不回显服务端文本（错误体是不可信输入，也可能夹带内部细节）。
 * 取值闭集与参考编号都来自协作面那一份（`PROJECT_COLLAB_REFERENCE_CODES`）；具体原因由 serverCode
 * 带给渲染层按共享层文案表覆盖，这里只是拿不到业务码时的兜底。
 */
const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再提交需求测试。',
  invalidRequest: '填写的内容不合法，请检查后重试。',
  tooLarge: '内容超出大小上限。',
  rateLimited: '操作过于频繁，请稍后再试。',
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

/** 提交失败的来路：门禁 / 入参 / 令牌挡下的只有 `code`，网络面回来的另带业务码与附加字段。 */
interface SubmitFailureInput {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly currentVersion?: number | undefined;
  readonly unfinishedTaskIds?: readonly string[] | undefined;
  readonly unfinishedTaskCount?: number | undefined;
  readonly legacyOpenReviewCount?: number | undefined;
}

/** 提交失败信封：四个附加键结构只有一种形状，取不到一律 null（门禁挡下的失败同样带齐）。 */
function submitFailureBody(failure: SubmitFailureInput): Record<string, unknown> {
  return {
    ...failureBody(failure.code, failure.serverCode),
    // 版本号只属于冲突：别的失败码即便带着它也清成 null（与改单通道同一条纪律）。
    currentVersion: failure.code === 'conflict' ? (failure.currentVersion ?? null) : null,
    unfinishedTaskIds:
      failure.unfinishedTaskIds === undefined ? null : [...failure.unfinishedTaskIds],
    unfinishedTaskCount: failure.unfinishedTaskCount ?? null,
    legacyOpenReviewCount: failure.legacyOpenReviewCount ?? null,
  };
}

export function registerProjectTestingHandlers(
  registrar: ProjectTestingIpcRegistrar,
  options: ProjectTestingHandlerOptions,
): void {
  const register = <Result>(
    channel: string,
    fail: (code: ProjectCollabErrorCode) => Result,
    run: (
      deps: ProjectTestingIpcDependencies,
      input: unknown,
      isCurrent: () => boolean,
    ) => Promise<Result>,
  ): void => {
    registrar.handle(channel, async (event, input) => {
      const account = options.authorize(event) ? options.activeAccount() : null;
      if (!account) return fail('authRequired');
      const deps = options.dependencies ?? null;
      if (!deps) return fail('unavailable');
      // 同一请求的真实发送帧、账号与纪元必须在取令牌后仍然有效。
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
        result = await run(deps, input, isCurrent);
      } catch {
        // 意外异常不跨 IPC 泄露：一律收敛为瞬时失败（可重试）。
        result = fail('transient');
      }
      // 换账号期间在飞的请求一律作废：不把上一个账号的回执交给下一个账号。
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
    deps: ProjectTestingIpcDependencies,
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

  /** 八个生命周期入口共用发送前与返回后的身份复核，逐动作保持严格协议。 */
  const lifecycle = <Input, Result>(
    channel: string,
    requestSchema: z.ZodType<Input>,
    resultSchema: z.ZodType<Result>,
    mutation: boolean,
    action: (
      client: ProjectTestingClientPort,
      token: string,
      input: Input,
      isCurrent: () => boolean,
    ) => Promise<CollabClientOutcome<Result>>,
  ): void => {
    const fail = (
      code: ProjectCollabErrorCode,
      serverCode?: string,
      currentVersion?: number,
    ): Result =>
      resultSchema.parse({
        ...failureBody(code, serverCode),
        ...(mutation
          ? { currentVersion: code === 'conflict' ? (currentVersion ?? null) : null }
          : {}),
      });
    register(channel, fail, async (deps, input, isCurrent) => {
      const request = requestSchema.safeParse(input);
      if (!request.success) return fail('invalidRequest');
      return withToken(deps, fail, isCurrent, async (token) => {
        const outcome = await action(deps.testing, token, request.data, isCurrent);
        if (!outcome.ok) return fail(outcome.code, outcome.serverCode, outcome.currentVersion);
        return resultSchema.parse(outcome.value);
      });
    });
  };
  lifecycle(
    IPC.PROJECT_TEST_ROUND_ACTION,
    ProjectTestRoundActionRequestSchema,
    ProjectTestRoundActionResultSchema,
    true,
    (client, token, input, isCurrent) => client.actOnTestRound(token, input, isCurrent),
  );
  lifecycle(
    IPC.PROJECT_TEST_ROUND_ACTIONS,
    ProjectTestRoundActionsRequestSchema,
    ProjectTestRoundActionsResultSchema,
    false,
    (client, token, input) => client.listTestRoundActions(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_ROUNDS,
    ProjectTestRoundsRequestSchema,
    ProjectTestRoundsResultSchema,
    false,
    (client, token, input) => client.listProjectTestRounds(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_CASE_EXECUTE,
    ProjectTestCaseExecuteRequestSchema,
    ProjectTestCaseExecuteResultSchema,
    true,
    (client, token, input) => client.executeTestCase(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_EXECUTIONS,
    ProjectTestExecutionsRequestSchema,
    ProjectTestExecutionsResultSchema,
    false,
    (client, token, input) => client.listTestExecutions(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_DEFECT_ACTION,
    ProjectTestDefectActionRequestSchema,
    ProjectTestDefectActionResultSchema,
    true,
    (client, token, input) => client.actOnTestDefect(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_DEFECTS,
    ProjectTestDefectsRequestSchema,
    ProjectTestDefectsResultSchema,
    false,
    (client, token, input) => client.listTestDefects(token, input),
  );
  lifecycle(
    IPC.PROJECT_TEST_DEFECT_DETAIL,
    ProjectTestDefectDetailRequestSchema,
    ProjectTestDefectDetailResultSchema,
    false,
    (client, token, input) => client.fetchTestDefect(token, input),
  );

  /* ── 整需求提交 ─────────────────────────────────────────────────────────── */

  const submitFail = (failure: SubmitFailureInput) =>
    ProjectRequirementSubmitResultSchema.parse(submitFailureBody(failure));
  register(
    IPC.PROJECT_REQUIREMENT_SUBMIT,
    (code) => submitFail({ code }),
    async (deps, input, isCurrent) => {
      const request = ProjectRequirementSubmitRequestSchema.safeParse(input);
      if (!request.success) return submitFail({ code: 'invalidRequest' });
      return withToken(
        deps,
        (code) => submitFail({ code }),
        isCurrent,
        async (token) => {
          const outcome = await deps.testing.submitRequirementForTest(
            token,
            request.data,
            isCurrent,
          );
          if (!outcome.ok) return submitFail(outcome);
          return ProjectRequirementSubmitResultSchema.parse({
            ok: true,
            submission: outcome.value.submission,
            todo: outcome.value.todo,
            replayed: outcome.value.replayed,
          });
        },
      );
    },
  );

  /* ── 轮次列表 ───────────────────────────────────────────────────────────── */

  const submissionsFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRequirementSubmissionsResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REQUIREMENT_SUBMISSIONS, submissionsFail, async (deps, input, isCurrent) => {
    const request = ProjectRequirementSubmissionsRequestSchema.safeParse(input);
    if (!request.success) return submissionsFail('invalidRequest');
    return withToken(deps, submissionsFail, isCurrent, async (token) => {
      const outcome = await deps.testing.listRequirementSubmissions(token, request.data);
      if (!outcome.ok) return submissionsFail(outcome.code, outcome.serverCode);
      return ProjectRequirementSubmissionsResultSchema.parse({
        ok: true,
        submissions: outcome.value.submissions,
        hasMore: outcome.value.hasMore,
        nextCursor: outcome.value.nextCursor,
      });
    });
  });

  /* ── 单轮详情 ───────────────────────────────────────────────────────────── */

  const detailFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectSubmissionDetailResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_SUBMISSION_DETAIL, detailFail, async (deps, input, isCurrent) => {
    const request = ProjectSubmissionDetailRequestSchema.safeParse(input);
    if (!request.success) return detailFail('invalidRequest');
    return withToken(deps, detailFail, isCurrent, async (token) => {
      const outcome = await deps.testing.fetchRequirementSubmission(token, request.data);
      if (!outcome.ok) return detailFail(outcome.code, outcome.serverCode);
      return ProjectSubmissionDetailResultSchema.parse({
        ok: true,
        submission: outcome.value.submission,
        snapshot: outcome.value.snapshot,
      });
    });
  });
}
