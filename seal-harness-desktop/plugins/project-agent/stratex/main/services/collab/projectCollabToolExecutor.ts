import { basename } from 'node:path';
import { rm, stat } from 'node:fs/promises';

import { z } from 'zod';

import {
  ProjectFeedPostRequestSchema,
  ProjectFileListRequestSchema,
  ProjectTodoCreateFieldsSchema,
  ProjectTodoDraftCreateRequestSchema,
  ProjectTodoSubmitReviewRequestSchema,
  ProjectTodoUpdateRequestSchema,
  assigneeDispatchIsConsistent,
  isTodoWorkOrder,
  ASSIGNEE_DISPATCH_CONFLICT_MESSAGE,
} from '../../../../../projects/stratex/shared/protocol/project-collab.js';
import {
  CREATE_TODO_ABSENT_FIELDS,
  DRAFT_ITEM_ABSENT_FIELDS,
  LIST_FILES_ABSENT_FIELDS,
  LIST_MESSAGES_ABSENT_FIELDS,
  LIST_TODOS_ABSENT_FIELDS,
  READ_FILE_ABSENT_FIELDS,
  SAVE_ASSET_ABSENT_FIELDS,
  SUBMIT_WORK_ORDER_ABSENT_FIELDS,
  withoutAbsentFields,
  withoutAbsentItemFields,
} from './projectCollabToolArguments.js';
import {
  PROJECT_COLLAB_TOOL_NAMESPACE,
  parseProjectCollabToolBinding,
} from './projectCollabToolContract.js';
import type {
  ProjectCollabApprovalGate,
  ProjectCollabPlanningToolPort,
  ProjectCollabToolBinding,
  ProjectCollabToolClientPort,
  ProjectCollabToolResponse,
  ProjectPlanningDraftStagingPort,
} from './projectCollabToolContract.js';
import {
  draftIterationTool,
  draftMilestoneTool,
  listIterationsTool,
  listMilestonesTool,
  type ProjectPlanningToolContext,
} from './projectCollabPlanningTools.js';
import {
  attachFailureTool,
  collabFailure,
  collabFailureMessage,
  describeListTodosArgumentFailure,
  failure,
  invalidRequestFailure,
  isParentResolutionFailure,
  listTodosRejectionFailure,
  openingSessionRef,
  refusedFailure,
  resolveWorkspaceFile,
  START_REQUIRES_DUE_SERVER_CODE,
  startRequiresDueFailure,
  success,
  versionConflictFailure,
  writtenTodoSummary,
} from './projectCollabToolResults.js';
import {
  PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH,
  todoDescriptionPreview,
  todoUpdateChangeSet,
} from './projectTodoUpdateChangeSet.js';
import type { TodoUpdateFields } from './projectTodoUpdateChangeSet.js';
import {
  PROJECT_DOCUMENT_PARSE_BUDGETS,
  documentFormatForFileName,
  normalizeDocumentSelector,
  parseLocalDocumentFile,
} from '@seal-harness/projects/documents';
import type { LocalDocumentFormat } from '@seal-harness/projects/documents';

/**
 * 项目组协作动态工具（`stratex_project`）的 Main 封闭执行器。
 *
 * 纪律照 `workspace-git-read-tool-executor.ts` 全套：
 *  - 读五件（list_todos / read_work_order / list_members / list_files / read_file）
 *    无审批直执行；
 *  - 写六件（create_todo / update_todo / draft_tasks / submit_work_order / post_update
 *    / save_asset）逐次经工具门审批，kind 闭集
 *    `'projectTodoWrite' | 'projectFeedPost' | 'projectAssetSave'`
 *    （待办面四件共用第一个——它们都是「写项目组待办」这同一件事）；
 *  - 规划四件（list_milestones / list_iterations 读；draft_milestone / draft_iteration 只暂存草案、
 *    不写服务端）见 `projectCollabPlanningTools.ts`（mil-11，ADR-0045）；
 *  - 审批明细只有 `{label: 固定文案, value: 数据}`，永不拼句（D3.24）；
 *  - 无 gate / 无绑定 / 无令牌一律拒（fail-closed），不冒充结果也不悬挂；
 *  - 输出给会话内核的结果体是紧凑 JSON 字符串（64 KiB 封顶，超限退化为截断标记）。
 *
 * 【可诊断性】失败一律**说得出为什么**：入参不合法回哪个参数与期望
 * （{@link invalidRequestFailure}），授权未过区分「人拒了」与「本轮只出方案」
 * （{@link refusedFailure}）。⛔ 别退回一句通用的「无效请求 / 未授权」——实测过一次
 * 代价：模型读不出原因就会**自己编一个**，用户照着那个假原因排查。
 *
 * 【账号/越权】工具参数里**没有项目 id**：绑定哪个项目由装配层解析后作为 binding
 * 传入，模型不能自选项目。【凭据】令牌逐调用经 `accessTokenProvider` 取新值，
 * 本模块不缓存、不记录。【白标】标识符与文案一律中性词。
 */

/*
 * 契约（绑定 / 工具门 / 结果体 / 网络端口）与结果构造分居两个同级模块；
 * 这里**原样再导出**，既有引用点不必改，层次仍是单向：契约 ← 结果构造 ← 本文件。
 */
export {
  PROJECT_COLLAB_TOOL_NAMESPACE,
  PROJECT_COLLAB_TOOL_MAX_OUTPUT_BYTES,
} from './projectCollabToolContract.js';
export type {
  ProjectCollabToolBinding,
  ProjectCollabApprovalGate,
  ProjectCollabToolResponse,
  ProjectCollabToolClientPort,
  ProjectCollabPlanningToolPort,
  ProjectPlanningDraftStagingPort,
} from './projectCollabToolContract.js';

/** 成员与文件列表的单次投影上限；TODO 另由服务端游标页封顶 50。 */
const PROJECT_TOOL_MAX_LIST_ENTRIES = 200;
/** read_file 的正文预算：低于 64 KiB 输出封顶，给 JSON 转义留余量。 */
const PROJECT_READ_FILE_MAX_DOWNLOAD_BYTES = PROJECT_DOCUMENT_PARSE_BUDGETS.maxInputBytes;
/** 保守字符预算：即使全是 4-byte Unicode，连同 JSON 信封也保持在 64 KiB 工具上限内。 */
const PROJECT_READ_FILE_MAX_OUTPUT_CHARS = 12 * 1024;
const PROJECT_MESSAGE_DEFAULT_LIMIT = 50;
const PROJECT_MESSAGE_MAX_LIMIT = 50;
const PROJECT_MESSAGE_MAX_BODY_BYTES = 8 * 1024;
const PROJECT_MESSAGE_TOTAL_BODY_BYTES = 32 * 1024;
const PROJECT_MESSAGE_MAX_AUTHOR_LENGTH = 80;

/** `continue` 在运行时契约上必须携带可推进游标，正文截断与分页状态彼此独立。 */
const discussionPaginationSchema = z.discriminatedUnion('nextAction', [
  z.strictObject({
    truncated: z.boolean(),
    contentTruncated: z.boolean(),
    complete: z.literal(false),
    nextAction: z.literal('continue'),
    nextBeforeSeq: z.number().int().safe().positive(),
  }),
  z.strictObject({
    truncated: z.boolean(),
    contentTruncated: z.boolean(),
    complete: z.literal(true),
    nextAction: z.literal('answer'),
  }),
]);

type DiscussionAuthorResolution =
  | {
      readonly kind: 'matched';
      readonly subject: string;
      readonly displayName: string;
      readonly assumed: boolean;
    }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'missing' };

export function resolveDiscussionAuthor(
  requestedName: string,
  members: readonly {
    readonly subject: string;
    readonly displayName: string;
    readonly state: string;
  }[],
): DiscussionAuthorResolution {
  const requested = requestedName.trim();
  const active = members.filter((member) => member.state === 'active');
  const exact = active.filter((member) => member.displayName.trim() === requested);
  if (exact.length > 1) return { kind: 'ambiguous' };
  if (exact[0]) {
    return {
      kind: 'matched',
      subject: exact[0].subject,
      displayName: exact[0].displayName,
      assumed: false,
    };
  }
  const nicknameCore = /^[老小阿]/u.test(requested) ? requested.slice(1) : requested;
  const nickname = active.filter(
    (member) => nicknameCore.length > 0 && member.displayName.trim().startsWith(nicknameCore),
  );
  if (nickname.length > 1) return { kind: 'ambiguous' };
  if (nickname[0]) {
    return {
      kind: 'matched',
      subject: nickname[0].subject,
      displayName: nickname[0].displayName,
      assumed: true,
    };
  }
  return { kind: 'missing' };
}

const projectToolNameSchema = z.enum([
  'project_list_messages',
  'project_list_todos',
  'project_read_work_order',
  'project_list_members',
  'project_create_todo',
  'project_update_todo',
  'project_draft_requirements',
  'project_draft_tasks',
  'project_submit_work_order',
  'project_post_update',
  'project_list_files',
  'project_read_file',
  'project_save_asset',
  'project_list_milestones',
  'project_list_iterations',
  'project_draft_milestone',
  'project_draft_iteration',
]);

const projectToolCallSchema = z.strictObject({
  namespace: z.literal(PROJECT_COLLAB_TOOL_NAMESPACE),
  tool: projectToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

/*
 * 参数权威校验直接复用共享协议 schema（strictObject + 上界一致），
 * 只裁掉模型不该自己填的两项：
 *  - `projectId`：由绑定提供，模型不能自选项目（可表达即可越权）；
 *  - `source`：本执行器**恒填 `assistant`**。留给模型填等于让它自称是人建的——
 *    服务端本来就分辨不出（同账号同 API），至少这条通道上不给它这个选项。
 */
const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;
/**
 * 空白 cursor = 未设置 = 第一页。
 *
 * 现场（反馈 627023a8 / 2e1024ff，2026-09-07 同日三次）：模型给 cursor 填 `""`，我方判非法并回
 * `retryable:false`；模型原样重发，循环守卫在第 2 次相同失败上杀整轮，用户被迫重发又被停，三次。
 * 2026-09-04 那次现场的处置是把拒绝文案写得更可执行——**文案救不回来**，因为读它的是模型而不是人。
 *
 * 这里跟 {@link listMessagesArgumentsSchema} 用同一条归一化：模型会把每个可见的可选属性都序列化
 * 出来，空串是它表达「没有」的常见方式，而空 cursor 的语义没有歧义。本工具此前是本文件里唯一
 * 没做这层归一化的 list 类工具。**只吃空白串**：非空但畸形的 cursor 仍按原契约拒绝并给指引。
 * null 同义（声明面现在写明「首页传 null」，见 `projectCollabToolArguments.ts`）。
 */
const listTodosArgumentsSchema = z.preprocess(
  withoutAbsentFields(LIST_TODOS_ABSENT_FIELDS),
  z.strictObject({
    cursor: z.preprocess(emptyStringToUndefined, z.string().min(1).max(1_024).optional()),
    limit: z.number().int().min(1).max(50).optional(),
  }),
);
const zeroToUndefined = (value: unknown): unknown => (value === 0 ? undefined : value);
const boundMessageLimit = (value: unknown): unknown =>
  typeof value === 'number' && Number.isInteger(value) && value > PROJECT_MESSAGE_MAX_LIMIT
    ? PROJECT_MESSAGE_MAX_LIMIT
    : value;

/**
 * OpenAI-compatible models may serialize every visible optional property instead of omitting
 * unused ones. For this bounded read-only tool, empty strings and a zero cursor mean "not set",
 * while an oversized page hint safely converges to the advertised maximum. Keep this local to
 * discussion reads: those values can have real meaning in write tools and must not be normalized
 * globally by the bridge. The declared schema now accepts null for every optional field; null is
 * mapped to "not set" first (see `projectCollabToolArguments.ts`).
 */
const listMessagesArgumentsSchema = z.preprocess(
  withoutAbsentFields(LIST_MESSAGES_ABSENT_FIELDS),
  z
    .strictObject({
      beforeSeq: z.preprocess(zeroToUndefined, z.number().int().safe().positive().optional()),
      limit: z.preprocess(
        boundMessageLimit,
        z.number().int().min(1).max(PROJECT_MESSAGE_MAX_LIMIT).optional(),
      ),
      authorSubject: z.preprocess(
        emptyStringToUndefined,
        z.string().trim().min(1).max(256).optional(),
      ),
      // Compatibility for sessions that were started before authorName left the model-facing schema.
      authorName: z.preprocess(
        emptyStringToUndefined,
        z.string().trim().min(1).max(160).optional(),
      ),
      createdAfter: z.preprocess(
        emptyStringToUndefined,
        z.string().max(64).datetime({ offset: true }).optional(),
      ),
      createdBefore: z.preprocess(
        emptyStringToUndefined,
        z.string().max(64).datetime({ offset: true }).optional(),
      ),
    })
    .superRefine((value, context) => {
      if (
        value.createdAfter !== undefined &&
        value.createdBefore !== undefined &&
        Date.parse(value.createdAfter) >= Date.parse(value.createdBefore)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['createdBefore'],
          message: 'createdBefore must be later than createdAfter',
        });
      }
    }),
);
/*
 * ⚠️ `.omit()` 不能作用在带 refinement 的对象上（zod），所以这里从**字段集**裁剪，
 * 再自己把跨字段判据挂回去——判据函数只有一份，但要记得用（见协议侧的头注）。
 * 裁掉的第三项 `assigneeKind`：**派单是人的动作**（设计方案 §4.1 界面驱动），
 * 助手不该能把活派给自己再自己交差。
 * 模型写出来的「没有」（null / 空白串 / `[]`）先落回「不传」再校验，规则见 `projectCollabToolArguments.ts`。
 */
const createTodoArgumentsSchema = z.preprocess(
  withoutAbsentFields(CREATE_TODO_ABSENT_FIELDS),
  ProjectTodoCreateFieldsSchema.omit({
    projectId: true,
    source: true,
    assigneeKind: true,
  }).refine(assigneeDispatchIsConsistent, { message: ASSIGNEE_DISPATCH_CONFLICT_MESSAGE }),
);
const updateTodoArgumentsSchema = ProjectTodoUpdateRequestSchema;
const readWorkOrderArgumentsSchema = z.strictObject({ todoId: z.string().uuid() });
const draftTasksArgumentsSchema = z.preprocess(
  withoutAbsentItemFields(DRAFT_ITEM_ABSENT_FIELDS),
  ProjectTodoDraftCreateRequestSchema.omit({
    projectId: true,
    targetItemKind: true,
    parentId: true,
  }).required({ sourceTodoId: true }),
);
const submitWorkOrderArgumentsSchema = z.preprocess(
  withoutAbsentFields(SUBMIT_WORK_ORDER_ABSENT_FIELDS),
  ProjectTodoSubmitReviewRequestSchema,
);
const postUpdateArgumentsSchema = ProjectFeedPostRequestSchema.omit({ projectId: true });
const listFilesArgumentsSchema = z.preprocess(
  withoutAbsentFields(LIST_FILES_ABSENT_FIELDS),
  ProjectFileListRequestSchema.omit({ projectId: true }),
);
/**
 * 定位参数收 `>= 0`：0 与缺省同义（模型常把用不上的定位器填 0 而不是省掉；
 * 2026-09-04 现场 gpt-5.6-sol 读 .md 时七个定位器全带、多数为 0，严格正整数校验一律拒
 * → 兜底文案说「文件不可读」→ 模型换参重试 → 循环护栏把整轮停掉）。null 同样等于缺省。
 * 真正按格式收敛在 `normalizeDocumentSelector`：不适用的键剔除并回报，不整次拒。
 */
const readFileArgumentsSchema = z.preprocess(
  withoutAbsentFields(READ_FILE_ABSENT_FIELDS),
  z.strictObject({
    fileId: z.string().uuid(),
    page: z.number().int().nonnegative().optional(),
    slide: z.number().int().nonnegative().optional(),
    sheet: z.number().int().nonnegative().optional(),
    block: z.number().int().nonnegative().optional(),
    startLine: z.number().int().nonnegative().optional(),
    startChar: z.number().int().nonnegative().optional(),
    maxLines: z.number().int().nonnegative().max(5_000).optional(),
  }),
);

const UNREADABLE_DOCUMENT_MESSAGE =
  'That project file is not readable text or a valid supported document.';
const TEXT_DOCUMENT_FORMATS: ReadonlySet<LocalDocumentFormat> = new Set([
  'txt',
  'md',
  'csv',
  'json',
  // html 经真实解析链去标签取正文（localDocumentParser 的 html 分支）后是纯文本，
  // 选择器语义随文本档。xml/yaml/log 未加：解析链无对应分支，加了也读不出。
  'html',
]);
const LOCATOR_NAME_BY_FORMAT: Partial<Record<LocalDocumentFormat, string>> = {
  pdf: 'page',
  pptx: 'slide',
  xlsx: 'sheet',
  docx: 'block',
};
const SELECTOR_RETRY_HINT =
  ' Read again with every selector set to null, or continue from the exact nextSelector of an ' +
  'earlier result.';

/**
 * 解析器错误码 → 给模型的可执行文案。
 *
 * 此前所有错误共用一句「文件不可读」，定位参数越界/不适用与真坏文件说的是同一句话，
 * 模型只能瞎猜着改参数再试（loop guard 最终停轮）。现在只有「文件本身坏/不是文本」
 * 才说不可读；定位参数问题说清哪个参数、为什么、下一步做什么。
 */
function describeProjectReadFileFailure(
  error: unknown,
  format: LocalDocumentFormat | null,
): string {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'DOCUMENT_SELECTOR_RANGE': {
      if (format === null || TEXT_DOCUMENT_FORMATS.has(format)) {
        return (
          'The selector is out of range for this text file: startLine must not exceed the ' +
          'number of lines in the file, and startChar is a 1-based character offset inside the ' +
          'selected line (not a byte or file offset).' +
          SELECTOR_RETRY_HINT
        );
      }
      const locator = LOCATOR_NAME_BY_FORMAT[format] ?? 'locator';
      return (
        `The selector is out of range for this ${format.toUpperCase()} file: the ${locator} ` +
        `index exceeds what the file contains, or startChar exceeds the length of that ${locator}.` +
        SELECTOR_RETRY_HINT
      );
    }
    case 'DOCUMENT_SELECTOR_MISMATCH':
      return (
        'The selector does not apply to this file format: use page for PDF, slide for PPTX, ' +
        'sheet for XLSX, block for DOCX, and startLine/maxLines for text files.'
      );
    case 'DOCUMENT_PARSE_SIZE_LIMIT':
    case 'DOCUMENT_STRUCTURED_PARSE_LIMIT':
    case 'DOCUMENT_ZIP_ENTRIES_LIMIT':
    case 'DOCUMENT_ZIP_ENTRY_LIMIT':
    case 'DOCUMENT_ZIP_EXPANDED_LIMIT':
    case 'DOCUMENT_ZIP_COMPRESSED_LIMIT':
    case 'DOCUMENT_ZIP_RATIO_LIMIT':
      return (
        'The project file exceeds the bounded document-reading budget. Read a smaller part with ' +
        'selectors, or ask a person to share an excerpt.'
      );
    case 'DOCUMENT_PARSE_TIMEOUT':
    case 'DOCUMENT_PARSE_WORKER_FAILED':
      return (
        'Reading the project file timed out or failed transiently. Retry once, or read a ' +
        'smaller part with selectors.'
      );
    case 'DOCUMENT_UNSUPPORTED':
      return (
        'That project file type is not readable text or a supported document; supported types ' +
        'are PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV and JSON.'
      );
    default:
      return UNREADABLE_DOCUMENT_MESSAGE;
  }
}
const listMembersArgumentsSchema = z.strictObject({});
/**
 * 存资产的入参。路径是**工作区相对**的：绝对路径与越界路径在 `resolveWorkspaceFile`
 * 一并拒掉——工具能把文件发给全组，所以「发哪一个」的范围必须由 Main 收口，
 * 不能由模型给一个任意路径（那等于一条把本机任意文件外发的通道）。
 */
const saveAssetArgumentsSchema = z.preprocess(
  withoutAbsentFields(SAVE_ASSET_ABSENT_FIELDS),
  z.strictObject({
    path: z.string().min(1).max(1_024),
    filename: z.string().min(1).max(200).optional(),
  }),
);

export type ProjectCollabToolName = z.infer<typeof projectToolNameSchema>;

export interface ProjectCollabToolExecutorOptions {
  readonly client: ProjectCollabToolClientPort;
  /** 规划面的读端口（只读两件）；缺省 ⇒ 规划四件失败闭合。 */
  readonly planning?: ProjectCollabPlanningToolPort;
  /** 规划草案暂存口（只能放进去）；缺省 ⇒ 两件草案工具失败闭合。 */
  readonly planningDrafts?: ProjectPlanningDraftStagingPort;
  /** read_file 的临时落盘目录（Main 私有）；读完即删，不留副本。 */
  readonly tempDirectory: () => string;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let end = maxBytes;
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      // UTF-8 最长四字节；只会退掉落在预算边界上的不完整码点。
      end -= 1;
    }
  }
  return '';
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join('');
}

function contextChangedFailure(): ProjectCollabToolResponse {
  return failure('Project session context changed; discard this result and retry.');
}

/**
 * 改单审批卡：**只列真实变更集里的字段**（与当前值相同的字段不在 `changes` 里，也就不上卡）。
 * 标签与描述此前不上卡——字段改了卡上却看不见，与「卡上看不出改了什么」是同一个失真。
 */
function todoUpdateApprovalDetails(
  todoId: string,
  changes: TodoUpdateFields,
  boundSessionRef: string | null,
): { label: string; value: string; mono?: boolean }[] {
  return [
    { label: '操作', value: '更新项目待办' },
    { label: '待办', value: todoId, mono: true },
    ...(changes.parentId !== undefined
      ? [{ label: '上级需求', value: changes.parentId ?? '摘回顶层', mono: true }]
      : []),
    ...(changes.title !== undefined ? [{ label: '标题', value: changes.title }] : []),
    ...(changes.status !== undefined ? [{ label: '状态', value: changes.status }] : []),
    ...(changes.priority !== undefined ? [{ label: '优先级', value: changes.priority }] : []),
    ...(changes.assigneeSubject !== undefined
      ? [{ label: '处理人', value: changes.assigneeSubject ?? '清空', mono: true }]
      : []),
    ...(changes.labels !== undefined
      ? [{ label: '标签', value: changes.labels.length > 0 ? changes.labels.join('、') : '清空' }]
      : []),
    ...(changes.startAt !== undefined
      ? [{ label: '开始时间', value: changes.startAt ?? '清空', mono: true }]
      : []),
    ...(changes.dueAt !== undefined
      ? [{ label: '截止时间', value: changes.dueAt ?? '清空', mono: true }]
      : []),
    ...(changes.description !== undefined
      ? [{ label: '描述', value: changes.description || '清空' }]
      : []),
    ...(boundSessionRef !== null
      ? [{ label: '执行会话', value: boundSessionRef, mono: true }]
      : []),
  ];
}

export class ProjectCollabToolExecutor {
  constructor(private readonly options: ProjectCollabToolExecutorOptions) {}

  private planningContext(): ProjectPlanningToolContext {
    return {
      client: this.options.client,
      planning: this.options.planning,
      drafts: this.options.planningDrafts,
    };
  }

  async execute(
    bindingInput: unknown,
    input: unknown,
    gate?: ProjectCollabApprovalGate,
  ): Promise<ProjectCollabToolResponse> {
    const binding = parseProjectCollabToolBinding(bindingInput);
    const call = projectToolCallSchema.safeParse(input);
    /*
     * ⚠️ 两种失败**分开回**（实测倒逼）：此前它们塌缩成一句 `Invalid project tool
     * request.`，模型拿到一句不知所云的拒绝，转头**自己编了个理由**告诉用户
     * （「录入接口要求必须关联一个现有顶层需求」「必须提供有效的负责人标识」——
     * 两句都不是真的），用户照着那个理由排查，白花一轮。
     *
     * 一个说不出哪儿错的报错，等于把诊断责任推给一个只能猜的读者。
     */
    if (!binding) {
      return failure('This session is not linked to a project group, so project tools are off.');
    }
    if (!call.success) return invalidRequestFailure(call.error);
    if (!binding.isCurrentContext()) {
      return failure('Project session context changed; retry from the current session.');
    }

    let accessToken: string | null;
    try {
      accessToken = await binding.accessTokenProvider();
    } catch {
      accessToken = null;
    }
    if (!binding.isCurrentContext()) {
      return failure('Project session context changed; retry from the current session.');
    }
    if (accessToken === null) {
      return failure('Project credentials are unavailable; ask the user to sign in again.');
    }

    try {
      let response: ProjectCollabToolResponse;
      switch (call.data.tool) {
        case 'project_list_messages':
          response = await this.listMessages(accessToken, binding, call.data.arguments);
          break;
        case 'project_list_todos':
          response = await this.listTodos(accessToken, binding, call.data.arguments);
          break;
        case 'project_read_work_order':
          response = await this.readWorkOrder(accessToken, binding, call.data.arguments);
          break;
        case 'project_list_members':
          response = await this.listMembers(accessToken, binding, call.data.arguments);
          break;
        case 'project_create_todo':
          response = await this.createTodo(accessToken, binding, call.data.arguments, gate);
          break;
        case 'project_update_todo':
          response = await this.updateTodo(accessToken, binding, call.data.arguments, gate);
          break;
        case 'project_draft_requirements':
          response = await this.draftItems(
            accessToken,
            binding,
            call.data.arguments,
            'requirement',
            gate,
          );
          break;
        case 'project_draft_tasks':
          response = await this.draftItems(accessToken, binding, call.data.arguments, 'task', gate);
          break;
        case 'project_submit_work_order':
          response = await this.submitWorkOrder(accessToken, binding, call.data.arguments, gate);
          break;
        case 'project_post_update':
          response = await this.postUpdate(accessToken, binding, call.data.arguments, gate);
          break;
        case 'project_list_files':
          response = await this.listFiles(accessToken, binding, call.data.arguments);
          break;
        case 'project_read_file':
          response = await this.readFile(accessToken, binding, call.data.arguments);
          break;
        case 'project_save_asset':
          response = await this.saveAsset(accessToken, binding, call.data.arguments, gate);
          break;
        case 'project_list_milestones':
          response = await listMilestonesTool(
            this.planningContext(),
            accessToken,
            binding,
            call.data.arguments,
          );
          break;
        case 'project_list_iterations':
          response = await listIterationsTool(
            this.planningContext(),
            accessToken,
            binding,
            call.data.arguments,
          );
          break;
        case 'project_draft_milestone':
          response = await draftMilestoneTool(
            this.planningContext(),
            accessToken,
            binding,
            call.data.arguments,
            gate,
          );
          break;
        case 'project_draft_iteration':
          response = await draftIterationTool(
            this.planningContext(),
            accessToken,
            binding,
            call.data.arguments,
            gate,
          );
          break;
      }
      return attachFailureTool(
        call.data.tool,
        binding.isCurrentContext() ? response : contextChangedFailure(),
      );
    } catch {
      // 非预期失败统一为封闭文案，不透传上游错误。
      return attachFailureTool(
        call.data.tool,
        failure('Project collaboration is unavailable right now.'),
      );
    }
  }

  private async listMessages(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = listMessagesArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    let authorSubject = parsed.data.authorSubject;
    let authorResolution: Readonly<Record<string, unknown>> | undefined;
    // An exact subject copied from project_list_members is stronger than a legacy fuzzy name hint.
    // Validate and use it first so an old session that serialized both optional fields can proceed.
    if (authorSubject !== undefined) {
      const project = await this.options.client.readProjectDetail(accessToken, {
        projectId: binding.projectId,
      });
      if (!binding.isCurrentContext()) return contextChangedFailure();
      if (!project.ok) return collabFailure(project);
      const isActiveSubject = project.value.members.some(
        (member) => member.state === 'active' && member.subject === authorSubject,
      );
      if (!isActiveSubject) {
        return failure(
          'authorSubject must be an exact opaque subject returned by project_list_members; ' +
            'do not pass a display name or nickname.',
        );
      }
    } else if (parsed.data.authorName !== undefined) {
      const project = await this.options.client.readProjectDetail(accessToken, {
        projectId: binding.projectId,
      });
      if (!binding.isCurrentContext()) return contextChangedFailure();
      if (project.ok) {
        const resolution = resolveDiscussionAuthor(parsed.data.authorName, project.value.members);
        if (resolution.kind === 'ambiguous') {
          return failure(
            'Multiple project members match that name; ask the user to confirm one display name.',
            {
              code: 'PROJECT_AUTHOR_AMBIGUOUS',
              retryable: false,
              nextAction:
                'Ask one minimal confirmation question using only the candidate display names.',
            },
          );
        }
        if (resolution.kind === 'missing') {
          return failure('No active project member matches that name.', {
            code: 'PROJECT_AUTHOR_NOT_FOUND',
            retryable: false,
            nextAction: 'Ask the user to confirm the member display name.',
          });
        }
        authorSubject = resolution.subject;
        authorResolution = {
          requestedName: parsed.data.authorName,
          matchedDisplayName: resolution.displayName,
          assumed: resolution.assumed,
        };
      } else {
        authorResolution = {
          requestedName: parsed.data.authorName,
          fallback: 'authorDisplayName',
        };
      }
    }
    const limit = parsed.data.limit ?? PROJECT_MESSAGE_DEFAULT_LIMIT;
    const outcome = await this.options.client.listChatHistory(accessToken, {
      projectId: binding.projectId,
      limit: limit + 1,
      ...(parsed.data.beforeSeq !== undefined ? { beforeSeq: parsed.data.beforeSeq } : {}),
      ...(authorSubject !== undefined ? { authorSubject } : {}),
      ...(parsed.data.createdAfter !== undefined ? { createdAfter: parsed.data.createdAfter } : {}),
      ...(parsed.data.createdBefore !== undefined
        ? { createdBefore: parsed.data.createdBefore }
        : {}),
    });
    if (!binding.isCurrentContext()) {
      return contextChangedFailure();
    }
    if (!outcome.ok) return collabFailure(outcome);

    const hasMore = outcome.value.length > limit;
    const page = hasMore ? outcome.value.slice(-limit) : outcome.value;
    let remainingBodyBytes = PROJECT_MESSAGE_TOTAL_BODY_BYTES;
    let contentTruncated = false;
    const messages = [...page].reverse().map((message) => {
      const originalBody = message.revoked ? '' : message.bodyMd;
      const allowedBytes = Math.min(PROJECT_MESSAGE_MAX_BODY_BYTES, remainingBodyBytes);
      const body = truncateUtf8(originalBody, allowedBytes);
      const bodyBytes = Buffer.byteLength(body, 'utf8');
      remainingBodyBytes -= bodyBytes;
      const bodyTruncated = body !== originalBody;
      contentTruncated ||= bodyTruncated;
      return {
        id: message.id,
        seq: message.seq,
        authorDisplayName:
          truncateCodePoints(message.authorDisplayName.trim(), PROJECT_MESSAGE_MAX_AUTHOR_LENGTH) ||
          '成员',
        body,
        revoked: message.revoked,
        createdAt: message.createdAt,
        ...(bodyTruncated ? { bodyTruncated: true } : {}),
      };
    });
    messages.reverse();

    const nextBeforeSeq = messages[0]?.seq;
    if (hasMore && nextBeforeSeq === undefined) {
      return failure('Project discussion pagination state was inconsistent.');
    }
    const pagination = hasMore
      ? discussionPaginationSchema.parse({
          truncated: true,
          contentTruncated,
          complete: false,
          nextAction: 'continue',
          nextBeforeSeq,
        })
      : discussionPaginationSchema.parse({
          truncated: contentTruncated,
          contentTruncated,
          complete: true,
          nextAction: 'answer',
        });

    return success({
      tool: 'project_list_messages',
      messages,
      ...(authorResolution ? { authorResolution } : {}),
      ...pagination,
    });
  }

  private async listTodos(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = listTodosArgumentsSchema.safeParse(input);
    // 现场：cursor 传 ""/limit 越界被拒只回 zod 原文 → 说清是哪个参数、第一页请省略 cursor。
    if (!parsed.success) return describeListTodosArgumentFailure(parsed.error);
    const outcome = await this.options.client.listTodos(accessToken, {
      projectId: binding.projectId,
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      limit: parsed.data.limit ?? 30,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    // 现场：cursor 传 "0"/"start" 过了 zod 却被服务端拒，通用「rejected」补首页省略指引。
    if (!outcome.ok) return listTodosRejectionFailure(outcome, parsed.data.cursor !== undefined);
    if (outcome.value.hasMore !== (outcome.value.nextCursor !== null)) {
      return failure('Project to-do pagination state was inconsistent.', {
        code: 'PROJECT_REQUEST_REJECTED',
        retryable: false,
      });
    }
    const todos = outcome.value.todos.map((todo) => ({
      id: todo.id,
      itemKind: todo.itemKind,
      // itemKind 与 parentId 正交：前者是业务种类，后者只是直接父项。
      parentId: todo.parentId,
      source: todo.source,
      visibility: todo.visibility,
      title: todo.title,
      status: todo.status,
      // 处理人档位：`assistant` ＝这张单派给了项目助理（处理人两列随之为空）。
      // ⛔ 别拿空处理人当「无人认领」——两个档位下它都可能是空。
      assigneeKind: todo.assigneeKind,
      assigneeSubject: todo.assigneeSubject,
      assigneeDisplayName: todo.assigneeDisplayName,
      priority: todo.priority,
      labels: todo.labels,
      startAt: todo.startAt,
      dueAt: todo.dueAt,
      description: todoDescriptionPreview(todo.description),
      ...(todo.description.length > PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH
        ? { descriptionTruncated: true }
        : {}),
      // 工作单面只回**计数**：判据正文与注意事项走 project_read_work_order。
      // 有判据 ⇒ 是工作单 ⇒ 必须走提交验收，不能直接标完成。
      isWorkOrder: isTodoWorkOrder(todo),
      acceptanceTotal: todo.acceptanceTotal,
      acceptanceChecked: todo.acceptanceChecked,
      version: todo.version,
      updatedAt: todo.updatedAt,
    }));
    return success({
      tool: 'project_list_todos',
      todos,
      hasMore: outcome.value.hasMore,
      nextCursor: outcome.value.nextCursor,
      truncated: outcome.value.hasMore,
      /*
       * 空看板要**说出来它是空的、以及下一步怎么走**（实测倒逼）。
       *
       * 一个空数组同时相容于「这个项目还没有需求」和「我没权限看/没查到」，模型于是
       * 自己补了个解释：既然一条都取不到，那就既没有可挂靠的需求、也没有可用的处理人，
       * 「所以建不了」——一个从空列表推出来的死锁，而这两条前提**都不是真的**：
       * 建需求只要标题，未分配处理人是合法状态。
       *
       * ⛔ 这不是「给模型打气」，是把本工具的事实边界写清楚：列表为空是正常起点。
       */
      ...(outcome.value.todos.length === 0
        ? {
            note:
              'The board has no items yet; this is the normal starting state, not an error. ' +
              'To add the first one, call project_create_todo with itemKind requirement and a ' +
              'title, set parentId to null to create a top-level requirement, and set ' +
              'assigneeSubject to null — an unassigned item is valid.',
          }
        : {}),
    });
  }

  /**
   * 列出项目成员（只读，无审批）。**只回 subject 与显示名两项**。
   *
   * ⚠️ 这一件此前整个不存在，而 `assigneeSubject` 的说明却指着「从看板事项里取」——
   * 空看板上那句话指向一个空集合，助手于是得出「拿不到任何可用的负责人标识」，
   * 再把它讲成了建单的前置条件。工具面没有成员概念，就只能靠猜。
   *
   * ⛔ 身份数据只给必要字段：角色、成员状态、加入时间**一概不出**——派单要用的只有
   * 「有谁、叫什么」，多倒出来的每一列都是白送给模型上下文的个人信息。
   * ⚠️ 只回 `active` 成员：受邀未加入的人服务端会拒收为处理人，摆出来就是个陷阱。
   */
  private async listMembers(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = listMembersArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    const outcome = await this.options.client.readProjectDetail(accessToken, {
      projectId: binding.projectId,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    const members = outcome.value.members
      .filter((member) => member.state === 'active')
      .slice(0, PROJECT_TOOL_MAX_LIST_ENTRIES)
      .map((member) => ({ subject: member.subject, displayName: member.displayName }));
    return success({ tool: 'project_list_members', members, totalMembers: members.length });
  }

  /**
   * 受审批新建待办。审批卡如实呈现将要写入的字段（标题/挂靠/可见性/状态/优先级/
   * 处理人/截止），决议非 accept（含拒绝/取消/超时/会话级放行）一律不执行。
   */
  private async createTodo(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = createTodoArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('The to-do change was not authorized.');

    const details = [
      {
        label: '操作',
        value: parsed.data.itemKind === 'requirement' ? '新建项目需求' : '新建项目任务',
      },
      { label: '标题', value: parsed.data.title },
      ...(parsed.data.parentId !== undefined
        ? [{ label: '父项', value: parsed.data.parentId, mono: true }]
        : []),
      ...(parsed.data.visibility !== undefined
        ? [{ label: '可见性', value: parsed.data.visibility }]
        : []),
      ...(parsed.data.status !== undefined ? [{ label: '状态', value: parsed.data.status }] : []),
      ...(parsed.data.priority !== undefined
        ? [{ label: '优先级', value: parsed.data.priority }]
        : []),
      ...(parsed.data.assigneeSubject !== undefined
        ? [{ label: '处理人', value: parsed.data.assigneeSubject, mono: true }]
        : []),
      ...(parsed.data.startAt !== undefined
        ? [{ label: '开始时间', value: parsed.data.startAt ?? '清空', mono: true }]
        : []),
      ...(parsed.data.dueAt !== undefined
        ? [{ label: '截止时间', value: parsed.data.dueAt, mono: true }]
        : []),
    ];
    const decision = await gate.requestApproval({ kind: 'projectTodoWrite', details });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'The to-do change');

    // ⚠️ `source: 'assistant'` 是**本执行器的声明**，不是服务端查证过的事实：
    // 助手与人用同一个账号走同一条 API，服务端没有任何办法分辨。这里如实声明，
    // 服务端把声明值落进 todo.create 审计（键名 declared_source）——
    // 它答的是「这条通道自称是助手建的」，不答「事实上是助手建的」。
    const outcome = await this.options.client.createTodo(accessToken, {
      projectId: binding.projectId,
      source: 'assistant',
      ...parsed.data,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) {
      // 业务码说得清是日期的事，就不再猜是父项的事（下面那句「改建顶层需求」在这里是误导）。
      if (outcome.serverCode === START_REQUIRES_DUE_SERVER_CODE) {
        return startRequiresDueFailure('project_create_todo');
      }
      /*
       * 带了 `parentId` 又被服务端拒 ⇒ 头号原因是那个 id 根本不存在（空看板上尤其），
       * 而通用文案说不出「所以我该怎么办」。补一句可执行的下一步：改建顶层需求。
       * ⛔ 只在**确实带了 parentId** 时补——不带的时候这句话是误导。
       */
      if (parsed.data.parentId !== undefined && isParentResolutionFailure(outcome.code)) {
        return failure(
          [
            collabFailureMessage(outcome.code),
            'The parentId may not exist or may not be visible to this account.',
            'To create a top-level requirement instead, call project_create_todo again ' +
              'with parentId set to null.',
          ].join('\n'),
        );
      }
      return collabFailure(outcome);
    }
    return success({ tool: 'project_create_todo', todo: writtenTodoSummary(outcome.value) });
  }

  /**
   * 读一张工作单的完整规格：目标、注意事项（边界）、验收清单逐条、完成记录时间线。
   *
   * 列表端点只回验收**计数**（500 条待办 × 20 条判据的正文会把结果体打爆），
   * 逐条内容只在这里给——而提交待验收要求对每一条判据写自述，所以这是承接一张
   * 工作单的必经一步。只读，无审批。
   */
  private async readWorkOrder(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = readWorkOrderArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    const outcome = await this.options.client.getTodoDetail(accessToken, {
      todoId: parsed.data.todoId,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    const { todo, acceptanceItems, completionRecords } = outcome.value;
    return success({
      tool: 'project_read_work_order',
      todo: {
        id: todo.id,
        parentId: todo.parentId,
        title: todo.title,
        status: todo.status,
        assigneeKind: todo.assigneeKind,
        assigneeSubject: todo.assigneeSubject,
        priority: todo.priority,
        startAt: todo.startAt,
        dueAt: todo.dueAt,
        description: todo.description,
        constraintsText: todo.constraintsText,
        refs: todo.refs,
        sessionRef: todo.sessionRef,
        isWorkOrder: isTodoWorkOrder(todo),
        version: todo.version,
      },
      acceptanceItems: acceptanceItems.map((item) => ({
        ordinal: item.ordinal,
        text: item.text,
        checked: item.checked,
        executorNote: item.executorNote,
      })),
      completionRecords: completionRecords.map((record) => ({
        entryKind: record.entryKind,
        authorDisplayName: record.authorDisplayName,
        summary: record.summary,
        artifacts: record.artifacts,
        createdAt: record.createdAt,
      })),
    });
  }

  /**
   * 受审批落一批**拆解草案**（设计方案 §3.1）。
   *
   * ⛔ 草案**不是待办**：服务端把它落在独立的两张表里，正式清单的任何查询都看不见，
   *    看板上也不会多出一条。它只有一个出口——人在审阅界面上逐条剔除后整批确认，
   *    确认那一刻才成单。这道闸存在的全部理由就是不让助手拆出来的东西变成既成事实。
   * ⛔ **不自动触发**：本工具只在用户明确要求拆解时被调用；「需求单自动拆解（无人
   *    确认即成单）」是设计方案 §6 明写不做的事。工具面无从自我触发——它得先有人
   *    在会话里说一句话，再经过一次逐调用审批。
   * ⚠️ 可见集合至多两人（拆解发起方 ＋ 源需求的建单人），**项目拥有者也看不见**；
   *    判定在服务端，客户端这一侧不做也做不到。
   */
  private async draftItems(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    targetItemKind: 'requirement' | 'task',
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = draftTasksArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('The task breakdown was not authorized.');

    // 有几条是模型自己补的假设。审批卡上先说这个数，人才知道这一批要不要细看——
    // ⛔ 它不是「拦下来」的判据（不做必填表单挡在前面），只是把区分摆到台面上。
    const assumedCount = parsed.data.items.filter((item) => item.basis === 'assumed').length;
    const details = [
      {
        label: '操作',
        value: `生成${targetItemKind === 'requirement' ? '需求' : '任务'}草案（待人工审阅）`,
      },
      { label: '草案条数', value: String(parsed.data.items.length) },
      ...(assumedCount > 0 ? [{ label: '其中助手补的', value: String(assumedCount) }] : []),
      { label: '当前拆解源', value: parsed.data.sourceTodoId, mono: true },
      // 逐条标题如实呈现：审批人要看的就是「它准备拆出哪几条」。
      // 补出来的那几条在标题上就标出来，免得人得回头数第几条是哪一条。
      ...parsed.data.items.map((item, index) => ({
        label: `第 ${index + 1} 条${item.basis === 'assumed' ? '（助手补的）' : ''}`,
        value: item.title,
      })),
    ];
    const decision = await gate.requestApproval({ kind: 'projectTodoWrite', details });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'The task breakdown');

    const outcome = await this.options.client.createDraftBatch(accessToken, {
      projectId: binding.projectId,
      targetItemKind,
      parentId: parsed.data.sourceTodoId,
      ...parsed.data,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    return success({
      tool: targetItemKind === 'requirement' ? 'project_draft_requirements' : 'project_draft_tasks',
      targetItemKind,
      parentId: parsed.data.sourceTodoId,
      batchId: outcome.value.id,
      draftCount: outcome.value.drafts.length,
      // 结果体如实说清「这还不是任务」，免得模型转头就告诉用户单已经建好了。
      note: 'These are drafts awaiting human review; no board item exists yet.',
    });
  }

  /**
   * 受审批提交一张工作单的**完成记录**并推到「待验收」（设计方案 §4.4）。
   *
   * ⛔ 这里**没有、也不会有**「验收通过」的工具：执行方只能推到待验收，拍板是人的事
   *    （设计方案 §1.1 内核三）。服务端另有硬闸——有验收清单的单一律不能直跳
   *    「已完成」，`project_update_todo` 也走同一条判定，所以工具面既没有入口，
   *    绕过去也会被服务端拒。
   * ⚠️ 完成记录三件（做了什么 / 产出关联到哪些资产 / 逐条验收自述）都在这一次请求里，
   *    服务端在同一事务内落盘——不会出现「状态到了待验收、记录还没写」的中间态。
   */
  private async submitWorkOrder(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = submitWorkOrderArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('The work order submission was not authorized.');

    const details = [
      { label: '操作', value: '提交工作单待验收' },
      { label: '工作单', value: parsed.data.todoId, mono: true },
      { label: '做了什么', value: parsed.data.summary },
      ...((parsed.data.artifacts ?? []).length > 0
        ? [{ label: '产出关联', value: (parsed.data.artifacts ?? []).join('、'), mono: true }]
        : []),
      ...(parsed.data.itemNotes ?? []).map((note) => ({
        label: `验收第 ${note.ordinal} 条`,
        value: note.note,
      })),
    ];
    const decision = await gate.requestApproval({ kind: 'projectTodoWrite', details });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'The work order submission');

    const outcome = await this.options.client.submitTodoReview(accessToken, parsed.data);
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) {
      if (outcome.code === 'conflict') return versionConflictFailure(outcome.currentVersion);
      return collabFailure(outcome);
    }
    return success({
      tool: 'project_submit_work_order',
      todo: writtenTodoSummary(outcome.value.todo),
      // 说清下一步在谁手里：模型不该把「已提交」讲成「已完成」。
      note: 'Submitted for review. Only the dispatcher or the project owner can accept it.',
    });
  }

  /**
   * 受审批更新待办（乐观锁）。409 版本冲突如实透传当前版本，让模型重取后
   * 带新版本重试，而不是盲目重发同一份请求。
   *
   * ⚠️ **会话关联不由模型填**：派给助理的单转「进行中」＝开工（设计方案 §4.2），
   * 此刻把**本会话**记进 `sessionRef`，卡片上的「查看执行」才点得回来。会话编号是
   * Main 手上的事实，模型填的只能是它猜的一个串——所以模型给的那一项一律丢弃。
   *
   * ⚠️ **写入与审批卡只含真实变更**（判定见 `projectTodoUpdateChangeSet.ts`）：有的模型每次都把
   * 全部属性抄回来。审批前先按 todoId 读出当前事项，与当前值相同的字段不写也不上卡；一个字段都
   * 没变 ⇒ 不弹卡、不写，如实回「没有变化」。当前版本已不是模型给的 expectedVersion ⇒ 直接回
   * 版本冲突：那份抄回值属于旧版本，拿它和新版本比，会把别人刚做的修改算成「改动」摆上卡。
   * expectedVersion 原样送服务端，并发下的最后一道仍是服务端乐观锁。
   */
  private async updateTodo(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = updateTodoArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('The to-do change was not authorized.');

    // ⛔ 模型给的会话编号一律丢弃（见方法头注）；开工那一次由 Main 用绑定值补上。
    const { todoId, expectedVersion, ...requested } = parsed.data;
    delete (requested as { sessionRef?: unknown }).sessionRef;

    const detail = await this.options.client.getTodoDetail(accessToken, { todoId });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!detail.ok) return collabFailure(detail);
    const current = detail.value.todo;
    if (current.version !== expectedVersion) return versionConflictFailure(current.version);

    const changes = todoUpdateChangeSet(requested, current);
    if (Object.keys(changes).length === 0) {
      return success({
        tool: 'project_update_todo',
        changed: false,
        todo: writtenTodoSummary(current),
        note:
          'Every supplied field already matches the current item, so no approval was requested ' +
          'and the item was not changed.',
      });
    }
    // 开工只认状态**真的**转成进行中：抄回来的「进行中」不是开工。
    const boundSessionRef = openingSessionRef(binding, changes.status);

    const decision = await gate.requestApproval({
      kind: 'projectTodoWrite',
      details: todoUpdateApprovalDetails(todoId, changes, boundSessionRef),
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'The to-do change');

    const outcome = await this.options.client.updateTodo(accessToken, {
      todoId,
      expectedVersion,
      ...changes,
      /*
       * 「description: null＝清空」是工具说明给模型的契约，但服务端描述列 NOT NULL DEFAULT ''，
       * 改单模型又把 null 原样写进 SET ⇒ 整次 500；5xx 在客户端被归为可重试，模型只会反复重发。
       * 清空在库里的样子就是空串：这里落成 '' 再发，审批卡照样写「清空」（界面那条路不发 null）。
       */
      ...(changes.description === null ? { description: '' } : {}),
      ...(boundSessionRef !== null ? { sessionRef: boundSessionRef } : {}),
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) {
      if (outcome.code === 'conflict') return versionConflictFailure(outcome.currentVersion);
      if (outcome.serverCode === START_REQUIRES_DUE_SERVER_CODE) {
        return startRequiresDueFailure('project_update_todo');
      }
      return collabFailure(outcome);
    }
    return success({ tool: 'project_update_todo', todo: writtenTodoSummary(outcome.value) });
  }

  /** 受审批发布项目动态。审批卡如实呈现将要发布的正文（数据进 value，超长由投影层截断）。 */
  private async postUpdate(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = postUpdateArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('The project update was not authorized.');

    const decision = await gate.requestApproval({
      kind: 'projectFeedPost',
      details: [
        { label: '操作', value: '发布项目动态' },
        { label: '内容', value: parsed.data.bodyMd },
      ],
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'The project update');

    const outcome = await this.options.client.postFeedEntry(accessToken, {
      projectId: binding.projectId,
      bodyMd: parsed.data.bodyMd,
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    return success({
      tool: 'project_post_update',
      entryId: outcome.value.id,
      createdAt: outcome.value.createdAt,
    });
  }

  private async listFiles(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = listFilesArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    const outcome = await this.options.client.listFiles(accessToken, {
      projectId: binding.projectId,
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    const files = outcome.value.slice(0, PROJECT_TOOL_MAX_LIST_ENTRIES).map((file) => ({
      id: file.id,
      kind: file.kind,
      filename: file.filename,
      mime: file.mime,
      bytes: file.bytes,
      uploaderDisplayName: file.uploaderDisplayName,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
    }));
    return success({
      tool: 'project_list_files',
      files,
      totalFiles: outcome.value.length,
      truncated: outcome.value.length > files.length,
    });
  }

  /**
   * 读项目文件正文：经底层客户端流式落到 Main 私有临时目录（复用其 64 MiB 封顶
   * 与原子占位），读出有界 UTF-8 文本后**即删临时件**，不留副本。含 NUL 的内容
   * 判为二进制，如实报不可读，绝不把乱码喂给模型。
   */
  private async readFile(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = readFileArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    const listing = await this.options.client.listFiles(accessToken, {
      projectId: binding.projectId,
    });
    if (!binding.isCurrentContext()) {
      return failure('Project session context changed; discard this result and retry.');
    }
    if (!listing.ok) return collabFailure(listing);
    const file = listing.value.find((candidate) => candidate.id === parsed.data.fileId);
    if (!file) return failure('That project file is not available in the current project.');
    if (file.bytes > PROJECT_READ_FILE_MAX_DOWNLOAD_BYTES) {
      return failure(
        'The project file is stored successfully but exceeds the bounded document-reading download budget.',
      );
    }
    const outcome = await this.options.client.downloadFile(accessToken, {
      fileId: parsed.data.fileId,
      targetDirectory: this.options.tempDirectory(),
      maxBytes: PROJECT_READ_FILE_MAX_DOWNLOAD_BYTES,
    });
    if (!outcome.ok) {
      return binding.isCurrentContext() ? collabFailure(outcome) : contextChangedFailure();
    }
    const savedPath = outcome.value.savedPath;
    // 定位参数按文件格式收敛：不适用的键剔除并回报（ignoredSelectors），0 视为没给。
    const format = documentFormatForFileName(file.filename);
    const normalized = normalizeDocumentSelector(format, {
      page: parsed.data.page,
      slide: parsed.data.slide,
      sheet: parsed.data.sheet,
      block: parsed.data.block,
      startLine: parsed.data.startLine,
      startChar: parsed.data.startChar,
      maxLines: parsed.data.maxLines,
    });
    try {
      if (!binding.isCurrentContext()) {
        return failure('Project session context changed; discard this result and retry.');
      }
      const document = await parseLocalDocumentFile({
        filePath: savedPath,
        fileName: file.filename,
        mimeType: file.mime,
        budgets: {
          ...PROJECT_DOCUMENT_PARSE_BUDGETS,
          maxOutputChars: PROJECT_READ_FILE_MAX_OUTPUT_CHARS,
        },
        selector: normalized.selector,
      });
      if (!binding.isCurrentContext()) {
        return failure('Project session context changed; discard this result and retry.');
      }
      return success({
        tool: 'project_read_file',
        fileId: parsed.data.fileId,
        filename: file.filename,
        bytes: file.bytes,
        format: document.format,
        content: document.content,
        locatorCoverage: document.locatorCoverage,
        selectedRange: document.selectedRange,
        truncated: document.truncated,
        nextSelector: document.nextSelector,
        ...(normalized.ignored.length > 0 ? { ignoredSelectors: normalized.ignored } : {}),
      });
    } catch (error) {
      return failure(describeProjectReadFileFailure(error, format));
    } finally {
      await rm(savedPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * 受审批把**工作区里的一个文件**存进项目资产（设计方案 §4.3 的 `save_asset`）。
   *
   * 这一件此前整个缺席：助手能列资产、能读资产，就是存不进去，于是它只能如实答
   * 「我没有上传的权限」——工具面漏做被讲成了权限问题。
   *
   * 三条纪律：
   * ① **范围由 Main 收口**：路径是工作区相对的，绝对路径与 `..` 越界一律拒。
   *    这条工具能把文件发给全组，所以「发哪一个」绝不能由模型给一个任意路径。
   * ② **恒弹卡**：`projectAssetSave` 在 `gateAutoAcceptable` 里恒 false——文件进了
   *    全组共享区，别人当场下得走，删掉也收不回已经被拿走的那一份。
   * ③ **如实声明来源**：`source: 'assistant'`，与建待办同一条纪律（服务端分辨不出
   *    是谁按的键，我们如实声明，资产页据此出徽标）。
   *
   * ⚠️ 直传 `kind: 'asset'` 与人点「上传资产」是**同一条路**，不是绕开临时件配额：
   *    配额按服务端设计只判 `kind='temp'`（资产是正式沉淀，容量治理另归一处）。
   *    工具描述里已写明「存成品、别存草稿」，随手件该走临时件那条路。
   */
  private async saveAsset(
    accessToken: string,
    binding: ProjectCollabToolBinding,
    input: unknown,
    gate: ProjectCollabApprovalGate | undefined,
  ): Promise<ProjectCollabToolResponse> {
    const parsed = saveAssetArgumentsSchema.safeParse(input);
    if (!parsed.success) return invalidRequestFailure(parsed.error);
    if (!gate) return failure('Saving a project asset was not authorized.');
    const workspaceRoot = binding.workspaceRoot?.trim();
    if (!workspaceRoot) {
      return failure('This session has no workspace, so there is no file to save.');
    }
    const filePath = resolveWorkspaceFile(workspaceRoot, parsed.data.path);
    if (filePath === null) {
      return failure(
        'Parameter "path" must be a workspace-relative path inside the current workspace; ' +
          'absolute paths and paths that leave the workspace are rejected.',
      );
    }
    // 审批卡要说得出「多大的东西发给谁」，所以大小在弹卡**之前**取；顺带把
    // 「文件根本不存在」与「那是个目录」在这里如实分开说，不留给上传层的通用码。
    let bytes: number;
    try {
      const stats = await stat(filePath);
      if (!binding.isCurrentContext()) return contextChangedFailure();
      if (!stats.isFile()) {
        return failure(`Parameter "path" points to a directory, not a file: ${parsed.data.path}`);
      }
      bytes = stats.size;
    } catch {
      return failure(`No such file in the workspace: ${parsed.data.path}`);
    }
    const filename = parsed.data.filename ?? basename(filePath);
    if (filename.includes('/') || filename.includes('\\')) {
      return failure(
        'Parameter "filename" must be a plain file name with no directory separators.',
      );
    }

    const decision = await gate.requestApproval({
      kind: 'projectAssetSave',
      details: [
        { label: '操作', value: '存入项目资产（全组可见）' },
        { label: '工作区文件', value: parsed.data.path, mono: true },
        { label: '存为', value: filename, mono: true },
        { label: '大小', value: `${bytes} 字节` },
      ],
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (decision !== 'accept') return refusedFailure(decision, 'Saving a project asset');

    const outcome = await this.options.client.uploadFile(accessToken, {
      projectId: binding.projectId,
      filePath,
      kind: 'asset',
      filename,
      source: 'assistant',
    });
    if (!binding.isCurrentContext()) return contextChangedFailure();
    if (!outcome.ok) return collabFailure(outcome);
    return success({
      tool: 'project_save_asset',
      fileId: outcome.value.id,
      filename: outcome.value.filename,
      bytes: outcome.value.bytes,
      kind: outcome.value.kind,
      // 说清它现在在哪儿：模型该告诉用户去资产页拿，而不是说「已发送」。
      note: 'Saved to the project assets; every member can find it on the project assets page.',
    });
  }
}
