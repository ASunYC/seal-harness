import { ref, type Ref } from 'vue';

import type {
  ProjectLinkedDirectoriesResult,
  ProjectLinkedDirectory,
  ProjectLinkedDirectoryError,
} from '@shared/protocol/project-workspace.js';

/**
 * 关联（只读）目录的渲染层状态与反馈映射（CTX-06）。
 *
 * 这里是 UI 自持的清单态 + 结构化码 → 明确反馈文案的翻译层。数据由注入的 `client`
 * 提供；⚠️ 生产侧 client（SDK→IPC→Main 真选择/持久化/读工具）在 **CTX-07** 接线，
 * 本包用假 client 做单测。⛔ 离线反馈**不复用**工作树兜底文案，用结构化码分型出专属文案。
 */
export interface DirectoryNotice {
  readonly tone: 'info' | 'warn' | 'error';
  readonly text: string;
}

export type LinkedDirectoryAction = 'refresh' | 'add' | 'remove' | 'rename';

export interface ProjectLinkedDirectoryClient {
  list(collabProjectId: string): Promise<ProjectLinkedDirectoriesResult>;
  add(collabProjectId: string): Promise<ProjectLinkedDirectoriesResult>;
  remove(collabProjectId: string, refId: string): Promise<ProjectLinkedDirectoriesResult>;
  rename(
    collabProjectId: string,
    refId: string,
    displayName: string,
  ): Promise<ProjectLinkedDirectoriesResult>;
}

const GENERIC_ERROR: DirectoryNotice = { tone: 'error', text: '操作未完成，请稍后重试。' };

function errorNotice(error: ProjectLinkedDirectoryError): DirectoryNotice | null {
  // W5：7 个结构化码各有可区分文案——⛔ 不再把四个码塌缩成同一句兜底，
  // 让现场红条自己说清是哪类问题（下一次能定因）。default 只兜真正未知的码。
  switch (error.code) {
    // 取消：不改绑定/清单，也不该报错——静默即可。
    case 'selectionCancelled':
      return null;
    case 'duplicate':
      return { tone: 'warn', text: '该目录已在关联列表中（或与工作目录重名）。' };
    // ⛔ 结构化离线文案：与工作树的 “Workspace content is temporarily unavailable.” 无关。
    case 'offline':
      return { tone: 'warn', text: '该目录当前不可访问（可能已移动、删除或离线）。' };
    // 同一码可能来自「主进程当前项目/绑定游标已移走」（重开面板即可复位）或「账号真的换了/登出」
    // （才需重新登录）——⛔ 不写死「请重新登录」误导用户白跑一趟：先给能自愈的动作，再兜真失效。
    case 'authentication':
      return {
        tone: 'error',
        text: '无法确认当前的访问权限，请关闭后重新打开再试；如果仍无法管理，请重新登录。',
      };
    case 'invalidInput':
      return { tone: 'error', text: '该目录不能作为关联目录（路径不合法，或数量已达上限）。' };
    case 'unavailable':
      return { tone: 'error', text: '暂时无法读取关联目录，请稍后重试。' };
    case 'persistenceUnavailable':
      return { tone: 'error', text: '关联目录未能保存到本地，请检查磁盘空间后重试。' };
    default:
      return GENERIC_ERROR;
  }
}

/**
 * 把一次操作结果翻译成明确反馈。成功态里：refresh 静默、add/remove 各出一句确认。
 */
export function linkedDirectoryNotice(
  action: LinkedDirectoryAction,
  result: ProjectLinkedDirectoriesResult,
): DirectoryNotice | null {
  if (!result.ok) return errorNotice(result.error);
  switch (action) {
    case 'add':
      return { tone: 'info', text: '已添加只读关联目录。' };
    case 'remove':
      // 「移除引用不删除磁盘文件」——反馈里把这层语义说清楚。
      return { tone: 'info', text: '已移除引用，磁盘上的文件保留。' };
    case 'rename':
      return { tone: 'info', text: '已更新关联目录名称。' };
    default:
      return null;
  }
}

export interface ProjectLinkedDirectoriesController {
  readonly directories: Ref<ProjectLinkedDirectory[]>;
  readonly notice: Ref<DirectoryNotice | null>;
  readonly busy: Ref<boolean>;
  refresh(): Promise<void>;
  add(): Promise<void>;
  remove(refId: string): Promise<void>;
  rename(refId: string, displayName: string): Promise<void>;
  clearNotice(): void;
}

export function useProjectLinkedDirectories(options: {
  readonly client: ProjectLinkedDirectoryClient;
  readonly collabProjectId: () => string;
}): ProjectLinkedDirectoriesController {
  const directories = ref<ProjectLinkedDirectory[]>([]);
  const notice = ref<DirectoryNotice | null>(null);
  const busy = ref(false);

  async function run(
    action: LinkedDirectoryAction,
    operation: (projectId: string) => Promise<ProjectLinkedDirectoriesResult>,
  ): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      const result = await operation(options.collabProjectId());
      notice.value = linkedDirectoryNotice(action, result);
      // ⛔ 只有成功才更新展示：失败/取消一律不动已显示的清单。
      if (result.ok) directories.value = [...result.directories];
    } catch {
      notice.value = GENERIC_ERROR;
    } finally {
      busy.value = false;
    }
  }

  return {
    directories,
    notice,
    busy,
    refresh: () => run('refresh', (id) => options.client.list(id)),
    add: () => run('add', (id) => options.client.add(id)),
    remove: (refId: string) => run('remove', (id) => options.client.remove(id, refId)),
    rename: (refId: string, displayName: string) =>
      run('rename', (id) => options.client.rename(id, refId, displayName)),
    clearNotice: () => {
      notice.value = null;
    },
  };
}
