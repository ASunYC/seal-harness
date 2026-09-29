import {
  PROJECT_DATA_SOURCE_REFERENCE_CODES,
  type ProjectDataSource,
  type ProjectDataSourceErrorCode,
  type ProjectDataSourceSyncSummary,
  type ProjectExternalLinkKind,
} from '@shared/protocol/project-datasource.js';

/**
 * 外部数据源面的用户可见措辞与派生量，集中一处。
 *
 * 与 `projectCollabErrors.ts` 同款形态（文案 + 参考编号），但**不共用那张表**：
 * 协作面把 4xx 都收进「请求被服务端拒绝」，本面正相反——「本部署没开外部数据源」
 * 「分支上没有任务目录」「票据被外部仓库拒了」三件事用户要做的下一步完全不同，
 * 塌缩成一句通用错误等于把该说的话吞了。
 */

export interface ProjectDataSourceNotice {
  readonly message: string;
  /** 参考编号（`STRX-DSRC-0xx`）；成功回执为 null。 */
  readonly referenceCode: string | null;
}

/**
 * 失败码 → 固定文案。
 *
 * ⚠️ `externalSourcesDisabled` 那一行是这条线的重点：白名单缺省为空 ⇒ 整个数据源面
 * 503，这**不是故障而是 fail-closed 的设计**，所以文案说的是「本部署尚未开放，
 * 请联系管理员」——一句可执行的下一步，不是「网络暂时不可用，请稍后重试」。
 */
export function projectDataSourceErrorText(code: ProjectDataSourceErrorCode): string {
  switch (code) {
    case 'unavailable':
      return '项目组能力未启用。';
    case 'authRequired':
      return '请先登录后再配置数据源。';
    case 'invalidRequest':
      return '填写的内容不合法，请检查后重试。';
    case 'forbidden':
      return '只有项目拥有者或管理者能配置数据源。';
    case 'rateLimited':
      return '操作过于频繁，请稍后再试。';
    case 'credentialRejected':
      return '登录状态已失效，请重新登录。';
    case 'notFound':
      return '该数据源已不存在，请刷新后重试。';
    case 'alreadyExists':
      return '该仓库与分支已经接入本项目，不必重复添加。';
    case 'sourceDisabled':
      return '该数据源已停用，启用后才能同步。';
    case 'noChanges':
      return '没有需要保存的修改。';
    case 'externalSourcesDisabled':
      return '本部署尚未开放外部数据源，请联系管理员开放后再配置。';
    case 'endpointNotAllowed':
      return '该地址不在本部署允许的实例名单内，请联系管理员确认。';
    case 'invalidEndpoint':
      return '仓库地址不合法，请填写以 http:// 或 https:// 开头的实例地址。';
    case 'credentialInEndpoint':
      return '仓库地址里不能内嵌账号或令牌，访问票据请在授权那一栏单独填写。';
    case 'documentsUnavailable':
      return '本部署未配置文件存储，无法导入需求文档；只要任务列表可关闭「同时导入需求文档」。';
    case 'ticketMissing':
      return '还没有保存访问票据，填写后才能同步。';
    case 'ticketRejected':
      return '外部仓库拒绝了该访问票据（无权限或已过期），请重新填写后再同步。';
    case 'repositoryNotFound':
      return '找不到该仓库，或当前票据看不到它，请核对仓库标识与授权范围。';
    case 'taskDirectoryMissing':
      return '该仓库的目标分支上没有可导入的任务目录，请确认分支填写是否正确。';
    case 'externalRejected':
      return '外部仓库拒绝了本次请求，请稍后重试或核对配置。';
    case 'externalBudgetExhausted':
      return '本次同步的外部请求数超出上限已中止，请缩小仓库范围后重试。';
    case 'externalUnavailable':
      return '外部仓库暂时不可达，请稍后重试。';
    case 'tooLarge':
      return '内容超出大小上限。';
    case 'ticketStoreUnavailable':
      return '本机凭据加密当前不可用，无法保存或读取访问票据。';
    case 'rejected':
      return '请求被服务端拒绝。';
    case 'transient':
    default:
      return '网络暂时不可用，请稍后重试。';
  }
}

/** 失败码 → 报错条（文案 + 参考编号）。渲染层的唯一失败展示工厂。 */
export function projectDataSourceErrorNotice(
  code: ProjectDataSourceErrorCode,
): ProjectDataSourceNotice {
  return {
    message: projectDataSourceErrorText(code),
    referenceCode: PROJECT_DATA_SOURCE_REFERENCE_CODES[code],
  };
}

/** 成功回执（无参考编号）。 */
export function projectDataSourceInfoNotice(message: string): ProjectDataSourceNotice {
  return { message, referenceCode: null };
}

/** 对账行类别的中文名（不出现内部实现词）。 */
export const EXTERNAL_LINK_KIND_LABELS: Readonly<Record<ProjectExternalLinkKind, string>> = {
  task: '需求',
  subtask: '任务',
  todoItem: '任务条目',
  document: '需求文档',
};

/** 「实例/仓库@分支」一行自述；分支为空时说清是默认分支，别留白。 */
export function describeDataSourceTarget(source: ProjectDataSource): string {
  return `${source.repoPath} @ ${source.gitRef ?? '默认分支'}`;
}

/** 上次同步的一句话结论；从没跑过与跑了失败是两句话。 */
export function describeLastSync(source: ProjectDataSource): string {
  if (source.lastSyncStatus === null || source.lastSyncedAt === null) return '尚未同步过';
  const when = formatSyncTime(source.lastSyncedAt);
  return source.lastSyncStatus === 'ok' ? `上次同步成功 · ${when}` : `上次同步失败 · ${when}`;
}

/** 同步回执的计数行。 */
export function describeSyncCounts(summary: ProjectDataSourceSyncSummary): string {
  return (
    `需求与任务 新建 ${summary.todosCreated} / 更新 ${summary.todosUpdated} / ` +
    `未变 ${summary.todosUnchanged}；文档 新建 ${summary.documentsCreated} / ` +
    `更新 ${summary.documentsUpdated} / 未变 ${summary.documentsUnchanged}；` +
    `来源失效 ${summary.orphaned}`
  );
}

/**
 * 诊断条目「还有多少条没列出来」。服务端封顶 50 条并给出总数——不说这一句，
 * 用户会以为列出来的就是全部。返回 null ＝ 没有被截断。
 */
export function describeDiagnosticsOverflow(summary: ProjectDataSourceSyncSummary): string | null {
  const hidden = summary.diagnosticsTotal - summary.diagnostics.length;
  return hidden > 0 ? `另有 ${hidden} 条未列出（本次共 ${summary.diagnosticsTotal} 条）` : null;
}

/** 时间戳 → 本地可读串；解析不了就原样显示（不谎报一个假时间）。 */
export function formatSyncTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', { hour12: false });
}
