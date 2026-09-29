import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { ProjectDictionaryEntry } from '@shared/protocol/project-collab-dictionaries.js';
import { projectDictionariesApi } from '../sdk/projectDictionaries';
import { useProjectCollabStore } from './projectCollab';

export interface ProjectDictionariesState {
  readonly modules: readonly ProjectDictionaryEntry[];
  readonly categories: readonly ProjectDictionaryEntry[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
}
const emptyState = (): ProjectDictionariesState => ({
  modules: [],
  categories: [],
  loading: false,
  loaded: false,
  error: null,
});

class DictionaryLoadError extends Error {}

/** 只保留当前项目和账号代际的数据；不持久化、不从已有需求推断选项。 */
export const useProjectDictionariesStore = defineStore('project-dictionaries', () => {
  const collab = useProjectCollabStore();
  const state = ref<ProjectDictionariesState>(emptyState());
  let requestId = 0;
  const context = (): string =>
    JSON.stringify([
      collab.accountEpoch,
      collab.projectEpoch,
      collab.activeProjectId,
      collab.detail?.id,
      collab.mySubject,
      collab.myRole,
    ]);
  const allowed = (projectId: string): boolean =>
    collab.activeProjectId === projectId &&
    collab.detail?.id === projectId &&
    collab.mySubject !== null &&
    collab.myRole !== null;
  watch(
    context,
    () => {
      requestId += 1;
      state.value = { ...emptyState(), error: '项目或账号权限已变化，请重新加载模块与分类。' };
    },
    { flush: 'sync' },
  );

  function getState(projectId: string): ProjectDictionariesState {
    return allowed(projectId)
      ? state.value
      : { ...emptyState(), error: '当前项目身份尚未确认，无法读取模块与分类。' };
  }

  async function load(projectId: string): Promise<void> {
    const id = ++requestId;
    const scope = context();
    const current = (): boolean => id === requestId && scope === context() && allowed(projectId);
    if (!allowed(projectId)) {
      state.value = { ...emptyState(), error: '当前项目身份尚未确认，无法读取模块与分类。' };
      return;
    }
    state.value = { ...emptyState(), loading: true };
    try {
      const dictionaries: Record<'modules' | 'categories', ProjectDictionaryEntry[]> = {
        modules: [],
        categories: [],
      };
      for (const kind of ['modules', 'categories'] as const) {
        let expectedTotal: number | null = null;
        const ids = new Set<string>();
        for (let page = 1; ; page += 1) {
          // 限制不可信总数引起的无限请求；超过预算明确失败，不能发布半份字典。
          if (page > 100)
            throw new DictionaryLoadError(
              '模块或分类条目过多，暂时无法完整加载，请联系项目管理者整理。',
            );
          const result = await projectDictionariesApi.list({
            projectId,
            kind,
            page,
            pageSize: 100,
          });
          if (!current()) return;
          if (!result.ok) throw new DictionaryLoadError(result.message);
          if (expectedTotal !== null && result.total !== expectedTotal)
            throw new DictionaryLoadError('模块与分类在加载期间发生变化，请重试。');
          expectedTotal = result.total;
          if (result.page !== page || result.pageSize !== 100)
            throw new DictionaryLoadError('模块与分类列表响应不完整，请重试。');
          for (const entry of result.items) {
            if (ids.has(entry.id))
              throw new DictionaryLoadError('模块与分类列表响应不完整，请重试。');
            ids.add(entry.id);
          }
          dictionaries[kind].push(...result.items);
          if (dictionaries[kind].length === result.total) break;
          if (dictionaries[kind].length > result.total || result.items.length !== 100)
            throw new DictionaryLoadError('模块与分类列表响应不完整，请重试。');
        }
      }
      state.value = { ...dictionaries, loading: false, loaded: true, error: null };
    } catch (error) {
      if (current())
        state.value = {
          ...emptyState(),
          error:
            error instanceof DictionaryLoadError ? error.message : '模块与分类加载失败，请重试。',
        };
    }
  }
  return { getState, load };
});
