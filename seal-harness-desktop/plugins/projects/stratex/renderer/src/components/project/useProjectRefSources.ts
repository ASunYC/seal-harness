import { computed, watch } from 'vue';
import type { ComputedRef } from 'vue';

import { PROJECT_REF_KIND_ASSET, PROJECT_REF_KIND_TODO } from '@shared/protocol/project-collab.js';

import { splitRefToken } from './project-format';
import type { ProjectRefSources } from './project-refs';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 动态 / 讨论面板共用的引用来源：芯片文案与跳转目标都从这里取，引用浮层的候选也是。
 *
 * 除了把 store 里的三份清单拼成 `ProjectRefSources`，还多管一件事：**面板上已经有待办 / 资产
 * 引用、而对应清单还没取过时，挂载即补取一次**（测试提单 2552）。
 * 这两个页签本身不取待办与资产——从动态页签直接进项目时，不补取的话待办芯片一律显示
 * 「已删除」、资产芯片显示原 id，而且永远点不开。
 *
 * ⚠️ 每个「账号 × 项目」每类至多补取一次：清单本来就是空的项目（真没有资产）不该每来一条
 *    动态就重取一遍。之后的变化由 store 的事件合帧重取负责，⛔ 这里不轮询。
 */
export interface ProjectRefSourcesHandle {
  readonly refSources: ComputedRef<ProjectRefSources>;
  /** `#` 浮层首次打开时补齐候选（清单为空才取）。 */
  ensureRefCandidates(): void;
}

export function useProjectRefSources(
  projectId: () => string,
  displayedRefs: () => readonly string[],
): ProjectRefSourcesHandle {
  const store = useProjectCollabStore();

  const refSources = computed<ProjectRefSources>(() => ({
    members: store.detail?.members ?? [],
    files: store.files,
    todos: store.todos,
  }));

  function ensureRefCandidates(): void {
    if (store.files.length === 0) void store.loadFiles(projectId());
    if (store.todos.length === 0) void store.loadTodos(projectId());
  }

  const requested = { files: '', todos: '' };

  const referencedKinds = computed(() => {
    const kinds = new Set<string>();
    for (const token of displayedRefs()) {
      const { kind } = splitRefToken(token);
      if (kind !== null) kinds.add(kind);
    }
    return { asset: kinds.has(PROJECT_REF_KIND_ASSET), todo: kinds.has(PROJECT_REF_KIND_TODO) };
  });

  watch(
    () => [referencedKinds.value.asset, referencedKinds.value.todo, projectId()] as const,
    ([hasAsset, hasTodo, id]) => {
      if (!id) return;
      const scope = `${store.accountEpoch}:${id}`;
      if (
        hasAsset &&
        requested.files !== scope &&
        store.files.length === 0 &&
        !store.filesLoading
      ) {
        requested.files = scope;
        void store.loadFiles(id);
      }
      if (hasTodo && requested.todos !== scope && store.todos.length === 0 && !store.todosLoading) {
        requested.todos = scope;
        void store.loadTodos(id);
      }
    },
    { immediate: true },
  );

  return { refSources, ensureRefCandidates };
}
