import type {
  ProjectIterationListItem,
  ProjectMilestoneListItem,
} from '@shared/protocol/project-planning.js';
import type {
  ProjectRequirementPlacement,
  ProjectRequirementPlacementItem,
} from '@shared/protocol/project-planning-schedule.js';

import { formatPlanningDate } from './project-planning-view';

/**
 * 里程碑页写入口（MIL-09）的**纯**辅助：表单草稿、本地校验与「已排在 / 将从…移出」提示。
 *
 * ⭐ 文案与判定顺序逐字照合并原型 `[里程碑管理·已定稿 2026-09-13]` 那一层（`editPlan27` 包装、
 *    `editMilestone27` 覆盖、`arrangeRequirementsM1` / `scheduleRowM1` / `scheduleHintM1`）。
 * ⚠️ 本地校验只为不白跑一趟必错的请求，**权威在服务端**（MIL-10 起日期顺序、同名、周期覆盖、迭代日期在周期内、
 *    负责人在册全部由服务端强制，ADR-0040）；服务端码映射成的人话与这里的句子逐字相同
 *    （`projectMilestoneWriteServerCodeText` / `projectIterationUpdateServerCodeText`）。
 * ⚠️ 负责人只在**设置或更换**时判在册：原负责人后来离开项目，不挡改别的字段，只给一句非阻塞提示。
 */

export const PLANNING_FORM_TEXT = {
  milestoneRequired: '请填写里程碑名称、目标和起止日期。',
  /**
   * 起止成对（CORE-08，ADR-0042）：服务端码 `start_requires_due` 的那一句。表单照原型要求填起止，本地先被
   * 「必填」挡住；这一句只在服务端拒绝时出现（例如存量只有开始的目标被改了开始日期）。
   */
  milestoneStartRequiresDue: '填写开始日期后请同时填写结束日期。',
  milestoneDateOrder: '结束日期不能早于开始日期。',
  milestoneNameTaken: '已有同名业务目标，请使用其他名称。',
  milestonePeriodCover: '计划周期需覆盖已有迭代计划日期，请先调整节点。',
  milestoneOwnerLeft: '所选负责人已不在项目中。',
  milestoneSaved: '里程碑已保存。',
  milestoneNote: '例如「成员邀请与权限管理」。围绕这个业务目标安排多轮迭代，日期单独维护。',
  milestoneArchiveConfirm: '归档后仍可在历史中查看；本里程碑下迭代计划的在排需求会一并移出。',
  milestoneArchived: '里程碑已归档，历史记录保留。',
  /** 负责人已离开项目、且这次没改负责人：非阻塞提示（ADR-0040：负责人只在设置或更换时判在册）。 */
  ownerDeparted: '负责人已离开项目，请改派',
  iterationRequired: '请填写名称、计划日期和完成标准。',
  iterationOutOfPeriod: '节点日期应在里程碑周期内，请调整日期或先修改里程碑。',
  iterationOwnerLeft: '负责人已不在项目中。',
  iterationSaved: '迭代计划已保存。',
  /** 两步保存的第二步失败：本体已落盘，只有关联需求没保存（接在具体原因前）。 */
  iterationSavedRequirementsNot: '迭代计划已保存，关联需求未保存：',
  iterationRequirementsNote: '从项目需求中选择；一条需求同一时间只排在一个迭代里。',
  iterationArchiveConfirm: '归档后仍可在历史中查看；本轮在排的需求会一并移出。',
  iterationArchived: '迭代计划已归档，历史记录保留。',
  iterationCompletedLocked: '请先重新打开节点，再调整完成标准。',
  scheduleTitle: '安排里程碑需求',
  scheduleIntro:
    '为每条需求选择排进本里程碑的哪一轮迭代，或保持不排；一条需求同一时间只排在一个迭代里。',
  scheduleNoRounds: '本里程碑还没有迭代计划，请先添加迭代计划再安排需求。',
  scheduleEmpty: '暂无可安排的需求，可从需求池录入。',
  scheduleNotScheduled: '不排',
  scheduleSaved: '里程碑需求安排已保存。',
  readOnly: '只有管理者和拥有者可以调整里程碑与迭代计划。',
  unscheduledRequirement: '未排入迭代',
} as const;

/** 负责人已离开项目时下拉里的那一项（原型「xu（已离组）」）。 */
export function departedOwnerLabel(subject: string): string {
  return `${subject}（已离组）`;
}

/* ── 负责人候选（手工新建与草案审阅同一份，mil-11 D5）──────────────────────────── */

interface OwnerCandidate {
  readonly subject: string;
  readonly displayName: string;
  readonly state: string;
}

/**
 * 能被设为负责人的成员：**只列在册（active）成员**。受邀未加入、已移出的人服务端一律以
 * `owner_not_member` 拒收（ADR-0040），摆进下拉就是一个点了必错的陷阱。
 */
export function assignableOwnerMembers<Member extends OwnerCandidate>(
  members: readonly Member[],
): Member[] {
  return members.filter((member) => member.state === 'active');
}

/** 判「负责人在册」用的主体集合：与下拉同一口径（只算在册成员）。 */
export function activeMemberSubjects(
  members: readonly Pick<OwnerCandidate, 'subject' | 'state'>[],
): ReadonlySet<string> {
  return new Set(
    members.filter((member) => member.state === 'active').map((member) => member.subject),
  );
}

/**
 * 选中的负责人不在可选名单里（原负责人已离开项目）：下拉保留一项「（已离组）」，否则会静默改成「待分配」。
 * 名册里还认得这个人就写显示名，认不得（已不在名册）才写主体。
 */
export function departedOwnerOption(
  ownerSubject: string,
  members: readonly OwnerCandidate[],
): { readonly subject: string; readonly label: string } | null {
  if (!ownerSubject) return null;
  if (assignableOwnerMembers(members).some((member) => member.subject === ownerSubject)) {
    return null;
  }
  const known = members.find((member) => member.subject === ownerSubject);
  return { subject: ownerSubject, label: departedOwnerLabel(known?.displayName ?? ownerSubject) };
}

/* ── 里程碑表单 ─────────────────────────────────────────────────────────────── */

export interface MilestoneFormDraft {
  readonly name: string;
  readonly objectiveMd: string;
  /** `YYYY-MM-DD`；空串 ＝ 没填。 */
  readonly startAt: string;
  readonly dueAt: string;
  /** 空串 ＝ 待分配。 */
  readonly ownerSubject: string;
}

export const EMPTY_MILESTONE_FORM_DRAFT: MilestoneFormDraft = {
  name: '',
  objectiveMd: '',
  startAt: '',
  dueAt: '',
  ownerSubject: '',
};

/** 服务端时间串 → 表单里的日期键（`YYYY-MM-DD`，按本地日呈现，与列表同一个格式化出处）。 */
export function planningDayKey(value: string | null): string {
  if (!value) return '';
  const day = formatPlanningDate(value);
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day : '';
}

export function milestoneFormDraftFrom(row: ProjectMilestoneListItem | null): MilestoneFormDraft {
  if (row === null) return EMPTY_MILESTONE_FORM_DRAFT;
  return {
    name: row.name,
    objectiveMd: row.objectiveMd,
    startAt: planningDayKey(row.startAt),
    dueAt: planningDayKey(row.dueAt),
    ownerSubject: row.ownerSubject ?? '',
  };
}

export interface MilestoneFormContext {
  /** 正在编辑的那一个（新建为 null）：同名判定要排除它自己。 */
  readonly selfId: string | null;
  /** 手上已有的业务目标（未归档的参与同名预判；权威判定在服务端）。 */
  readonly milestones: readonly Pick<ProjectMilestoneListItem, 'id' | 'name' | 'archivedAt'>[];
  /** 本目标下**未归档**迭代计划的到期日键（新建时为空）。 */
  readonly iterationDueDays: readonly string[];
  readonly memberSubjects: ReadonlySet<string>;
  /** 活行上现在的负责人（新建为空串）：负责人没改就不判在册（与服务端 `owner_not_member` 同口径）。 */
  readonly currentOwnerSubject: string;
}

/** 这次保存是不是在**设置或更换**负责人，而那个人不在项目里（阻塞；服务端 422 `owner_not_member`）。 */
function ownerChangeIsInvalid(
  draftOwner: string,
  currentOwner: string,
  members: ReadonlySet<string>,
): boolean {
  return draftOwner !== '' && draftOwner !== currentOwner && !members.has(draftOwner);
}

/**
 * 负责人没改、却已离开项目：非阻塞提示「负责人已离开项目，请改派」（⛔ 不挡保存）；其余情况 null。
 * ⚠️ 与 `ownerChangeIsInvalid` 互斥：负责人一改就不再是「离开了的原负责人」，而是一次待判的更换。
 */
export function departedOwnerHint(
  draftOwner: string,
  currentOwner: string,
  members: ReadonlySet<string>,
): string | null {
  return draftOwner !== '' && draftOwner === currentOwner && !members.has(draftOwner)
    ? PLANNING_FORM_TEXT.ownerDeparted
    : null;
}

/** 照原型 `editPlan27` 的判定顺序给出第一句问题；通过为 null。 */
export function milestoneFormProblem(
  draft: MilestoneFormDraft,
  context: MilestoneFormContext,
): string | null {
  const name = draft.name.trim();
  if (!name || !draft.objectiveMd.trim() || !draft.startAt || !draft.dueAt) {
    return PLANNING_FORM_TEXT.milestoneRequired;
  }
  if (draft.startAt > draft.dueAt) return PLANNING_FORM_TEXT.milestoneDateOrder;
  if (
    context.milestones.some(
      (other) =>
        other.id !== context.selfId && other.archivedAt === null && other.name.trim() === name,
    )
  ) {
    return PLANNING_FORM_TEXT.milestoneNameTaken;
  }
  if (context.iterationDueDays.some((day) => day < draft.startAt || day > draft.dueAt)) {
    return PLANNING_FORM_TEXT.milestonePeriodCover;
  }
  if (
    ownerChangeIsInvalid(draft.ownerSubject, context.currentOwnerSubject, context.memberSubjects)
  ) {
    return PLANNING_FORM_TEXT.milestoneOwnerLeft;
  }
  return null;
}

/* ── 迭代计划表单 ───────────────────────────────────────────────────────────── */

export interface IterationFormDraft {
  readonly name: string;
  readonly dueAt: string;
  readonly ownerSubject: string;
  /** 完成标准（每行一条）。 */
  readonly criteriaText: string;
  /** 勾选的「关联本里程碑需求」。 */
  readonly requirementIds: readonly string[];
}

/** 完成标准：每行一条，去掉首尾空白与空行（照原型 `split('\n').map(trim).filter(Boolean)`）。 */
export function criteriaLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function iterationFormDraftFrom(
  row: ProjectIterationListItem | null,
  defaults: { readonly ownerSubject: string; readonly requirementIds: readonly string[] },
): IterationFormDraft {
  return {
    name: row?.name ?? '',
    dueAt: planningDayKey(row?.dueAt ?? null),
    ownerSubject: row === null ? defaults.ownerSubject : (row.ownerSubject ?? ''),
    criteriaText: criteriaLines(row?.criteriaMd ?? '').join('\n'),
    requirementIds: [...defaults.requirementIds],
  };
}

export interface PlanningPeriod {
  readonly start: string;
  readonly end: string;
}

/** 照原型 `editMilestone27` 的判定顺序；通过为 null。 */
export function iterationFormProblem(
  draft: IterationFormDraft,
  context: {
    readonly period: Partial<PlanningPeriod>;
    readonly memberSubjects: ReadonlySet<string>;
    /** 活行上现在的负责人（新建为空串）：负责人没改就不判在册。 */
    readonly currentOwnerSubject: string;
  },
): string | null {
  if (!draft.name.trim() || !draft.dueAt || criteriaLines(draft.criteriaText).length === 0) {
    return PLANNING_FORM_TEXT.iterationRequired;
  }
  const { start, end } = context.period;
  if ((start && draft.dueAt < start) || (end && draft.dueAt > end)) {
    return PLANNING_FORM_TEXT.iterationOutOfPeriod;
  }
  if (
    ownerChangeIsInvalid(draft.ownerSubject, context.currentOwnerSubject, context.memberSubjects)
  ) {
    return PLANNING_FORM_TEXT.iterationOwnerLeft;
  }
  return null;
}

/* ── 排期提示（安排需求弹层 + 迭代计划表单的关联需求）──────────────────────────── */

/**
 * 「『迭代名』（目标名）」：原轮次在**本**里程碑下只写轮次名；在别的里程碑下补目标名
 * （原型 `placeLabelM1`，全角书名号与括号）。「未关联」的旧轮次没有目标名可补。
 */
export function placementLabel(
  placement: ProjectRequirementPlacement | null,
  milestoneId: string,
): string {
  if (placement === null) return '';
  const own = placement.milestoneId === milestoneId || placement.milestoneName === null;
  return `『${placement.iterationName}』${own ? '' : `（${placement.milestoneName}）`}`;
}

export interface ScheduleHint {
  readonly text: string;
  /** 这次选择会把它从原轮次移出（原型 `is-move-m1`，警示色）。 */
  readonly moving: boolean;
}

/**
 * 安排需求弹层一行的就地提示（原型 `scheduleHintM1` 与第 7670 行的 change 处理）。
 *
 *  - `here`：当前排在**本**里程碑的某一轮；`current` ＝ 那一轮（否则空串）。
 *  - moving ＝ 原来有排期 且 选择不同于 current 且（选了某一轮 或 原来就在本里程碑）。
 *  - moving ⇒「将从『…』移出」；否则排在别处 ⇒「已排在『…』（目标名）」；排在本里程碑或没排 ⇒ 无提示。
 */
export function scheduleRowHint(
  item: ProjectRequirementPlacementItem,
  milestoneId: string,
  selection: string,
): ScheduleHint {
  const from = placementLabel(item.placement, milestoneId);
  const here = item.placement !== null && item.placement.milestoneId === milestoneId;
  const current = here ? (item.placement?.iterationId ?? '') : '';
  const moving = Boolean(from && selection !== current && (selection || here));
  if (moving) return { text: `将从${from}移出`, moving };
  return { text: from && !here ? `已排在${from}` : '', moving: false };
}

/** 这一行在弹层打开时的选择：排在本里程碑 ⇒ 那一轮；否则「不排」（空串）。 */
export function initialScheduleSelection(
  item: ProjectRequirementPlacementItem,
  milestoneId: string,
): string {
  return item.placement !== null && item.placement.milestoneId === milestoneId
    ? item.placement.iterationId
    : '';
}

/**
 * 迭代计划表单里一条候选需求的提示（原型 `scheduleCheckM1`）：排在**别的**迭代（含本里程碑的
 * 另一轮）时「已排在『…』」，勾上后「将从『…』移出」；排在这一轮或没排 ⇒ 无提示。
 */
export function requirementCheckHint(
  item: ProjectRequirementPlacementItem,
  milestoneId: string,
  iterationId: string | null,
  checked: boolean,
): ScheduleHint {
  const here = item.placement !== null && item.placement.iterationId === iterationId;
  const from = here ? '' : placementLabel(item.placement, milestoneId);
  if (!from) return { text: '', moving: false };
  return checked
    ? { text: `将从${from}移出`, moving: true }
    : { text: `已排在${from}`, moving: false };
}

/** 下拉选项里轮次的名字：已达成的补「（已达成）」（原型 `scheduleRowM1`）。 */
export function scheduleRoundLabel(
  round: Pick<ProjectIterationListItem, 'name' | 'status'>,
): string {
  return round.status === 'completed' ? `${round.name}（已达成）` : round.name;
}

/** 需求编辑器「迭代信息」：「当前排在：目标名 · 迭代名」/「未排入迭代」（原型 `scheduleLabelM1`）。 */
export function requirementPlacementText(placement: ProjectRequirementPlacement | null): string {
  if (placement === null) return PLANNING_FORM_TEXT.unscheduledRequirement;
  const goal = placement.milestoneName;
  return `当前排在：${goal === null ? '' : `${goal} · `}${placement.iterationName}`;
}
