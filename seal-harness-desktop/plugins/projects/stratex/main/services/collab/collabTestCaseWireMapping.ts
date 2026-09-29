import { z } from 'zod';

import {
  ProjectTestCaseCopySourceSchema,
  ProjectTestCaseSchema,
  type ProjectTestCase,
  type ProjectTestCaseCopySource,
  type ProjectTestCaseField,
} from '../../../shared/protocol/project-testing-cases.js';
import { recordOf } from './collabWireMapping.js';

/**
 * 测试轮次的用例（TST-04）的线格式（snake_case）→ 客户端投影（camelCase）映射。
 *
 * 与 `collabTestingWireMapping.ts` 分文件，理由同那一份：本域的字段名映射**只有这一处**，⛔ 不写第二份。
 * 纪律与协作面逐字一致：**逐字段挑选**已知项（服务端后续新增字段进不了投影），映射后再过一遍共享协议 schema
 * （strictObject + enum 封顶）——两道门任一不过即回 null，上层当不可信响应（transient）。
 *
 * ⚠️【埋点红线】用例名称 / 前置 / 步骤 / 预期都是用户亲笔：只经这里投影给界面，⛔ 不进日志与埋点。
 */

/** 一条用例（服务端 `serialize_test_case`）。 */
export function mapTestCase(raw: unknown): ProjectTestCase | null {
  const record = recordOf(raw);
  if (!record) return null;
  const view = ProjectTestCaseSchema.safeParse({
    id: record.id,
    projectId: record.project_id,
    requirementId: record.requirement_id,
    submissionId: record.submission_id,
    ordinal: record.ordinal,
    title: record.title,
    preconditions: record.preconditions,
    steps: record.steps,
    expected: record.expected,
    result: record.result,
    ...(record.actual_result === undefined ? {} : { actualResult: record.actual_result }),
    ...(record.tested_by_subject === undefined
      ? {}
      : { testedBySubject: record.tested_by_subject }),
    ...(record.tested_at === undefined ? {} : { testedAt: record.tested_at }),
    ...(record.evidence_refs === undefined ? {} : { evidenceRefs: record.evidence_refs }),
    copiedFromCaseId: record.copied_from_case_id,
    createdBySubject: record.created_by_subject,
    updatedBySubject: record.updated_by_subject,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
  return view.success ? view.data : null;
}

/**
 * 可复用的来源轮次：服务端显式给 `null` ＝ 没有来源；⚠️ 键缺席或形状不对 ⇒ `undefined`（调用方判整页不可信，
 * ⛔ 不把一次数据缺失说成「没有可复用的上轮」）。
 */
export function mapCopySource(raw: unknown): ProjectTestCaseCopySource | null | undefined {
  if (raw === null) return null;
  const record = recordOf(raw);
  if (!record) return undefined;
  const view = ProjectTestCaseCopySourceSchema.safeParse({
    submissionId: record.submission_id,
    roundNo: record.round_no,
    caseCount: record.case_count,
  });
  return view.success ? view.data : undefined;
}

/** 写失败时服务端平铺在错误体里的附加字段（`CollabRejection.extra`）。 */
export interface TestCaseWriteFailureExtras {
  readonly field?: ProjectTestCaseField;
  readonly missingFields?: readonly ProjectTestCaseField[];
}

const fieldWireSchema = z.enum(['title', 'preconditions', 'steps', 'expected']);
const missingFieldsWireSchema = z.array(fieldWireSchema).min(1).max(4);

/**
 * 从失败体里挑出 `field`（400 超长 / 形状不对点名的字段）与 `missing_fields`（400 缺必填）。
 * ⚠️ 逐键独立判：哪一个形状不对就**丢掉那一个键**（⛔ 不编），业务码照带。⛔ 只挑这两个键。
 */
export function mapTestCaseFailureExtras(body: unknown): TestCaseWriteFailureExtras {
  const record = recordOf(body);
  if (!record) return {};
  const field = fieldWireSchema.safeParse(record.field);
  const missing = missingFieldsWireSchema.safeParse(record.missing_fields);
  return {
    ...(field.success ? { field: field.data } : {}),
    ...(missing.success ? { missingFields: missing.data } : {}),
  };
}
