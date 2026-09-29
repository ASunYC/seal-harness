import { recordOf } from './collabWireMapping.js';

/** 逐字段投影后交共享 schema 校验；不把服务器附加内容或内部元数据带过 IPC。 */
export function mapCollaboratorsWire(body: unknown): unknown {
  const row = recordOf(body);
  return {
    todoId: row?.todo_id,
    version: row?.version,
    collaborators: Array.isArray(row?.collaborators)
      ? row.collaborators.map((item: unknown) => {
          const member = recordOf(item);
          return {
            subject: member?.subject,
            displayName: member?.display_name,
            state: member?.state,
          };
        })
      : null,
  };
}

export function mapCollaboratorsReplaceWire(body: unknown): unknown {
  return { ...recordOf(mapCollaboratorsWire(body)), replayed: recordOf(body)?.replayed };
}

export function mapTodoCommentWire(body: unknown): unknown {
  const row = recordOf(body);
  return {
    id: row?.id,
    todoId: row?.todo_id,
    authorSubject: row?.author_subject,
    authorDisplayName: row?.author_display_name,
    bodyMd: row?.body_md,
    refs: row?.refs,
    createdAt: row?.created_at,
  };
}

export function mapTodoCommentsWire(body: unknown): unknown {
  const row = recordOf(body);
  return {
    comments: Array.isArray(row?.comments) ? row.comments.map(mapTodoCommentWire) : null,
    nextCursor: row?.next_cursor,
  };
}

export function mapTodoCommentCreateWire(body: unknown): unknown {
  const row = recordOf(body);
  return { comment: mapTodoCommentWire(row?.comment), replayed: row?.replayed };
}

export function mapTodoDeletePreviewWire(body: unknown): unknown {
  const row = recordOf(body);
  return {
    rootIds: row?.root_ids,
    requirementCount: row?.requirement_count,
    taskCount: row?.task_count,
    testRoundCount: row?.test_round_count,
    testCaseCount: row?.test_case_count,
    activeRoundCount: row?.active_round_count,
    canDelete: row?.can_delete,
  };
}
