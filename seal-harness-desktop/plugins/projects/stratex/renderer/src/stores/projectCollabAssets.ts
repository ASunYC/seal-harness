import {
  projectAssetRecoveryErrorText,
  type ProjectAssetRecoveryOperation,
} from '@shared/protocol/project-collab-assets.js';
import type { ProjectCollabErrorCode, ProjectFileQuota } from '@shared/protocol/project-collab.js';

import { projectCollabErrorNotice, type ProjectCollabNotice } from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { formatBytes } from '../components/project/project-format';
import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 资产版本域的渲染层动作（RPT-08）：目录 / 回收站 / 版本链的取数，回收站恢复，
 * 历史版本恢复为新版本，以及 `file.changed` 到达后的重取。契约见 ADR-0037。
 *
 * 判据全部落在这里：
 *  - **目录与回收站互补不重叠**：两边各取各的服务端列表（服务端是同一句谓词的正反面），
 *    任何一次恢复之后**两边一起**按服务端重取——⛔ 不在本地把一行从回收站「搬」进目录；
 *  - **不假成功**：恢复的失败一律带回报错条（文案按业务码取共享层那张表 + 参考编号），
 *    成功才推回执；
 *  - **旧版本全部保留且内容不变**：历史版本恢复成功后只重取版本链（服务端 append-only），
 *    ⛔ 本地不拼新版本行、不改旧行；
 *  - **事件按类型重取、不读负载**：`refetchAssetsForFileChange` 的签名里没有负载参数。
 *
 * ⚠️ 与 `projectCollabFiles`（旧文件列表）是两套模型，本模块一个 `files` 字段都不碰
 *    （ADR-0037 决策 8）。
 */
export type ProjectAssetsHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    | 'assets'
    | 'assetsLoaded'
    | 'assetsLoading'
    | 'assetsError'
    | 'assetsRequestId'
    | 'assetTrash'
    | 'assetTrashLoaded'
    | 'assetTrashLoading'
    | 'assetTrashError'
    | 'assetTrashRequestId'
    | 'assetVersionTarget'
    | 'assetVersionChain'
    | 'assetVersionChainLoading'
    | 'assetVersionChainError'
    | 'assetVersionChainRequestId'
  >;

/** 原型 `:981` / `:983` 的两句成功回执（没踢球：列表当场就变了 ⇒ toast）。 */
export const ASSET_RESTORED_RECEIPT = '资产已恢复。';
export const ASSET_VERSION_RESTORED_RECEIPT = '已恢复为新的版本。';

/**
 * 一次恢复的结果。
 *
 * `notice === null` 只有一种来路：请求在途时切了项目（或换了号），结果已作废——
 * 调用方不必再提示任何东西（弹层随切项目收起）。⛔ 它不是成功。
 */
export type AssetRecoveryOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly notice: ProjectCollabNotice | null;
      /** 服务端业务码（如 `asset_deleted`）；弹层据此决定要不要给「打开回收站」。 */
      readonly serverCode: string | null;
    };

const STALE_OUTCOME: AssetRecoveryOutcome = { ok: false, notice: null, serverCode: null };

interface RecoveryFailure {
  readonly code: ProjectCollabErrorCode;
  readonly serverCode?: string | undefined;
  readonly quota?: ProjectFileQuota | null | undefined;
}

/**
 * 失败 → 报错条。配额已满且拿得到两个数时说出上限与已用量（与上传触顶同一种说法的
 * 形态）；其余按「动作 × 业务码」取共享层文案，认不出退回按 `code` 的通用句。
 * 参考编号始终取 `code` 那一格——说法是给人看的，编号是给排查用的。
 */
function recoveryFailure(
  operation: ProjectAssetRecoveryOperation,
  failure: RecoveryFailure,
): AssetRecoveryOutcome {
  const serverCode = failure.serverCode ?? null;
  const quota = failure.quota ?? null;
  const message =
    failure.code === 'quotaExceeded' && quota !== null
      ? `项目存储已达容量上限（上限 ${formatBytes(quota.limitBytes)}，` +
        `已用 ${formatBytes(quota.usedBytes)}），无法恢复为新版本。请先清理不再需要的文件。`
      : (projectAssetRecoveryErrorText(operation, serverCode) ?? undefined);
  return { ok: false, notice: projectCollabErrorNotice(failure.code, message), serverCode };
}

/* ── 取数：目录 / 回收站 / 版本链 ─────────────────────────────────────────── */

/**
 * 资产目录（只含未删血统）。`projectEpoch` + 请求序号双守：切项目后迟到的响应、同项目
 * 乱序的重取都不落地。⛔ 失败不清已有列表（保留旧内容 + 报错条）。
 */
export async function loadAssets(host: ProjectAssetsHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.assetsRequestId + 1;
  host.assetsRequestId = requestId;
  const stale = (): boolean => epoch !== host.projectEpoch || requestId !== host.assetsRequestId;
  host.assetsLoading = true;
  try {
    const result = await projectCollabApi.assetList({ projectId });
    if (stale()) return;
    if (!result.ok) {
      host.assetsError = projectCollabErrorNotice(result.code);
      return;
    }
    host.assets = result.assets;
    host.assetsLoaded = true;
    host.assetsError = null;
  } catch {
    if (!stale()) host.assetsError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.assetsLoading = false;
  }
}

/** 资产回收站（只含已删血统，最近删的在前）。守卫与失败处理同目录。 */
export async function loadAssetTrash(host: ProjectAssetsHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const requestId = host.assetTrashRequestId + 1;
  host.assetTrashRequestId = requestId;
  const stale = (): boolean =>
    epoch !== host.projectEpoch || requestId !== host.assetTrashRequestId;
  host.assetTrashLoading = true;
  try {
    const result = await projectCollabApi.assetTrashList({ projectId });
    if (stale()) return;
    if (!result.ok) {
      host.assetTrashError = projectCollabErrorNotice(result.code);
      return;
    }
    host.assetTrash = result.assets;
    host.assetTrashLoaded = true;
    host.assetTrashError = null;
  } catch {
    if (!stale()) host.assetTrashError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.assetTrashLoading = false;
  }
}

/**
 * 重取当前打开的那条版本链（`assetVersionTarget`；未打开则什么都不做）。
 *
 * 多一道守：响应回来时弹层已换成另一条血统或已关掉 ⇒ 不落地（不串到另一条链上）。
 */
export async function loadAssetVersionChain(
  host: ProjectAssetsHost,
  projectId: string,
): Promise<void> {
  const assetId = host.assetVersionTarget;
  if (assetId === null) return;
  const epoch = host.projectEpoch;
  const requestId = host.assetVersionChainRequestId + 1;
  host.assetVersionChainRequestId = requestId;
  const stale = (): boolean =>
    epoch !== host.projectEpoch ||
    requestId !== host.assetVersionChainRequestId ||
    host.assetVersionTarget !== assetId;
  host.assetVersionChainLoading = true;
  try {
    const result = await projectCollabApi.assetVersionList({ projectId, assetId });
    if (stale()) return;
    if (!result.ok) {
      host.assetVersionChainError = projectCollabErrorNotice(result.code);
      return;
    }
    // 服务端定序（新版在前），⛔ 不重排。已删血统照旧回整条链，`asset.deletedAt` 就是明确反馈。
    host.assetVersionChain = { asset: result.asset, versions: result.versions };
    host.assetVersionChainError = null;
  } catch {
    if (!stale()) host.assetVersionChainError = projectCollabErrorNotice('transient');
  } finally {
    if (!stale()) host.assetVersionChainLoading = false;
  }
}

/** 打开某条血统的版本历史：换了一条就先清空旧链（⛔ 不让上一条的版本闪在新弹层里）。 */
export async function openAssetVersions(
  host: ProjectAssetsHost,
  projectId: string,
  assetId: string,
): Promise<void> {
  if (host.assetVersionTarget !== assetId) {
    host.assetVersionTarget = assetId;
    host.assetVersionChain = null;
    host.assetVersionChainError = null;
  }
  await loadAssetVersionChain(host, projectId);
}

/** 关掉版本历史：清空并作废在途请求（关掉之后迟到的链不落地，事件也不再重取它）。 */
export function closeAssetVersions(host: ProjectAssetsHost): void {
  host.assetVersionTarget = null;
  host.assetVersionChain = null;
  host.assetVersionChainError = null;
  host.assetVersionChainLoading = false;
  host.assetVersionChainRequestId += 1;
}

async function reloadCatalogueAndTrash(host: ProjectAssetsHost, projectId: string): Promise<void> {
  await Promise.all([loadAssets(host, projectId), loadAssetTrash(host, projectId)]);
}

/* ── 回收站恢复 ──────────────────────────────────────────────────────────── */

/**
 * 把一条已删血统从回收站恢复回目录（本人或拥有者，服务端强判）。
 *
 * ⭐ 成功后目录与回收站**一起**按服务端重取：只刷回收站 ⇒ 这一条从回收站消失却没回到
 *    目录，两侧就串了（判据「恢复后回到目录、回收站不再列出」的载体）。
 * 404 `asset_not_found` ⇒ 这一条已经不在回收站里（别人先恢复了、或已看不见），同样两侧
 * 重取，别让回收站继续摆着一条恢复不了的行。
 */
export async function restoreAsset(
  host: ProjectAssetsHost,
  projectId: string,
  assetId: string,
): Promise<AssetRecoveryOutcome> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.assetRestore({ projectId, assetId });
    if (epoch !== host.projectEpoch) return STALE_OUTCOME;
    if (!result.ok) {
      if (result.serverCode === 'asset_not_found') await reloadCatalogueAndTrash(host, projectId);
      return recoveryFailure('restoreAsset', result);
    }
    await reloadCatalogueAndTrash(host, projectId);
    pushProjectCollabReceipt(ASSET_RESTORED_RECEIPT);
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch
      ? recoveryFailure('restoreAsset', { code: 'transient' })
      : STALE_OUTCOME;
  }
}

/* ── 历史版本恢复为新版本 ────────────────────────────────────────────────── */

/**
 * 把一个历史版本恢复成链上新的一版（可编辑成员，服务端强判）。
 *
 * ⭐ 成功后重取**版本链与目录**：新的一版出现在链的最上面、目录行的当前版本随之换成它，
 *    旧版本行一字不改（服务端 append-only）。⛔ 本地不拼新行——拼出来的那一行没有服务端
 *    给的 id、序号与指纹，再下一次恢复就对不上了。
 * 失败后按业务码重取受影响的列表，让屏上状态与服务端一致：
 *  - `asset_deleted`：弹层打开之后血统被移进了回收站 ⇒ 链（带回 deletedAt）、目录、回收站三处；
 *  - `asset_version_not_found` / `asset_version_content_deleted` ⇒ 只重取版本链。
 */
export async function restoreAssetVersion(
  host: ProjectAssetsHost,
  projectId: string,
  versionId: string,
): Promise<AssetRecoveryOutcome> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.assetVersionRestore({ projectId, versionId });
    if (epoch !== host.projectEpoch) return STALE_OUTCOME;
    if (!result.ok) {
      await reloadAfterVersionRestoreFailure(host, projectId, result.serverCode);
      return recoveryFailure('restoreVersion', result);
    }
    await Promise.all([loadAssetVersionChain(host, projectId), loadAssets(host, projectId)]);
    pushProjectCollabReceipt(ASSET_VERSION_RESTORED_RECEIPT);
    return { ok: true };
  } catch {
    return epoch === host.projectEpoch
      ? recoveryFailure('restoreVersion', { code: 'transient' })
      : STALE_OUTCOME;
  }
}

async function reloadAfterVersionRestoreFailure(
  host: ProjectAssetsHost,
  projectId: string,
  serverCode: string | undefined,
): Promise<void> {
  switch (serverCode) {
    case 'asset_deleted':
      await Promise.all([
        loadAssetVersionChain(host, projectId),
        reloadCatalogueAndTrash(host, projectId),
      ]);
      return;
    case 'asset_version_not_found':
    case 'asset_version_content_deleted':
      await loadAssetVersionChain(host, projectId);
      return;
    default:
      return;
  }
}

/* ── 事件 ────────────────────────────────────────────────────────────────── */

/**
 * `file.changed` 到达后资产版本这一侧的重取：**按事件类型**决定重取什么，⛔ 不读负载。
 *
 * 签名里刻意没有负载参数：负载只有 id 与枚举、而且是不透明透传，权威数据只认 REST 回的
 * 那一份——拿负载里的枚举去筛「这次是不是资产变化」，一旦服务端哪天多发一种原因就会漏刷。
 * 只刷本项目里已经取过的部分：没打开过资产页的人不必为一次上传多发三个请求。
 * ⚠️ 服务端的回收站删除 / 恢复**不发事件**（ADR-0037 代价与限制），别人恢复之后要到下次
 *    进页签或下一条 `file.changed` 才对齐。
 */
export async function refetchAssetsForFileChange(
  host: ProjectAssetsHost,
  projectId: string,
): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  if (host.assetsLoaded || host.assetsError !== null) tasks.push(loadAssets(host, projectId));
  if (host.assetTrashLoaded || host.assetTrashError !== null) {
    tasks.push(loadAssetTrash(host, projectId));
  }
  if (host.assetVersionTarget !== null) tasks.push(loadAssetVersionChain(host, projectId));
  await Promise.all(tasks);
}
