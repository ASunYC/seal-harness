import { onScopeDispose, ref, watch, type Ref } from 'vue';

import type { ChatMessage, ProjectEvent } from '@shared/protocol/project-collab.js';

import { projectCollabApi } from '../../sdk/projectCollab';
import {
  projectCollabErrorNotice,
  type ProjectCollabNotice,
} from '../../stores/projectCollabErrors';

interface SearchContext {
  projectId(): string;
  projectEpoch(): number;
  accountEpoch(): number;
  subject(): string | null;
  canRead(): boolean;
  supported(): boolean;
}

export interface ProjectChatSearchState {
  query: Ref<string>;
  messages: Ref<ChatMessage[]>;
  nextCursor: Ref<string | null>;
  loading: Ref<boolean>;
  error: Ref<ProjectCollabNotice | null>;
  searched: Ref<boolean>;
  newMessages: Ref<boolean>;
  submit(): Promise<void>;
  loadMore(): Promise<void>;
  clear(): void;
}

/** 搜索快照独立于普通历史；不写消息大仓，也不读取或推进读游标。 */
export function useProjectChatSearch(context: SearchContext): ProjectChatSearchState {
  const query = ref('');
  const messages = ref<ChatMessage[]>([]);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<ProjectCollabNotice | null>(null);
  const searched = ref(false);
  const newMessages = ref(false);
  let generation = 0;
  let active = true;

  function invalidate(): void {
    generation += 1;
    messages.value = [];
    nextCursor.value = null;
    loading.value = false;
    error.value = null;
    searched.value = false;
    newMessages.value = false;
  }

  function clear(): void {
    query.value = '';
    invalidate();
  }

  const allowed = (): boolean =>
    active && context.supported() && context.canRead() && context.subject() !== null;

  watch(query, invalidate, { flush: 'sync' });
  watch(
    () => [
      context.projectId(),
      context.projectEpoch(),
      context.accountEpoch(),
      context.subject(),
      context.canRead(),
      context.supported(),
    ],
    clear,
    { flush: 'sync' },
  );

  async function requestPage(cursor?: string): Promise<void> {
    const request = ++generation;
    const text = query.value.trim();
    const current = (): boolean =>
      active && request === generation && allowed() && query.value.trim() === text;
    loading.value = true;
    error.value = null;
    try {
      const result = await projectCollabApi.chatHistory({
        projectId: context.projectId(),
        limit: 20,
        search: { query: text, ...(cursor ? { cursor } : {}) },
      });
      if (!current()) return;
      if (!result.ok) {
        if (['forbidden', 'authRequired', 'credentialRejected'].includes(result.code)) invalidate();
        error.value = projectCollabErrorNotice(result.code);
        return;
      }
      if (!result.searchPage || (cursor && result.searchPage.nextCursor === cursor)) {
        error.value = projectCollabErrorNotice(
          'invalidRequest',
          '搜索结果未完整返回，请重新搜索。',
        );
        return;
      }
      const merged = new Map((cursor ? messages.value : []).map((item) => [item.id, item]));
      for (const item of result.messages) {
        // 即使服务端误回撤回行，也不在搜索面显示其正文或引用。
        if (item.revoked) merged.delete(item.id);
        else merged.set(item.id, item);
      }
      messages.value = [...merged.values()].sort((left, right) => right.seq - left.seq);
      nextCursor.value = result.searchPage.nextCursor;
      searched.value = true;
    } catch {
      if (current()) error.value = projectCollabErrorNotice('transient');
    } finally {
      if (current()) loading.value = false;
    }
  }

  async function submit(): Promise<void> {
    if (!allowed() || loading.value) return;
    const text = query.value.trim();
    invalidate();
    if (!text) return;
    if (text.length > 128) {
      error.value = projectCollabErrorNotice('invalidRequest', '搜索内容最多 128 个字符。');
      return;
    }
    await requestPage();
  }

  async function loadMore(): Promise<void> {
    if (!allowed() || loading.value || !nextCursor.value) return;
    await requestPage(nextCursor.value);
  }

  function reauthorize(): void {
    invalidate();
    if (query.value.trim()) void submit();
  }

  function onEvent(event: ProjectEvent): void {
    if (!active) return;
    if (event.kind === 'connection') {
      if (event.payload.state === 'online') reauthorize();
      else invalidate();
      return;
    }
    if (event.projectId !== context.projectId()) return;
    if (event.kind === 'chat.message') {
      if (query.value.trim()) newMessages.value = true;
    } else if (['chat.revoked', 'member.changed', 'project.changed'].includes(event.kind)) {
      reauthorize();
    }
  }

  const unsubscribe = projectCollabApi.onEvent(onEvent);
  onScopeDispose(() => {
    active = false;
    invalidate();
    unsubscribe();
  });

  return {
    query,
    messages,
    nextCursor,
    loading,
    error,
    searched,
    newMessages,
    submit,
    loadMore,
    clear,
  };
}
