import { z } from 'zod';

import { PROJECT_REF_TOKEN_PATTERN } from '../../../../../projects/stratex/shared/protocol/project-collab.js';
import type {
  ChatMessage,
  FeedEntry,
  ProjectDetail,
  ProjectFile,
  ProjectFileKind,
  ProjectChatHistoryRequest,
  ProjectTodoCreateRequest,
  ProjectTodoDraftCreateRequest,
  ProjectTodoDetailRequest,
  ProjectTodoSubmitReviewRequest,
  ProjectTodoUpdateRequest,
  Todo,
  TodoAcceptanceItem,
  TodoCompletionRecord,
  TodoDraftBatch,
} from '../../../../../projects/stratex/shared/protocol/project-collab.js';
import type {
  ProjectIterationListRequest,
  ProjectMilestoneListRequest,
} from '../../../../../projects/stratex/shared/protocol/project-planning.js';
import type { CollabClientOutcome, TodoPage } from '../../../../../projects/stratex/main/services/collab/collabClient.js';
import type { IterationPage, MilestonePage } from '../../../../../projects/stratex/main/services/collab/collabPlanningClient.js';
import type { ProjectPlanningDraftStaging } from './projectPlanningDraftStaging.js';

/**
 * 项目协作工具面的**契约**：绑定、工具门、结果体与底层网络端口。
 *
 * 单独成文只为一件事——让「结果与失败文案」那一层（`projectCollabToolResults.ts`）
 * 能引用它而不必反向依赖执行器。三者是单向的：契约 ← 结果构造 ← 执行器。
 */

export const PROJECT_COLLAB_TOOL_NAMESPACE = 'stratex_project' as const;
export const PROJECT_COLLAB_TOOL_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * 会话 → 项目组绑定（装配层 `resolveProjectBinding` 的产物）。
 * `accessTokenProvider` 逐调用取新令牌：登出/过期即拒，旧令牌零复用。
 */
export interface ProjectCollabToolBinding {
  readonly projectId: string;
  /**
   * 本会话的编号。**由装配层给出，不是模型填的**——它是「这张单在哪儿执行」的
   * 唯一事实来源，模型填的只能是它猜的。派给助理的单开工（转「进行中」）时由
   * 执行器写进 `sessionRef`，卡片上的「查看执行」据此点回本会话。
   * 缺省/空串 ＝ 会话编号暂不可得 ⇒ 不写关联（不假造一个）。
   */
  readonly sessionId?: string;
  /**
   * 本会话的工作区根（装配层的 `cwd`，Main 解析、模型给不了）。
   * `project_save_asset` 的相对路径以它为基准，越界即拒；缺省 ⇒ 本会话没有工作区，
   * 存资产整条能力不可用（如实说，不冒充成功）。
   */
  readonly workspaceRoot?: string;
  /**
   * 本会话所属账号（装配层的事实，模型给不了）。规划草案按「账号×会话」暂存，
   * 缺省 ⇒ 两件草案工具失败闭合（读工具与其余写工具照常）。
   */
  readonly accountKey?: string;
  readonly accessTokenProvider: () => Promise<string | null>;
  /** 账号或项目 epoch 改变后立即失效；异步结果写回前必须复检。 */
  readonly isCurrentContext: () => boolean;
}

/** 工具门句柄（调用侧注入）；缺失即无法授权，写域一律拒绝。 */
export interface ProjectCollabApprovalGate {
  /**
   * 本轮是否可写（执行档；项目会话恒为工作区会话）。只有规划草案工具读它：本轮可写就直接暂存、不弹卡；
   * 不可写（只出方案档）就走与拆解草案同一道 `requestApproval`，由档位拒绝收口。缺省按不可写处理。
   */
  readonly writeAccess?: boolean;
  requestApproval(input: {
    readonly kind: 'projectTodoWrite' | 'projectFeedPost' | 'projectAssetSave';
    /** 审批对象明细：label 固定文案、value 数据，永不拼句（D3.24）。 */
    readonly details?: readonly { label: string; value: string; mono?: boolean }[];
  }): Promise<'accept' | 'decline' | 'cancel' | 'timeout' | 'declinedByMode'>;
}

export interface ProjectCollabToolResponse {
  readonly contentItems: readonly [{ readonly type: 'inputText'; readonly text: string }];
  readonly success: boolean;
}

/** 底层网络面（CollabClient 的结构子集；令牌首参、单次尝试、outcome 分档）。 */
export interface ProjectCollabToolClientPort {
  listChatHistory(
    accessToken: string,
    input: ProjectChatHistoryRequest,
  ): Promise<CollabClientOutcome<readonly ChatMessage[]>>;
  readProjectDetail(
    accessToken: string,
    input: { readonly projectId: string },
  ): Promise<CollabClientOutcome<ProjectDetail>>;
  uploadFile(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly filePath: string;
      readonly kind: ProjectFileKind;
      readonly filename?: string;
      readonly source?: 'manual' | 'assistant';
    },
  ): Promise<CollabClientOutcome<ProjectFile>>;
  listTodos(
    accessToken: string,
    input: { readonly projectId: string; readonly cursor?: string; readonly limit?: number },
  ): Promise<CollabClientOutcome<TodoPage>>;
  createTodo(
    accessToken: string,
    input: ProjectTodoCreateRequest,
  ): Promise<CollabClientOutcome<Todo>>;
  updateTodo(
    accessToken: string,
    input: ProjectTodoUpdateRequest,
  ): Promise<CollabClientOutcome<Todo>>;
  getTodoDetail(
    accessToken: string,
    input: ProjectTodoDetailRequest,
  ): Promise<
    CollabClientOutcome<{
      readonly todo: Todo;
      readonly acceptanceItems: readonly TodoAcceptanceItem[];
      readonly completionRecords: readonly TodoCompletionRecord[];
    }>
  >;
  createDraftBatch(
    accessToken: string,
    input: ProjectTodoDraftCreateRequest,
  ): Promise<CollabClientOutcome<TodoDraftBatch>>;
  submitTodoReview(
    accessToken: string,
    input: ProjectTodoSubmitReviewRequest,
  ): Promise<
    CollabClientOutcome<{
      readonly todo: Todo;
      readonly completionRecord: TodoCompletionRecord | null;
    }>
  >;
  postFeedEntry(
    accessToken: string,
    input: { readonly projectId: string; readonly bodyMd: string },
  ): Promise<CollabClientOutcome<FeedEntry>>;
  listFiles(
    accessToken: string,
    input: { readonly projectId: string; readonly kind?: ProjectFileKind | undefined },
  ): Promise<CollabClientOutcome<readonly ProjectFile[]>>;
  downloadFile(
    accessToken: string,
    input: {
      readonly fileId: string;
      readonly targetDirectory: string;
      readonly maxBytes?: number;
    },
  ): Promise<CollabClientOutcome<{ readonly savedPath: string }>>;
}

/**
 * 规划面的读端口（`CollabPlanningClient` 的结构子集）。
 *
 * ⛔ **只有两个读方法**：项目工具面拿不到任何规划写方法（类型上由本接口，运行时由装配处的
 *    `narrowProjectPlanningToolPorts` 收窄）。里程碑与迭代计划只能由人在审阅弹层
 *    或里程碑页经 `project:milestone-create` / `project:iteration-create` 新建（ADR-0045）。
 */
export interface ProjectCollabPlanningToolPort {
  listMilestones(
    accessToken: string,
    input: ProjectMilestoneListRequest,
  ): Promise<CollabClientOutcome<MilestonePage>>;
  listIterations(
    accessToken: string,
    input: ProjectIterationListRequest,
  ): Promise<CollabClientOutcome<IterationPage>>;
}

/** 规划草案暂存口：工具面只能**放进去**，读与清除归 IPC 层。 */
export type ProjectPlanningDraftStagingPort = Pick<ProjectPlanningDraftStaging, 'stage'>;

/** 交给项目协作工具执行器的两件规划端口。 */
export interface ProjectPlanningToolPorts {
  readonly planning: ProjectCollabPlanningToolPort;
  readonly planningDrafts: ProjectPlanningDraftStagingPort;
}

/**
 * 装配处把规划客户端与暂存区交给执行器之前的**运行时**收窄（ADR-0045 决策 3）。
 *
 * 装配层手里的是完整的 `CollabPlanningClient`（带新建、改、达成、排期等写方法，IPC 手工新建那条要用）
 * 与完整的暂存实例（带读取、清除、清空，IPC 读草案那两条要用）。原样递给执行器的话，「端口没有写方法」
 * 只剩 TS 类型在管，绕过类型就够得到。这里只转发两个读方法与 `stage`，并冻结：
 * - 经原对象调用而不是摘下方法引用——两者的方法都依赖 `this`；
 * - 返回的是普通对象，原型上没有客户端或暂存区的任何方法。
 */
export function narrowProjectPlanningToolPorts(
  client: ProjectCollabPlanningToolPort,
  staging: ProjectPlanningDraftStagingPort,
): ProjectPlanningToolPorts {
  const planning: ProjectCollabPlanningToolPort = {
    listMilestones: (accessToken, input) => client.listMilestones(accessToken, input),
    listIterations: (accessToken, input) => client.listIterations(accessToken, input),
  };
  const planningDrafts: ProjectPlanningDraftStagingPort = {
    stage: (owner, content) => staging.stage(owner, content),
  };
  return { planning: Object.freeze(planning), planningDrafts: Object.freeze(planningDrafts) };
}

/** 会话编号的形状门（与协议侧引用 token 同一条正则）：装配层给的值也复检一次。 */
const projectRefTokenSchema = z.string().regex(PROJECT_REF_TOKEN_PATTERN);

/**
 * 未知输入 → 绑定。契约自带的形状门：解析不出 ⇒ null ⇒ 调用侧失败闭合。
 */
export function parseProjectCollabToolBinding(input: unknown): ProjectCollabToolBinding | null {
  if (typeof input !== 'object' || input === null) return null;
  const candidate = input as {
    projectId?: unknown;
    sessionId?: unknown;
    workspaceRoot?: unknown;
    accountKey?: unknown;
    accessTokenProvider?: unknown;
    isCurrentContext?: unknown;
  };
  const projectId = z.string().uuid().safeParse(candidate.projectId);
  if (
    !projectId.success ||
    typeof candidate.accessTokenProvider !== 'function' ||
    typeof candidate.isCurrentContext !== 'function'
  )
    return null;
  // 工作区根同样「有就用、没有就当没有」：它只决定存资产这一件能不能用，
  // ⛔ 不因缺席把整组工具废掉（读写待办与「能不能存文件」是两件事）。
  const workspaceRoot =
    typeof candidate.workspaceRoot === 'string' && candidate.workspaceRoot.trim()
      ? candidate.workspaceRoot
      : undefined;
  // 会话编号不合形状 ⇒ 当没有（不写关联），⛔ 不因此拒掉整组工具：
  // 读写待办与「点得回执行现场」是两件事，后者缺席不该把前者一起废掉。
  const sessionId = projectRefTokenSchema.safeParse(candidate.sessionId);
  // 账号同理：只决定规划草案这一件能不能暂存，缺席不废整组工具。
  const accountKey =
    typeof candidate.accountKey === 'string' && candidate.accountKey.trim()
      ? candidate.accountKey
      : undefined;
  return {
    projectId: projectId.data,
    ...(sessionId.success ? { sessionId: sessionId.data } : {}),
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
    ...(accountKey !== undefined ? { accountKey } : {}),
    accessTokenProvider: candidate.accessTokenProvider as () => Promise<string | null>,
    isCurrentContext: candidate.isCurrentContext as () => boolean,
  };
}
