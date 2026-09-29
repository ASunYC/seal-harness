import {
  ProjectTestExecutionSchema,
  type ProjectTestExecution,
} from '../../../shared/protocol/project-testing-cases.js';
import { z } from 'zod';

import {
  PROJECT_TEST_ROUND_MAX_UNFINISHED_TASK_IDS,
  ProjectTestRoundDetailSchema,
  ProjectTestRoundSchema,
  ProjectTestRoundSnapshotSchema,
  type ProjectTestRound,
  type ProjectTestRoundDetail,
  type ProjectTestRoundSnapshot,
} from '../../../shared/protocol/project-testing.js';
import { mapArray, recordOf } from './collabWireMapping.js';

/**
 * 整需求提测域（TST-02）的线格式（snake_case）→ 客户端投影（camelCase）映射。
 *
 * 与规划域同一个理由另起一份文件：`collabWireMapping.ts` 已按协作面九个实体长满。⚠️ 但纪律不分家：
 * 本域的字段名映射**只有这一处**——轮次列表、单轮详情、提交回执与项目级测试模式判定
 * （`collabClient.fetchProjectTestMode`）都调这里的同一个函数，⛔ 不写第二份。
 *
 * 纪律与协作面逐字一致：**逐字段挑选**已知项（服务端后续新增字段进不了投影），映射后再过一遍共享
 * 协议 schema（strictObject + enum 封顶）——两道门任一不过即回 null，上层当不可信响应（transient）。
 * 数组不做部分采信：任何一项不可信即整体拒绝。
 *
 * ⚠️【埋点红线】整体完成说明、任务标题、判据正文都是用户亲笔：只经这里投影给界面，⛔ 不进日志与埋点。
 */

/** 轮次摘要那十个键（摘要与详情共用；详情另加 `summary`）。 */
function pickRoundFields(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    projectId: record.project_id,
    requirementId: record.requirement_id,
    roundNo: record.round_no,
    state: record.state,
    submittedBySubject: record.submitted_by_subject,
    reviewerSubject: record.reviewer_subject,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/**
 * 一轮测试的**摘要**（项目级测试模式判定里的 `test_rounds` 条目）。
 * ⚠️ 服务端这里不给整体完成说明；即便多给了也挑不进来（摘要形态 strict，没有这个键）。
 */
export function mapTestRound(raw: unknown): ProjectTestRound | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectTestRoundSchema.safeParse(pickRoundFields(record));
  return view.success ? view.data : null;
}

/**
 * 一轮测试的**完整**出参（提交回执 / 轮次列表 / 单轮详情）：摘要 + 整体完成说明。
 * ⚠️ 说明**不兜空串**：详情形态服务端恒回这个键，缺席即投影漏列，整条判不可信才是对的。
 */
export function mapTestRoundDetail(raw: unknown): ProjectTestRoundDetail | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectTestRoundDetailSchema.safeParse({
    ...pickRoundFields(record),
    summary: record.summary,
  });
  return view.success ? view.data : null;
}

function mapSnapshotRequirement(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    priority: record.priority,
    status: record.status,
    constraintsText: record.constraints_text,
    labels: record.labels,
    itemKind: record.item_kind,
  };
}

function mapSnapshotTask(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    id: record.id,
    parentId: record.parent_id,
    title: record.title,
    status: record.status,
    itemKind: record.item_kind,
  };
}

function mapSnapshotCriterion(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return { ordinal: record.ordinal, text: record.text, checked: record.checked };
}

function mapSnapshotAttachment(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  return {
    fileVersionId: record.file_version_id,
    assetId: record.asset_id,
    versionNo: record.version_no,
    filename: record.filename,
    contentSha256: record.content_sha256,
    byteSize: record.byte_size,
  };
}

function mapSnapshotGate(raw: unknown): unknown {
  const record = recordOf(raw);
  if (!record) return null;
  const gate = recordOf(record.submission_gate);
  return {
    gateVersion: record.gate_version,
    // 门槛只挑闭集里的四个布尔（服务端写入口 `normalize_submission_gate` 同一个闭集）：闭集外的键
    // 挑不进投影；四个里任一缺席或不是真布尔 ⇒ strict 那一道判不可信。
    submissionGate:
      gate === null
        ? null
        : {
            requireTasks: gate.require_tasks,
            requireAllTasksDone: gate.require_all_tasks_done,
            requireCriteria: gate.require_criteria,
            requireReadyArtifacts: gate.require_ready_artifacts,
          },
    requiredItemCount: record.required_item_count,
    requiredItemOrdinals: record.required_item_ordinals,
  };
}

/**
 * 五面快照（建轮次那一刻物化的值）。任一面缺席或不合形状 ⇒ 整份不可信。
 * ⚠️ 服务端在快照行缺失时回 `{}`：那一轮没有可核对的快照，⛔ 不兜成空快照（空快照会被读成
 *    「提交时一项任务、一条标准都没有」——把一次数据缺失说成一个事实）。
 */
export function mapTestRoundSnapshot(raw: unknown): ProjectTestRoundSnapshot | null {
  const record = recordOf(raw);
  if (!record) return null;
  const tasks = mapArray(record.tasks, mapSnapshotTask);
  const criteria = mapArray(record.criteria, mapSnapshotCriterion);
  const attachments = mapArray(record.attachments, mapSnapshotAttachment);
  if (tasks === null || criteria === null || attachments === null) return null;
  const view = ProjectTestRoundSnapshotSchema.safeParse({
    requirement: mapSnapshotRequirement(record.requirement),
    tasks,
    criteria,
    attachments,
    gate: mapSnapshotGate(record.gate),
  });
  return view.success ? view.data : null;
}

/** 提交被拒时服务端平铺在错误体里的附加字段（`CollabRejection.extra`）。 */
export interface RequirementSubmitFailureExtras {
  readonly unfinishedTaskIds?: readonly string[];
  readonly unfinishedTaskCount?: number;
  readonly legacyOpenReviewCount?: number;
}

const unfinishedTaskIdsWireSchema = z
  .array(z.string().uuid())
  .max(PROJECT_TEST_ROUND_MAX_UNFINISHED_TASK_IDS);
const countWireSchema = z.number().int().safe().nonnegative();

/**
 * 从失败体里挑出附加字段：`unfinished_task_ids` / `unfinished_task_count`（422 未完成任务）与
 * `legacy_open_review_count`（409 旧评审未结）。
 *
 * ⚠️ 逐键独立判：哪一个形状不对就**丢掉那一个键**（⛔ 不编数、不部分截断），业务码与其余键照带——
 *    附加字段是锦上添花，拿不到时界面退回不带数的那一句，而不是把整次失败判成不可信。
 * ⛔ 只挑这三个键：`detail` 文案、请求回显一概不碰。
 */
export function mapRequirementSubmitFailureExtras(body: unknown): RequirementSubmitFailureExtras {
  const record = recordOf(body);
  if (!record) return {};
  const ids = unfinishedTaskIdsWireSchema.safeParse(record.unfinished_task_ids);
  const count = countWireSchema.safeParse(record.unfinished_task_count);
  const legacy = countWireSchema.safeParse(record.legacy_open_review_count);
  return {
    ...(ids.success ? { unfinishedTaskIds: ids.data } : {}),
    ...(count.success ? { unfinishedTaskCount: count.data } : {}),
    ...(legacy.success ? { legacyOpenReviewCount: legacy.data } : {}),
  };
}

/** 不可变执行的唯一字段投影。 */
export function mapTestExecution(raw: unknown): ProjectTestExecution | null {
  const row = recordOf(raw);
  if (!row) return null;
  const snapshot = recordOf(row.case_snapshot);
  const parsed = ProjectTestExecutionSchema.safeParse({
    id: row.id,
    caseId: row.case_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    roundId: row.round_id,
    result: row.result,
    actualResult: row.actual_result,
    evidenceRefs: row.evidence_refs,
    testedBySubject: row.tested_by_subject,
    testedAt: row.tested_at,
    caseSnapshot: snapshot && {
      title: snapshot.title,
      preconditions: snapshot.preconditions,
      steps: snapshot.steps,
      expected: snapshot.expected,
    },
  });
  return parsed.success ? parsed.data : null;
}
