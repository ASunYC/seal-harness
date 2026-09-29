import {
  type ProjectTestDefectActionRequest,
  type ProjectTestDefectsRequest,
  type ProjectTestDefectDetailRequest,
} from '../../../shared/protocol/project-testing-defects.js';
import { CollabTestDefectsClient } from './collabTestDefectsClient.js';
import {
  ProjectTestCaseExecuteResultSchema,
  ProjectTestExecutionsResultSchema,
  type ProjectTestCaseExecuteRequest,
  type ProjectTestExecutionsRequest,
} from '../../../shared/protocol/project-testing-cases.js';
import {
  ProjectTestRoundActionResultSchema,
  ProjectTestRoundsResultSchema,
  ProjectTestRoundActionsResultSchema,
  type ProjectTestRoundActionsRequest,
  type ProjectTestRoundActionRequest,
  type ProjectTestRoundsRequest,
} from '../../../shared/protocol/project-testing.js';
import { mapTestExecution } from './collabTestingWireMapping.js';
import { z } from 'zod';
import {
  SERVICE_CAPABILITY,
  hasCapability,
} from '../../../shared/protocol/project-collab-capabilities.js';

import type { Todo } from '../../../shared/protocol/project-collab.js';
import type {
  ProjectRequirementSubmissionsRequest,
  ProjectRequirementSubmitRequest,
  ProjectSubmissionDetailRequest,
  ProjectTestRoundDetail,
  ProjectTestRoundSnapshot,
} from '../../../shared/protocol/project-testing.js';
import type {
  ProjectRequirementTestCaseCountsRequest,
  ProjectRoundTestCaseCreateRequest,
  ProjectRoundTestCasesCopyRequest,
  ProjectRoundTestCasesRequest,
  ProjectTestCase,
  ProjectTestCaseCopySource,
  ProjectTestCaseUpdateRequest,
} from '../../../shared/protocol/project-testing-cases.js';
import {
  failureFromBody,
  createCollabClient,
  failureFromResponse,
  readBoundedJson,
  type CollabClientFailure,
  type CollabClientOutcome,
} from './collabClient.js';
import {
  mapCopySource,
  mapTestCase,
  mapTestCaseFailureExtras,
  type TestCaseWriteFailureExtras,
} from './collabTestCaseWireMapping.js';
import {
  mapRequirementSubmitFailureExtras,
  mapTestRoundDetail,
  mapTestRoundSnapshot,
  type RequirementSubmitFailureExtras,
} from './collabTestingWireMapping.js';
import { conflictWireSchema, mapArray, mapTodo, recordOf } from './collabWireMapping.js';

/**
 * 整需求提测域（TST-02）的 HTTP 客户端：整需求提交、一条需求的轮次列表、单轮详情三个端点
 * （服务端 `scripts/collab-service/server/routes_testing.py`）。
 *
 * 与 `collabClient` 分文件的理由同规划域（`collabPlanningClient`）：那份已按协作面九个实体长满，
 * 而本域还要接着长（撤回 TST-03、结论 TST-07）。⛔ 但**失败分档与响应体读取不另起一套**：
 * `failureFromBody` / `failureFromResponse` / `readBoundedJson` 从 `collabClient` 导入——分档表两处必漂移。
 *
 * 纪律与协作面一致：单次尝试不自行重试；响应体是不可信输入（逐字段挑选映射 + 共享协议 schema 两道门，
 * 任一不过即 transient）；令牌只进 `Authorization` 头，本模块不记录、不打印任何凭据，也不记录整体完成
 * 说明（用户亲笔正文）。
 *
 * ⭐ 提交必带 `client_request_id`：服务端把 (项目, 需求, 提交人, 请求号) 折成新轮次的主键——同号同内容的
 *    重试回原轮次（200），同号异内容 409 `idempotency_conflict`，同号并发在途 409 `idempotency_retry`。
 *    ⛔ 本层不替调用方换号，也不自行重试。
 *
 * ⚠️ 这里**不做角色与独立性判定**：处理人、测试负责人独立（D-TEST-01 选 A）、在册可编辑、门槛，全部由
 *    服务端强判。
 */

const API_PREFIX = 'api/v1/';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly accessToken: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly jsonBody?: Readonly<Record<string, unknown>>;
}

export interface CollabTestingClientOptions {
  /** 构建期注入并已校验的服务基地址（末尾带 `/`）。 */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 一次整需求提交的成功出参。⚠️ `replayed=true` **不是失败**：同号同内容的重试命中了原轮次。 */
export interface RequirementSubmission {
  readonly submission: ProjectTestRoundDetail;
  readonly todo: Todo;
  readonly replayed: boolean;
}

/**
 * 提交失败：协作面失败形状 + 服务端平铺在错误体里的附加字段（逐键可缺席）。
 * `currentVersion` 只在 409 `version_conflict` 读得到版本时出现（`CollabClientFailure` 自带的键）。
 */
export type RequirementSubmitFailure = CollabClientFailure & RequirementSubmitFailureExtras;

export type RequirementSubmitOutcome =
  { readonly ok: true; readonly value: RequirementSubmission } | RequirementSubmitFailure;

/** 一条需求的轮次一页（最新在前，服务端定序）。 */
export interface RequirementSubmissionPage {
  readonly submissions: readonly ProjectTestRoundDetail[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** 单轮详情：轮次（含整体完成说明）+ 五面快照。 */
export interface RequirementSubmissionView {
  readonly submission: ProjectTestRoundDetail;
  readonly snapshot: ProjectTestRoundSnapshot;
}

/** 一轮的用例一页（TST-04；按序号，服务端定序）。 */
export interface RoundTestCasePage {
  readonly testCases: readonly ProjectTestCase[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly total: number;
  readonly copySource: ProjectTestCaseCopySource | null;
}

/** 新建用例的成功出参。⚠️ `replayed=true` **不是失败**：同号同内容的重试命中了原用例。 */
export interface RoundTestCaseCreation {
  readonly testCase: ProjectTestCase;
  readonly replayed: boolean;
}

/** 用例写失败：协作面失败形状 + 400 点名的字段（逐键可缺席；409 版本号走 `currentVersion`）。 */
export type TestCaseWriteFailure = CollabClientFailure & TestCaseWriteFailureExtras;

export type TestCaseWriteOutcome<T> =
  { readonly ok: true; readonly value: T } | TestCaseWriteFailure;

/** 复用上轮的结果：这一次复制了几条、来源轮次。 */
export interface RoundTestCaseCopy {
  readonly copiedCount: number;
  readonly sourceSubmissionId: string;
  readonly sourceRoundNo: number;
}

/** 一条需求各轮的用例条数（只列有用例的轮次）。 */
export interface RequirementTestCaseCounts {
  readonly counts: readonly { readonly submissionId: string; readonly caseCount: number }[];
}

export function createCollabTestingClient(
  options: CollabTestingClientOptions,
): CollabTestingClient {
  return new CollabTestingClient(options);
}

export class CollabTestingClient {
  private readonly capabilitiesClient: ReturnType<typeof createCollabClient>;
  private readonly defects: CollabTestDefectsClient;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CollabTestingClientOptions) {
    this.capabilitiesClient = createCollabClient(options);
    this.defects = new CollabTestDefectsClient((path, init, project) =>
      this.requestEntity(path, init, project),
    );
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * `POST /todos/{requirement_id}/submissions`：处理人把整条需求提交一轮测试。
   *
   * 201 ⇒ 新建（`replayed=false`）；200 ⇒ 同号同内容的重试命中原轮次（`replayed=true`）。
   * ⚠️ 回来的轮次必须属于这条需求、这个项目，需求 id 也必须是这一条——对不上即不可信响应。
   * ⚠️ 失败体只读一次：分档走 `failureFromBody`（与协作面同一张表），409 另读 `current_version`，
   *    另把 `unfinished_task_*` / `legacy_open_review_count` 挑出来；业务码缺 `current_version` 也照带
   *    （⛔ 不塌缩成无码 conflict）。
   */
  async submitRequirementForTest(
    accessToken: string,
    input: ProjectRequirementSubmitRequest,
    isCurrent?: () => boolean,
  ): Promise<RequirementSubmitOutcome> {
    if (input.reviewerSubject === null) {
      const gate = await this.requireOptionalReviewerCapability(accessToken);
      if (!gate.ok) return gate;
    }
    if (isCurrent && !isCurrent()) return { ok: false, code: 'forbidden' };
    const response = await this.send(
      `todos/${encodeURIComponent(input.requirementId)}/submissions`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          client_request_id: input.clientRequestId,
          summary: input.summary,
          reviewer_subject: input.reviewerSubject,
          // 没选也显式发空数组：同一次点击的重试请求体逐字节一致，服务端缺省同样是空列表。
          artifacts: input.artifactVersionIds.map((versionId) => ({ file_version_id: versionId })),
        },
      },
    );
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status === 200 || response.status === 201) {
      const body = await readBoundedJson(response);
      const value =
        body === undefined ? null : mapRequirementSubmission(body, input, response.status === 200);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    if (response.status >= 200 && response.status < 300) {
      // 其它 2xx 不在契约里：当作不确定，⛔ 不误报为成功。
      await readBoundedJson(response);
      return { ok: false, code: 'transient' };
    }
    const body = await readBoundedJson(response);
    const failure = failureFromBody(response.status, body);
    const conflict = response.status === 409 ? conflictWireSchema.safeParse(body) : null;
    return {
      ...failure,
      ...(conflict?.success ? { currentVersion: conflict.data.current_version } : {}),
      ...(response.status >= 400 && response.status < 500
        ? mapRequirementSubmitFailureExtras(body)
        : {}),
    };
  }

  /** `GET /todos/{id}/submissions`：一条需求的轮次（最新在前；游标与条数缺席不发）。 */
  async listRequirementSubmissions(
    accessToken: string,
    input: ProjectRequirementSubmissionsRequest,
  ): Promise<CollabClientOutcome<RequirementSubmissionPage>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.requirementId)}/submissions`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (body) => mapSubmissionPage(body, input),
    );
  }

  /** `GET /submissions/{id}`：单轮详情（不存在 / 不可见同一个 404 `submission_not_found`）。 */
  async fetchRequirementSubmission(
    accessToken: string,
    input: ProjectSubmissionDetailRequest,
  ): Promise<CollabClientOutcome<RequirementSubmissionView>> {
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}`,
      { method: 'GET', accessToken },
      (body) => {
        const record = recordOf(body);
        const submission = mapTestRoundDetail(record?.submission);
        const snapshot = mapTestRoundSnapshot(record?.snapshot);
        if (submission === null || snapshot === null) return null;
        // 回来的必须就是请求的这一轮、在调用方以为的那个项目里。
        if (submission.id !== input.submissionId || submission.projectId !== input.projectId) {
          return null;
        }
        return { submission, snapshot };
      },
    );
  }

  /* ──────────────────────── 测试轮次的用例（TST-04） ──────────────────────── */

  /** `GET /submissions/{id}/test-cases`：一轮的用例（游标与条数缺席不发）。 */
  async listRoundTestCases(
    accessToken: string,
    input: ProjectRoundTestCasesRequest,
  ): Promise<CollabClientOutcome<RoundTestCasePage>> {
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}/test-cases`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (body) => mapRoundTestCasePage(body, input),
    );
  }

  /**
   * `POST /submissions/{id}/test-cases`：本轮测试负责人新建一条用例。201 新建；200 同号同内容的重试回放。
   * ⚠️ 回来的用例必须属于请求的那一轮、那个项目——对不上即不可信响应。
   */
  async createRoundTestCase(
    accessToken: string,
    input: ProjectRoundTestCaseCreateRequest,
  ): Promise<TestCaseWriteOutcome<RoundTestCaseCreation>> {
    const response = await this.send(
      `submissions/${encodeURIComponent(input.submissionId)}/test-cases`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          client_request_id: input.clientRequestId,
          title: input.title,
          preconditions: input.preconditions,
          steps: input.steps,
          expected: input.expected,
        },
      },
    );
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status === 200 || response.status === 201) {
      const body = await readBoundedJson(response);
      const testCase = body === undefined ? null : mapTestCase(recordOf(body)?.test_case);
      if (
        testCase === null ||
        testCase.submissionId !== input.submissionId ||
        testCase.projectId !== input.projectId
      ) {
        return { ok: false, code: 'transient' };
      }
      return { ok: true, value: { testCase, replayed: response.status === 200 } };
    }
    return this.testCaseWriteFailure(response);
  }

  /** `PATCH /test-cases/{id}`：四项整表保存 + expected_version；409 版本冲突带回当前版本。 */
  async updateTestCase(
    accessToken: string,
    input: ProjectTestCaseUpdateRequest,
  ): Promise<TestCaseWriteOutcome<ProjectTestCase>> {
    const response = await this.send(`test-cases/${encodeURIComponent(input.caseId)}`, {
      method: 'PATCH',
      accessToken,
      jsonBody: {
        expected_version: input.expectedVersion,
        title: input.title,
        preconditions: input.preconditions,
        steps: input.steps,
        expected: input.expected,
      },
    });
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status === 200) {
      const body = await readBoundedJson(response);
      const testCase = body === undefined ? null : mapTestCase(recordOf(body)?.test_case);
      if (
        testCase === null ||
        testCase.id !== input.caseId ||
        testCase.projectId !== input.projectId
      ) {
        return { ok: false, code: 'transient' };
      }
      return { ok: true, value: testCase };
    }
    return this.testCaseWriteFailure(response);
  }

  /** `POST /submissions/{id}/test-cases/copy-previous`：复用上轮用例（不带请求体，来源由服务端决定）。 */
  async copyPreviousRoundTestCases(
    accessToken: string,
    input: ProjectRoundTestCasesCopyRequest,
  ): Promise<CollabClientOutcome<RoundTestCaseCopy>> {
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}/test-cases/copy-previous`,
      { method: 'POST', accessToken },
      (body) => {
        const record = recordOf(body);
        const view = copyWireSchema.safeParse({
          copiedCount: record?.copied_count,
          sourceSubmissionId: record?.source_submission_id,
          sourceRoundNo: record?.source_round_no,
        });
        return view.success ? view.data : null;
      },
    );
  }

  /** `GET /todos/{id}/test-case-counts`：一条需求各轮的用例条数。一条坏全批坏。 */
  async listRequirementTestCaseCounts(
    accessToken: string,
    input: ProjectRequirementTestCaseCountsRequest,
  ): Promise<CollabClientOutcome<RequirementTestCaseCounts>> {
    return this.requestEntity(
      `todos/${encodeURIComponent(input.requirementId)}/test-case-counts`,
      { method: 'GET', accessToken },
      (body) => {
        const view = countsWireSchema.safeParse(recordOf(body)?.counts);
        return view.success ? { counts: view.data } : null;
      },
    );
  }

  /** 用例写失败的收尾：体只读一次；409 另读 current_version，4xx 另挑 field / missing_fields。 */
  private async testCaseWriteFailure(response: Response): Promise<TestCaseWriteFailure> {
    if (response.status >= 200 && response.status < 300) {
      // 其它 2xx 不在契约里：当作不确定，⛔ 不误报为成功。
      await readBoundedJson(response);
      return { ok: false, code: 'transient' };
    }
    const body = await readBoundedJson(response);
    const failure = failureFromBody(response.status, body);
    const conflict = response.status === 409 ? conflictWireSchema.safeParse(body) : null;
    return {
      ...failure,
      ...(conflict?.success ? { currentVersion: conflict.data.current_version } : {}),
      ...(response.status >= 400 && response.status < 500 ? mapTestCaseFailureExtras(body) : {}),
    };
  }

  /** 分页读取服务端签署的撤回、结论及改派历史。 */
  async listTestRoundActions(
    accessToken: string,
    input: ProjectTestRoundActionsRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestRoundActionsResultSchema>>> {
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}/actions`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (raw) => {
        const row = recordOf(raw);
        if (!row || !Array.isArray(row.items)) return null;
        const parsed = ProjectTestRoundActionsResultSchema.safeParse({
          ok: true,
          items: row.items.map((item: unknown) => {
            const entry = recordOf(item);
            return entry
              ? {
                  id: entry.id,
                  action: entry.action,
                  actorSubject: entry.actor_subject,
                  reason: entry.reason,
                  createdAt: entry.created_at,
                }
              : null;
          }),
          total: row.total,
          hasMore: row.has_more,
          nextCursor: row.next_cursor,
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** 轮次动作固定映射到三个服务端命令，不接受任意路径。 */
  async actOnTestRound(
    accessToken: string,
    input: ProjectTestRoundActionRequest,
    isCurrent?: () => boolean,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestRoundActionResultSchema>>> {
    if (input.action === 'reviewer' && input.claim === true) {
      const gate = await this.requireOptionalReviewerCapability(accessToken);
      if (!gate.ok) return gate;
    }
    if (isCurrent && !isCurrent()) return { ok: false, code: 'forbidden' };
    const body = {
      expected_version: input.expectedVersion,
      client_request_id: input.clientRequestId,
      reason: input.reason,
      ...(input.action === 'decision' ? { decision: input.decision } : {}),
      ...(input.action === 'reviewer' ? { reviewer_subject: input.reviewerSubject } : {}),
      ...(input.action === 'reviewer' && input.claim === true ? { claim: true } : {}),
    };
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}/${input.action}`,
      { method: 'POST', accessToken, jsonBody: body },
      (raw) => {
        const row = recordOf(raw);
        const submission = mapTestRoundDetail(row?.submission);
        if (
          !submission ||
          submission.projectId !== input.projectId ||
          submission.id !== input.submissionId
        )
          return null;
        const todo = row?.todo === undefined ? undefined : mapTodo(row.todo);
        if (todo === null) return null;
        const parsed = ProjectTestRoundActionResultSchema.safeParse({
          ok: true,
          submission,
          ...(todo ? { todo } : {}),
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** 项目测试列表，所有条目均须属于请求项目。 */
  async listProjectTestRounds(
    accessToken: string,
    input: ProjectTestRoundsRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestRoundsResultSchema>>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/test-rounds`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit, state: input.state },
      },
      (raw) => {
        const row = recordOf(raw);
        const items = mapArray(row?.items, mapTestRoundDetail);
        if (!items || items.some((item) => item.projectId !== input.projectId)) return null;
        const parsed = ProjectTestRoundsResultSchema.safeParse({
          ok: true,
          items,
          total: row?.total,
          hasMore: row?.has_more,
          nextCursor: row?.next_cursor,
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** 记录执行；返回实体不得跨项目或跨用例。 */
  async executeTestCase(
    accessToken: string,
    input: ProjectTestCaseExecuteRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestCaseExecuteResultSchema>>> {
    return this.requestEntity(
      `test-cases/${encodeURIComponent(input.caseId)}/executions`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          client_request_id: input.clientRequestId,
          result: input.result,
          actual_result: input.actualResult,
          evidence_refs: [...input.evidenceRefs],
        },
      },
      (raw) => {
        const row = recordOf(raw);
        const testCase = mapTestCase(row?.test_case);
        const execution = mapTestExecution(row?.execution);
        if (
          !testCase ||
          !execution ||
          testCase.projectId !== input.projectId ||
          execution.projectId !== input.projectId ||
          testCase.id !== input.caseId ||
          execution.caseId !== input.caseId
        )
          return null;
        const parsed = ProjectTestCaseExecuteResultSchema.safeParse({
          ok: true,
          testCase,
          execution,
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** 执行历史分页，不使用当前用例文字覆盖过去的执行快照。 */
  async listTestExecutions(
    accessToken: string,
    input: ProjectTestExecutionsRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestExecutionsResultSchema>>> {
    return this.requestEntity(
      `test-cases/${encodeURIComponent(input.caseId)}/executions`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (raw) => {
        const row = recordOf(raw);
        const items = mapArray(row?.items, mapTestExecution);
        if (
          !items ||
          items.some((item) => item.projectId !== input.projectId || item.caseId !== input.caseId)
        )
          return null;
        const parsed = ProjectTestExecutionsResultSchema.safeParse({
          ok: true,
          items,
          total: row?.total,
          hasMore: row?.has_more,
          nextCursor: row?.next_cursor,
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** 缺陷动作交给专属客户端，共享相同 HTTP 边界。 */
  actOnTestDefect(
    accessToken: string,
    input: ProjectTestDefectActionRequest,
  ): ReturnType<CollabTestDefectsClient['actOnTestDefect']> {
    return this.defects.actOnTestDefect(accessToken, input);
  }
  /** 缺陷分页。 */
  listTestDefects(
    accessToken: string,
    input: ProjectTestDefectsRequest,
  ): ReturnType<CollabTestDefectsClient['listTestDefects']> {
    return this.defects.listTestDefects(accessToken, input);
  }
  /** 缺陷历史分页。 */
  fetchTestDefect(
    accessToken: string,
    input: ProjectTestDefectDetailRequest,
  ): ReturnType<CollabTestDefectsClient['fetchTestDefect']> {
    return this.defects.fetchTestDefect(accessToken, input);
  }

  /* ------------------------------ 请求底座 ------------------------------ */

  private async requireOptionalReviewerCapability(
    accessToken: string,
  ): Promise<CollabClientOutcome<true>> {
    const result = await this.capabilitiesClient.fetchCapabilities(accessToken);
    if (!result.ok) return result;
    return hasCapability(result.value, SERVICE_CAPABILITY.optionalTestReviewer)
      ? { ok: true, value: true }
      : { ok: false, code: 'rejected', serverCode: 'optional_test_reviewer_unsupported' };
  }

  private async requestEntity<T>(
    path: string,
    init: SendInit,
    project: (body: unknown) => T | null,
  ): Promise<CollabClientOutcome<T>> {
    const response = await this.send(path, init);
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status >= 200 && response.status < 300) {
      const body = await readBoundedJson(response);
      const value = body === undefined ? null : project(body);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    // 读路径的 409 没有附加字段可读：全部 4xx 经同一张分档表带出 serverCode。
    if (response.status === 409 && init.method !== 'GET') {
      const body = await readBoundedJson(response);
      const failure = failureFromBody(response.status, body);
      const conflict = conflictWireSchema.safeParse(body);
      return {
        ...failure,
        ...(conflict.success ? { currentVersion: conflict.data.current_version } : {}),
      };
    }
    return failureFromResponse(response);
  }

  /** 单次请求；网络不可达/超时/连接层错误返回 null（＝瞬时）。 */
  private async send(path: string, init: SendInit): Promise<Response | null> {
    const url = new URL(`${API_PREFIX}${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { authorization: `Bearer ${init.accessToken}` };
    let body: string | undefined;
    if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.jsonBody);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: init.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 复用上轮结果的线格式门（逐键挑选后再校验）。 */
const copyWireSchema = z.strictObject({
  copiedCount: z.number().int().safe().nonnegative(),
  sourceSubmissionId: z.string().uuid(),
  sourceRoundNo: z.number().int().safe().positive(),
});

/** 各轮条数的线格式门：逐项挑两个键；条数必须为正（服务端只列有用例的轮次）。 */
const countsWireSchema = z
  .array(
    z
      .object({
        submission_id: z.string().uuid(),
        case_count: z.number().int().safe().positive(),
      })
      .transform((item) => ({ submissionId: item.submission_id, caseCount: item.case_count })),
  )
  .max(1_000);

/**
 * 一轮用例一页的投影。⛔ 一条坏全批坏；游标与 `has_more` 同生同灭；混进别的轮次 / 项目的用例即整页不可信；
 * 可复用来源键缺席或形状不对同样整页不可信。
 */
function mapRoundTestCasePage(
  body: unknown,
  input: Pick<ProjectRoundTestCasesRequest, 'projectId' | 'submissionId'>,
): RoundTestCasePage | null {
  const record = recordOf(body);
  if (!record) return null;
  const testCases = mapArray(record.test_cases, mapTestCase);
  const hasMore = record.has_more;
  const nextCursor = record.next_cursor ?? null;
  const total = record.total;
  const copySource = mapCopySource(record.copy_source);
  if (testCases === null || typeof hasMore !== 'boolean' || copySource === undefined) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor.length === 0)) {
    return null;
  }
  if (hasMore !== (nextCursor !== null)) return null;
  const foreign = testCases.some(
    (testCase) =>
      testCase.submissionId !== input.submissionId || testCase.projectId !== input.projectId,
  );
  return foreign ? null : { testCases, hasMore, nextCursor, total, copySource };
}

/**
 * 提交回执的投影：轮次（详情形态）+ 推进后的权威需求。
 * ⛔ 轮次不属于这条需求 / 这个项目、需求不是这一条 ⇒ null（上层归 transient）。
 */
function mapRequirementSubmission(
  body: unknown,
  input: Pick<ProjectRequirementSubmitRequest, 'projectId' | 'requirementId'>,
  replayed: boolean,
): RequirementSubmission | null {
  const record = recordOf(body);
  const submission = mapTestRoundDetail(record?.submission);
  const todo = mapTodo(record?.todo);
  if (submission === null || todo === null) return null;
  if (
    submission.requirementId !== input.requirementId ||
    submission.projectId !== input.projectId ||
    todo.id !== input.requirementId
  ) {
    return null;
  }
  return { submission, todo, replayed };
}

/**
 * 轮次一页的投影。⛔ 一条坏全批坏；游标与 `has_more` 必须同生同灭；混进别的需求 / 项目的轮次即整页不可信。
 */
function mapSubmissionPage(
  body: unknown,
  input: Pick<ProjectRequirementSubmissionsRequest, 'projectId' | 'requirementId'>,
): RequirementSubmissionPage | null {
  const record = recordOf(body);
  if (!record) return null;
  const submissions = mapArray(record.submissions, mapTestRoundDetail);
  const hasMore = record.has_more;
  const nextCursor = record.next_cursor ?? null;
  if (submissions === null || typeof hasMore !== 'boolean') return null;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || nextCursor.length === 0)) {
    return null;
  }
  if (hasMore !== (nextCursor !== null)) return null;
  const foreign = submissions.some(
    (round) => round.requirementId !== input.requirementId || round.projectId !== input.projectId,
  );
  return foreign ? null : { submissions, hasMore, nextCursor };
}
