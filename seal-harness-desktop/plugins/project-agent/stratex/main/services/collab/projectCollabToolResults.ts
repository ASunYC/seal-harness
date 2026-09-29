import { relative, resolve, sep } from 'node:path';

import type { z } from 'zod';

import type { Todo } from '../../../../../projects/stratex/shared/protocol/project-collab.js';
import type { CollabClientFailure } from '../../../../../projects/stratex/main/services/collab/collabClient.js';
import {
  PROJECT_COLLAB_TOOL_MAX_OUTPUT_BYTES,
  type ProjectCollabToolBinding,
  type ProjectCollabToolResponse,
} from './projectCollabToolContract.js';

/**
 * 项目协作工具的**结果与失败文案构造**（纯函数，无 I/O、无状态）。
 *
 * 从执行器分出来是为了两件事：① 单文件行数回到工程规范的量级；② 这些判定各自可以
 * 被单独执行——「失败说不说得出原因」正是本次被实测打脸的那一维，它不该只能靠跑一遍
 * 整个执行器来验。
 *
 * ⚠️【白标】面向模型的文案一律中性词，不出现任何第三方产品名与内核内部名词。
 */

/** 参数诊断的条数与单条长度上限：说清哪儿不对即可，不把整份 zod 报告倒进上下文。 */
const PROJECT_TOOL_MAX_REPORTED_ISSUES = 5;
const PROJECT_TOOL_MAX_ISSUE_LENGTH = 160;
/** 工具结果体的输出封顶（与内核约定一致）。 */

/** 服务端字段快照太长不进结果体；写路径只回写入结果的紧凑投影。 */
export function writtenTodoSummary(todo: Todo): Readonly<Record<string, unknown>> {
  return {
    id: todo.id,
    parentId: todo.parentId,
    visibility: todo.visibility,
    title: todo.title,
    status: todo.status,
    assigneeKind: todo.assigneeKind,
    priority: todo.priority,
    version: todo.version,
    updatedAt: todo.updatedAt,
  };
}

/**
 * 「这一次更新是不是**开工**」——是就把本会话记为执行会话，否则不动关联。
 *
 * 判据两条缺一不可：本次把状态推到「进行中」（＝设计方案 §4.2 的开工那一刻），
 * 且装配层给得出会话编号。⛔ 不在别的时机绑：助手顺手改一次标题不该把某个会话
 * 认领成这张单的执行现场。绑上之后关掉窗口也不中断，卡片上永远点得回来。
 */
export function openingSessionRef(
  binding: ProjectCollabToolBinding,
  status: string | undefined,
): string | null {
  if (status !== 'inProgress') return null;
  const sessionId = binding.sessionId?.trim();
  return sessionId ? sessionId : null;
}

/** 乐观锁冲突的统一回话：如实带回当前版本，让模型重取后带新版本重试。 */
export function versionConflictFailure(
  currentVersion: number | undefined,
): ProjectCollabToolResponse {
  return failure(
    [
      'The to-do was changed by someone else, so this request was not applied.',
      ...(currentVersion !== undefined ? [`Current version: ${currentVersion}.`] : []),
      'List the to-dos again and retry with the current version.',
    ].join('\n'),
  );
}

/**
 * 工作区相对路径 → 绝对路径；不在工作区内一律 null。
 *
 * 三道判据缺一不可：① 形状（非空、不以 `/` 开头、不带盘符、无 NUL、无 `.`/`..` 段）；
 * ② `resolve` 后仍落在根内（`relative` 不以 `..` 开头且非绝对）；③ 回算一致。
 * 形制照 `assistantProjectWorkspace.safeChildPath`，差别只有失败形态（这里回 null，
 * 因为调用方要把「哪儿不合法」讲给模型听，而不是抛一个通用错误）。
 *
 * ⛔ 不做 realpath：符号链接的解析要额外一次 I/O，且这条路径随后立刻被上传层
 * `stat` + 读；此处判定的是**模型给的字符串没有越界**，够不够防符号链接由工作区
 * 授权面统一管，别在这里造第二套口径。
 */
export function resolveWorkspaceFile(root: string, candidate: string): string | null {
  const normalized = candidate.replace(/\\/gu, '/');
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.includes('\0')) {
    return null;
  }
  if (/^[a-z]:/iu.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(resolvedRoot, ...segments);
  const relation = relative(resolvedRoot, resolvedChild);
  if (!relation || relation.startsWith(`..${sep}`) || relation === '..') return null;
  return resolve(resolvedRoot, relation) === resolvedChild ? resolvedChild : null;
}

/**
 * 参数不合法 → **说得出哪儿不合法**的回话。
 *
 * ⚠️ 这个函数存在的全部理由：此前十一处入参失败共用一句 `Invalid project tool
 * request.`，模型读不出是哪个参数、期望什么，于是**自己编了个原因**讲给用户
 * （实测：把参数被拒讲成「必须提供有效的负责人标识」）。一句说不出所以然的报错，
 * 把诊断责任推给了唯一一个只能靠猜的读者。
 *
 * ⛔ 只出**路径与期望**，不回显模型传来的值：值可能是用户正文，而工具结果会进
 * 上下文也可能进诊断；zod 的 issue message 本身只描述类型/枚举/未知键，不含实参。
 */
export function invalidRequestFailure(error: z.ZodError): ProjectCollabToolResponse {
  const issues = error.issues.slice(0, PROJECT_TOOL_MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    const detail = issue.message.slice(0, PROJECT_TOOL_MAX_ISSUE_LENGTH);
    return path ? `- ${path}: ${detail}` : `- ${detail}`;
  });
  if (issues.length === 0) return failure('Invalid project tool request.');
  return failure(
    ['Invalid project tool request. Fix these arguments and call the tool again:', ...issues].join(
      '\n',
    ),
  );
}

/**
 * project_list_todos 的分页契约文案（description 与拒绝文案同一句真相，改一处即同步）。
 * 现场（2026-09-04 gpt-5.6-sol）：cursor 传 ""/"0"/"start" 全被拒，模型看不出「第一页请省略」，
 * 只能换个猜法再试直到循环护栏停轮。
 * 2026-09-14：指引改成「传 null」——总是填满全部属性的模型根本做不到「省略」。
 */
export const LIST_TODOS_CURSOR_GUIDANCE =
  'Set cursor to null to read the first page; pass only a nextCursor returned by a previous ' +
  'project_list_todos result. An empty string, "0", or "start" is not a valid cursor.';
export const LIST_TODOS_LIMIT_GUIDANCE =
  'limit must be an integer from 1 to 50 (default 30); set it to null to use the default.';
const LIST_TODOS_FIRST_PAGE_NEXT_ACTION =
  'Retry project_list_todos with cursor set to null to read the first page.';

/**
 * project_list_todos 的入参失败 → **说清是 cursor 还是 limit、下一步怎么走**（照
 * {@link describeProjectReadFileFailure} 的既有先例：说清哪个参数、为什么、下一步做什么）。
 *
 * 通用 {@link invalidRequestFailure} 只把 zod 原文（「Too small…」/越界）倒回去，模型读不出
 * 「第一页请省略 cursor」「limit 上限 50」。这里对 cursor/limit 给可执行指引，其余字段（如未知键）
 * 仍如实列出、不吞掉；两者都不涉时回落通用文案。
 */
export function describeListTodosArgumentFailure(error: z.ZodError): ProjectCollabToolResponse {
  const hasCursorIssue = error.issues.some((issue) => issue.path[0] === 'cursor');
  const hasLimitIssue = error.issues.some((issue) => issue.path[0] === 'limit');
  if (!hasCursorIssue && !hasLimitIssue) return invalidRequestFailure(error);
  const details: string[] = [];
  if (hasCursorIssue) details.push(`- cursor: ${LIST_TODOS_CURSOR_GUIDANCE}`);
  if (hasLimitIssue) details.push(`- limit: ${LIST_TODOS_LIMIT_GUIDANCE}`);
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === 'cursor' || key === 'limit') continue;
    const path = issue.path.map((segment) => String(segment)).join('.');
    const detail = issue.message.slice(0, PROJECT_TOOL_MAX_ISSUE_LENGTH);
    details.push(path ? `- ${path}: ${detail}` : `- ${detail}`);
  }
  return failure(
    [
      'Invalid project tool request. Fix these arguments and call project_list_todos again:',
      ...details,
    ].join('\n'),
    {
      nextAction: hasCursorIssue
        ? LIST_TODOS_FIRST_PAGE_NEXT_ACTION
        : 'Retry project_list_todos with a limit from 1 to 50, or null for the default.',
    },
  );
}

/**
 * 服务端拒了一次带 cursor 的 list_todos → 补「第一页请省略」指引，而不是只回一句
 * 「The project service rejected this request.」。现场 row 2：`"0"`/`"start"` 过了 zod（非空）
 * 却被服务端拒，模型拿到通用拒绝只能再猜。只在**带了 cursor 且是非瞬态拒绝**时改写——
 * 没带 cursor 或瞬态故障不是模型能改的输入，保持既有分档文案。
 */
export function listTodosRejectionFailure(
  outcome: CollabClientFailure,
  cursorSupplied: boolean,
): ProjectCollabToolResponse {
  if (cursorSupplied && (outcome.code === 'rejected' || outcome.code === 'invalidRequest')) {
    return failure(
      `The project service did not accept this to-do page request. ${LIST_TODOS_CURSOR_GUIDANCE}`,
      {
        code: 'PROJECT_REQUEST_REJECTED',
        retryable: false,
        nextAction: LIST_TODOS_FIRST_PAGE_NEXT_ACTION,
      },
    );
  }
  return collabFailure(outcome);
}

/**
 * 授权未通过 → 分档回话。**`declinedByMode` 必须单独说**：那一档下卡片从未出现过
 * （本轮是计划档，只出方案不落改动），把它和「用户点了拒绝」讲成同一句，模型就只能
 * 猜为什么，而它猜出来的东西会被用户当成真原因去排查。
 */
export function refusedFailure(
  decision: 'decline' | 'cancel' | 'timeout' | 'acceptForSession' | 'declinedByMode',
  subject: string,
): ProjectCollabToolResponse {
  if (decision === 'declinedByMode') {
    return failure(
      `${subject} was refused because this turn only produces a plan and applies nothing. ` +
        'Nothing was written. Describe the change in your plan instead; the user has an entry ' +
        'to start the work, and it will run then.',
    );
  }
  return failure(`${subject} was not authorized.`);
}

/** outcome 分档 → 面向模型的封闭文案（不回显服务端原文，与共享协议的分档一致）。 */
export function collabFailure(outcome: CollabClientFailure): ProjectCollabToolResponse {
  const retryable = outcome.code === 'rateLimited' || outcome.code === 'transient';
  const code = retryable
    ? 'PROJECT_SERVICE_TEMPORARILY_UNAVAILABLE'
    : outcome.code === 'credentialRejected'
      ? 'PROJECT_AUTH_REQUIRED'
      : outcome.code === 'conflict'
        ? 'PROJECT_STATE_CONFLICT'
        : outcome.code === 'tooLarge'
          ? 'PROJECT_RESULT_TOO_LARGE'
          : 'PROJECT_REQUEST_REJECTED';
  return failure(collabFailureMessage(outcome.code), { code, retryable });
}

/** 服务端「起止成对」闸的业务码：写入之后有开始却没有截止（建单、认领、改到日期的改单）。 */
export const START_REQUIRES_DUE_SERVER_CODE = 'start_requires_due';

/**
 * 待办写入撞上「有开始没截止」→ 说清两条在参数里写得出来的出路：补 dueAt，或把 startAt 也设为 null。
 *
 * ⛔ 不落到通用「服务端拒绝」：模型读不出是日期的事，就会去改别的字段乱试，或者自己编一个截止日期。
 * 按业务码判（400 与业务目标面的 422 同名），与通用分档 `code` 无关。
 */
export function startRequiresDueFailure(
  tool: 'project_create_todo' | 'project_update_todo',
): ProjectCollabToolResponse {
  return failure(
    'The project service rejected this because a start date requires a due date: the item ' +
      'would have startAt without dueAt. Set dueAt to the due date the user gave, or set ' +
      'startAt to null as well. Never invent a due date; if the user gave only a start date, ' +
      'ask for the due date.',
    { nextAction: `Retry ${tool} with dueAt set, or with startAt set to null.` },
  );
}

/** 挂靠父级解析不出来时的失败码闭集（据此补一句「改建顶层需求」的下一步）。 */
export function isParentResolutionFailure(code: CollabClientFailure['code']): boolean {
  return code === 'rejected' || code === 'invalidRequest' || code === 'forbidden';
}

export function collabFailureMessage(code: CollabClientFailure['code']): string {
  const messages: Record<CollabClientFailure['code'], string> = {
    tooLarge: "The file exceeds the 1 GiB project limit or this bounded read operation's limit.",
    rateLimited: 'The project service is rate limiting requests; try again later.',
    conflict: 'The request conflicts with the current project state.',
    quotaExceeded: 'The project file capacity is full; delete files that are no longer needed.',
    credentialRejected: 'Project credentials are unavailable; ask the user to sign in again.',
    forbidden: 'This account does not have permission for that project operation.',
    rejected: 'The project service rejected this request.',
    transient: 'The project service is temporarily unavailable; try again later.',
    invalidRequest: 'Invalid project tool request.',
    writeFailed: 'The project file could not be saved locally.',
  };
  return messages[code];
}

export function success(payload: Readonly<Record<string, unknown>>): ProjectCollabToolResponse {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') > PROJECT_COLLAB_TOOL_MAX_OUTPUT_BYTES) {
    return failure('Project tool result exceeded the safe output limit.', {
      tool: typeof payload['tool'] === 'string' ? payload['tool'] : null,
      code: 'PROJECT_RESULT_TOO_LARGE',
      retryable: false,
      nextAction: 'Request a smaller page from the same cursor.',
    });
  }
  return { contentItems: [{ type: 'inputText', text }], success: true };
}

interface ProjectToolFailureOptions {
  readonly tool?: string | null;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly nextAction?: string;
  readonly nextCursor?: string;
}

export function failure(
  message: string,
  options: ProjectToolFailureOptions = {},
): ProjectCollabToolResponse {
  const text = JSON.stringify({
    tool: options.tool ?? null,
    success: false,
    error: {
      code: options.code ?? 'PROJECT_REQUEST_REJECTED',
      retryable: options.retryable ?? false,
    },
    message,
    nextAction: options.nextAction ?? 'Do not repeat the same request; adjust it before retrying.',
    ...(options.nextCursor !== undefined ? { nextCursor: options.nextCursor } : {}),
  });
  return { contentItems: [{ type: 'inputText', text }], success: false };
}

export function attachFailureTool(
  tool: string,
  response: ProjectCollabToolResponse,
): ProjectCollabToolResponse {
  if (response.success) return response;
  try {
    const payload = JSON.parse(response.contentItems[0].text) as Record<string, unknown>;
    return {
      contentItems: [{ type: 'inputText', text: JSON.stringify({ ...payload, tool }) }],
      success: false,
    };
  } catch {
    return failure('Project tool request failed.', { tool });
  }
}
