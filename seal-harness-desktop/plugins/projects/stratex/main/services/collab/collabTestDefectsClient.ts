import { z } from 'zod';
import {
  ProjectTestDefectActionResultSchema,
  ProjectTestDefectsResultSchema,
  ProjectTestDefectDetailResultSchema,
  type ProjectTestDefectActionRequest,
  type ProjectTestDefectsRequest,
  type ProjectTestDefectDetailRequest,
} from '../../../shared/protocol/project-testing-defects.js';
import type { CollabClientOutcome } from './collabClient.js';
import type { SendInit } from './collabTestingClient.js';
import { mapArray } from './collabWireMapping.js';
import {
  ProjectTestDefectSchema,
  ProjectTestDefectHistorySchema,
  type ProjectTestDefect,
  type ProjectTestDefectHistory,
} from '../../../shared/protocol/project-testing-defects.js';
import { recordOf } from './collabWireMapping.js';

/** 缺陷客户端唯一的线格式投影；未知字段不会进入渲染层。 */
export function mapTestDefect(raw: unknown): ProjectTestDefect | null {
  const r = recordOf(raw);
  if (!r) return null;
  const parsed = ProjectTestDefectSchema.safeParse({
    id: r.id,
    projectId: r.project_id,
    requirementId: r.requirement_id,
    roundId: r.round_id,
    caseId: r.case_id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    assigneeSubject: r.assignee_subject,
    state: r.state,
    createdBySubject: r.created_by_subject,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return parsed.success ? parsed.data : null;
}

/** 历史签署者和时刻来自服务器，禁止用当前用户补齐。 */
export function mapTestDefectHistory(raw: unknown): ProjectTestDefectHistory | null {
  const r = recordOf(raw);
  if (!r) return null;
  const parsed = ProjectTestDefectHistorySchema.safeParse({
    id: r.id,
    defectId: r.defect_id,
    action: r.action,
    fromAssigneeSubject: r.from_assignee_subject,
    toAssigneeSubject: r.to_assignee_subject,
    actorSubject: r.actor_subject,
    summary: r.summary,
    evidenceRefs: r.evidence_refs,
    createdAt: r.created_at,
  });
  return parsed.success ? parsed.data : null;
}

type RequestEntity = <T>(
  path: string,
  init: SendInit,
  project: (raw: unknown) => T | null,
) => Promise<CollabClientOutcome<T>>;
/** 缺陷域复用测试客户端的传输、超时和失败映射。 */
export class CollabTestDefectsClient {
  constructor(private readonly requestEntity: RequestEntity) {}
  /** 缺陷写命令只映射到固定端点。 */
  async actOnTestDefect(
    accessToken: string,
    input: ProjectTestDefectActionRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestDefectActionResultSchema>>> {
    const common = {
      expected_version: input.expectedVersion,
      client_request_id: input.clientRequestId,
    };
    const path =
      input.action === 'create'
        ? `submissions/${encodeURIComponent(input.submissionId)}/defects`
        : `defects/${encodeURIComponent(input.defectId)}/${input.action === 'fix' ? 'fixes' : input.action === 'retest' ? 'retests' : 'assign'}`;
    const body =
      input.action === 'create'
        ? {
            ...common,
            title: input.title,
            description: input.description,
            severity: input.severity,
            assignee_subject: input.assigneeSubject,
            case_id: input.caseId,
          }
        : input.action === 'assign'
          ? { ...common, assignee_subject: input.assigneeSubject, reason: input.reason }
          : {
              ...common,
              summary: input.summary,
              evidence_refs: [...input.evidenceRefs],
              ...(input.action === 'retest' ? { result: input.result } : {}),
            };
    return this.requestEntity(path, { method: 'POST', accessToken, jsonBody: body }, (raw) => {
      const defect = mapTestDefect(recordOf(raw)?.defect);
      if (
        !defect ||
        defect.projectId !== input.projectId ||
        (input.action === 'create'
          ? defect.roundId !== input.submissionId
          : defect.id !== input.defectId)
      )
        return null;
      const parsed = ProjectTestDefectActionResultSchema.safeParse({ ok: true, defect });
      return parsed.success ? parsed.data : null;
    });
  }

  /** 当前轮次的缺陷分页。 */
  async listTestDefects(
    accessToken: string,
    input: ProjectTestDefectsRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestDefectsResultSchema>>> {
    return this.requestEntity(
      `submissions/${encodeURIComponent(input.submissionId)}/defects`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (raw) => {
        const row = recordOf(raw);
        const items = mapArray(row?.items, mapTestDefect);
        if (
          !items ||
          items.some(
            (item) => item.projectId !== input.projectId || item.roundId !== input.submissionId,
          )
        )
          return null;
        const parsed = ProjectTestDefectsResultSchema.safeParse({
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

  /** 缺陷及其不可变修复、复测历史分页。 */
  async fetchTestDefect(
    accessToken: string,
    input: ProjectTestDefectDetailRequest,
  ): Promise<CollabClientOutcome<z.infer<typeof ProjectTestDefectDetailResultSchema>>> {
    return this.requestEntity(
      `defects/${encodeURIComponent(input.defectId)}`,
      {
        method: 'GET',
        accessToken,
        query: { cursor: input.cursor ?? undefined, limit: input.limit },
      },
      (raw) => {
        const row = recordOf(raw);
        const defect = mapTestDefect(row?.defect);
        const history = mapArray(row?.history, mapTestDefectHistory);
        if (
          !defect ||
          !history ||
          defect.projectId !== input.projectId ||
          defect.id !== input.defectId ||
          history.some((item) => item.defectId !== input.defectId)
        )
          return null;
        const parsed = ProjectTestDefectDetailResultSchema.safeParse({
          ok: true,
          defect,
          history,
          total: row?.total,
          hasMore: row?.has_more,
          nextCursor: row?.next_cursor,
        });
        return parsed.success ? parsed.data : null;
      },
    );
  }
}
