import { projectStorage } from '../../../../../src/ui/runtime';
import type { FeedEntry, FeedEntryKind } from '@shared/protocol/project-collab.js';

/**
 * 动态页签的三视图（全部 / 公告与留言 / 系统事件）。
 *
 * 归类的**唯一**依据是协议里的动态类别闭集 `FeedEntryKindSchema`，今天恰好三类：
 *   - `member_post` 成员发的留言（可评论、带引用）
 *   - `assistant`   项目助理自动发的条目（卡片形态，界面上标「自动化」）
 *   - `system`      服务端按操作自动生成的流水（紧凑单行，没有作者也不可评论）
 *
 * 两个非「全部」视图按**读它的人在找什么**分：前两类都是「有人（或代人）说了句话」，
 * 要读正文、可能要回一句；`system` 是「发生了什么」的流水，只用来对时间线。
 * ⚠️ 协议里新增一类时必须在这里显式归位——漏了它只会出现在「全部」里，
 * 另外两个视图谁都不认领。
 */

export type ProjectFeedView = 'all' | 'posts' | 'system';

export const PROJECT_FEED_VIEWS: readonly { value: ProjectFeedView; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'posts', label: '公告与留言' },
  { value: 'system', label: '系统事件' },
];

/** `null` ＝不收窄（「全部」）。其余视图列出**它认领的类别**。 */
const VIEW_KINDS: Record<ProjectFeedView, readonly FeedEntryKind[] | null> = {
  all: null,
  posts: ['member_post', 'assistant'],
  system: ['system'],
};

export function isProjectFeedView(value: unknown): value is ProjectFeedView {
  return PROJECT_FEED_VIEWS.some((option) => option.value === value);
}

/** 视图 → 条目集合的唯一收窄（列表与计数读同一支，不许各筛各的）。 */
export function feedEntriesInView<T extends Pick<FeedEntry, 'kind'>>(
  entries: readonly T[],
  view: ProjectFeedView,
): readonly T[] {
  const kinds = VIEW_KINDS[view];
  if (kinds === null) return entries;
  return entries.filter((entry) => kinds.includes(entry.kind));
}

/**
 * 视图选择跟着人走，不跟着项目走——「我只想看系统流水」是个人习惯。
 * 载体沿用仓内既有做法：`stratex.*` 前缀的 localStorage 键 + try/catch 静默降级
 * （见 useTodoViewState、stores/workbench.ts、theme.ts）。存的只是视图偏好，
 * 不含任何账号信息，所以不进 store 的换号作废清单。
 */
const FEED_VIEW_STORAGE_KEY = 'stratex.project.feed-view';

export function readStoredFeedView(): ProjectFeedView {
  try {
    const raw = projectStorage().getItem(FEED_VIEW_STORAGE_KEY);
    // 认不出的值（手改过 / 旧格式 / 将来删掉的视图）一律回落「全部」：
    // 回落到某个收窄视图会让人以为动态丢了。
    return isProjectFeedView(raw) ? raw : 'all';
  } catch {
    // 渲染层存储不可用：本次会话按「全部」走，不影响任何数据。
    return 'all';
  }
}

export function persistFeedView(view: ProjectFeedView): void {
  try {
    projectStorage().setItem(FEED_VIEW_STORAGE_KEY, view);
  } catch {
    // 偏好保存失败只影响下次进入，不改变当前视图。
  }
}
