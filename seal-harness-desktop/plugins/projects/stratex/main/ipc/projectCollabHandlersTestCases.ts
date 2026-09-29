import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectCollabErrorCode,
} from '../../shared/protocol/project-collab.js';
import {
  ProjectRequirementTestCaseCountsRequestSchema,
  ProjectRequirementTestCaseCountsResultSchema,
  ProjectRoundTestCaseCreateRequestSchema,
  ProjectRoundTestCaseCreateResultSchema,
  ProjectRoundTestCasesCopyRequestSchema,
  ProjectRoundTestCasesCopyResultSchema,
  ProjectRoundTestCasesRequestSchema,
  ProjectRoundTestCasesResultSchema,
  ProjectTestCaseUpdateRequestSchema,
  ProjectTestCaseUpdateResultSchema,
  type ProjectTestCaseField,
} from '../../shared/protocol/project-testing-cases.js';
import type { CollabTestingClient } from '../services/collab/collabTestingClient.js';

/**
 * 测试轮次的用例（TST-04，ADR-0046）的 IPC 处理器：一轮的用例、新建、编辑、复用上轮、各轮条数五条通道。
 *
 * 与 `projectCollabHandlers` 是**同一批门禁**：鉴权 → activeAccount → 入参 strictObject 校验 → 取令牌 →
 * 调客户端 → **每次 await 后重验 accountKey + authEpoch** → 出参 schema 校验。分文件只为单文件行数
 * （同 `projectCollabHandlersTesting.ts`），装配期由 `registerProjectCollabHandlers` 一并挂上。⛔ 本文件
 * 不直接碰 ipcMain：一律经注入的 registrar 注册，发送帧门禁（ADR-0039）才罩得住这五条。
 *
 * ⛔ **这一层不做身份与轮次状态判定**：只有本轮测试负责人能写、测试负责人须独立、结束的轮次只读——全部由
 *    服务端强判。
 * ⚠️ 【账号】账号一律由 Main 从会话态推导——请求契约里结构性没有账号字段。
 * ⚠️ 幂等键 `clientRequestId` 由渲染层生成、在同一次打开弹层的重试里保持不变；本层原样透传，⛔ 不重新生成。
 * ⚠️ 失败体透传 `serverCode` 与附加字段：同一个 409 底下是「版本冲突 / 轮次已结束 / 幂等」三件要用户做不同事的
 *    原因，⛔ 丢了码渲染层只剩一句「内容已被他人更新」。
 */

/** 客户端网络面（结构性子集，测试可用对象字面量替身）。 */
export type ProjectTestCaseClientPort = Pick<
  CollabTestingClient,
  | 'listRoundTestCases'
  | 'createRoundTestCase'
  | 'updateTestCase'
  | 'copyPreviousRoundTestCases'
  | 'listRequirementTestCaseCounts'
>;

/** 本组通道需要的依赖切片（与协作面共用同一个 dependencies 对象上的两个键）。 */
export interface ProjectTestCaseIpcDependencies {
  readonly testing: ProjectTestCaseClientPort;
  readonly accessToken: () => Promise<string | null>;
}

export interface ProjectTestCaseHandlerOptions {
  readonly dependencies?: ProjectTestCaseIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
  } | null;
}

export interface ProjectTestCaseIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/**
 * 固定文案表：⛔ 不回显服务端文本（错误体是不可信输入）。具体原因由 serverCode 带给渲染层按共享层文案表
 * 覆盖，这里只是拿不到业务码时的兜底。
 */
const FAILURE_MESSAGES: Readonly<Record<ProjectCollabErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再查看测试用例。',
  invalidRequest: '填写的内容不合法，请检查后重试。',
  tooLarge: '内容超出大小上限。',
  rateLimited: '操作过于频繁，请稍后再试。',
  conflict: '内容已被更新，请刷新后重试。',
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

/** 写失败的来路：门禁 / 入参 / 令牌挡下的只有 `code`，网络面回来的另带业务码与附加字段。 */
interface WriteFailureInput {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly currentVersion?: number | undefined;
  readonly field?: ProjectTestCaseField | undefined;
  readonly missingFields?: readonly ProjectTestCaseField[] | undefined;
}

/** 写失败信封：附加键结构只有一种形状，取不到一律 null（门禁挡下的失败同样带齐）。 */
function writeFailureBody(failure: WriteFailureInput): Record<string, unknown> {
  return {
    ...failureBody(failure.code, failure.serverCode),
    field: failure.field ?? null,
    missingFields: failure.missingFields === undefined ? null : [...failure.missingFields],
  };
}

export function registerProjectTestCaseHandlers(
  registrar: ProjectTestCaseIpcRegistrar,
  options: ProjectTestCaseHandlerOptions,
): void {
  const register = <Result>(
    channel: string,
    fail: (code: ProjectCollabErrorCode) => Result,
    run: (
      deps: ProjectTestCaseIpcDependencies,
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
    deps: ProjectTestCaseIpcDependencies,
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

  /* ── 一轮的用例 ─────────────────────────────────────────────────────────── */

  const listFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRoundTestCasesResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_ROUND_TEST_CASES, listFail, async (deps, input, isCurrent) => {
    const request = ProjectRoundTestCasesRequestSchema.safeParse(input);
    if (!request.success) return listFail('invalidRequest');
    return withToken(deps, listFail, isCurrent, async (token) => {
      const outcome = await deps.testing.listRoundTestCases(token, request.data);
      if (!outcome.ok) return listFail(outcome.code, outcome.serverCode);
      return ProjectRoundTestCasesResultSchema.parse({ ok: true, ...outcome.value });
    });
  });

  /* ── 新建 ───────────────────────────────────────────────────────────────── */

  const createFail = (failure: WriteFailureInput) =>
    ProjectRoundTestCaseCreateResultSchema.parse(writeFailureBody(failure));
  register(
    IPC.PROJECT_ROUND_TEST_CASE_CREATE,
    (code) => createFail({ code }),
    async (deps, input, isCurrent) => {
      const request = ProjectRoundTestCaseCreateRequestSchema.safeParse(input);
      if (!request.success) return createFail({ code: 'invalidRequest' });
      return withToken(
        deps,
        (code) => createFail({ code }),
        isCurrent,
        async (token) => {
          const outcome = await deps.testing.createRoundTestCase(token, request.data);
          if (!outcome.ok) return createFail(outcome);
          return ProjectRoundTestCaseCreateResultSchema.parse({
            ok: true,
            testCase: outcome.value.testCase,
            replayed: outcome.value.replayed,
          });
        },
      );
    },
  );

  /* ── 编辑 ───────────────────────────────────────────────────────────────── */

  const updateFail = (failure: WriteFailureInput) =>
    ProjectTestCaseUpdateResultSchema.parse({
      ...writeFailureBody(failure),
      // 版本号只属于冲突：别的失败码即便带着它也清成 null（与整需求提交同一条纪律）。
      currentVersion: failure.code === 'conflict' ? (failure.currentVersion ?? null) : null,
    });
  register(
    IPC.PROJECT_TEST_CASE_UPDATE,
    (code) => updateFail({ code }),
    async (deps, input, isCurrent) => {
      const request = ProjectTestCaseUpdateRequestSchema.safeParse(input);
      if (!request.success) return updateFail({ code: 'invalidRequest' });
      return withToken(
        deps,
        (code) => updateFail({ code }),
        isCurrent,
        async (token) => {
          const outcome = await deps.testing.updateTestCase(token, request.data);
          if (!outcome.ok) return updateFail(outcome);
          return ProjectTestCaseUpdateResultSchema.parse({ ok: true, testCase: outcome.value });
        },
      );
    },
  );

  /* ── 复用上轮 ───────────────────────────────────────────────────────────── */

  const copyFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRoundTestCasesCopyResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_ROUND_TEST_CASES_COPY, copyFail, async (deps, input, isCurrent) => {
    const request = ProjectRoundTestCasesCopyRequestSchema.safeParse(input);
    if (!request.success) return copyFail('invalidRequest');
    return withToken(deps, copyFail, isCurrent, async (token) => {
      const outcome = await deps.testing.copyPreviousRoundTestCases(token, request.data);
      if (!outcome.ok) return copyFail(outcome.code, outcome.serverCode);
      return ProjectRoundTestCasesCopyResultSchema.parse({ ok: true, ...outcome.value });
    });
  });

  /* ── 各轮条数 ───────────────────────────────────────────────────────────── */

  const countsFail = (code: ProjectCollabErrorCode, serverCode?: string) =>
    ProjectRequirementTestCaseCountsResultSchema.parse(failureBody(code, serverCode));
  register(IPC.PROJECT_REQUIREMENT_TEST_CASE_COUNTS, countsFail, async (deps, input, isCurrent) => {
    const request = ProjectRequirementTestCaseCountsRequestSchema.safeParse(input);
    if (!request.success) return countsFail('invalidRequest');
    return withToken(deps, countsFail, isCurrent, async (token) => {
      const outcome = await deps.testing.listRequirementTestCaseCounts(token, request.data);
      if (!outcome.ok) return countsFail(outcome.code, outcome.serverCode);
      return ProjectRequirementTestCaseCountsResultSchema.parse({
        ok: true,
        counts: outcome.value.counts.map((item) => ({ ...item })),
      });
    });
  });
}
