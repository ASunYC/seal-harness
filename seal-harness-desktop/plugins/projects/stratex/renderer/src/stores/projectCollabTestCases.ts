import {
  PROJECT_TEST_CASE_DEFAULT_PAGE_SIZE,
  projectTestCaseServerCodeText,
  type ProjectRoundTestCaseCreateRequest,
  type ProjectTestCase,
  type ProjectTestCaseField,
  type ProjectTestCaseUpdateRequest,
  ProjectTestCaseExecuteRequestSchema,
  type ProjectTestCaseExecuteRequest,
} from '@shared/protocol/project-testing-cases.js';
import type { ProjectCollabErrorCode } from '@shared/protocol/project-collab.js';

import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import type {
  ProjectCollabState,
  ProjectDomainHost,
  RequirementCaseCountsState,
  RoundTestCasesState,
  TestRoundViewState,
} from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';
import {
  loadTestingPage,
  newerTestingEntity,
  testingWriteFailure,
  type TestingWriteOutcome,
} from './projectCollabTesting';

/**
 * 测试轮次的用例（TST-04，ADR-0046）的渲染层动作：进入 / 返回测试轮次、一轮的用例（分页）、新建 / 编辑 /
 * 复用上轮，以及一条需求各轮的用例条数。域文件形态见 `projectCollabFeed.ts` 注释（自由函数取 host，store 里
 * 一行转发）。
 *
 * 判据落在这里：
 *  - **不假成功**：写失败带回共享层文案（按业务码）与参考编号（按 `code`），弹层就地显示；成功才重取与推回执；
 *  - **恢复路径兑现文案的承诺**：409 `version_conflict` 重取到最新版本并回出当前版本号（弹层改基、保留填写）；
 *    400 `invalid_cursor` 回到第一页并就地说明；
 *  - **过桥的是普通值**：contextBridge 拒收 Vue 响应式 Proxy，请求逐字段投影；
 *  - **迟到作废**：`projectEpoch` + 各自请求序号双守，切项目 / 换号之后的结果不落地。
 *
 * ⚠️ 本域不收事件（服务端不发，ADR-0046）：别人的写入在重新进入或手动刷新时才看得到，同步刷新归 TST-08。
 * ⚠️ 入口是否出现由能力协商（`supportsRequirementTestCases`）与界面的身份判定决定，本模块不再判一遍。
 */
export type ProjectTestCasesHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    | 'activeProjectId'
    | 'testRoundView'
    | 'roundTestCases'
    | 'requirementCaseCounts'
    | 'testExecutions'
  >;

/** 用例写入的结局（弹层据此就地显示失败或关闭）。 */
export type TestCaseWriteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `null` 只有一种来路：请求在途时切了项目 / 换了号，结果已作废——⛔ 它不是成功，调用方也不必再提示。 */
      readonly notice: ProjectCollabNotice | null;
      readonly serverCode: string | null;
      /** 400 缺必填时服务端点名的字段（弹层据此标出输入框）；其余失败为 null。 */
      readonly missingFields: readonly ProjectTestCaseField[] | null;
      /** 409 `version_conflict` 带回的当前版本（弹层据此改基）；其余失败为 null。 */
      readonly currentVersion: number | null;
    };

/** 复用上轮的结局。 */
export type TestCaseCopyOutcome =
  { readonly ok: true } | { readonly ok: false; readonly notice: ProjectCollabNotice | null };

/** 原型保存成功那句的前半（后半「可继续执行或登记缺陷」要等 TST-05 / TST-06 落地才说得出）。 */
export const TEST_CASE_SAVED_RECEIPT = '用例已保存。';

const STALE_WRITE: TestCaseWriteOutcome = {
  ok: false,
  notice: null,
  serverCode: null,
  missingFields: null,
  currentVersion: null,
};

const EMPTY_CASES: RoundTestCasesState = {
  items: [],
  hasMore: false,
  nextCursor: null,
  total: 0,
  copySource: null,
  loaded: false,
  loading: false,
  error: null,
  notice: null,
  requestId: 0,
};

const EMPTY_COUNTS: RequirementCaseCountsState = { counts: {}, loaded: false, requestId: 0 };

function writeCases(
  host: ProjectTestCasesHost,
  submissionId: string,
  patch: Partial<RoundTestCasesState>,
): void {
  const current = host.roundTestCases[submissionId] ?? EMPTY_CASES;
  host.roundTestCases = { ...host.roundTestCases, [submissionId]: { ...current, ...patch } };
}

function writeView(host: ProjectTestCasesHost, patch: Partial<TestRoundViewState>): void {
  if (host.testRoundView === null) return;
  host.testRoundView = { ...host.testRoundView, ...patch };
}

interface Failure {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
}

/** 失败 → 就地文案：业务码认得出就换成共享层那一句，编号照旧取 `code` 那一格。 */
function failureNotice(
  failure: Failure,
  context: { readonly field?: string | null } = {},
): ProjectCollabNotice {
  const text = projectTestCaseServerCodeText(failure.serverCode, context);
  return projectCollabErrorNotice(failure.code, text ?? undefined);
}

/* ── 进入 / 返回测试轮次 ─────────────────────────────────────────────────────── */

/**
 * 从需求详情「进入测试」：记下正在看的轮次，取单轮详情（抬头的轮号、状态、测试负责人）与第一页用例。
 * ⚠️ 用 store 当前的项目：入口在需求详情深处，项目上下文就是屏上这一个。
 */
export async function openTestRound(
  host: ProjectTestCasesHost,
  requirementId: string,
  submissionId: string,
): Promise<void> {
  const projectId = host.activeProjectId;
  if (projectId === null) return;
  const requestId = (host.testRoundView?.requestId ?? 0) + 1;
  host.testRoundView = {
    requirementId,
    submissionId,
    round: null,
    requirementTitle: null,
    loading: true,
    error: null,
    requestId,
  };
  await Promise.all([
    loadTestRoundDetail(host, projectId, submissionId, requestId),
    loadRoundTestCases(host, projectId, submissionId),
  ]);
}

/** 「‹ 返回测试记录」：回到测试页签外壳（列表模式归 TST-08）。 */
export function closeTestRound(host: ProjectTestCasesHost): void {
  host.testRoundView = null;
}

/** 视图里的「重试」：重取单轮详情与第一页用例。 */
export async function reloadTestRound(host: ProjectTestCasesHost): Promise<void> {
  const view = host.testRoundView;
  const projectId = host.activeProjectId;
  if (view === null || projectId === null) return;
  const requestId = view.requestId + 1;
  writeView(host, { loading: true, requestId });
  await Promise.all([
    loadTestRoundDetail(host, projectId, view.submissionId, requestId),
    loadRoundTestCases(host, projectId, view.submissionId),
  ]);
}

async function loadTestRoundDetail(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
  requestId: number,
): Promise<void> {
  const epoch = host.projectEpoch;
  const stale = (): boolean =>
    epoch !== host.projectEpoch ||
    host.testRoundView?.submissionId !== submissionId ||
    host.testRoundView.requestId !== requestId;
  try {
    const result = await projectCollabApi.submissionDetail({ projectId, submissionId });
    if (stale()) return;
    if (!result.ok) {
      const denied = !['transient', 'rateLimited'].includes(result.code);
      writeView(host, {
        ...(denied ? { round: null, snapshot: null, requirementTitle: null } : {}),
        loading: false,
        error: failureNotice(result),
      });
      if (denied)
        writeCases(host, submissionId, {
          ...EMPTY_CASES,
          requestId: (host.roundTestCases[submissionId]?.requestId ?? 0) + 1,
        });
      return;
    }
    writeView(host, {
      round: result.submission,
      requirementTitle: result.snapshot.requirement.title,
      snapshot: result.snapshot,
      loading: false,
      error: null,
    });
  } catch {
    if (!stale()) writeView(host, { loading: false, error: projectCollabErrorNotice('transient') });
  }
}

/* ── 一轮的用例（分页）───────────────────────────────────────────────────────── */

/** 取一轮用例的第一页（整页替换）。⛔ 失败不清已有用例（保留旧内容 + 标出错误，界面给重试）。 */
export async function loadRoundTestCases(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
): Promise<void> {
  await fetchCasePage(host, projectId, submissionId, null);
}

/** 「加载更多」：带游标取下一页接在后面；游标失效回到第一页并就地说明。 */
export async function loadMoreRoundTestCases(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
): Promise<void> {
  const cursor = host.roundTestCases[submissionId]?.nextCursor ?? null;
  if (cursor === null) return;
  await fetchCasePage(host, projectId, submissionId, cursor);
}

async function fetchCasePage(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
  cursor: string | null,
): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = (host.roundTestCases[submissionId]?.requestId ?? 0) + 1;
  writeCases(host, submissionId, { loading: true, requestId });
  const stale = (): boolean =>
    epoch !== host.projectEpoch || host.roundTestCases[submissionId]?.requestId !== requestId;
  try {
    const result = await projectCollabApi.roundTestCases({
      projectId,
      submissionId,
      ...(cursor === null ? {} : { cursor }),
      limit: PROJECT_TEST_CASE_DEFAULT_PAGE_SIZE,
    });
    if (stale()) return;
    if (!result.ok) {
      if (cursor !== null && result.serverCode === 'invalid_cursor') {
        // 文案承诺了「已回到第一页」：先取第一页，再把说明挂上（取第一页会清掉旧说明）。
        await fetchCasePage(host, projectId, submissionId, null);
        if (epoch === host.projectEpoch) {
          writeCases(host, submissionId, {
            notice: projectCollabInfoNotice(failureNotice(result).message),
          });
        }
        return;
      }
      writeCases(host, submissionId, {
        ...(!['transient', 'rateLimited'].includes(result.code)
          ? {
              items: [],
              total: 0,
              copySource: null,
              hasMore: false,
              nextCursor: null,
              loaded: false,
            }
          : {}),
        loading: false,
        error: failureNotice(result),
      });
      return;
    }
    const previous: readonly ProjectTestCase[] =
      cursor === null ? [] : (host.roundTestCases[submissionId]?.items ?? []);
    writeCases(host, submissionId, {
      items: [...previous, ...result.testCases],
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      total: result.total,
      copySource: result.copySource,
      loaded: true,
      loading: false,
      error: null,
      notice: null,
    });
  } catch {
    if (!stale()) {
      writeCases(host, submissionId, {
        loading: false,
        error: projectCollabErrorNotice('transient'),
      });
    }
  }
}

/* ── 写：新建 / 编辑 / 复用上轮 ─────────────────────────────────────────────── */

interface WriteFailure extends Failure {
  readonly field?: ProjectTestCaseField | null | undefined;
  readonly missingFields?: readonly ProjectTestCaseField[] | null | undefined;
  readonly currentVersion?: number | null | undefined;
}

function writeFailure(failure: WriteFailure): TestCaseWriteOutcome {
  return {
    ok: false,
    notice: failureNotice(failure, { field: failure.field ?? null }),
    serverCode: failure.serverCode ?? null,
    missingFields: failure.missingFields ? [...failure.missingFields] : null,
    currentVersion: failure.currentVersion ?? null,
  };
}

/** 写成功之后：本轮用例第一页与这条需求各轮条数一起重取（界面上的「N 个用例」随之变）。 */
async function refreshAfterWrite(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
): Promise<void> {
  const requirementId =
    host.testRoundView?.submissionId === submissionId ? host.testRoundView.requirementId : null;
  await Promise.all([
    loadRoundTestCases(host, projectId, submissionId),
    requirementId === null
      ? Promise.resolve()
      : loadRequirementCaseCounts(host, projectId, requirementId),
  ]);
}

/** 本轮测试负责人新建一条用例（身份与轮次状态由服务端强判）。⛔ 请求逐字段投影再过桥。 */
export async function createRoundTestCase(
  host: ProjectTestCasesHost,
  request: ProjectRoundTestCaseCreateRequest,
): Promise<TestCaseWriteOutcome> {
  const epoch = host.projectEpoch;
  const plain: ProjectRoundTestCaseCreateRequest = {
    projectId: request.projectId,
    submissionId: request.submissionId,
    clientRequestId: request.clientRequestId,
    title: request.title,
    preconditions: request.preconditions,
    steps: request.steps,
    expected: request.expected,
  };
  try {
    const result = await projectCollabApi.roundTestCaseCreate(plain);
    if (epoch !== host.projectEpoch) return STALE_WRITE;
    if (!result.ok) return writeFailure(result);
    await refreshAfterWrite(host, plain.projectId, plain.submissionId);
    pushProjectCollabReceipt(TEST_CASE_SAVED_RECEIPT);
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch ? writeFailure({ code: 'transient' }) : STALE_WRITE;
  }
}

/**
 * 编辑一条用例（四项整表保存）。成功就地替换那一条；409 版本冲突重取第一页到最新版本、回出当前版本号，
 * 弹层据此改基并保留填写内容（共享层那句文案的承诺）。
 */
export async function updateTestCase(
  host: ProjectTestCasesHost,
  request: ProjectTestCaseUpdateRequest,
): Promise<TestCaseWriteOutcome> {
  const epoch = host.projectEpoch;
  const plain: ProjectTestCaseUpdateRequest = {
    projectId: request.projectId,
    caseId: request.caseId,
    expectedVersion: request.expectedVersion,
    title: request.title,
    preconditions: request.preconditions,
    steps: request.steps,
    expected: request.expected,
  };
  try {
    const result = await projectCollabApi.testCaseUpdate(plain);
    if (epoch !== host.projectEpoch) return STALE_WRITE;
    if (!result.ok) {
      const outcome = writeFailure(result);
      if (result.serverCode === 'version_conflict') {
        const submissionId = findSubmissionOf(host, plain.caseId);
        if (submissionId !== null) await loadRoundTestCases(host, plain.projectId, submissionId);
      }
      return outcome;
    }
    const updated = result.testCase;
    const entry = host.roundTestCases[updated.submissionId];
    if (entry !== undefined) {
      writeCases(host, updated.submissionId, {
        items: entry.items.map((item) => (item.id === updated.id ? updated : item)),
      });
    }
    pushProjectCollabReceipt(TEST_CASE_SAVED_RECEIPT);
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch ? writeFailure({ code: 'transient' }) : STALE_WRITE;
  }
}

function findSubmissionOf(host: ProjectTestCasesHost, caseId: string): string | null {
  for (const [submissionId, entry] of Object.entries(host.roundTestCases)) {
    if (entry.items.some((item) => item.id === caseId)) return submissionId;
  }
  return null;
}

/** 复用上轮用例（原型 `case-copy-previous`）。成功重取并回执这一次复制了几条；没新增也说清楚。 */
export async function copyPreviousRoundTestCases(
  host: ProjectTestCasesHost,
  projectId: string,
  submissionId: string,
): Promise<TestCaseCopyOutcome> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.roundTestCasesCopy({ projectId, submissionId });
    if (epoch !== host.projectEpoch) return { ok: false, notice: null };
    if (!result.ok) return { ok: false, notice: failureNotice(result) };
    await refreshAfterWrite(host, projectId, submissionId);
    pushProjectCollabReceipt(
      result.copiedCount > 0
        ? `已复用第 ${String(result.sourceRoundNo)} 轮的 ${String(result.copiedCount)} 条用例，请执行本轮测试。`
        : `第 ${String(result.sourceRoundNo)} 轮的用例都已复用过，没有新增。`,
    );
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch
      ? { ok: false, notice: projectCollabErrorNotice('transient') }
      : { ok: false, notice: null };
  }
}

/* ── 各轮用例条数 ───────────────────────────────────────────────────────────── */

/** 取一条需求各轮的用例条数（需求详情轮次卡上的「N 个用例」）。⛔ 失败不清旧值（卡片退回不显示条数）。 */
export async function loadRequirementCaseCounts(
  host: ProjectTestCasesHost,
  projectId: string,
  requirementId: string,
): Promise<void> {
  const epoch = host.projectEpoch;
  const current = host.requirementCaseCounts[requirementId] ?? EMPTY_COUNTS;
  const requestId = current.requestId + 1;
  host.requirementCaseCounts = {
    ...host.requirementCaseCounts,
    [requirementId]: { ...current, requestId },
  };
  try {
    const result = await projectCollabApi.requirementTestCaseCounts({ projectId, requirementId });
    const latest = host.requirementCaseCounts[requirementId];
    if (epoch !== host.projectEpoch || latest?.requestId !== requestId || !result.ok) return;
    host.requirementCaseCounts = {
      ...host.requirementCaseCounts,
      [requirementId]: {
        counts: Object.fromEntries(
          result.counts.map((item) => [item.submissionId, item.caseCount]),
        ),
        loaded: true,
        requestId,
      },
    };
  } catch {
    /* 条数只是锦上添花：取不到就不显示，⛔ 不打扰用户也不编一个 0。 */
  }
}

export async function loadTestExecutions(
  host: ProjectTestCasesHost,
  projectId: string,
  caseId: string,
  append = false,
): Promise<void> {
  await loadTestingPage(
    host,
    () => host.testExecutions[caseId],
    (page) => {
      host.testExecutions = { ...host.testExecutions, [caseId]: page };
    },
    (cursor) => projectCollabApi.testExecutions({ projectId, caseId, cursor, limit: 30 }),
    append,
  );
}

export async function executeTestCase(
  host: ProjectTestCasesHost,
  request: ProjectTestCaseExecuteRequest,
): Promise<TestingWriteOutcome> {
  const epoch = host.projectEpoch;
  const parsed = ProjectTestCaseExecuteRequestSchema.safeParse(request);
  if (!parsed.success) return testingWriteFailure({ code: 'rejected' });
  try {
    const result = await projectCollabApi.testCaseExecute(parsed.data);
    if (epoch !== host.projectEpoch) return testingWriteFailure();
    if (!result.ok) return testingWriteFailure(result);
    const updated = result.testCase;
    const entry = host.roundTestCases[updated.submissionId];
    if (entry)
      writeCases(host, updated.submissionId, {
        items: entry.items.map((item) =>
          item.id === updated.id ? newerTestingEntity(item, updated) : item,
        ),
      });
    await Promise.all([
      loadTestExecutions(host, request.projectId, request.caseId),
      host.testRoundView?.submissionId === updated.submissionId
        ? reloadTestRound(host)
        : Promise.resolve(),
    ]);
    return epoch === host.projectEpoch ? { ok: true } : testingWriteFailure();
  } catch {
    return testingWriteFailure(epoch === host.projectEpoch ? { code: 'transient' } : undefined);
  }
}
