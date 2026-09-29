import { computed, onScopeDispose, shallowRef, watch, type ComputedRef } from 'vue';

import {
  isAssetPreviewDownloadable,
  isAssetVersionContentAvailable,
  type ProjectAssetVersionPreviewRequest,
  type ProjectAssetVersionPreviewResult,
} from '@shared/protocol/project-collab-assets.js';

import { projectCollabApi } from '../../sdk/projectCollab';
import {
  projectCollabErrorNotice,
  type ProjectCollabNotice,
} from '../../stores/projectCollabErrors';

type PreviewSuccess = Extract<ProjectAssetVersionPreviewResult, { ok: true }>;
type Selector = Omit<ProjectAssetVersionPreviewRequest, 'versionId'>;

export interface ProjectAssetPreviewContext {
  readonly subject: string;
  readonly accountEpoch: number;
  readonly projectEpoch: number;
  readonly projectId: string;
  readonly assetId: string;
  readonly versionId: string;
  readonly fileId: string;
}

export interface ProjectAssetPreviewController {
  readonly result: ComputedRef<PreviewSuccess | null>;
  readonly loading: ComputedRef<boolean>;
  readonly failure: ComputedRef<ProjectCollabNotice | null>;
  readonly downloadableFileId: ComputedRef<string | null>;
  readonly load: (selector?: Selector) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly next: () => Promise<void>;
  readonly invalidate: () => void;
}

/** 临时文本只属于当前弹层。上下文失效和每次读取都先清空，迟到响应不能重新填回。 */
export function useProjectAssetPreview(
  context: () => ProjectAssetPreviewContext | null,
): ProjectAssetPreviewController {
  const result = shallowRef<PreviewSuccess | null>(null);
  const loading = shallowRef(false);
  const failure = shallowRef<ProjectCollabNotice | null>(null);
  const contextKey = computed(() => JSON.stringify(context()));
  let generation = 0;
  let disposed = false;
  let lastSelector: Selector = {};

  function clear(): void {
    generation += 1;
    result.value = null;
    failure.value = null;
    loading.value = false;
  }

  async function load(selector: Selector = {}): Promise<void> {
    if (disposed) return;
    clear();
    const target = context();
    if (target === null) return;
    const key = contextKey.value;
    const requestGeneration = generation;
    lastSelector = { ...selector };
    loading.value = true;
    const isCurrent = (): boolean =>
      !disposed && requestGeneration === generation && key === contextKey.value;
    try {
      const response = await projectCollabApi.assetVersionPreview({
        ...selector,
        versionId: target.versionId,
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        failure.value = projectCollabErrorNotice(response.code);
        return;
      }
      // 即使桥接响应结构合法，也必须是用户选中的冻结版本，不能接受另一个文件。
      if (
        response.asset.projectId !== target.projectId ||
        response.asset.id !== target.assetId ||
        response.version.assetId !== target.assetId ||
        response.version.id !== target.versionId ||
        response.version.fileId !== target.fileId
      ) {
        failure.value = projectCollabErrorNotice('rejected');
        return;
      }
      result.value = response;
    } catch {
      if (isCurrent()) failure.value = projectCollabErrorNotice('transient');
    } finally {
      if (isCurrent()) loading.value = false;
    }
  }

  watch(contextKey, () => void load(), { immediate: true, flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    clear();
  });

  return {
    result: computed(() => result.value),
    loading: computed(() => loading.value),
    failure: computed(() => failure.value),
    downloadableFileId: computed(() => {
      const current = result.value;
      if (!current || !isAssetVersionContentAvailable(current.version)) return null;
      if (
        current.preview.kind === 'fallback' &&
        !isAssetPreviewDownloadable(current.preview.reason)
      ) {
        return null;
      }
      return current.version.fileId;
    }),
    load,
    invalidate: clear,
    retry: () => load(lastSelector),
    next: async () => {
      const preview = result.value?.preview;
      if (preview?.kind === 'text' && preview.nextSelector !== null) {
        await load(preview.nextSelector);
      }
    },
  };
}
