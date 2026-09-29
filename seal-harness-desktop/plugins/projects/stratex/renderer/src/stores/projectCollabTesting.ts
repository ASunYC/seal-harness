import {
  PROJECT_TEST_ROUND_DEFAULT_PAGE_SIZE,
  projectRequirementSubmitServerCodeText,
  type ProjectRequirementSubmitRequest,
  ProjectTestRoundActionRequestSchema,
  type ProjectTestRoundActionRequest,
} from '@shared/protocol/project-testing.js';
import type { ProjectCollabErrorCode } from '@shared/protocol/project-collab.js';

import { projectCollabErrorNotice, type ProjectCollabNotice } from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import type {
  ProjectCollabState,
  ProjectDomainHost,
  RequirementRoundsState,
  TestingPage,
} from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 整需求提测域（TST-02）的渲染层动作：一条需求的测试轮次、整需求提交，以及 `todo.changed` 之后的轮次
 * 重取。域文件形态见 `projectCollabFeed.ts` 注释（自由函数取 host，store 里一行转发）。
 *
 * 判据落在这里：
 *  - **轮次按需求缓存**：详情底部提测块与「测试记录」页签读同一份；切项目 / 换号整表清空；
 *  - **不假成功**：提交失败带回共享层文案（按业务码）与参考编号（按 `code`），弹层就地显示；
 *    成功才原地替换那条需求、重取轮次、推回执；
 *  - **过桥的是普通值**：contextBridge 拒收 Vue 响应式 Proxy（主进程零记录、界面报「暂时不可用」），
 *    请求逐字段投影、数组先展开；
 *  - **事件不读负载**：`todo.changed` 之后按清单里的版本判轮次过期。
 *
 * ⚠️ 提测入口是否出现由能力协商决定（`supportsRequirementTestMode`），本模块不再判一遍：没协商到
 *    能力的界面根本不会调到这里。
 */
export type ProjectTestingHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    'todos' | 'requirementRounds' | 'projectTestRounds' | 'testRoundActions' | 'testRoundView'
  >;

/** 原型那句成功回执（没踢球：需求状态当场就变了 ⇒ toast）。 */
export const REQUIREMENT_SUBMITTED_RECEIPT = '整条需求已提交测试，需求处理人保持不变。';

/** 一次整需求提交的结局。 */
export type RequirementSubmitOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * 就地显示的失败（文案按业务码取共享层那张表，编号取 `code` 那一格）。
       * `null` 只有一种来路：请求在途时切了项目 / 换了号，结果已作废——⛔ 它不是成功，调用方也不必再提示。
       */
      readonly notice: ProjectCollabNotice | null;
      readonly serverCode: string | null;
      /** 422 `submission_tasks_unfinished` 带回的未完成任务 id（至多 50 个）；其余失败为空数组。 */
      readonly unfinishedTaskIds: readonly string[];
      /** 未完成任务总数（服务端给的，含超出 50 个 id 的部分）；取不到为 null。 */
      readonly unfinishedTaskCount: number | null;
    };

const STALE_OUTCOME: RequirementSubmitOutcome = {
  ok: false,
  notice: null,
  serverCode: null,
  unfinishedTaskIds: [],
  unfinishedTaskCount: null,
};

const EMPTY_ROUNDS: RequirementRoundsState = {
  items: [],
  hasMore: false,
  nextCursor: null,
  loaded: false,
  loading: false,
  error: null,
  requestId: 0,
  requirementVersion: null,
};

function writeRounds(
  host: ProjectTestingHost,
  requirementId: string,
  patch: Partial<RequirementRoundsState>,
): void {
  const current = host.requirementRounds[requirementId] ?? EMPTY_ROUNDS;
  host.requirementRounds = { ...host.requirementRounds, [requirementId]: { ...current, ...patch } };
}

/**
 * 取一条需求的测试轮次第一页（最新在前 30 轮）。`projectEpoch` + 请求序号双守：切项目后迟到的、同一条
 * 需求乱序重取的都不落地。⛔ 失败不清已有轮次（保留旧内容 + 标出错误，页签给重试）。
 */
export async function loadRequirementRounds(
  host: ProjectTestingHost,
  projectId: string,
  requirementId: string,
  append = false,
): Promise<void> {
  const prior = host.requirementRounds[requirementId];
  if (append && (!prior?.hasMore || !prior.nextCursor || prior.loading)) return;
  const cursor = append ? prior?.nextCursor : null;
  const epoch = host.projectEpoch;
  const requestId = (host.requirementRounds[requirementId]?.requestId ?? 0) + 1;
  const requirementVersion = host.todos.find((todo) => todo.id === requirementId)?.version ?? null;
  writeRounds(host, requirementId, { loading: true, requestId });
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.requirementRounds[requirementId]?.requestId !== requestId;
  try {
    const result = await projectCollabApi.requirementSubmissions({
      projectId,
      requirementId,
      limit: PROJECT_TEST_ROUND_DEFAULT_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    if (stale()) return;
    if (!result.ok) {
      writeRounds(host, requirementId, {
        loading: false,
        ...(!['transient', 'rateLimited'].includes(result.code)
          ? {
              items: [],
              hasMore: false,
              nextCursor: null,
              loaded: false,
              requirementVersion: null,
            }
          : {}),
        error: projectCollabErrorNotice(result.code),
      });
      return;
    }
    writeRounds(host, requirementId, {
      // 只有成功刷新首页才能确认缓存版本；失败或追加旧页不能确认首页已更新。
      ...(!append ? { requirementVersion } : {}),
      items: append
        ? [
            ...(prior?.items ?? []).filter(
              (row) => !result.submissions.some((next) => next.id === row.id),
            ),
            ...result.submissions,
          ]
        : result.submissions,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      loaded: true,
      loading: false,
      error: null,
    });
  } catch {
    if (!stale()) {
      writeRounds(host, requirementId, {
        loading: false,
        error: projectCollabErrorNotice('transient'),
      });
    }
  }
}

interface SubmitFailure {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly unfinishedTaskIds?: readonly string[] | null | undefined;
  readonly unfinishedTaskCount?: number | null | undefined;
  readonly legacyOpenReviewCount?: number | null | undefined;
}

/** 失败 → 结局：业务码认得出就换成共享层那一句（旧评审未结带条数），编号照旧取 `code` 那一格。 */
function submitFailure(failure: SubmitFailure): RequirementSubmitOutcome {
  const text = projectRequirementSubmitServerCodeText(failure.serverCode, {
    legacyOpenReviewCount: failure.legacyOpenReviewCount ?? null,
  });
  return {
    ok: false,
    notice: projectCollabErrorNotice(failure.code, text ?? undefined),
    serverCode: failure.serverCode ?? null,
    unfinishedTaskIds: failure.unfinishedTaskIds ?? [],
    unfinishedTaskCount: failure.unfinishedTaskCount ?? null,
  };
}

/**
 * 整需求提交（需求处理人；独立测试负责人、门槛等由服务端强判）。
 *
 * 成功（含同号重试命中的回放）：原地替换清单里那条需求（推进后的权威投影）、重取它的轮次、推回执。
 * ⚠️ 写路径换回的需求不带 `requirementTaskTotal`（那是列表读路径才补的数），随后的 `todo.changed`
 *    会整表重取——与工作单写路径同一条纪律，⛔ 不在这里拼旧值。
 * ⛔ 请求逐字段投影、数组先展开再过桥：调用方手里的可能是响应式对象。
 */
export async function submitRequirementForTest(
  host: ProjectTestingHost,
  request: ProjectRequirementSubmitRequest,
): Promise<RequirementSubmitOutcome> {
  const epoch = host.projectEpoch;
  const plain: ProjectRequirementSubmitRequest = {
    projectId: request.projectId,
    requirementId: request.requirementId,
    expectedVersion: request.expectedVersion,
    clientRequestId: request.clientRequestId,
    summary: request.summary,
    reviewerSubject: request.reviewerSubject,
    artifactVersionIds: [...request.artifactVersionIds],
  };
  try {
    const result = await projectCollabApi.requirementSubmit(plain);
    if (epoch !== host.projectEpoch) return STALE_OUTCOME;
    if (!result.ok) return submitFailure(result);
    host.todos = host.todos.map((todo) => (todo.id === result.todo.id ? result.todo : todo));
    void loadRequirementRounds(host, plain.projectId, plain.requirementId);
    pushProjectCollabReceipt(REQUIREMENT_SUBMITTED_RECEIPT);
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch ? submitFailure({ code: 'transient' }) : STALE_OUTCOME;
  }
}

/**
 * `todo.changed` 落地（清单已按事件重取）之后：取过轮次的需求里，清单版本与取轮次时对不上的那几条重取。
 *
 * ⭐ 判据是**版本**不是事件负载：整需求提交在同一个事务里把需求推进待验收（版本 +1），结论与撤回同理；
 *    而合帧窗里同键只留先到的那一帧，负载里的 `reason` 可能恰好是被合掉的那一帧的——靠不住。
 * 没取过的不打请求；需求已不在清单里（被删 / 看不见了）的不动。
 */
export async function refreshRequirementRoundsForTodoChange(
  host: ProjectTestingHost,
  projectId: string,
): Promise<void> {
  const versions = new Map(host.todos.map((todo) => [todo.id, todo.version]));
  const tasks: Array<Promise<void>> = [];
  for (const [requirementId, entry] of Object.entries(host.requirementRounds)) {
    if (!entry.loaded && entry.error === null) continue;
    const version = versions.get(requirementId);
    if (version === undefined || version === entry.requirementVersion) continue;
    tasks.push(loadRequirementRounds(host, projectId, requirementId));
  }
  await Promise.all(tasks);
}

export type TestingWriteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly notice: ProjectCollabNotice | null;
      readonly currentVersion: number | null;
    };

export function testingWriteFailure(failure?: {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly currentVersion?: number | null;
}): TestingWriteOutcome {
  const message = projectRequirementSubmitServerCodeText(failure?.serverCode);
  return {
    ok: false,
    notice: failure
      ? { ...projectCollabErrorNotice(failure.code), ...(message ? { message } : {}) }
      : null,
    currentVersion: failure?.currentVersion ?? null,
  };
}

export function emptyTestingPage<T>(): TestingPage<T> {
  return {
    items: [],
    total: 0,
    hasMore: false,
    nextCursor: null,
    loaded: false,
    loading: false,
    error: null,
    requestId: 0,
  };
}

type PageResult<T> =
  | {
      readonly ok: true;
      readonly items: readonly T[];
      readonly total: number;
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }
  | { readonly ok: false; readonly code: ProjectCollabErrorCode };

/** 同页请求序号与项目纪元共同作废迟到响应；权限失败不保留旧正文。 */
export function newerTestingEntity<T extends { readonly version?: number }>(
  old: T | null | undefined,
  next: T,
): T {
  return old?.version !== undefined && next.version !== undefined && old.version > next.version
    ? old
    : next;
}

export async function loadTestingPage<T extends { readonly id: string; readonly version?: number }>(
  host: ProjectDomainHost,
  get: () => TestingPage<T> | null | undefined,
  set: (page: TestingPage<T>) => void,
  fetch: (cursor: string | null) => Promise<PageResult<T>>,
  append: boolean,
): Promise<void> {
  const prior = get() ?? emptyTestingPage<T>();
  if (append && (prior.loading || !prior.hasMore || !prior.nextCursor)) return;
  const epoch = host.projectEpoch;
  const requestId = prior.requestId + 1;
  set({ ...prior, loading: true, requestId });
  const stale = (): boolean => host.projectEpoch !== epoch || get()?.requestId !== requestId;
  try {
    const result = await fetch(append ? prior.nextCursor : null);
    if (stale()) return;
    if (!result.ok) {
      const retained = ['transient', 'rateLimited'].includes(result.code)
        ? prior
        : emptyTestingPage<T>();
      set({ ...retained, requestId, loading: false, error: projectCollabErrorNotice(result.code) });
      return;
    }
    const consumedCursors =
      append && prior.nextCursor ? [...(prior.consumedCursors ?? []), prior.nextCursor] : [];
    if (result.nextCursor && consumedCursors.includes(result.nextCursor)) {
      set({
        ...prior,
        requestId,
        loading: false,
        hasMore: false,
        nextCursor: null,
        error: projectCollabErrorNotice('rejected', '分页位置未前进，请刷新列表后重试。'),
      });
      return;
    }
    const merged = new Map((append ? prior.items : []).map((item) => [item.id, item]));
    for (const item of result.items)
      merged.set(item.id, newerTestingEntity(merged.get(item.id), item));
    set({
      items: [...merged.values()],
      consumedCursors,
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      loaded: true,
      loading: false,
      error: null,
      requestId,
    });
  } catch {
    if (!stale())
      set({ ...prior, requestId, loading: false, error: projectCollabErrorNotice('transient') });
  }
}

export async function loadProjectTestRounds(
  host: ProjectTestingHost,
  projectId: string,
  append = false,
): Promise<void> {
  await loadTestingPage(
    host,
    () => host.projectTestRounds,
    (page) => {
      host.projectTestRounds = page;
    },
    (cursor) => projectCollabApi.testRounds({ projectId, cursor, limit: 30 }),
    append,
  );
}

export async function loadTestRoundActions(
  host: ProjectTestingHost,
  projectId: string,
  submissionId: string,
  append = false,
): Promise<void> {
  await loadTestingPage(
    host,
    () => host.testRoundActions[submissionId],
    (page) => {
      host.testRoundActions = { ...host.testRoundActions, [submissionId]: page };
    },
    (cursor) => projectCollabApi.testRoundActions({ projectId, submissionId, cursor, limit: 30 }),
    append,
  );
}

/** 失败只回传信息，409 不改调用方版本或幂等键；成功只接收服务端权威投影。 */
export async function performTestRoundAction(
  host: ProjectTestingHost,
  request: ProjectTestRoundActionRequest,
): Promise<TestingWriteOutcome> {
  const epoch = host.projectEpoch;
  const parsed = ProjectTestRoundActionRequestSchema.safeParse(request);
  if (!parsed.success) return testingWriteFailure({ code: 'rejected' });
  try {
    const result = await projectCollabApi.testRoundAction(parsed.data);
    if (epoch !== host.projectEpoch) return testingWriteFailure();
    if (!result.ok) return testingWriteFailure(result);
    const round = result.submission;
    if (result.todo) {
      const todo = result.todo;
      host.todos = host.todos.map((item) =>
        item.id === todo.id ? newerTestingEntity(item, todo) : item,
      );
    }
    if (host.testRoundView?.submissionId === round.id)
      host.testRoundView = {
        ...host.testRoundView,
        round: newerTestingEntity(host.testRoundView.round, round),
      };
    await Promise.all([
      loadRequirementRounds(host, request.projectId, round.requirementId),
      loadTestRoundActions(host, request.projectId, round.id),
      host.projectTestRounds ? loadProjectTestRounds(host, request.projectId) : Promise.resolve(),
    ]);
    return epoch === host.projectEpoch ? { ok: true } : testingWriteFailure();
  } catch {
    return testingWriteFailure(epoch === host.projectEpoch ? { code: 'transient' } : undefined);
  }
}
