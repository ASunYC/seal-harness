<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue';
import {
  isAssetVersionContentAvailable,
  projectAssetPreviewFallbackText,
  type ProjectAssetVersion,
} from '@shared/protocol/project-collab-assets.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { projectCollabApi } from '../../sdk/projectCollab';
import {
  projectCollabErrorNotice,
  projectCollabInfoNotice,
  type ProjectCollabNotice,
} from '../../stores/projectCollabErrors';
import { useProjectAssetPreview } from './useProjectAssetPreview';

const props = defineProps<{ projectId: string; version: ProjectAssetVersion }>();
const emit = defineEmits<{ close: [] }>();
const store = useProjectCollabStore();
const closeButton = ref<HTMLButtonElement | null>(null);
onMounted(() => closeButton.value?.focus());
const downloading = ref(false);
const downloadNotice = ref<ProjectCollabNotice | null>(null);
let downloadGeneration = 0;
const { result, loading, failure, downloadableFileId, retry, next, invalidate } =
  useProjectAssetPreview(() => {
    if (
      !store.mySubject ||
      store.activeProjectId !== props.projectId ||
      store.detail?.id !== props.projectId ||
      store.detailError !== null ||
      store.assetVersionTarget !== props.version.assetId ||
      store.assetVersionChain?.asset.id !== props.version.assetId ||
      store.assetVersionChainError !== null ||
      !isAssetVersionContentAvailable(props.version) ||
      !store.assetVersionChain.versions.some(
        (version) =>
          version.id === props.version.id &&
          version.contentDeletedAt === props.version.contentDeletedAt,
      )
    )
      return null;
    return {
      subject: store.mySubject,
      accountEpoch: store.accountEpoch,
      projectEpoch: store.projectEpoch,
      projectId: props.projectId,
      assetId: props.version.assetId,
      versionId: props.version.id,
      fileId: props.version.fileId,
    };
  });
function clearDownload(): void {
  downloadGeneration += 1;
  downloading.value = false;
  downloadNotice.value = null;
}
watch(
  [
    downloadableFileId,
    () => props.version.id,
    () => props.projectId,
    () => store.accountEpoch,
    () => store.projectEpoch,
    () => store.mySubject,
  ],
  clearDownload,
  { flush: 'sync' },
);
onScopeDispose(clearDownload);
const text = computed(() => (result.value?.preview.kind === 'text' ? result.value.preview : null));
const fallback = computed(() => {
  if (!isAssetVersionContentAvailable(props.version)) {
    return { kind: 'fallback', reason: 'contentDeleted' } as const;
  }
  return result.value?.preview.kind === 'fallback' ? result.value.preview : null;
});

async function download(): Promise<void> {
  const fileId = downloadableFileId.value;
  if (fileId === null || downloading.value) return;
  const generation = downloadGeneration;
  downloading.value = true;
  downloadNotice.value = null;
  try {
    // 单独消费本次 typed 结果：共享 actionNotice 可能已被并行项目动作覆盖。
    const outcome = await projectCollabApi.fileDownload({ fileId });
    if (generation !== downloadGeneration) return;
    if (!outcome.ok && ['forbidden', 'authRequired', 'credentialRejected'].includes(outcome.code)) {
      invalidate();
    }
    downloadNotice.value = outcome.ok
      ? projectCollabInfoNotice(`已下载到 ${outcome.savedPath}`)
      : projectCollabErrorNotice(outcome.code);
  } catch {
    if (generation === downloadGeneration)
      downloadNotice.value = projectCollabErrorNotice('transient');
  } finally {
    if (generation === downloadGeneration) downloading.value = false;
  }
}
</script>

<template>
  <section class="asset-preview" data-testid="asset-preview-panel" aria-label="版本文本预览">
    <div class="asset-preview__head">
      <b>v{{ version.versionNo }} · {{ version.filename }}</b>
      <button ref="closeButton" class="btn btn--ghost" type="button" @click="emit('close')">
        关闭预览
      </button>
    </div>
    <p class="asset-preview__hint">文本预览；完整排版请下载后打开。</p>
    <p v-if="loading" role="status">正在读取这一版…</p>
    <div v-else-if="failure" role="alert" data-testid="asset-preview-error">
      <p>{{ failure.message }}</p>
      <ReferenceIdCopy v-if="failure.referenceCode" :reference-id="failure.referenceCode" />
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="asset-preview-retry"
        @click="retry"
      >
        重试此片段
      </button>
    </div>
    <template v-else-if="text">
      <p class="asset-preview__hint" data-testid="asset-preview-range">{{ text.selectedRange }}</p>
      <p class="asset-preview__hint" data-testid="asset-preview-coverage">
        <span v-for="(count, unit) in text.locatorCoverage" :key="unit"
          >{{ unit }}: {{ count }}
        </span>
      </p>
      <pre class="asset-preview__text" data-testid="asset-preview-text">{{ text.content }}</pre>
      <p v-if="text.truncated" role="status">当前片段已达到预览长度上限。</p>
      <p v-if="text.ignoredSelectors.length" class="asset-preview__hint">
        已忽略不适用于此格式的定位项：{{ text.ignoredSelectors.join('、') }}
      </p>
      <button
        v-if="text.nextSelector"
        class="btn btn--secondary"
        type="button"
        data-testid="asset-preview-next"
        @click="next"
      >
        下一片段
      </button>
    </template>
    <p v-else-if="fallback" role="status" data-testid="asset-preview-fallback">
      {{ projectAssetPreviewFallbackText(fallback.reason) }}
    </p>
    <p v-else role="status">预览上下文已失效，请重新打开版本历史。</p>
    <button
      v-if="downloadableFileId"
      class="btn btn--secondary"
      type="button"
      data-testid="asset-preview-download"
      :disabled="downloading"
      @click="download"
    >
      {{ downloading ? '下载中…' : '下载这一版' }}
    </button>
    <div
      v-if="downloadNotice"
      :role="downloadNotice.referenceCode ? 'alert' : 'status'"
      data-testid="asset-preview-download-notice"
    >
      <span>{{ downloadNotice.message }}</span>
      <ReferenceIdCopy
        v-if="downloadNotice.referenceCode"
        :reference-id="downloadNotice.referenceCode"
      />
    </div>
  </section>
</template>

<style scoped>
.asset-preview {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.asset-preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  overflow-wrap: anywhere;
}
.asset-preview__hint {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.asset-preview__text {
  margin: 0;
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ink);
  font: inherit;
}
</style>
