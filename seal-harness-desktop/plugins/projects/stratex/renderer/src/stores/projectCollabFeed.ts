import type {
  ProjectCommentPostRequest,
  ProjectFeedPostRequest,
} from '@shared/protocol/project-collab.js';

import { PROJECT_FEED_PAGE_SIZE, projectCollabErrorNotice } from './projectCollabErrors';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 动态域动作（列表/翻页/发布/评论）。
 *
 * 形态与讨论/看板/资产三域一致：**动作是拿 host 的自由函数**，不是 store 方法上的
 * `this` —— host 类型逐格列出本域真正碰的状态，跨域误写在类型上就不可能。
 * store 里的同名方法只做一行转发。
 */
export type ProjectFeedHost = ProjectDomainHost &
  Pick<ProjectCollabState, 'feedEntries' | 'feedLoading' | 'feedError' | 'feedHasMore'>;

export async function loadFeed(host: ProjectFeedHost, projectId: string): Promise<void> {
  const epoch = host.projectEpoch;
  host.feedLoading = true;
  try {
    const result = await projectCollabApi.feedList({
      projectId,
      limit: PROJECT_FEED_PAGE_SIZE,
    });
    if (epoch !== host.projectEpoch) return;
    if (!result.ok) {
      host.feedError = projectCollabErrorNotice(result.code);
      return;
    }
    host.feedEntries = result.entries;
    host.feedError = null;
    host.feedHasMore = result.entries.length >= PROJECT_FEED_PAGE_SIZE;
  } catch {
    if (epoch === host.projectEpoch) host.feedError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.feedLoading = false;
  }
}

export async function loadOlderFeed(host: ProjectFeedHost, projectId: string): Promise<void> {
  const oldest = host.feedEntries.at(-1);
  if (!oldest || host.feedLoading) return;
  const epoch = host.projectEpoch;
  host.feedLoading = true;
  try {
    const result = await projectCollabApi.feedList({
      projectId,
      beforeId: oldest.id,
      limit: PROJECT_FEED_PAGE_SIZE,
    });
    if (epoch !== host.projectEpoch) return;
    if (!result.ok) {
      host.feedError = projectCollabErrorNotice(result.code);
      return;
    }
    host.feedEntries = [...host.feedEntries, ...result.entries];
    host.feedHasMore = result.entries.length >= PROJECT_FEED_PAGE_SIZE;
  } catch {
    if (epoch === host.projectEpoch) host.feedError = projectCollabErrorNotice('transient');
  } finally {
    if (epoch === host.projectEpoch) host.feedLoading = false;
  }
}

/**
 * 发一条动态。`refs` 是结构化引用（@ 成员 / 引用资产、待办，G-9）——**只在非空时
 * 带上**：空数组与缺席在服务端是同一语义，少发一个键就少一处形状差异。
 */
export async function postFeed(
  host: ProjectFeedHost,
  projectId: string,
  bodyMd: string,
  refs: readonly string[] = [],
): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const request: ProjectFeedPostRequest = {
      projectId,
      bodyMd,
      ...(refs.length > 0 ? { refs: [...refs] } : {}),
    };
    const result = await projectCollabApi.feedPost(request);
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return false;
    }
    host.feedEntries = [result.entry, ...host.feedEntries];
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}

/**
 * 评论一条动态。`refs` 是 @ 提及的结构化 token（服务端 0011）——与发动态**同一条
 * 纪律**：只在非空时带上（空数组与缺席在服务端同义，少发一个键少一处形状差异）。
 */
export async function postComment(
  host: ProjectFeedHost,
  entryId: string,
  bodyMd: string,
  refs: readonly string[] = [],
): Promise<boolean> {
  const epoch = host.projectEpoch;
  try {
    const request: ProjectCommentPostRequest = {
      entryId,
      bodyMd,
      ...(refs.length > 0 ? { refs: [...refs] } : {}),
    };
    const result = await projectCollabApi.commentPost(request);
    if (epoch !== host.projectEpoch) return false;
    if (!result.ok) {
      host.actionNotice = projectCollabErrorNotice(result.code);
      return false;
    }
    host.feedEntries = host.feedEntries.map((entry) =>
      entry.id === entryId ? { ...entry, comments: [...entry.comments, result.comment] } : entry,
    );
    return true;
  } catch {
    if (epoch === host.projectEpoch) host.actionNotice = projectCollabErrorNotice('transient');
    return false;
  }
}
