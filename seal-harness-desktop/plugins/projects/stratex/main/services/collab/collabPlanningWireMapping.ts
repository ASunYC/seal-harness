import {
  ProjectIterationGroupCountsSchema,
  ProjectIterationListItemSchema,
  ProjectIterationRequirementLinkSchema,
  ProjectIterationRequirementSchema,
  ProjectMilestoneIterationSummarySchema,
  ProjectMilestoneListItemSchema,
  type ProjectIterationGroupCounts,
  type ProjectIterationListItem,
  type ProjectIterationRequirement,
  type ProjectIterationRequirementLink,
  type ProjectMilestoneListItem,
} from '../../../shared/protocol/project-planning.js';
import {
  ProjectIterationLifecycleEventSchema,
  ProjectMilestoneLifecycleEventSchema,
  type ProjectIterationLifecycleEvent,
  type ProjectMilestoneLifecycleEvent,
} from '../../../shared/protocol/project-planning-lifecycle.js';
import {
  ProjectRequirementPlacementItemSchema,
  ProjectRequirementScheduleConflictSchema,
  ProjectRequirementScheduleMoveSchema,
  type ProjectRequirementPlacementItem,
  type ProjectRequirementScheduleConflict,
  type ProjectRequirementScheduleMove,
} from '../../../shared/protocol/project-planning-schedule.js';
import { mapArray, recordOf } from './collabWireMapping.js';

/**
 * 规划域（业务目标 / 多轮迭代）的线格式（snake_case）→ 客户端投影（camelCase）映射。
 *
 * **为什么另起一份文件而不是续在 `collabWireMapping.ts` 后面**：与
 * `collabDataSourceWireMapping.ts` 同一个理由——那份已经按「协作面九个实体」长满，
 * 而这条线还要接着长（关联需求摘要、完成留证）。⚠️ 但纪律不分家：本域的映射
 * **只有这一处**，⛔ 不许在 SDK、store 或组件里再写第二份字段名映射。
 *
 * 纪律与协作面逐字一致：**逐字段挑选**已知项（服务端后续新增字段进不了投影），
 * 映射后再过一遍共享协议 schema（strictObject + enum 封顶）——两道门任一不过即回
 * null，上层当不可信响应（transient）处理。数组不做部分采信。
 *
 * ⛔ **服务端计数一律不设客户端上界**：`iteration_summary` / `visible_requirement_count`
 *    / `group_counts` 都没有 `.max()`，`linked_requirements` 数组也没有条数上界。
 *    已发生过的事故是给 `childTotal` 加了 `.max(500)`，子树越界时 `mapArray` 一条坏全批坏，
 *    整个看板取不回来——表现是「列表空白」，看不出是哪一行越界。
 *
 * ⚠️ 关联需求摘要里的**标题**是唯一一处用户亲笔正文：它进 REST 投影（列表第二列要显示
 *    它），⛔ 但绝不进事件面——事件只有 id 与枚举，渲染层收到后回拉。
 */

/**
 * 轮次汇总。⚠️ **不补默认值**：它是服务端恒回的键，缺席即投影漏列，整条判不可信
 * 才是对的。给它兜一个 `{total:0,...}` 会把「这一页没算出来」说成「这个目标下没有
 * 轮次」——用户看到的是一个空进度条，而不是一次可察觉的失败。
 */
function mapIterationSummary(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectMilestoneIterationSummarySchema.safeParse({
    total: record.total,
    open: record.open,
    completed: record.completed,
  });
  return view.success ? view.data : null;
}

/** 一行业务目标（列表投影：本体 + 服务端聚合）。 */
export function mapProjectMilestone(raw: unknown): ProjectMilestoneListItem | null {
  const record = recordOf(raw);
  if (!record) return null;
  const summary = mapIterationSummary(record.iteration_summary);
  if (summary === null) return null;
  const view = ProjectMilestoneListItemSchema.safeParse({
    id: record.id,
    name: record.name,
    // 目标说明允许空串（＝没写）；历史行/老服务端没有这个键时按空串投影。
    objectiveMd: record.objective_md ?? '',
    ownerSubject: record.owner_subject ?? null,
    status: record.status,
    startAt: record.start_at ?? null,
    dueAt: record.due_at ?? null,
    archivedAt: record.archived_at ?? null,
    version: record.version,
    creatorSubject: record.creator_subject,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    iterationSummary: summary,
    visibleRequirementCount: record.visible_requirement_count,
  });
  return view.success ? view.data : null;
}

/**
 * 一轮迭代（列表投影：本体 + 关联需求的授权摘要）。
 *
 * ⚠️ 关联摘要与 `has_more` 两个键都**不补默认值**：它们是服务端恒回的键，缺席即投影
 *    漏列，整条判不可信才是对的。兜一个空数组会把「这一页没算出来」说成「这一轮没关联
 *    任何需求」——用户看到的是一张空卡，而不是一次可察觉的失败。
 */
export function mapProjectIteration(raw: unknown): ProjectIterationListItem | null {
  const record = recordOf(raw);
  if (!record) return null;
  const linked = mapIterationRequirements(record.linked_requirements);
  if (linked === null) return null;
  const view = ProjectIterationListItemSchema.safeParse({
    linkedRequirements: linked,
    linkedRequirementsHasMore: record.linked_requirements_has_more,
    id: record.id,
    // ⭐ 这里**必须**是 `?? null`：服务端对「未关联」回的就是 JSON null，
    //    而 null 是一个有意的产品状态，不是缺失。⛔ 别在调用点兜成某个目标。
    milestoneId: record.milestone_id ?? null,
    name: record.name,
    criteriaMd: record.criteria_md ?? '',
    ownerSubject: record.owner_subject ?? null,
    priority: record.priority,
    status: record.status,
    dueAt: record.due_at ?? null,
    archivedAt: record.archived_at ?? null,
    version: record.version,
    creatorSubject: record.creator_subject,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
  return view.success ? view.data : null;
}

/**
 * 一条关联需求的授权摘要（迭代那一侧看需求的**唯一**形状）。
 *
 * ⚠️ 服务端已经按可见性筛过（别人的个人条目根本不在数组里），所以这里**不做**任何
 *    「要不要显示」的判断——那道门在服务端，客户端再判一次只会多一个会漂的出处。
 * ⛔ 不补默认值：任一字段缺席即整条不可信（`mapArray` 一条坏全批坏，不做部分采信）。
 */
function mapIterationRequirement(raw: unknown): ProjectIterationRequirement | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectIterationRequirementSchema.safeParse({
    requirementId: record.requirement_id,
    title: record.title,
    // 状态值与线协议**逐字一致**（`mapTodo` 也是直接透传），所以这里不做翻译；
    // 闭集由 `TodoStatusSchema` 在下面那次 safeParse 里封顶。
    status: record.status,
    linkState: record.state,
    linkedAt: record.linked_at,
    unlinkedAt: record.unlinked_at ?? null,
  });
  return view.success ? view.data : null;
}

/**
 * 一行关联记录（写路径出参）。
 *
 * ⚠️ `id` 是**关联行**的 id，`requirement_id` 才是需求的 —— 两者刻意都出，别互相当。
 */
export function mapIterationRequirementLink(raw: unknown): ProjectIterationRequirementLink | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectIterationRequirementLinkSchema.safeParse({
    id: record.id,
    iterationId: record.iteration_id,
    requirementId: record.requirement_id,
    state: record.state,
    linkedAt: record.linked_at,
    unlinkedAt: record.unlinked_at ?? null,
    linkedBySubject: record.linked_by_subject,
    version: record.version,
  });
  return view.success ? view.data : null;
}

export function mapIterationRequirements(
  raw: unknown,
): readonly ProjectIterationRequirement[] | null {
  return mapArray(raw, mapIterationRequirement);
}

/**
 * 分组计数。⚠️ 同上不补默认值——分组数关系到「我的」那一栏显示几条，
 * 悄悄兜成 0 会让用户以为自己名下没有轮次。
 */
export function mapIterationGroupCounts(raw: unknown): ProjectIterationGroupCounts | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectIterationGroupCountsSchema.safeParse({
    mine: record.mine,
    open: record.open,
    completed: record.completed,
  });
  return view.success ? view.data : null;
}

/**
 * 阶段记录一行（一次记录达成或重新打开）的共同字段。
 *
 * ⚠️ `reason` / `evidence_refs` 是用户亲笔正文：它们进 REST 投影（阶段记录要显示），
 *    ⛔ 但绝不进事件面。缺席按空投影，与服务端序列化的 `or ""` / `or []` 同口径——
 *    空串 / 空数组本身就是合法值（重开可以不带证据），兜它们不会把失败说成成功。
 * ⛔ 其余键**不补默认值**：状态、操作人、时刻缺一即整条不可信。
 */
function lifecycleEventFields(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    fromStatus: record.from_status,
    toStatus: record.to_status,
    actorSubject: record.actor_subject,
    reason: record.reason ?? '',
    evidenceRefs: record.evidence_refs ?? [],
    occurredAt: record.occurred_at,
  };
}

/** 业务目标的一条阶段记录。 */
export function mapMilestoneLifecycleEvent(raw: unknown): ProjectMilestoneLifecycleEvent | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectMilestoneLifecycleEventSchema.safeParse({
    ...lifecycleEventFields(record),
    milestoneId: record.milestone_id,
  });
  return view.success ? view.data : null;
}

/** 迭代计划的一条阶段记录。 */
export function mapIterationLifecycleEvent(raw: unknown): ProjectIterationLifecycleEvent | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectIterationLifecycleEventSchema.safeParse({
    ...lifecycleEventFields(record),
    iterationId: record.iteration_id,
  });
  return view.success ? view.data : null;
}

/** 阶段记录数组：一条不可信即整页拒绝（与本域其余列表同一条纪律）。 */
export function mapMilestoneLifecycleEvents(
  raw: unknown,
): readonly ProjectMilestoneLifecycleEvent[] | null {
  return mapArray(raw, mapMilestoneLifecycleEvent);
}

export function mapIterationLifecycleEvents(
  raw: unknown,
): readonly ProjectIterationLifecycleEvent[] | null {
  return mapArray(raw, mapIterationLifecycleEvent);
}

/**
 * 分页信封的三个数（`total` / `page` / `page_size`）。
 * 任一缺失或不合形状即整页不可信——分页数错了会让「还有下一页」判反。
 */
export function mapPlanningPage(
  record: Record<string, unknown>,
): { readonly total: number; readonly page: number; readonly pageSize: number } | null {
  const total = record.total;
  const page = record.page;
  const pageSize = record.page_size;
  if (!isCount(total) || !isPositiveInteger(page) || !isPositiveInteger(pageSize)) return null;
  return { total, page, pageSize };
}

/** ⛔ 只判形状，**不设上界**（服务端计数）。 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/* ── 安排需求整批保存（MIL-09）──────────────────────────────────────────────── */

/** 安排需求整批保存的成功出参（投影后）。⚠️ `changed=false` 不是失败。 */
export interface RequirementScheduleWrite {
  readonly changed: boolean;
  readonly iterations: readonly ProjectIterationListItem[];
  readonly moves: readonly ProjectRequirementScheduleMove[];
}

/** 一条改动（逐字段挑选 + 共享协议 schema 两道门）。 */
function mapRequirementScheduleMove(raw: unknown): ProjectRequirementScheduleMove | null {
  const record = recordOf(raw);
  if (!record) return null;
  const parsed = ProjectRequirementScheduleMoveSchema.safeParse({
    requirementId: record.requirement_id,
    iterationId: record.iteration_id,
    previousIterationId: record.previous_iteration_id,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * 成功出参：`changed` 缺席不兜 false（那会把「真的排上了」说成「本来就排着」）；任一轮或任一条
 * 改动投影失败整体拒绝（数组不做部分采信）。
 */
export function mapRequirementScheduleWrite(body: unknown): RequirementScheduleWrite | null {
  const record = recordOf(body);
  if (!record || typeof record.changed !== 'boolean') return null;
  const iterations = mapArray(record.iterations, mapProjectIteration);
  const moves = mapArray(record.moves, mapRequirementScheduleMove);
  if (iterations === null || moves === null) return null;
  return { changed: record.changed, iterations, moves };
}

/** 冲突清单里的一条（逐字段挑选 + 共享协议 schema 两道门）。 */
export function mapRequirementScheduleConflict(
  raw: unknown,
): ProjectRequirementScheduleConflict | null {
  const record = recordOf(raw);
  if (!record) return null;
  const parsed = ProjectRequirementScheduleConflictSchema.safeParse({
    requirementId: record.requirement_id,
    currentVersion: record.current_version,
    currentIterationId: record.current_iteration_id,
  });
  return parsed.success ? parsed.data : null;
}

/** 需求排期现状的一条（逐字段挑选 + 共享协议 schema 两道门；排期对象缺席不兜 null）。 */
function mapRequirementPlacementItem(raw: unknown): ProjectRequirementPlacementItem | null {
  const record = recordOf(raw);
  if (!record || !('placement' in record)) return null;
  const placement = record.placement === null ? null : recordOf(record.placement);
  if (record.placement !== null && placement === null) return null;
  const hierarchyKeys = [
    'parent_id',
    'ancestor_path',
    'has_parent',
    'path_complete',
    'has_visible_children',
  ];
  const hasHierarchy = hierarchyKeys.some((key) => key in record);
  if (hasHierarchy && !hierarchyKeys.every((key) => key in record)) return null;
  const ancestorPath = hasHierarchy
    ? mapArray(record.ancestor_path, (rawAncestor) => {
        const ancestor = recordOf(rawAncestor);
        return ancestor ? { requirementId: ancestor.requirement_id, title: ancestor.title } : null;
      })
    : undefined;
  if (ancestorPath === null) return null;
  const parsed = ProjectRequirementPlacementItemSchema.safeParse({
    requirementId: record.requirement_id,
    ...(hasHierarchy
      ? {
          parentId: record.parent_id,
          ancestorPath,
          hasParent: record.has_parent,
          pathComplete: record.path_complete,
          hasVisibleChildren: record.has_visible_children,
        }
      : {}),
    title: record.title,
    status: record.status,
    version: record.version,
    placement:
      placement === null
        ? null
        : {
            iterationId: placement.iteration_id,
            iterationName: placement.iteration_name,
            iterationStatus: placement.iteration_status,
            milestoneId: placement.milestone_id,
            milestoneName: placement.milestone_name,
          },
  });
  return parsed.success ? parsed.data : null;
}

export function mapRequirementPlacementItems(
  raw: unknown,
): readonly ProjectRequirementPlacementItem[] | null {
  return mapArray(raw, mapRequirementPlacementItem);
}
