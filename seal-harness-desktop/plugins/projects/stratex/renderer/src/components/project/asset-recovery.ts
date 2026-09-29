import {
  isAssetVersionContentAvailable,
  type ProjectAssetCatalogueEntry,
  type ProjectAssetVersion,
  type ProjectFileAsset,
} from '@shared/protocol/project-collab-assets.js';

import { formatBytes } from './project-format';

/**
 * 资产回收站与历史版本恢复（RPT-08）的入口收窄与界面文案。
 *
 * ⛔ 这里的判定**不是权限判定**，只决定「不摆一个点了必错的入口」——真正的门在服务端
 *    （ADR-0037 决策 2）。成员与观察者照样看得见回收站与版本历史，只是没有恢复按钮。
 * 文案取自原型 `docs/prototypes/project-collaboration-v1/index.html` `:980–983`。
 */

/** 看的人在本项目里的身份切片（全部来自 store 的既有 getter / action）。 */
export interface AssetRecoveryViewer {
  readonly isOwner: boolean;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  readonly isSelf: (subject: string | null) => boolean;
}

/**
 * 回收站「恢复」入口：**本人（且仍可编辑）或拥有者**；归档项目一律只读。
 *
 * 与服务端 `restore_asset` 逐条对齐：写路径门要求编辑档 + 项目未归档，再判
 * `ensure_file_delete_permitted`（血统创建者本人或拥有者）。
 * ⛔ 管理者不在此列：负责人 2026-09-13 定「恢复与删除同权」，这是与原型
 *    `f.owner===actor||manager()` 的一处**有意偏离**。
 */
export function canRestoreTrashedAsset(
  entry: Pick<ProjectFileAsset, 'createdBySubject'>,
  viewer: AssetRecoveryViewer,
): boolean {
  if (viewer.isArchived) return false;
  return viewer.isOwner || (viewer.canWrite && viewer.isSelf(entry.createdBySubject));
}

/**
 * 某一版「恢复为新版本」入口。
 *
 * 服务端判的是：可编辑成员 + 项目未归档 + 血统未删（409 `asset_deleted`）+ 这一版字节未删
 * （409 `asset_version_content_deleted`）。这里与之同口径，再多收一条：**当前版本不给入口**
 * ——把最新一版原样复制一份不是「恢复历史版本」，只会让链上多出一版一模一样的内容。
 */
export function canRestoreAssetVersion(
  version: Pick<ProjectAssetVersion, 'id' | 'contentDeletedAt'>,
  asset: Pick<ProjectFileAsset, 'currentVersionId' | 'deletedAt'>,
  viewer: Pick<AssetRecoveryViewer, 'canWrite' | 'isArchived'>,
): boolean {
  return (
    viewer.canWrite &&
    !viewer.isArchived &&
    asset.deletedAt === null &&
    version.id !== asset.currentVersionId &&
    isAssetVersionContentAvailable(version)
  );
}

/** 血统还没有任何版本时的标题占位（服务端允许的过渡态，一个事务内即被填上）。 */
export const ASSET_NO_VERSION_TITLE = '（尚无版本）';

/** 目录 / 回收站行的标题：当前那一版的文件名。 */
export function assetEntryTitle(entry: Pick<ProjectAssetCatalogueEntry, 'currentVersion'>): string {
  return entry.currentVersion?.filename ?? ASSET_NO_VERSION_TITLE;
}

/**
 * 版本卡片的内容摘要：这一版**冻结的**文件名与大小。
 *
 * ⚠️ 原型这一行是正文前 100 字；真实资产是二进制文件，摘正文要逐版取字节解析，
 *    版本多时代价按版本数线性增长——所以这里只给登记时刻的元数据（ADR-0037 代价与限制）。
 */
export function assetVersionSummary(
  version: Pick<ProjectAssetVersion, 'filename' | 'bytes'>,
): string {
  return `${version.filename} · ${formatBytes(version.bytes)}`;
}

export const ASSET_VERSIONS_SECTION_TITLE = '资产版本';
export const ASSET_TRASH_TITLE = '资产回收站';
export const ASSET_TRASH_EMPTY = '回收站为空。';
export const ASSET_TRASH_NOTE =
  '移入回收站的资产保留全部版本；仅资产创建者本人或项目拥有者可以恢复。';
export const ASSET_VERSIONS_TITLE = '文档版本历史';
export const ASSET_VERSION_RESTORE_TITLE = '恢复历史版本';
export const ASSET_VERSION_RESTORE_TEXT = '将此历史内容复制为新的最新版，已有版本全部保留。';
export const ASSET_VERSION_RESTORE_ACTION = '恢复为新版本';
export const ASSET_VERSIONS_DELETED_HINT = '该资产已在回收站中，恢复历史版本前请先从回收站恢复。';
export const ASSET_OPEN_TRASH_ACTION = '打开回收站';
