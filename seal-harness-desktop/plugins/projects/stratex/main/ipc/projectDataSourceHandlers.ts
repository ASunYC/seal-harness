import { IPC } from '../../shared/ipc/channels.js';
import {
  PROJECT_DATA_SOURCE_REFERENCE_CODES,
  ProjectDataSourceCreateRequestSchema,
  ProjectDataSourceCreateResultSchema,
  ProjectDataSourceDeleteRequestSchema,
  ProjectDataSourceDeleteResultSchema,
  ProjectDataSourceListRequestSchema,
  ProjectDataSourceListResultSchema,
  ProjectDataSourceSyncRequestSchema,
  ProjectDataSourceSyncResultSchema,
  ProjectDataSourceTicketClearRequestSchema,
  ProjectDataSourceTicketResultSchema,
  ProjectDataSourceTicketSaveRequestSchema,
  ProjectDataSourceUpdateRequestSchema,
  ProjectDataSourceUpdateResultSchema,
  ProjectExternalLinkListRequestSchema,
  ProjectExternalLinkListResultSchema,
  type ProjectDataSourceErrorCode,
} from '../../shared/protocol/project-datasource.js';
import type { CollabDataSourceClient } from '../services/collab/collabDataSourceClient.js';
import type { ProjectDataSourceTicketScheme } from '../../shared/protocol/project-datasource.js';

/**
 * 项目组**外部数据源**（`project:data-source-*` / `project:external-link-*`）的 IPC 处理器。
 *
 * 边界纪律与 `projectCollabHandlers` 同款：鉴权 → activeAccount → 入参 strictObject
 * 校验 → 取令牌 → 调客户端 → **每次 await 后重验 accountKey + authEpoch** → 出参
 * schema 校验。
 *
 * 这一段多出来的一件事是**票据的取用**：
 *  - 渲染层递交的同步请求里结构性没有票据（协议 schema 就没有那个字段）；
 *  - 主进程按**在场账号**从本机加密库取出票据，只拼进那一次外发请求；
 *  - 出参里同样没有票据字段，只有 `ticketed` 这个布尔量。
 * 于是「票据从哪儿来、到哪儿去」在这一层是可数的：一进（用户亲手保存）、一出
 * （同步时的那一次外发），没有第三条路。
 */

/** 客户端网络面（结构性子集，测试可用对象字面量替身）。 */
export type ProjectDataSourceClientPort = Pick<
  CollabDataSourceClient,
  | 'listDataSources'
  | 'createDataSource'
  | 'updateDataSource'
  | 'deleteDataSource'
  | 'syncDataSource'
  | 'listExternalLinks'
>;

/** 票据库的结构性子集（同上，测试用替身注入）。 */
export interface ProjectDataSourceTicketPort {
  save(input: { accountKey: string; dataSourceId: string; ticket: string; scheme: ProjectDataSourceTicketScheme }): Promise<void>;
  remove(input: { accountKey: string; dataSourceId: string }): Promise<void>;
  resolve(input: { accountKey: string; dataSourceId: string }): Promise<{ ticket: string; scheme: ProjectDataSourceTicketScheme } | null>;
  listDataSourceIds(accountKey: string): Promise<readonly string[]>;
}

export interface ProjectDataSourceIpcDependencies {
  readonly client: ProjectDataSourceClientPort;
  /** 逐请求取平台 access token；null＝当前拿不到凭据。 */
  readonly accessToken: () => Promise<string | null>;
  /** 本机票据加密库；null＝本机凭据加密不可用（读仍可用，同步会明确失败）。 */
  readonly ticketStore: ProjectDataSourceTicketPort | null;
}

export interface ProjectDataSourceHandlerOptions {
  readonly dependencies?: ProjectDataSourceIpcDependencies | null;
  readonly authorize: (event: unknown) => boolean;
  readonly activeAccount: () => {
    readonly accountKey: string;
    readonly authEpoch: number;
  } | null;
}

export interface ProjectDataSourceIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
}

/**
 * 固定文案表：不回显服务端文本（错误体是不可信输入，也可能夹带内部细节）。
 *
 * ⚠️ 这张表是这条线**存在的理由之一**：白名单未开、仓库里没有任务目录、票据被外部
 * 仓库拒了——三件事用户要做的下一步完全不同，塌缩成「同步失败」等于什么都没说。
 */
const FAILURE_MESSAGES: Readonly<Record<ProjectDataSourceErrorCode, string>> = {
  unavailable: '项目组功能当前不可用。',
  authRequired: '请先登录后再配置数据源。',
  invalidRequest: '填写的内容不合法，请检查后重试。',
  forbidden: '只有项目拥有者能配置数据源。',
  rateLimited: '操作过于频繁，请稍后再试。',
  credentialRejected: '登录状态已失效，请重新登录。',
  notFound: '该数据源已不存在，请刷新后重试。',
  alreadyExists: '该仓库与分支已经接入本项目，不必重复添加。',
  sourceDisabled: '该数据源已停用，启用后才能同步。',
  noChanges: '没有需要保存的修改。',
  externalSourcesDisabled: '本部署尚未开放外部数据源，请联系管理员开放后再配置。',
  endpointNotAllowed: '该地址不在本部署允许的实例名单内，请联系管理员确认。',
  invalidEndpoint: '仓库地址不合法，请填写以 http:// 或 https:// 开头的实例地址。',
  credentialInEndpoint: '仓库地址里不能内嵌账号或令牌，访问票据请在下方单独填写。',
  documentsUnavailable: '本部署未配置文件存储，无法导入需求文档；只要任务列表可关闭文档导入。',
  ticketMissing: '还没有保存访问票据，填写后才能同步。',
  ticketRejected: '外部仓库拒绝了该访问票据（无权限或已过期），请重新填写后再同步。',
  repositoryNotFound: '找不到该仓库，或当前票据看不到它，请核对仓库标识与授权范围。',
  taskDirectoryMissing: '该仓库的目标分支上没有可导入的任务目录，请确认分支填写是否正确。',
  externalRejected: '外部仓库拒绝了本次请求，请稍后重试或核对配置。',
  externalBudgetExhausted: '本次同步的外部请求数超出上限已中止，请缩小仓库范围后重试。',
  externalUnavailable: '外部仓库暂时不可达，请稍后重试。',
  tooLarge: '内容超出大小上限。',
  ticketStoreUnavailable: '本机凭据加密当前不可用，无法保存或读取访问票据。',
  rejected: '请求被服务端拒绝。',
  transient: '网络暂时不可用，请稍后重试。',
};

function failureBody(code: ProjectDataSourceErrorCode): {
  readonly ok: false;
  readonly code: ProjectDataSourceErrorCode;
  readonly message: string;
  readonly referenceCode: string;
} {
  return {
    ok: false,
    code,
    message: FAILURE_MESSAGES[code],
    referenceCode: PROJECT_DATA_SOURCE_REFERENCE_CODES[code],
  };
}

export function registerProjectDataSourceHandlers(
  registrar: ProjectDataSourceIpcRegistrar,
  options: ProjectDataSourceHandlerOptions,
): void {
  const register = <Result>(
    channel: string,
    fail: (code: ProjectDataSourceErrorCode) => Result,
    run: (
      deps: ProjectDataSourceIpcDependencies,
      input: unknown,
      accountKey: string,
    ) => Promise<Result>,
  ): void => {
    registrar.handle(channel, async (event, input) => {
      const account = options.authorize(event) ? options.activeAccount() : null;
      if (!account) return fail('authRequired');
      const deps = options.dependencies ?? null;
      if (!deps) return fail('unavailable');
      let result: Result;
      try {
        result = await run(deps, input, account.accountKey);
      } catch {
        // 意外异常不跨 IPC 泄露（异常消息可能夹带票据片段）：一律收敛为瞬时失败。
        result = fail('transient');
      }
      const current = options.authorize(event) ? options.activeAccount() : null;
      if (
        !current ||
        current.accountKey !== account.accountKey ||
        current.authEpoch !== account.authEpoch
      ) {
        return fail('authRequired');
      }
      return result;
    });
  };

  const withToken = async <Result>(
    deps: ProjectDataSourceIpcDependencies,
    fail: (code: ProjectDataSourceErrorCode) => Result,
    action: (accessToken: string) => Promise<Result>,
  ): Promise<Result> => {
    let token: string | null;
    try {
      token = await deps.accessToken();
    } catch {
      token = null;
    }
    if (token === null) return fail('credentialRejected');
    return action(token);
  };

  const listFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_LIST, listFail, async (deps, input, accountKey) => {
    const request = ProjectDataSourceListRequestSchema.safeParse(input);
    if (!request.success) return listFail('invalidRequest');
    return withToken(deps, listFail, async (token) => {
      const outcome = await deps.client.listDataSources(token, request.data);
      if (!outcome.ok) return listFail(outcome.code);
      // 票据库读不出来不该拖垮列表：退化成「都没存过」，同步时再明确报错。
      let ticketed: readonly string[] = [];
      try {
        ticketed = (await deps.ticketStore?.listDataSourceIds(accountKey)) ?? [];
      } catch {
        ticketed = [];
      }
      const present = new Set(outcome.value.map((source) => source.id));
      return ProjectDataSourceListResultSchema.parse({
        ok: true,
        dataSources: outcome.value,
        // 只报本项目里确实存在的那几个：别把别的项目的数据源 id 顺出去。
        ticketedDataSourceIds: ticketed.filter((id) => present.has(id)),
      });
    });
  });

  const createFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceCreateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_CREATE, createFail, async (deps, input) => {
    const request = ProjectDataSourceCreateRequestSchema.safeParse(input);
    if (!request.success) return createFail('invalidRequest');
    return withToken(deps, createFail, async (token) => {
      const outcome = await deps.client.createDataSource(token, request.data);
      if (!outcome.ok) return createFail(outcome.code);
      return ProjectDataSourceCreateResultSchema.parse({ ok: true, dataSource: outcome.value });
    });
  });

  const updateFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceUpdateResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_UPDATE, updateFail, async (deps, input) => {
    const request = ProjectDataSourceUpdateRequestSchema.safeParse(input);
    if (!request.success) return updateFail('invalidRequest');
    return withToken(deps, updateFail, async (token) => {
      // `gitRef` 的「缺席 ＝ 不动」靠键在不在表达，所以整包原样递给客户端。
      const outcome = await deps.client.updateDataSource(token, request.data);
      if (!outcome.ok) return updateFail(outcome.code);
      return ProjectDataSourceUpdateResultSchema.parse({ ok: true, dataSource: outcome.value });
    });
  });

  const deleteFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceDeleteResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_DELETE, deleteFail, async (deps, input, accountKey) => {
    const request = ProjectDataSourceDeleteRequestSchema.safeParse(input);
    if (!request.success) return deleteFail('invalidRequest');
    return withToken(deps, deleteFail, async (token) => {
      const outcome = await deps.client.deleteDataSource(token, request.data);
      if (!outcome.ok) return deleteFail(outcome.code);
      // 来源断了，本机那枚票据就没有用处了——一并清掉（清不掉不改变删除结果）。
      try {
        await deps.ticketStore?.remove({ accountKey, dataSourceId: request.data.dataSourceId });
      } catch {
        /* 票据清理是尽力而为：数据源已经删掉了，不能因此谎报删除失败。 */
      }
      return ProjectDataSourceDeleteResultSchema.parse({
        ok: true,
        dataSourceId: request.data.dataSourceId,
      });
    });
  });

  const syncFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceSyncResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_SYNC, syncFail, async (deps, input, accountKey) => {
    const request = ProjectDataSourceSyncRequestSchema.safeParse(input);
    if (!request.success) return syncFail('invalidRequest');
    if (!deps.ticketStore) return syncFail('ticketStoreUnavailable');
    let ticket: Awaited<ReturnType<ProjectDataSourceTicketPort['resolve']>>;
    try {
      ticket = await deps.ticketStore.resolve({
        accountKey,
        dataSourceId: request.data.dataSourceId,
      });
    } catch {
      return syncFail('ticketStoreUnavailable');
    }
    // 「没存过票据」与「本机加密库坏了」是两回事，处置也不同：前者去填，后者去修。
    if (ticket === null) return syncFail('ticketMissing');
    return withToken(deps, syncFail, async (token) => {
      const outcome = await deps.client.syncDataSource(token, {
        projectId: request.data.projectId,
        dataSourceId: request.data.dataSourceId,
        ticket: ticket.ticket,
        ticketScheme: ticket.scheme,
      });
      if (!outcome.ok) return syncFail(outcome.code);
      return ProjectDataSourceSyncResultSchema.parse({
        ok: true,
        dataSourceId: request.data.dataSourceId,
        summary: outcome.value,
      });
    });
  });

  const linkFail = (code: ProjectDataSourceErrorCode) =>
    ProjectExternalLinkListResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_EXTERNAL_LINK_LIST, linkFail, async (deps, input) => {
    const request = ProjectExternalLinkListRequestSchema.safeParse(input);
    if (!request.success) return linkFail('invalidRequest');
    return withToken(deps, linkFail, async (token) => {
      const outcome = await deps.client.listExternalLinks(token, request.data);
      if (!outcome.ok) return linkFail(outcome.code);
      return ProjectExternalLinkListResultSchema.parse({ ok: true, links: outcome.value });
    });
  });

  /*
   * 票据存 / 撤：**不经服务端**、不需要平台令牌，只写本机加密库。
   * 出参只有 `ticketed` 布尔量——契约里根本没有能承载票据的字段。
   */
  const ticketFail = (code: ProjectDataSourceErrorCode) =>
    ProjectDataSourceTicketResultSchema.parse(failureBody(code));
  register(IPC.PROJECT_DATA_SOURCE_TICKET_SAVE, ticketFail, async (deps, input, accountKey) => {
    const request = ProjectDataSourceTicketSaveRequestSchema.safeParse(input);
    if (!request.success) return ticketFail('invalidRequest');
    if (!deps.ticketStore) return ticketFail('ticketStoreUnavailable');
    try {
      await deps.ticketStore.save({
        accountKey,
        dataSourceId: request.data.dataSourceId,
        ticket: request.data.ticket,
        scheme: request.data.scheme,
      });
    } catch {
      return ticketFail('ticketStoreUnavailable');
    }
    return ProjectDataSourceTicketResultSchema.parse({
      ok: true,
      dataSourceId: request.data.dataSourceId,
      ticketed: true,
    });
  });

  register(IPC.PROJECT_DATA_SOURCE_TICKET_CLEAR, ticketFail, async (deps, input, accountKey) => {
    const request = ProjectDataSourceTicketClearRequestSchema.safeParse(input);
    if (!request.success) return ticketFail('invalidRequest');
    if (!deps.ticketStore) return ticketFail('ticketStoreUnavailable');
    try {
      await deps.ticketStore.remove({ accountKey, dataSourceId: request.data.dataSourceId });
    } catch {
      return ticketFail('ticketStoreUnavailable');
    }
    return ProjectDataSourceTicketResultSchema.parse({
      ok: true,
      dataSourceId: request.data.dataSourceId,
      ticketed: false,
    });
  });
}
