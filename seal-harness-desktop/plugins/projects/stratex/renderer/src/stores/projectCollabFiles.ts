import type { ProjectFileKind } from '@shared/protocol/project-collab.js';

import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  projectFileQuotaNotice,
} from './projectCollabErrors';
import { pushProjectCollabReceipt } from './projectCollabReceipts';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { formatBytes } from '../components/project/project-format';
import { projectCollabApi } from '../sdk/projectCollab';

/** 资产域动作（列表/上传/转存/删除/下载）。域文件形态见 `projectCollabFeed.ts` 注释。 */
export type ProjectFilesHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    | 'files'
    | 'filesLoading'
    | 'filesError'
    | 'fileActionBusy'
    | 'fileUpload'
    | 'fileUploadOperationId'
  >;

export async function loadFiles(host: ProjectFilesHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  host.filesLoading = true;
  try {
    const result = await projectCollabApi.fileList({ projectId });
    if (epoch !== host.projectEpoch) return;
    if (!result.ok) {
      host.filesError = projectCollabErrorNotice(result.code);
      return;
    }
    host.files = result.files;
    host.filesError = null;
  } catch {
    if (epoch === host.projectEpoch) host.filesError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.filesLoading = false;
  }
}

/**
 * 上传：主进程自己弹文件选择框并读盘直发；这里只递交
 * `{projectId, kind, operationId}` 意图，路径永不跨 IPC。
 * 三分支结果：完成→重列并回执；用户取消→静默收起（不是错误）；失败→固定文案。
 *
 * ⚠️ 项目文件配额触顶是**独立一档**：回执要说出上限与已用量（`projectFileQuotaNotice`），
 * 而不是掉进「上传失败」那句通用话里——两者指向的下一步动作完全不同。
 * 触顶只挡这一次上传，已有文件与其它功能一格没动（服务端事务里就是这样）。
 */
export async function uploadFile(
  host: ProjectFilesHost,
  projectId: string,
  kind: ProjectFileKind,
): Promise<boolean> {
  if (host.fileActionBusy) return false;
  const epoch = host.projectEpoch;
  const operationId = globalThis.crypto.randomUUID();
  host.fileActionBusy = true;
  host.fileUploadOperationId = operationId;
  const unsubscribe = projectCollabApi.onFileUploadProgress((progress) => {
    if (epoch !== host.projectEpoch || progress.operationId !== operationId) return;
    host.fileUpload = progress;
  });
  try {
    const result = await projectCollabApi.fileUpload({ projectId, kind, operationId });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice =
        result.code === 'quotaExceeded'
          ? projectFileQuotaNotice(result.quota, formatBytes)
          : projectCollabErrorNotice(result.code);
      return false;
    }
    if ('cancelled' in result) return false;
    await loadFiles(host, projectId);
    // 没踢球：文件已经在列表里了，用户接下来做什么与这句话无关 ⇒ toast。
    pushProjectCollabReceipt(`已上传「${result.file.filename}」。`);
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  } finally {
    unsubscribe();
    if (epoch === host.projectEpoch) {
      host.fileActionBusy = false;
      host.fileUpload = null;
      host.fileUploadOperationId = null;
    }
  }
}

export async function cancelUpload(host: ProjectFilesHost): Promise<void> {
  const operationId = host.fileUploadOperationId;
  if (!operationId) return;
  await projectCollabApi.fileUploadCancel(operationId).catch(() => undefined);
}

export async function promoteFile(host: ProjectFilesHost, fileId: string): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.filePromote({ fileId });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return false;
    }
    host.files = host.files.map((file) => (file.id === fileId ? result.file : file));
    // 没踢球：那一行的类型徽标当场变成「资产」，回执只是复述一遍 ⇒ toast。
    pushProjectCollabReceipt(`「${result.file.filename}」已转存为资产。`);
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

export async function deleteFile(host: ProjectFilesHost, fileId: string): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.fileDelete({ fileId });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return false;
    }
    host.files = host.files.filter((file) => file.id !== fileId);
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/**
 * 下载。**成功回执留在常驻条**（⛔ 不走 toast）。
 *
 * 判据仍是那一条「有没有把球踢回给用户」——这一条踢了：落盘路径是**要被读、被选中
 * 复制**的一串字，用户接下来要拿它去资源管理器里找那个文件。3 秒自灭的 toast 在他
 * 把眼睛移过去之前就没了，而下载这件事没有第二处能再问出路径。
 */
export async function downloadFile(host: ProjectFilesHost, fileId: string): Promise<void> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.fileDownload({ fileId });
    if (epoch !== host.projectEpoch) return;
    host.actionNotice = result.ok
      ? projectCollabInfoNotice(`已交给浏览器下载：${result.savedPath}`)
      : projectCollabErrorNotice(result.code);
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
  }
}
