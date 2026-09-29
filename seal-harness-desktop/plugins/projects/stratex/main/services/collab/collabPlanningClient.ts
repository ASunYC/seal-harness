import type {
  ProjectIterationCreateRequest,
  ProjectIterationGroupCounts,
  ProjectIterationListItem,
  ProjectIterationListRequest,
  ProjectIterationRequirement,
  ProjectIterationRequirementLink,
  ProjectIterationRequirementLinkRequest,
  ProjectIterationRequirementListRequest,
  ProjectIterationRequirementUnlinkRequest,
  ProjectIterationUpdateRequest,
  ProjectMilestoneCreateRequest,
  ProjectMilestoneListItem,
  ProjectMilestoneListRequest,
  ProjectMilestoneUpdateRequest,
} from '../../../shared/protocol/project-planning.js';
import type {
  ProjectIterationLifecycleEvent,
  ProjectIterationLifecycleEventListRequest,
  ProjectIterationLifecycleRequest,
  ProjectMilestoneLifecycleEvent,
  ProjectMilestoneLifecycleEventListRequest,
  ProjectMilestoneLifecycleRequest,
  ProjectPlanningLifecycleAction,
} from '../../../shared/protocol/project-planning-lifecycle.js';
import {
  ProjectIterationScheduleConflictSchema,
  ProjectRequirementPlacementListResultSchema,
  type ProjectIterationScheduleConflict,
  type ProjectIterationScheduleSaveRequest,
  type ProjectRequirementPlacementItem,
  type ProjectRequirementPlacementListRequest,
  type ProjectRequirementScheduleConflict,
  type ProjectRequirementScheduleSaveRequest,
} from '../../../shared/protocol/project-planning-schedule.js';
import {
  failureFromResponse,
  readBoundedJson,
  type CollabClientFailure,
  type CollabClientOutcome,
} from './collabClient.js';
import {
  mapIterationGroupCounts,
  mapIterationLifecycleEvents,
  mapIterationRequirementLink,
  mapIterationRequirements,
  mapMilestoneLifecycleEvents,
  mapPlanningPage,
  mapProjectIteration,
  mapProjectMilestone,
  mapRequirementPlacementItems,
  mapRequirementScheduleConflict,
  mapRequirementScheduleWrite,
  type RequirementScheduleWrite,
} from './collabPlanningWireMapping.js';
import {
  conflictWireSchema,
  mapArray,
  readServerErrorCode,
  recordOf,
} from './collabWireMapping.js';

/**
 * 规划域（业务目标 / 多轮迭代 / 迭代↔需求关联历史 / 完成·重开留证）的 HTTP 客户端：
 * 九个 CRUD 与关联端点 + 六个生命周期端点（MIL-07）。
 *
 * 与 `collabClient` 分文件而不是续在它后面，是因为那份已经按协作面九个实体长满，
 * 而本域还要接着长（关联需求、完成留证）。⛔ 但**失败分档与响应体读取不另起一套**：
 * `failureFromResponse` / `readBoundedJson` 从 `collabClient` 导入——分档表两处必漂移。
 *
 * 纪律与协作面一致：单次尝试不自行重试；响应体是不可信输入（逐字段挑选映射 + 共享
 * 协议 schema 两道门，任一不过即 transient）；令牌只进 `Authorization` 头，本模块
 * 不记录、不打印任何凭据。
 *
 * ⭐ 四条写路径**必带 `client_request_id`**：它是服务端幂等的键（服务端把
 * (项目, 操作人, 请求号) 折成新行的主键）。同一次点击的重试因此回到同一行，
 * 而不是落出第二条。⛔ 别在重试时换一个新请求号——那正好把幂等关掉。
 */

const API_PREFIX = 'api/v1/';
const DEFAULT_TIMEOUT_MS = 20_000;

interface SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly accessToken: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly jsonBody?: Readonly<Record<string, unknown>>;
}

export interface CollabPlanningClientOptions {
  /** 构建期注入并已校验的服务基地址（末尾带 `/`）。 */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface MilestonePage {
  readonly items: readonly ProjectMilestoneListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface IterationPage extends Omit<MilestonePage, 'items'> {
  readonly items: readonly ProjectIterationListItem[];
  readonly groupCounts: ProjectIterationGroupCounts;
}

export interface IterationRequirementPage extends Omit<MilestonePage, 'items'> {
  readonly items: readonly ProjectIterationRequirement[];
}

/** 需求排期现状页（MIL-09）：候选 + 服务端算的未排条数（⛔ 不自算）。 */
export interface RequirementPlacementPage extends Omit<MilestonePage, 'items'> {
  readonly items: readonly ProjectRequirementPlacementItem[];
  readonly unscheduledTotal: number;
  readonly selectionScope?: 'page' | 'group';
  readonly groupRootId?: string | null;
  readonly groupComplete?: boolean;
}

/** 一个业务目标的阶段记录页（完成 / 重开的留证，按发生时刻升序）。 */
export interface MilestoneLifecycleEventPage extends Omit<MilestonePage, 'items'> {
  readonly items: readonly ProjectMilestoneLifecycleEvent[];
}

/** 一轮迭代的阶段记录页。 */
export interface IterationLifecycleEventPage extends Omit<MilestonePage, 'items'> {
  readonly items: readonly ProjectIterationLifecycleEvent[];
}

/**
 * 关联 / 移出的共同出参。
 *
 * ⚠️ `changed=false` **不是失败**：幂等重发命中、「本来就排在这一轮」、「本来就已经
 *    不在这一轮」三种情况都是它。⛔ 别据此重试。
 * ⚠️ `previousIterationId` 非空 ⇒ 切排期，**另一轮的摘要也变了**。
 */
export interface IterationRequirementWrite {
  readonly changed: boolean;
  readonly link: ProjectIterationRequirementLink;
  readonly iteration: ProjectIterationListItem;
  readonly requirementId: string;
  readonly previousIterationId: string | null;
}

/**
 * 排期整批保存的成功出参。⚠️ `changed=false` **不是失败**（回放命中 / 每轮本来就在那一天）。
 */
export interface IterationScheduleWrite {
  readonly changed: boolean;
  readonly iterations: readonly ProjectIterationListItem[];
}

/**
 * 排期整批保存的结果：失败分支在协作面失败形状之上**多带一份冲突清单**——
 * 仅 409 `version_conflict` 时非空（服务端一次收齐全部过期条目），其余失败缺席。
 */
export type IterationScheduleOutcome = BatchWriteOutcome<
  IterationScheduleWrite,
  ProjectIterationScheduleConflict
>;

/** 安排需求整批保存的结果（MIL-09）：失败分支同样多带一份冲突清单，仅版本冲突时可能非空。 */
export type RequirementScheduleOutcome = BatchWriteOutcome<
  RequirementScheduleWrite,
  ProjectRequirementScheduleConflict
>;

/** 两条整批写口共用的结果形状：成功带投影，失败在协作面失败形状之上多一份冲突清单（可缺席）。 */
type BatchWriteOutcome<Value, Conflict> =
  | { readonly ok: true; readonly value: Value }
  | (CollabClientFailure & { readonly conflicts?: readonly Conflict[] });

export type { RequirementScheduleWrite };

export function createCollabPlanningClient(
  options: CollabPlanningClientOptions,
): CollabPlanningClient {
  return new CollabPlanningClient(options);
}

export class CollabPlanningClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CollabPlanningClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `GET /projects/{id}/milestones`（按项目可读权限，viewer 也能读）。 */
  async listMilestones(
    accessToken: string,
    input: ProjectMilestoneListRequest,
  ): Promise<CollabClientOutcome<MilestonePage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/milestones`,
      {
        method: 'GET',
        accessToken,
        query: {
          page: input.page,
          page_size: input.pageSize,
          q: input.q,
          include_archived: input.includeArchived,
          // 计划区间交叠（ADR-0042）：目标自身起止或名下未归档迭代的截止日。
          plan_from: input.planFrom,
          plan_to: input.planTo,
        },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapArray(record.items, mapProjectMilestone);
        const page = mapPlanningPage(record);
        return items === null || page === null ? null : { items, ...page };
      },
    );
  }

  /** `POST /projects/{id}/milestones`（manager+，服务端强判）。 */
  async createMilestone(
    accessToken: string,
    input: ProjectMilestoneCreateRequest,
  ): Promise<CollabClientOutcome<ProjectMilestoneListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/milestones`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          client_request_id: input.clientRequestId,
          name: input.name,
          // 缺席即不发（服务端落缺省）；`null` 要保留（＝显式不指派/清空）。
          ...(input.objectiveMd !== undefined ? { objective_md: input.objectiveMd } : {}),
          ...(input.ownerSubject !== undefined ? { owner_subject: input.ownerSubject } : {}),
          ...(input.startAt !== undefined ? { start_at: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
        },
      },
      (body) => mapProjectMilestone(recordOf(body)?.milestone),
    );
  }

  /**
   * `PATCH /projects/{id}/milestones/{mid}`（manager+；含归档与恢复）。
   * 409 时把服务端 `current_version` 带回（`conflict` + currentVersion）。
   */
  async updateMilestone(
    accessToken: string,
    input: ProjectMilestoneUpdateRequest,
  ): Promise<CollabClientOutcome<ProjectMilestoneListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/milestones/` +
        `${encodeURIComponent(input.milestoneId)}`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          client_request_id: input.clientRequestId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.objectiveMd !== undefined ? { objective_md: input.objectiveMd } : {}),
          ...(input.ownerSubject !== undefined ? { owner_subject: input.ownerSubject } : {}),
          ...(input.startAt !== undefined ? { start_at: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
          // 归档是**动作标记**：true 归档、false 恢复；时刻由服务端定（客户端不递时间戳）。
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
        },
      },
      (body) => mapProjectMilestone(recordOf(body)?.milestone),
      { readConflictVersion: true },
    );
  }

  /** `GET /projects/{id}/iterations`（列表 + 分组计数）。 */
  async listIterations(
    accessToken: string,
    input: ProjectIterationListRequest,
  ): Promise<CollabClientOutcome<IterationPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations`,
      {
        method: 'GET',
        accessToken,
        query: {
          milestone_id: input.milestoneId,
          // 「未关联」是独立问题，不用 milestone_id 的空值表达。
          unlinked: input.unlinked,
          state: input.state,
          owner_subject: input.ownerSubject,
          q: input.q,
          sort: input.sort,
          page: input.page,
          page_size: input.pageSize,
          include_archived: input.includeArchived,
        },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapArray(record.items, mapProjectIteration);
        const page = mapPlanningPage(record);
        const groupCounts = mapIterationGroupCounts(record.group_counts);
        if (items === null || page === null || groupCounts === null) return null;
        return { items, ...page, groupCounts };
      },
    );
  }

  /** `POST /projects/{id}/iterations`（manager+；父目标须同项目且未归档）。 */
  async createIteration(
    accessToken: string,
    input: ProjectIterationCreateRequest,
  ): Promise<CollabClientOutcome<ProjectIterationListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          client_request_id: input.clientRequestId,
          name: input.name,
          // `null` ＝ 显式「未关联」，必须发出去；缺席 ＝ 不发（服务端同样落未关联）。
          ...(input.milestoneId !== undefined ? { milestone_id: input.milestoneId } : {}),
          ...(input.criteriaMd !== undefined ? { criteria_md: input.criteriaMd } : {}),
          ...(input.ownerSubject !== undefined ? { owner_subject: input.ownerSubject } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
        },
      },
      (body) => mapProjectIteration(recordOf(body)?.iteration),
    );
  }

  /**
   * `PATCH /projects/{id}/iterations/{iid}`。
   *
   * ⛔ 请求体里结构性**没有** `milestone_id`：首期不支持跨目标移动，契约层就不表达它。
   * 轮次 PATCH 只有 manager+ 一档（排期归管理者和拥有者），由服务端强判，这里不预判。
   */
  async updateIteration(
    accessToken: string,
    input: ProjectIterationUpdateRequest,
  ): Promise<CollabClientOutcome<ProjectIterationListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}`,
      {
        method: 'PATCH',
        accessToken,
        jsonBody: {
          expected_version: input.expectedVersion,
          client_request_id: input.clientRequestId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.criteriaMd !== undefined ? { criteria_md: input.criteriaMd } : {}),
          ...(input.ownerSubject !== undefined ? { owner_subject: input.ownerSubject } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
        },
      },
      (body) => mapProjectIteration(recordOf(body)?.iteration),
      { readConflictVersion: true },
    );
  }

  /** `GET /projects/{id}/iterations/{iid}/requirements`（独立分页，viewer 也能读）。 */
  async listIterationRequirements(
    accessToken: string,
    input: ProjectIterationRequirementListRequest,
  ): Promise<CollabClientOutcome<IterationRequirementPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}/requirements`,
      {
        method: 'GET',
        accessToken,
        query: {
          page: input.page,
          page_size: input.pageSize,
          include_history: input.includeHistory,
        },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapIterationRequirements(record.items);
        const page = mapPlanningPage(record);
        return items === null || page === null ? null : { items, ...page };
      },
    );
  }

  /**
   * `POST /projects/{id}/iterations/{iid}/requirements`（editor+）。
   *
   * ⭐ 必带 `client_request_id`：它是服务端幂等的键（折成新关联行的主键）。
   *    ⛔ 别在重试时换一个新请求号——那正好把幂等关掉。
   * ⚠️ 两个 `expected_*_version` 是**闸**：成功后它们都不变（排期不改需求本身、
   *    也不改轮次的任何字段）。⛔ 别据此判断「服务端没生效」。
   */
  async linkIterationRequirement(
    accessToken: string,
    input: ProjectIterationRequirementLinkRequest,
  ): Promise<CollabClientOutcome<IterationRequirementWrite>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}/requirements`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          requirement_id: input.requirementId,
          expected_requirement_version: input.expectedRequirementVersion,
          expected_iteration_version: input.expectedIterationVersion,
          client_request_id: input.clientRequestId,
        },
      },
      mapIterationRequirementWrite,
      { readConflictVersion: true },
    );
  }

  /**
   * `POST /projects/{id}/iterations/{iid}/requirements/{rid}/unlink`（editor+）。
   *
   * ⛔ 这**不是删除**：关联行留着（`link.state === 'closed'`），带 `includeHistory`
   *    的分页照样读得到它。
   */
  async unlinkIterationRequirement(
    accessToken: string,
    input: ProjectIterationRequirementUnlinkRequest,
  ): Promise<CollabClientOutcome<IterationRequirementWrite>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}/requirements/` +
        `${encodeURIComponent(input.requirementId)}/unlink`,
      {
        method: 'POST',
        accessToken,
        jsonBody: {
          expected_requirement_version: input.expectedRequirementVersion,
          expected_iteration_version: input.expectedIterationVersion,
          client_request_id: input.clientRequestId,
        },
      },
      mapIterationRequirementWrite,
      { readConflictVersion: true },
    );
  }

  /**
   * `POST /projects/{id}/milestones/{mid}/iteration-schedule`（manager+；单事务全有或全无）。
   *
   * ⭐ 必带 `client_request_id`（服务端幂等键）；⛔ 重试同一份草案时别换编号。
   * ⚠️ 409 在这条路上有三个互不相同的业务码：`version_conflict`（带冲突清单，刷新后重试）、
   *    `idempotency_conflict`（换编号）、`idempotency_retry`（原样重试一次）——serverCode
   *    原样透传，⛔ 不在这一层塌成一句。
   */
  async saveIterationSchedule(
    accessToken: string,
    input: ProjectIterationScheduleSaveRequest,
  ): Promise<IterationScheduleOutcome> {
    return this.sendBatchWrite(
      `projects/${encodeURIComponent(input.projectId)}/milestones/` +
        `${encodeURIComponent(input.milestoneId)}/iteration-schedule`,
      accessToken,
      {
        client_request_id: input.clientRequestId,
        items: input.items.map((entry) => ({
          iteration_id: entry.iterationId,
          due_at: entry.dueAt,
          expected_version: entry.expectedVersion,
        })),
      },
      mapIterationScheduleWrite,
      mapIterationScheduleConflict,
    );
  }

  /**
   * `POST /projects/{id}/milestones/{mid}/requirement-schedule`；无里程碑轮次改走
   * `POST /projects/{id}/requirement-schedule`（MIL-09，manager+；单事务全有或全无）。
   *
   * ⭐ 必带 `client_request_id`（服务端幂等键）；⛔ 重试同一份安排时别换编号。
   * ⚠️ `iteration_id` / `expected_iteration_id` 的 `null` **必须发出去**（＝不排 / 没排）：服务端要求
   *    这两个键显式存在，缺席即 422。
   * ⚠️ 409 的业务码同排期保存：`version_conflict`（带冲突清单）/ `idempotency_conflict` /
   *    `idempotency_retry` / `milestone_archived` / `iteration_archived`——serverCode 原样透传。
   */
  async saveRequirementSchedule(
    accessToken: string,
    input: ProjectRequirementScheduleSaveRequest,
  ): Promise<RequirementScheduleOutcome> {
    const path =
      input.milestoneId === null
        ? `projects/${encodeURIComponent(input.projectId)}/requirement-schedule`
        : `projects/${encodeURIComponent(input.projectId)}/milestones/` +
          `${encodeURIComponent(input.milestoneId)}/requirement-schedule`;
    return this.sendBatchWrite(
      path,
      accessToken,
      {
        client_request_id: input.clientRequestId,
        items: input.items.map((entry) => ({
          requirement_id: entry.requirementId,
          iteration_id: entry.iterationId,
          expected_requirement_version: entry.expectedRequirementVersion,
          expected_iteration_id: entry.expectedIterationId,
        })),
      },
      mapRequirementScheduleWrite,
      mapRequirementScheduleConflict,
    );
  }

  /** `GET /projects/{id}/requirement-placements`（MIL-09，viewer 也能读）。 */
  async listRequirementPlacements(
    accessToken: string,
    input: ProjectRequirementPlacementListRequest,
  ): Promise<CollabClientOutcome<RequirementPlacementPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/requirement-placements`,
      {
        method: 'GET',
        accessToken,
        query: {
          page: input.page,
          page_size: input.pageSize,
          q: input.q,
          requirement_id: input.requirementId,
          group_root_id: input.groupRootId,
        },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapRequirementPlacementItems(record.items);
        const page = mapPlanningPage(record);
        const unscheduled = record.unscheduled_total;
        if (items === null || page === null) return null;
        if (
          typeof unscheduled !== 'number' ||
          !Number.isSafeInteger(unscheduled) ||
          unscheduled < 0
        ) {
          return null;
        }
        const parsed = ProjectRequirementPlacementListResultSchema.safeParse({
          ok: true,
          items,
          ...page,
          unscheduledTotal: unscheduled,
          ...(record.selection_scope !== undefined
            ? { selectionScope: record.selection_scope }
            : {}),
          ...(record.group_root_id !== undefined ? { groupRootId: record.group_root_id } : {}),
          ...(record.group_complete !== undefined ? { groupComplete: record.group_complete } : {}),
        });
        if (!parsed.success || !parsed.data.ok) return null;
        if (
          input.groupRootId !== undefined &&
          (parsed.data.selectionScope !== 'group' ||
            parsed.data.groupRootId?.toLowerCase() !== input.groupRootId.toLowerCase())
        )
          return null;
        if (input.groupRootId === undefined && parsed.data.selectionScope === 'group') return null;
        const { selectionScope, groupRootId, groupComplete } = parsed.data;
        return {
          items: parsed.data.items,
          total: parsed.data.total,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
          unscheduledTotal: parsed.data.unscheduledTotal,
          ...(selectionScope !== undefined ? { selectionScope } : {}),
          ...(groupRootId !== undefined ? { groupRootId } : {}),
          ...(groupComplete !== undefined ? { groupComplete } : {}),
        };
      },
    );
  }

  /* ---------------- 生命周期：记录达成 / 重新打开 / 阶段记录（MIL-07） ---------------- */

  /** `POST /projects/{id}/milestones/{mid}/complete`（manager+；至少一轮且全部未归档轮次已达成）。 */
  async completeMilestone(
    accessToken: string,
    input: ProjectMilestoneLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectMilestoneListItem>> {
    return this.transitionMilestone(accessToken, 'complete', input);
  }

  /** `POST /projects/{id}/milestones/{mid}/reopen`（manager+；⛔ 不联动子迭代与需求）。 */
  async reopenMilestone(
    accessToken: string,
    input: ProjectMilestoneLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectMilestoneListItem>> {
    return this.transitionMilestone(accessToken, 'reopen', input);
  }

  /** `POST /projects/{id}/iterations/{iid}/complete`（manager+；⛔ 不写需求状态、不建测试轮次）。 */
  async completeIteration(
    accessToken: string,
    input: ProjectIterationLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectIterationListItem>> {
    return this.transitionIteration(accessToken, 'complete', input);
  }

  /** `POST /projects/{id}/iterations/{iid}/reopen`（manager+；历史记录保留）。 */
  async reopenIteration(
    accessToken: string,
    input: ProjectIterationLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectIterationListItem>> {
    return this.transitionIteration(accessToken, 'reopen', input);
  }

  /**
   * `GET /projects/{id}/milestones/{mid}/events`（viewer 也能读；**已归档照样读得到**）。
   * ⚠️ 服务端出参的数组键是 `events`（不是本域其余列表的 `items`），映射到客户端契约的 `items`。
   */
  async listMilestoneEvents(
    accessToken: string,
    input: ProjectMilestoneLifecycleEventListRequest,
  ): Promise<CollabClientOutcome<MilestoneLifecycleEventPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/milestones/` +
        `${encodeURIComponent(input.milestoneId)}/events`,
      {
        method: 'GET',
        accessToken,
        query: { page: input.page, page_size: input.pageSize },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapMilestoneLifecycleEvents(record.events);
        const page = mapPlanningPage(record);
        return items === null || page === null ? null : { items, ...page };
      },
    );
  }

  /** `GET /projects/{id}/iterations/{iid}/events`（同上）。 */
  async listIterationEvents(
    accessToken: string,
    input: ProjectIterationLifecycleEventListRequest,
  ): Promise<CollabClientOutcome<IterationLifecycleEventPage>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}/events`,
      {
        method: 'GET',
        accessToken,
        query: { page: input.page, page_size: input.pageSize },
      },
      (body) => {
        const record = recordOf(body);
        if (!record) return null;
        const items = mapIterationLifecycleEvents(record.events);
        const page = mapPlanningPage(record);
        return items === null || page === null ? null : { items, ...page };
      },
    );
  }

  /**
   * 目标的完成 / 重开。路径最后一段取自动作闭集（`complete` / `reopen`），⛔ 不接受任意串。
   * 409 时读 `current_version`（版本冲突可恢复）；其余 409 由 serverCode 区分。
   */
  private async transitionMilestone(
    accessToken: string,
    action: ProjectPlanningLifecycleAction,
    input: ProjectMilestoneLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectMilestoneListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/milestones/` +
        `${encodeURIComponent(input.milestoneId)}/${action}`,
      { method: 'POST', accessToken, jsonBody: lifecycleBody(input) },
      (body) => mapProjectMilestone(recordOf(body)?.milestone),
      { readConflictVersion: true },
    );
  }

  private async transitionIteration(
    accessToken: string,
    action: ProjectPlanningLifecycleAction,
    input: ProjectIterationLifecycleRequest,
  ): Promise<CollabClientOutcome<ProjectIterationListItem>> {
    return this.requestEntity(
      `projects/${encodeURIComponent(input.projectId)}/iterations/` +
        `${encodeURIComponent(input.iterationId)}/${action}`,
      { method: 'POST', accessToken, jsonBody: lifecycleBody(input) },
      (body) => mapProjectIteration(recordOf(body)?.iteration),
      { readConflictVersion: true },
    );
  }

  /* ------------------------------ 请求底座 ------------------------------ */

  /**
   * 整批写口（排期保存 / 安排需求）的共同读法：2xx 投影、409 带业务码与冲突清单、其余走分档表。
   * ⚠️ 冲突清单读不出来时不编造：缺席 ⇒ 上层按「刷新后重试」的通用冲突处理。
   */
  private async sendBatchWrite<Value, Conflict>(
    path: string,
    accessToken: string,
    jsonBody: Readonly<Record<string, unknown>>,
    project: (body: unknown) => Value | null,
    projectConflict: (raw: unknown) => Conflict | null,
  ): Promise<BatchWriteOutcome<Value, Conflict>> {
    const response = await this.send(path, { method: 'POST', accessToken, jsonBody });
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status >= 200 && response.status < 300) {
      const body = await readBoundedJson(response);
      const value = body === undefined ? null : project(body);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    if (response.status === 409) {
      const body = await readBoundedJson(response);
      const serverCode = readServerErrorCode(body);
      const conflicts = mapArray(recordOf(body)?.conflicts, projectConflict);
      return {
        ok: false,
        code: 'conflict',
        ...(serverCode === undefined ? {} : { serverCode }),
        ...(conflicts === null ? {} : { conflicts }),
      };
    }
    return failureFromResponse(response);
  }

  private async requestEntity<T>(
    path: string,
    init: SendInit,
    project: (body: unknown) => T | null,
    options?: { readonly readConflictVersion?: boolean },
  ): Promise<CollabClientOutcome<T>> {
    const response = await this.send(path, init);
    if (response === null) return { ok: false, code: 'transient' };
    if (response.status >= 200 && response.status < 300) {
      const body = await readBoundedJson(response);
      const value = body === undefined ? null : project(body);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    }
    if (response.status === 409 && options?.readConflictVersion) {
      const body = await readBoundedJson(response);
      const conflict = conflictWireSchema.safeParse(body);
      // ⚠️ 409 在本域有三种来路：版本冲突、同 key 异 body、同 key 并发在途。
      //    只有第一种带 current_version；另两种由失败信封的 serverCode 区分
      //    （`idempotency_conflict` / `idempotency_retry`），所以这里读不到版本
      //    时**不能**当成不可信响应，要退回带 serverCode 的通用 conflict。
      if (conflict.success) {
        return { ok: false, code: 'conflict', currentVersion: conflict.data.current_version };
      }
      // ⛔ 「什么算业务码」的闭集只有一处（共享层正则），这里直接复用。
      const serverCode = readServerErrorCode(body);
      return {
        ok: false,
        code: 'conflict',
        ...(serverCode === undefined ? {} : { serverCode }),
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

/**
 * 完成 / 重开四条写路径的**同一份**请求体（契约四处都是这四个键）。
 *
 * ⭐ `client_request_id` 必带：服务端把它折进阶段记录行的主键——同号同内容回原结果，
 *    同号异内容 409 `idempotency_conflict`。⛔ 本层不替调用方换号。
 * ⛔ `reason` / `evidence_refs` 是用户亲笔正文：只进请求体，本模块不记录、不打印。
 */
function lifecycleBody(input: {
  readonly expectedVersion: number;
  readonly clientRequestId: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}): Record<string, unknown> {
  return {
    expected_version: input.expectedVersion,
    client_request_id: input.clientRequestId,
    reason: input.reason,
    evidence_refs: [...input.evidenceRefs],
  };
}

/**
 * 关联 / 移出出参的投影（两条写路径**同一份**，⛔ 不各写一遍）。
 *
 * 逐字段挑选 + 两道门（映射 + 共享协议 schema），任一不过即 transient。
 * ⚠️ `changed` 缺席不兜 false：那会把一次「真的排上了」说成「本来就排着」，
 *    而渲染层据此可能不刷新。
 */
function mapIterationRequirementWrite(body: unknown): IterationRequirementWrite | null {
  const record = recordOf(body);
  if (!record) return null;
  const link = mapIterationRequirementLink(record.link);
  const iteration = mapProjectIteration(record.iteration);
  const changed = record.changed;
  const requirementId = record.requirement_id;
  const previousIterationId = record.previous_iteration_id ?? null;
  if (link === null || iteration === null) return null;
  if (typeof changed !== 'boolean' || typeof requirementId !== 'string') return null;
  if (previousIterationId !== null && typeof previousIterationId !== 'string') return null;
  return { changed, link, iteration, requirementId, previousIterationId };
}

/**
 * 排期整批保存出参的投影：`changed` 缺席不兜 false（理由同关联出参），任一轮投影失败整体拒绝。
 */
function mapIterationScheduleWrite(body: unknown): IterationScheduleWrite | null {
  const record = recordOf(body);
  if (!record || typeof record.changed !== 'boolean') return null;
  const iterations = mapArray(record.iterations, mapProjectIteration);
  return iterations === null ? null : { changed: record.changed, iterations };
}

/** 版本冲突清单里的一条（逐字段挑选 + 共享协议 schema 两道门）。 */
function mapIterationScheduleConflict(raw: unknown): ProjectIterationScheduleConflict | null {
  const record = recordOf(raw);
  if (!record) return null;
  const parsed = ProjectIterationScheduleConflictSchema.safeParse({
    iterationId: record.iteration_id,
    currentVersion: record.current_version,
  });
  return parsed.success ? parsed.data : null;
}
