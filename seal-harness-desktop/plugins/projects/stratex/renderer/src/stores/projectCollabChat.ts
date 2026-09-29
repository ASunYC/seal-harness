import type { ChatMessage, ProjectChatSendRequest } from '@shared/protocol/project-collab.js';
import { reactive } from 'vue';

import { PROJECT_CHAT_PAGE_SIZE, projectCollabErrorNotice } from './projectCollabErrors';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 讨论域动作（历史/翻页/发送/撤回/读游标）。域文件形态见 `projectCollabFeed.ts` 注释。
 *
 * 本域要够着两个非本域的东西：`projects`（未读数是分割线落点的唯一来源）与
 * `loadProjects`（游标推进后刷新列表投影）——都在 host 里显式列出，不藏在 `this` 后面。
 */
export type ProjectChatHost = ProjectDomainHost &
  Pick<
    ProjectCollabState,
    'chatMessages' | 'chatLoading' | 'chatError' | 'chatHasMore' | 'chatUnreadFromSeq' | 'projects'
  > & {
    loadProjects(): Promise<void>;
  };

/** 服务端按 seq 倒序返回一页；本域一律以升序存放。 */
function ascending(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.seq - b.seq);
}

function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!messages.get(message.id)?.revoked) messages.set(message.id, message);
  }
  return ascending([...messages.values()]);
}

const refreshRequests = new WeakMap<ProjectChatHost, object>();
const MAX_CATCH_UP_PAGES = 20;

interface ChatCoverage {
  epoch: number;
  frontier: number | undefined;
  pending: boolean;
}

const chatCoverage = new WeakMap<ProjectChatHost, ChatCoverage>();

/** 发送已确认不代表历史追平；只读取当前上下文，不为旧上下文创建覆盖状态。 */
export function hasPendingChatHistory(host: ProjectChatHost): boolean {
  const epoch = host.projectEpoch;
  const hasMessages = host.chatMessages.length > 0;
  const coverage = chatCoverage.get(host);
  return hasMessages && coverage?.epoch === epoch && coverage.pending;
}

function coverageFor(host: ProjectChatHost): ChatCoverage {
  const previous = chatCoverage.get(host);
  if (previous?.epoch === host.projectEpoch) return previous;
  const coverage = reactive({
    epoch: host.projectEpoch,
    frontier: host.chatMessages.at(-1)?.seq,
    pending: false,
  });
  chatCoverage.set(host, coverage);
  return coverage;
}

/**
 * 进入讨论页签：取最新一页（升序保存），并按列表投影的未读数一次性推导
 * 未读分割线的落点（服务端读游标无回读通道，未读数是它在客户端的唯一投影）。
 */
export async function loadChatLatest(host: ProjectChatHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const request = {};
  refreshRequests.set(host, request);
  const messagesAtStart = host.chatMessages;
  const current = (): boolean =>
    epoch === host.projectEpoch && refreshRequests.get(host) === request;
  host.chatLoading = true;
  try {
    const coverage = chatCoverage.get(host);
    if (coverage?.epoch === epoch && coverage.pending) {
      await refreshChatWindow(host, projectId);
      return;
    }
    const result = await projectCollabApi.chatHistory({
      projectId,
      limit: PROJECT_CHAT_PAGE_SIZE,
    });
    if (!current()) return;
    // 快照请求期间可能已收到发送确认或历史页。
    // 从已补齐的位置继续核对，避免旧快照覆盖这些新变更。
    if (host.chatMessages !== messagesAtStart) {
      await refreshChatWindow(host, projectId);
      return;
    }
    if (!result.ok) {
      host.chatError = projectCollabErrorNotice(result.code);
      return;
    }
    const sorted = ascending(result.messages);
    host.chatMessages = sorted;
    chatCoverage.set(host, reactive({ epoch, frontier: sorted.at(-1)?.seq, pending: false }));
    host.chatError = null;
    host.chatHasMore = sorted.length >= PROJECT_CHAT_PAGE_SIZE;
    const unread = host.projects.find((project) => project.id === projectId)?.unreadCount ?? 0;
    host.chatUnreadFromSeq =
      unread > 0 && sorted.length > 0
        ? (sorted[Math.max(0, sorted.length - unread)]?.seq ?? null)
        : null;
  } catch {
    if (current()) host.chatError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.chatLoading = false;
  }
}

export async function loadOlderChat(host: ProjectChatHost, projectId: string): Promise<void> {
  const oldest = host.chatMessages[0];
  if (!oldest || host.chatLoading) return;
  const epoch = host.projectEpoch;
  host.chatLoading = true;
  try {
    const result = await projectCollabApi.chatHistory({
      projectId,
      beforeSeq: oldest.seq,
      limit: PROJECT_CHAT_PAGE_SIZE,
    });
    if (epoch !== host.projectEpoch) return;
    if (!result.ok) {
      host.chatError = projectCollabErrorNotice(result.code);
      return;
    }
    const sorted = ascending(result.messages);
    host.chatMessages = [...sorted, ...host.chatMessages];
    host.chatHasMore = sorted.length >= PROJECT_CHAT_PAGE_SIZE;
  } catch {
    if (epoch === host.projectEpoch) host.chatError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.chatLoading = false;
  }
}

/**
 * 最新窗口与本地末尾之间可能隔着多页；逐页补齐后才合入最新窗口。
 * 每轮有界，失败保留已成功补拉的进度，下一次核对可继续；不跳过缺页推进已读位置。
 * 本入口刷新最新窗口内的撤回，窗口外撤回仍需历史重取或按事件定位。
 */
export async function refreshChatWindow(host: ProjectChatHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const request = {};
  refreshRequests.set(host, request);
  const current = (): boolean =>
    epoch === host.projectEpoch && refreshRequests.get(host) === request;
  const coverage = coverageFor(host);
  let cursor = coverage.frontier;
  try {
    const result = await projectCollabApi.chatHistory({
      projectId,
      limit: PROJECT_CHAT_PAGE_SIZE,
    });
    if (!current()) return;
    if (!result.ok) {
      host.chatError = projectCollabErrorNotice(result.code);
      return;
    }
    const sorted = ascending(result.messages);
    const windowStart = sorted[0]?.seq;
    let pages = 0;
    while (cursor !== undefined && windowStart !== undefined && cursor < windowStart - 1) {
      coverage.pending = true;
      if (pages >= MAX_CATCH_UP_PAGES) {
        host.chatError = projectCollabErrorNotice(
          'transient',
          '还有消息尚未载入，请继续核对最新消息。',
        );
        return;
      }
      const page = await projectCollabApi.chatHistory({
        projectId,
        afterSeq: cursor,
        limit: Math.min(PROJECT_CHAT_PAGE_SIZE, windowStart - cursor - 1),
      });
      if (!current()) return;
      if (!page.ok) {
        host.chatError = projectCollabErrorNotice(page.code);
        return;
      }
      const entries = ascending(page.messages);
      const after = cursor;
      if (
        entries.length === 0 ||
        entries.some((message, index) => message.seq <= (entries[index - 1]?.seq ?? after))
      ) {
        host.chatError = projectCollabErrorNotice(
          'transient',
          '消息未完整载入，请重新核对最新消息。',
        );
        return;
      }
      cursor = entries.at(-1)?.seq;
      coverage.frontier = cursor;
      host.chatMessages = mergeMessages(host.chatMessages, entries);
      pages += 1;
    }
    if (host.chatMessages.length === 0) host.chatHasMore = sorted.length >= PROJECT_CHAT_PAGE_SIZE;
    const latestSeq = sorted.at(-1)?.seq;
    if (latestSeq !== undefined) {
      coverage.frontier = Math.max(coverage.frontier ?? 0, latestSeq);
    }
    host.chatMessages = mergeMessages(host.chatMessages, sorted);
    coverage.pending = (host.chatMessages.at(-1)?.seq ?? 0) > (coverage.frontier ?? 0);
    host.chatError = coverage.pending
      ? projectCollabErrorNotice('transient', '还有消息尚未载入，请继续核对最新消息。')
      : null;
  } catch {
    if (current()) host.chatError = projectCollabErrorNotice('transient');
  }
}

/** 发消息；`refs` 是结构化引用（@ 成员 / 引用资产、待办，G-9），空则不带该键。 */
export async function sendChat(
  host: ProjectChatHost,
  projectId: string,
  bodyMd: string,
  refs: readonly string[] = [],
  clientMessageId?: string,
): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const request: ProjectChatSendRequest = {
      projectId,
      bodyMd,
      ...(refs.length > 0 ? { refs: [...refs] } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
    };
    const result = await projectCollabApi.chatSend(request);
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return false;
    }
    const coverage = coverageFor(host);
    if (coverage.frontier !== undefined && result.message.seq === coverage.frontier + 1) {
      coverage.frontier = result.message.seq;
    } else if (result.message.seq > (coverage.frontier ?? 0)) {
      coverage.pending = true;
    }
    host.chatMessages = mergeMessages(host.chatMessages, [result.message]);
    void markChatRead(host, projectId);
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/** 撤回：成功回软删后的权威消息，就地替换（正文已被服务端置空）。 */
export async function revokeChat(host: ProjectChatHost, messageId: string): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const result = await projectCollabApi.chatRevoke({ messageId });
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      // 撤回超时说得比通用的「没有权限」准，但**编号照旧**是 forbidden 那一枚：
      // 用户看到的说法可以更贴切，排查时认的还是同一类失败。
      host.actionNotice =
        result.code === 'forbidden'
          ? projectCollabErrorNotice('forbidden', '已超过可撤回时限（发送后 5 分钟内可撤回）。')
          : projectCollabErrorNotice(result.code);
      return false;
    }
    host.chatMessages = host.chatMessages.map((message) =>
      message.id === messageId ? result.message : message,
    );
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/** 读游标上报（幂等 max()，重放无害）；成功后刷新列表投影里的未读数。 */
export async function markChatRead(host: ProjectChatHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  const coverage = chatCoverage.get(host);
  const lastReadSeq =
    coverage?.epoch === epoch && coverage.pending
      ? coverage.frontier
      : host.chatMessages.at(-1)?.seq;
  if (lastReadSeq === undefined) return;
  try {
    const result = await projectCollabApi.readCursor({ projectId, lastReadSeq });
    if (epoch === host.projectEpoch && result.ok) void host.loadProjects();
  } catch {
    /* 游标上报失败只影响未读徽标，不打扰用户。 */
  }
}
