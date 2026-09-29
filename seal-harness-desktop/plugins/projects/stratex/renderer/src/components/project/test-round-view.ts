import { ProjectTestEvidenceRefSchema } from '@shared/protocol/project-testing-cases.js';
import type { ProjectMember } from '@shared/protocol/project-collab.js';
import {
  isProjectTestRoundActive,
  type ProjectTestRound,
} from '@shared/protocol/project-testing.js';
import type {
  ProjectTestCase,
  ProjectTestCaseCopySource,
  ProjectTestCaseDraft,
  ProjectTestCaseResult,
} from '@shared/protocol/project-testing-cases.js';

import { formatProjectTime } from './project-format';
import { memberDisplayName } from './requirement-submission';

/**
 * 测试页签「轮次视图」（TST-04，ADR-0046）的**入口收窄判据与呈现模型**——纯函数，不碰 store、不碰 DOM。
 *
 * 版式照协作原型最后生效的那层：`renderVerification` 进入一轮后的抬头、三个子页签（测试用例 / 缺陷记录 / 测试
 * 结论）、用例表（用例 / 执行结果 / 关联缺陷 / 操作）、`caseEditor` 弹层与 `case-copy-previous` 确认。
 *
 * ⚠️ 全部是**入口收窄不是权限**：只有本轮测试负责人能写、测试负责人须独立、结束的轮次只读——服务端逐条强判。
 *    这里只负责不摆点了必错的入口。
 * ⚠️ 缺陷记录（TST-06）与测试结论（TST-07）还没有落地：子页签给「稍后开放」，关联缺陷列显示横线，
 *    ⛔ 不写「0 个缺陷」这种还说不出的事实。
 */

/** 执行结果中文（原型 `caseStates`）。 */
export const TEST_CASE_RESULT_LABELS: Readonly<Record<ProjectTestCaseResult, string>> = {
  notrun: '未执行',
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
};

/** 子页签（原型 `test-pane`）。 */
export type TestRoundPaneId = 'cases' | 'bugs' | 'result';

export const TEST_ROUND_PANES: readonly { readonly id: TestRoundPaneId; readonly label: string }[] =
  [
    { id: 'cases', label: '测试用例' },
    { id: 'bugs', label: '缺陷记录' },
    { id: 'result', label: '测试结论' },
  ];

/** 轮次视图的固定文案（组件零默认文案：句子都在这里）。 */
export const TEST_ROUND_VIEW_TEXT = {
  back: '‹ 返回测试记录',
  openRequirement: '打开需求',
  submissionSuffix: (roundNo: number): string => `第 ${String(roundNo)} 次提交`,
  metaCases: '测试用例',
  metaPassed: '已通过',
  casesHint: '记录操作步骤、预期与实际结果',
  newCase: '＋ 新建用例',
  copyPrevious: '复用上轮用例',
  columns: { case: '用例', result: '执行结果', defects: '关联缺陷', action: '操作' },
  actionEdit: '执行 / 编辑',
  actionView: '查看',
  empty: ['本次提交还没有测试用例。', '先新建用例，再记录实际执行结果。'],
  loading: '正在读取测试用例…',
  loadingRound: '正在读取这一轮测试…',
  retry: '重试',
  loadMore: '加载更多',
  paneSoon: {
    bugs: '缺陷记录稍后开放：登记、修复与复测将在后续版本接入。',
    result: '测试结论稍后开放：通过或退回将在后续版本接入。',
  },
  viewerNote: '当前账号可以查看记录。测试负责人在待测试阶段执行用例并提交结论。',
  dialogCreate: '新建测试用例',
  dialogDetail: '测试用例详情',
  dialogContext: (roundNo: number): string => `第 ${String(roundNo)} 次提交测试`,
  fieldTitle: '用例名称',
  fieldPreconditions: '前置条件',
  fieldSteps: '操作步骤 · 每行一步',
  fieldExpected: '预期结果',
  fieldResult: '执行结果',
  resultPendingNote: '执行结果与实际结果在后续版本记录。',
  save: '保存用例',
  saving: '保存中…',
  cancel: '取消',
  close: '关闭',
  copyTitle: '复用上轮测试用例',
  copyConfirm: '确认复用',
  copying: '复用中…',
} as const;

/** 判「我能不能在这一轮执行 / 编辑用例」要看的上下文（store 喂进来）。 */
export interface TestRoundCaseActorContext {
  readonly mySubject: string | null;
  /** 可写（成员及以上且项目未归档）。 */
  readonly canWrite: boolean;
  /** 需求**此刻**的处理人（服务端复用独立性判定按此刻判；清单里没有这条需求时为 null）。 */
  readonly assigneeSubject: string | null;
}

/**
 * 原型 `testActor`：`state === pending && reviewer === actor && submitter !== actor && canWrite()`，外加
 * 「我此刻不是需求处理人」（服务端 `ensure_reviewer_independent` 按此刻判）。
 */
export function isTestRoundCaseActor(
  round: Pick<ProjectTestRound, 'state' | 'reviewerSubject' | 'submittedBySubject'> | null,
  context: TestRoundCaseActorContext,
): boolean {
  const me = context.mySubject;
  return (
    round !== null &&
    me !== null &&
    context.canWrite &&
    isProjectTestRoundActive(round) &&
    round.reviewerSubject === me &&
    round.submittedBySubject !== me &&
    context.assigneeSubject !== me
  );
}

/** 抬头「第 N 次提交」（需求标识另由可复制的 id 组件呈现）。 */
export function testRoundHeading(round: Pick<ProjectTestRound, 'roundNo'>): string {
  return TEST_ROUND_VIEW_TEXT.submissionSuffix(round.roundNo);
}

/** 副行「提交人 提交 · 测试负责人 X · 时间」（原型 `renderVerification` 的 subline）。 */
export function testRoundSubline(
  round: Pick<ProjectTestRound, 'submittedBySubject' | 'reviewerSubject' | 'createdAt'>,
  members: readonly ProjectMember[],
): string {
  return (
    `${memberDisplayName(members, round.submittedBySubject)} 提交 · ` +
    `测试负责人 ${round.reviewerSubject === null ? '待认领' : memberDisplayName(members, round.reviewerSubject)} · ${formatProjectTime(round.createdAt)}`
  );
}

/** 用例表的一行。 */
export interface TestCaseRowView {
  readonly id: string;
  readonly ordinalLabel: string;
  readonly title: string;
  readonly result: ProjectTestCaseResult;
  readonly resultLabel: string;
  readonly defectsLabel: string;
  readonly actionLabel: string;
}

/** 用例表的行（次序＝服务端定序）。缺陷记录未开放：关联缺陷显示横线。 */
export function testCaseRows(
  cases: readonly ProjectTestCase[],
  context: { readonly actor: boolean },
): readonly TestCaseRowView[] {
  return cases.map((testCase) => ({
    id: testCase.id,
    ordinalLabel: `#${String(testCase.ordinal)}`,
    title: testCase.title,
    result: testCase.result,
    resultLabel: TEST_CASE_RESULT_LABELS[testCase.result],
    defectsLabel: '—',
    actionLabel: context.actor ? TEST_ROUND_VIEW_TEXT.actionEdit : TEST_ROUND_VIEW_TEXT.actionView,
  }));
}

/**
 * 抬头概览（原型 `detail-meta` 的前两格）：用例条数照服务端总数；「已通过 x / N」只在全部载入时算——
 * 没翻完的页里有几条通过说不出，⛔ 不拿已载入的一页冒充全体。
 */
export function testRoundMetas(input: {
  readonly total: number;
  readonly hasMore: boolean;
  readonly items: readonly Pick<ProjectTestCase, 'result'>[];
}): { readonly cases: string; readonly passed: string } {
  const passed = input.items.filter((item) => item.result === 'passed').length;
  return {
    cases: `${String(input.total)} 个`,
    passed: input.hasMore ? '—' : `${String(passed)} / ${String(input.total)}`,
  };
}

/** 复用上轮确认的正文（原型 `case-copy-previous`）。 */
export function testRoundCopyPrompt(source: Pick<ProjectTestCaseCopySource, 'roundNo'>): string {
  return `复制第 ${String(source.roundNo)} 轮的用例步骤与预期，执行结果全部重置为未执行，保留原轮次记录。`;
}

/** 弹层草稿：编辑取原值、新建全空。 */
export function testCaseDraftFrom(testCase: ProjectTestCase | null): ProjectTestCaseDraft {
  return {
    title: testCase?.title ?? '',
    preconditions: testCase?.preconditions ?? '',
    steps: testCase?.steps ?? '',
    expected: testCase?.expected ?? '',
  };
}

/** 表单只接收不可变文件版本引用或无凭据网页链接；服务端仍独立校验。 */
export function parseTestEvidenceRefs(text: string): string[] | null {
  const refs = text
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const valid =
    refs.length <= 32 &&
    refs.every((value) => ProjectTestEvidenceRefSchema.safeParse(value).success);
  return valid ? refs : null;
}
