import { z } from 'zod';

import { projectRoleAtLeast, type ProjectDetail } from '../../../../../projects/stratex/shared/protocol/project-collab.js';
import {
  PROJECT_ITERATION_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_NAME_LENGTH,
  PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH,
  PROJECT_PLANNING_MAX_PAGE_SIZE,
  type ProjectIterationListItem,
  type ProjectMilestoneListItem,
} from '../../../../../projects/stratex/shared/protocol/project-planning.js';
import {
  PROJECT_PLANNING_DRAFTS_PER_ACCOUNT,
  PROJECT_PLANNING_DRAFTS_PER_SESSION,
  PROJECT_PLANNING_DRAFT_MAX_CRITERIA,
  PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH,
} from '../../../../../projects/stratex/shared/protocol/project-planning-draft.js';
import { isCalendarDayKey } from '../../../../../projects/stratex/shared/protocol/project-planning-schedule.js';
import {
  DRAFT_ITERATION_ABSENT_FIELDS,
  DRAFT_MILESTONE_ABSENT_FIELDS,
  LIST_ITERATIONS_ABSENT_FIELDS,
  LIST_MILESTONES_ABSENT_FIELDS,
  withoutAbsentFields,
} from './projectCollabToolArguments.js';
import type {
  ProjectCollabApprovalGate,
  ProjectCollabPlanningToolPort,
  ProjectCollabToolBinding,
  ProjectCollabToolClientPort,
  ProjectCollabToolResponse,
  ProjectPlanningDraftStagingPort,
} from './projectCollabToolContract.js';
import {
  collabFailure,
  failure,
  invalidRequestFailure,
  refusedFailure,
  success,
} from './projectCollabToolResults.js';
import type {
  ProjectPlanningDraftOwner,
  ProjectPlanningDraftStageResult,
} from './projectPlanningDraftStaging.js';

/**
 * 项目协作工具里的**规划四件**（mil-11，ADR-0045）：读里程碑、读迭代计划、提出里程碑草案、
 * 在指定里程碑下提出迭代计划草案。
 *
 * ⭐ 两件草案工具**什么都不新建**：校验后放进 Main 的规划草案暂存区，回包如实说「还没新建」。
 *    新建只发生在人确认审阅弹层的那一刻，走手工新建同一条 IPC。端口结构上没有规划写方法。
 * ⭐ 草案工具不弹审批卡（它不写任何东西，审阅弹层就是确认）。**本轮不可写**（只出方案档）时，
 *    走与拆解草案同一道审批门，由档位拒绝收口——可用性与 `project_draft_tasks` 一致，不另立规则。
 * ⚠️ 暂存前的预检（项目归档、负责人在册、起止成对与先后、同名目标、里程碑存在且未归档、达成日在周期内）
 *    只是提前告诉模型，确认新建时服务端照样逐条强判。
 */

/** 里程碑列表一页：说明只给预览，20 条连同 JSON 信封远低于 64 KiB。 */
const MILESTONE_PAGE_SIZE = 20;
/** 迭代计划列表一页（每条比里程碑更短）。 */
const ITERATION_PAGE_SIZE = 50;
/** 按编号找里程碑时最多翻几页（每页取上界 100 条）。 */
const MILESTONE_LOOKUP_MAX_PAGES = 10;
/** 目标说明 / 完成标准的预览长度（码点）。全文在里程碑页看。 */
const PLANNING_TEXT_PREVIEW_LENGTH = 300;

export interface ProjectPlanningToolContext {
  readonly client: Pick<ProjectCollabToolClientPort, 'readProjectDetail'>;
  readonly planning: ProjectCollabPlanningToolPort | undefined;
  readonly drafts: ProjectPlanningDraftStagingPort | undefined;
}

const pageSchema = z.number().int().min(1).max(10_000);
const noNul = (value: string): boolean => !value.includes('\0');

const listMilestonesArgumentsSchema = z.preprocess(
  withoutAbsentFields(LIST_MILESTONES_ABSENT_FIELDS),
  z.strictObject({
    page: pageSchema.optional(),
    includeArchived: z.boolean().optional(),
  }),
);

const listIterationsArgumentsSchema = z.preprocess(
  withoutAbsentFields(LIST_ITERATIONS_ABSENT_FIELDS),
  z.strictObject({
    milestoneId: z.string().uuid(),
    page: pageSchema.optional(),
    includeArchived: z.boolean().optional(),
  }),
);

const draftNameSchema = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).refine(noNul, 'must not contain NUL');

/** 计划日期只收真实日历日 `YYYY-MM-DD`：与审阅弹层的日期输入同形，预填不做任何换算。 */
const draftDaySchema = z
  .string()
  .refine(isCalendarDayKey, 'must be a real calendar date written as YYYY-MM-DD');

const ownerSubjectSchema = z.string().trim().min(1).max(256);

const draftMilestoneArgumentsSchema = z.preprocess(
  withoutAbsentFields(DRAFT_MILESTONE_ABSENT_FIELDS),
  z.strictObject({
    name: draftNameSchema(PROJECT_MILESTONE_MAX_NAME_LENGTH),
    objective: z
      .string()
      .trim()
      .max(PROJECT_MILESTONE_MAX_OBJECTIVE_LENGTH)
      .refine(noNul, 'must not contain NUL')
      .optional(),
    startAt: draftDaySchema.optional(),
    dueAt: draftDaySchema.optional(),
    ownerSubject: ownerSubjectSchema.optional(),
  }),
);

const draftIterationArgumentsSchema = z.preprocess(
  withoutAbsentFields(DRAFT_ITERATION_ABSENT_FIELDS),
  z.strictObject({
    milestoneId: z.string().uuid(),
    name: draftNameSchema(PROJECT_ITERATION_MAX_NAME_LENGTH),
    dueAt: draftDaySchema.optional(),
    criteria: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(PROJECT_PLANNING_DRAFT_MAX_CRITERION_LENGTH)
          .refine(noNul, 'must not contain NUL'),
      )
      .max(PROJECT_PLANNING_DRAFT_MAX_CRITERIA)
      .optional(),
    ownerSubject: ownerSubjectSchema.optional(),
  }),
);

const MILESTONE_DRAFT_NOTE =
  'This is a milestone draft shown to the user in a review card in this session; nothing has been created. ' +
  'It becomes a milestone only after a project manager or owner reviews it, possibly edits it, and confirms it. ' +
  'Do not say the milestone was created or saved. If the user later asks whether it exists, check with project_list_milestones first.';

const ITERATION_DRAFT_NOTE =
  'This is an iteration plan draft shown to the user in a review card in this session; nothing has been created. ' +
  'It becomes an iteration plan only after a project manager or owner reviews it, possibly edits it, and confirms it. ' +
  'Do not say the iteration plan was created or saved. If the user later asks whether it exists, check with project_list_iterations first.';

const CONFIRM_BLOCKED_NOTE =
  'The current member is not a project manager or owner, so they cannot confirm this draft. ' +
  'Say so plainly: a project manager or owner has to confirm it.';

function contextChangedFailure(): ProjectCollabToolResponse {
  return failure('Project session context changed; discard this result and retry.');
}

function textPreview(text: string): { readonly preview: string; readonly truncated: boolean } {
  const codePoints = Array.from(text);
  return codePoints.length > PLANNING_TEXT_PREVIEW_LENGTH
    ? { preview: codePoints.slice(0, PLANNING_TEXT_PREVIEW_LENGTH).join(''), truncated: true }
    : { preview: text, truncated: false };
}

/** 负责人显示名只从名册解析；读不到名册就给 null，⛔ 不把主体串当名字回给模型。 */
function memberDisplayNames(detail: ProjectDetail | null): ReadonlyMap<string, string> {
  return new Map((detail?.members ?? []).map((member) => [member.subject, member.displayName]));
}

function ownerDisplayName(
  ownerSubject: string | null,
  names: ReadonlyMap<string, string>,
): string | null {
  return ownerSubject === null ? null : (names.get(ownerSubject) ?? null);
}

function milestoneView(item: ProjectMilestoneListItem, names: ReadonlyMap<string, string>) {
  const objective = textPreview(item.objectiveMd);
  return {
    id: item.id,
    name: item.name,
    objectivePreview: objective.preview,
    ...(objective.truncated ? { objectiveTruncated: true } : {}),
    ownerSubject: item.ownerSubject,
    ownerDisplayName: ownerDisplayName(item.ownerSubject, names),
    status: item.status,
    startAt: item.startAt,
    dueAt: item.dueAt,
    archived: item.archivedAt !== null,
    iterationSummary: item.iterationSummary,
  };
}

/** 迭代计划只回计划本身；⛔ 在排需求不在这里（排需求不在草案范围，也免得把需求标题带进上下文）。 */
function iterationView(item: ProjectIterationListItem, names: ReadonlyMap<string, string>) {
  const criteria = textPreview(item.criteriaMd);
  return {
    id: item.id,
    name: item.name,
    criteriaPreview: criteria.preview,
    ...(criteria.truncated ? { criteriaTruncated: true } : {}),
    ownerSubject: item.ownerSubject,
    ownerDisplayName: ownerDisplayName(item.ownerSubject, names),
    priority: item.priority,
    status: item.status,
    dueAt: item.dueAt,
    archived: item.archivedAt !== null,
  };
}

async function readDisplayNames(
  context: ProjectPlanningToolContext,
  accessToken: string,
  binding: ProjectCollabToolBinding,
): Promise<ReadonlyMap<string, string> | null> {
  const detail = await context.client.readProjectDetail(accessToken, {
    projectId: binding.projectId,
  });
  if (!binding.isCurrentContext()) return null;
  return memberDisplayNames(detail.ok ? detail.value : null);
}

function planningUnavailableFailure(): ProjectCollabToolResponse {
  return failure('Milestone and iteration plan tools are unavailable in this session.', {
    code: 'PROJECT_PLANNING_UNAVAILABLE',
  });
}

export async function listMilestonesTool(
  context: ProjectPlanningToolContext,
  accessToken: string,
  binding: ProjectCollabToolBinding,
  input: unknown,
): Promise<ProjectCollabToolResponse> {
  const parsed = listMilestonesArgumentsSchema.safeParse(input);
  if (!parsed.success) return invalidRequestFailure(parsed.error);
  if (!context.planning) return planningUnavailableFailure();
  const outcome = await context.planning.listMilestones(accessToken, {
    projectId: binding.projectId,
    page: parsed.data.page ?? 1,
    pageSize: MILESTONE_PAGE_SIZE,
    ...(parsed.data.includeArchived === true ? { includeArchived: true } : {}),
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  if (!outcome.ok) return collabFailure(outcome);
  const names = await readDisplayNames(context, accessToken, binding);
  if (names === null) return contextChangedFailure();
  const { items, page, pageSize, total } = outcome.value;
  return success({
    tool: 'project_list_milestones',
    milestones: items.map((item) => milestoneView(item, names)),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
}

export async function listIterationsTool(
  context: ProjectPlanningToolContext,
  accessToken: string,
  binding: ProjectCollabToolBinding,
  input: unknown,
): Promise<ProjectCollabToolResponse> {
  const parsed = listIterationsArgumentsSchema.safeParse(input);
  if (!parsed.success) return invalidRequestFailure(parsed.error);
  if (!context.planning) return planningUnavailableFailure();
  const outcome = await context.planning.listIterations(accessToken, {
    projectId: binding.projectId,
    milestoneId: parsed.data.milestoneId,
    page: parsed.data.page ?? 1,
    pageSize: ITERATION_PAGE_SIZE,
    ...(parsed.data.includeArchived === true ? { includeArchived: true } : {}),
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  if (!outcome.ok) return collabFailure(outcome);
  const names = await readDisplayNames(context, accessToken, binding);
  if (names === null) return contextChangedFailure();
  const { items, page, pageSize, total } = outcome.value;
  return success({
    tool: 'project_list_iterations',
    milestoneId: parsed.data.milestoneId,
    iterations: items.map((item) => iterationView(item, names)),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
}

function draftOwner(binding: ProjectCollabToolBinding): ProjectPlanningDraftOwner | null {
  return binding.accountKey && binding.sessionId
    ? { accountKey: binding.accountKey, sessionId: binding.sessionId }
    : null;
}

function draftsUnavailableFailure(): ProjectCollabToolResponse {
  return failure('Planning drafts are unavailable in this session, so nothing was proposed.', {
    code: 'PROJECT_PLANNING_DRAFTS_UNAVAILABLE',
  });
}

/**
 * 本轮能不能出草案：可写（执行档）⇒ 放行、不弹卡；不可写（只出方案档）⇒ 交给与拆解草案同一道审批门。
 *
 * ⚠️ 原注释称「计划档下它不弹卡、直接回 `declinedByMode`」——**已过期**：R7 起
 * `declineSilently` 已删，工具门在计划/默认/无工作区**一律出卡**（见
 * `app-server-client-approvals.ts:163`），用户决策后走 `decline`。`declinedByMode` 现为
 * 保留的死类型、**不再产出**（标注见 {@link KernelToolGateOutcome}），下方对它的消费属死分支，
 * 随 09-18 R7 一并清理。终态卡与「开始执行」入口照常由该门的决策结果驱动。
 */
async function refuseUnlessTurnCanWrite(
  binding: ProjectCollabToolBinding,
  gate: ProjectCollabApprovalGate | undefined,
  operation: string,
  subject: string,
): Promise<ProjectCollabToolResponse | null> {
  if (!gate) return failure(`${subject} was not authorized.`);
  if (gate.writeAccess === true) return null;
  const decision = await gate.requestApproval({
    kind: 'projectTodoWrite',
    details: [{ label: '操作', value: operation }],
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  return decision === 'accept' ? null : refusedFailure(decision, subject);
}

/** 暂存前对「这个项目还能不能规划、负责人在不在册」的预检。 */
function projectPlanningBlocked(
  detail: ProjectDetail,
  ownerSubject: string | undefined,
): ProjectCollabToolResponse | null {
  if (detail.archivedAt !== null) {
    return failure(
      'The project is archived and read-only, so nothing can be planned in it. Nothing was proposed.',
      {
        code: 'PROJECT_ARCHIVED',
        nextAction: 'Tell the user an owner has to restore the project first.',
      },
    );
  }
  if (
    ownerSubject !== undefined &&
    !detail.members.some((member) => member.state === 'active' && member.subject === ownerSubject)
  ) {
    return failure('ownerSubject is not an active member of this project. Nothing was proposed.', {
      code: 'PROJECT_PLANNING_OWNER_NOT_MEMBER',
      nextAction: 'Copy an exact subject from project_list_members, or set ownerSubject to null.',
    });
  }
  return null;
}

function draftStagedResponse(
  tool: 'project_draft_milestone' | 'project_draft_iteration',
  result: ProjectPlanningDraftStageResult,
  detail: ProjectDetail,
): ProjectCollabToolResponse {
  if (!result.ok) {
    if (result.reason === 'invalid') {
      return failure('The draft could not be prepared for review, so nothing was proposed.');
    }
    const limit =
      result.reason === 'sessionFull'
        ? `${PROJECT_PLANNING_DRAFTS_PER_SESSION} planning drafts in this session are`
        : `${PROJECT_PLANNING_DRAFTS_PER_ACCOUNT} planning drafts across this account's sessions are`;
    return failure(`${limit} already waiting for review, so nothing was proposed.`, {
      code: 'PROJECT_PLANNING_DRAFT_LIMIT',
      retryable: false,
      nextAction:
        'Ask the user to confirm or dismiss the drafts already shown before proposing more.',
    });
  }
  const canConfirm = projectRoleAtLeast(detail.myRole, 'manager');
  return success({
    tool,
    draftId: result.draft.draftId,
    status: 'awaitingReview',
    canConfirm,
    note: tool === 'project_draft_milestone' ? MILESTONE_DRAFT_NOTE : ITERATION_DRAFT_NOTE,
    ...(canConfirm ? {} : { confirmBlocked: CONFIRM_BLOCKED_NOTE }),
  });
}

export async function draftMilestoneTool(
  context: ProjectPlanningToolContext,
  accessToken: string,
  binding: ProjectCollabToolBinding,
  input: unknown,
  gate: ProjectCollabApprovalGate | undefined,
): Promise<ProjectCollabToolResponse> {
  const parsed = draftMilestoneArgumentsSchema.safeParse(input);
  if (!parsed.success) return invalidRequestFailure(parsed.error);
  const owner = draftOwner(binding);
  if (!context.planning || !context.drafts || !owner) return draftsUnavailableFailure();
  const refused = await refuseUnlessTurnCanWrite(
    binding,
    gate,
    '提出里程碑草案（待审阅确认）',
    'The milestone draft',
  );
  if (refused) return refused;

  const { name, startAt, dueAt, ownerSubject } = parsed.data;
  if (startAt !== undefined && dueAt === undefined) {
    return failure(
      'A planned start date needs a planned end date: the draft has startAt without dueAt. Nothing was proposed.',
      {
        code: 'PROJECT_PLANNING_START_REQUIRES_DUE',
        nextAction:
          'Set dueAt to the end date the user gave, or set startAt to null. Never invent a date; ask the user for the end date.',
      },
    );
  }
  if (startAt !== undefined && dueAt !== undefined && startAt > dueAt) {
    return failure(
      'The planned end date is earlier than the planned start date. Nothing was proposed.',
      {
        code: 'PROJECT_PLANNING_DATE_ORDER',
        nextAction: 'Ask the user for the correct dates, or set both startAt and dueAt to null.',
      },
    );
  }

  const detail = await context.client.readProjectDetail(accessToken, {
    projectId: binding.projectId,
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  if (!detail.ok) return collabFailure(detail);
  const blocked = projectPlanningBlocked(detail.value, ownerSubject);
  if (blocked) return blocked;

  // 同名只算未归档、去首尾空白后逐字相同（区分大小写），与服务端的唯一约束同一口径。
  const sameName = await context.planning.listMilestones(accessToken, {
    projectId: binding.projectId,
    q: name,
    page: 1,
    pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  if (!sameName.ok) return collabFailure(sameName);
  if (sameName.value.items.some((item) => item.archivedAt === null && item.name.trim() === name)) {
    return failure(
      'An unarchived milestone with the same name already exists in this project. Nothing was proposed.',
      {
        code: 'PROJECT_PLANNING_NAME_TAKEN',
        nextAction:
          'Ask the user for a different name, or look at the existing one with project_list_milestones.',
      },
    );
  }

  const staged = context.drafts.stage(owner, {
    kind: 'milestone',
    projectId: binding.projectId,
    name,
    objectiveMd: parsed.data.objective ?? '',
    startAt: startAt ?? null,
    dueAt: dueAt ?? null,
    ownerSubject: ownerSubject ?? null,
  });
  return draftStagedResponse('project_draft_milestone', staged, detail.value);
}

type MilestoneLookup =
  | { readonly kind: 'found'; readonly milestone: ProjectMilestoneListItem }
  | { readonly kind: 'missing'; readonly exhausted: boolean }
  | { readonly kind: 'failed'; readonly response: ProjectCollabToolResponse };

/** 按编号找里程碑（含归档，才分得清「不存在」与「已归档」）；每页 100 条，至多翻 10 页。 */
async function findMilestone(
  planning: ProjectCollabPlanningToolPort,
  accessToken: string,
  binding: ProjectCollabToolBinding,
  milestoneId: string,
): Promise<MilestoneLookup> {
  for (let page = 1; page <= MILESTONE_LOOKUP_MAX_PAGES; page += 1) {
    const outcome = await planning.listMilestones(accessToken, {
      projectId: binding.projectId,
      includeArchived: true,
      page,
      pageSize: PROJECT_PLANNING_MAX_PAGE_SIZE,
    });
    if (!binding.isCurrentContext()) return { kind: 'failed', response: contextChangedFailure() };
    if (!outcome.ok) return { kind: 'failed', response: collabFailure(outcome) };
    const match = outcome.value.items.find((item) => item.id === milestoneId);
    if (match) return { kind: 'found', milestone: match };
    const lastPage =
      outcome.value.items.length < PROJECT_PLANNING_MAX_PAGE_SIZE ||
      page * PROJECT_PLANNING_MAX_PAGE_SIZE >= outcome.value.total;
    if (lastPage) return { kind: 'missing', exhausted: true };
  }
  return { kind: 'missing', exhausted: false };
}

/** 服务端时刻 → UTC 日（与服务端「达成日在周期内」按 UTC 日比较同一口径）；读不出就不判。 */
function utcDayKey(timestamp: string | null): string | null {
  if (timestamp === null) return null;
  if (isCalendarDayKey(timestamp)) return timestamp;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export async function draftIterationTool(
  context: ProjectPlanningToolContext,
  accessToken: string,
  binding: ProjectCollabToolBinding,
  input: unknown,
  gate: ProjectCollabApprovalGate | undefined,
): Promise<ProjectCollabToolResponse> {
  const parsed = draftIterationArgumentsSchema.safeParse(input);
  if (!parsed.success) return invalidRequestFailure(parsed.error);
  const owner = draftOwner(binding);
  if (!context.planning || !context.drafts || !owner) return draftsUnavailableFailure();
  const refused = await refuseUnlessTurnCanWrite(
    binding,
    gate,
    '提出迭代计划草案（待审阅确认）',
    'The iteration plan draft',
  );
  if (refused) return refused;

  const detail = await context.client.readProjectDetail(accessToken, {
    projectId: binding.projectId,
  });
  if (!binding.isCurrentContext()) return contextChangedFailure();
  if (!detail.ok) return collabFailure(detail);
  const blocked = projectPlanningBlocked(detail.value, parsed.data.ownerSubject);
  if (blocked) return blocked;

  const lookup = await findMilestone(
    context.planning,
    accessToken,
    binding,
    parsed.data.milestoneId,
  );
  if (lookup.kind === 'failed') return lookup.response;
  if (lookup.kind === 'missing') {
    return failure(
      lookup.exhausted
        ? 'No milestone with that milestoneId exists in this project. Nothing was proposed.'
        : `That milestoneId was not found among the first ${MILESTONE_LOOKUP_MAX_PAGES * PROJECT_PLANNING_MAX_PAGE_SIZE} milestones of this project. Nothing was proposed.`,
      {
        code: 'PROJECT_PLANNING_MILESTONE_NOT_FOUND',
        nextAction: 'Call project_list_milestones and use an id it reports.',
      },
    );
  }
  const { milestone } = lookup;
  if (milestone.archivedAt !== null) {
    return failure(
      'That milestone is archived, so no iteration plan can be proposed under it. Nothing was proposed.',
      {
        code: 'PROJECT_PLANNING_MILESTONE_ARCHIVED',
        nextAction:
          'Tell the user the milestone has to be restored first, or choose an unarchived milestone.',
      },
    );
  }
  const { dueAt } = parsed.data;
  const periodStart = utcDayKey(milestone.startAt);
  const periodEnd = utcDayKey(milestone.dueAt);
  if (
    dueAt !== undefined &&
    ((periodStart !== null && dueAt < periodStart) || (periodEnd !== null && dueAt > periodEnd))
  ) {
    return failure(
      `dueAt must fall within the milestone's planned period (${periodStart ?? 'no start date'} to ${periodEnd ?? 'no end date'}). Nothing was proposed.`,
      {
        code: 'PROJECT_PLANNING_DATE_OUT_OF_PERIOD',
        nextAction: 'Ask the user for a date inside that period, or set dueAt to null.',
      },
    );
  }

  const staged = context.drafts.stage(owner, {
    kind: 'iteration',
    projectId: binding.projectId,
    milestoneId: milestone.id,
    milestoneName: milestone.name,
    name: parsed.data.name,
    criteriaMd: (parsed.data.criteria ?? []).join('\n'),
    dueAt: dueAt ?? null,
    ownerSubject: parsed.data.ownerSubject ?? null,
  });
  return draftStagedResponse('project_draft_iteration', staged, detail.value);
}
