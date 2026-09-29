<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import {
  isAssetVersionContentAvailable,
  type ProjectAssetVersion,
} from '@shared/protocol/project-collab-assets.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import ProjectAssetPreviewPanel from './ProjectAssetPreviewPanel.vue';
import {
  ASSET_OPEN_TRASH_ACTION,
  ASSET_VERSIONS_DELETED_HINT,
  ASSET_VERSIONS_TITLE,
  ASSET_VERSION_RESTORE_ACTION,
  ASSET_VERSION_RESTORE_TEXT,
  ASSET_VERSION_RESTORE_TITLE,
  assetVersionSummary,
  canRestoreAssetVersion,
} from './asset-recovery';
import { formatProjectTime } from './project-format';
import { useProjectCollabStore, type ProjectCollabNotice } from '../../stores/projectCollab';

/**
 * 文档版本历史（原型 `asset-versions`，`:981–982`）+ 恢复历史版本确认（`asset-version-restore`，`:983`）。
 *
 * 原型是**同一个弹层换内容**（`dialog()` 覆盖前一个），这里照做成两步：
 *  - 列表步：按新到旧逐版显示「v序号 · 操作人」、时间、内容摘要，可恢复的那几版带「恢复为新版本」；
 *  - 确认步：「将此历史内容复制为新的最新版，已有版本全部保留。」+「确认恢复」。
 * 成功后回到列表步：store 已按服务端重取版本链，新的一版在最上面、旧版本一个没少
 * （⚠️ 与原型的偏离：原型确认后整个弹层关闭，这里留在列表上让人看见结果）。
 *
 * ⛔ 不假成功：失败留在确认步（按业务码的说法 + 参考编号）；血统已在回收站时给「打开回收站」。
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: []; openTrash: [] }>();

const store = useProjectCollabStore();

/** 正在确认恢复的那一版；null = 列表步。 */
const pending = ref<ProjectAssetVersion | null>(null);
const busy = ref(false);
const failure = ref<{
  readonly notice: ProjectCollabNotice;
  readonly serverCode: string | null;
} | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);

const chain = computed(() => store.assetVersionChain);
const previewVersionId = ref<string | null>(null);
let previewTrigger: HTMLButtonElement | null = null;
const previewVersion = computed(
  () => chain.value?.versions.find((version) => version.id === previewVersionId.value) ?? null,
);
function openPreview(versionId: string, event: MouseEvent): void {
  previewTrigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
  previewVersionId.value = versionId;
}
async function closePreview(): Promise<void> {
  previewVersionId.value = null;
  await nextTick();
  previewTrigger?.focus();
  previewTrigger = null;
}
watch(
  [
    () => store.accountEpoch,
    () => store.projectEpoch,
    () => store.mySubject,
    () => props.projectId,
    () => store.activeProjectId,
    () => store.detail?.id,
    () => store.detailError,
    () => store.assetVersionTarget,
    () => chain.value?.asset.id,
    () => store.assetVersionChainError,
  ],
  () => {
    previewVersionId.value = null;
  },
  { flush: 'sync' },
);
const title = computed(() =>
  pending.value === null ? ASSET_VERSIONS_TITLE : ASSET_VERSION_RESTORE_TITLE,
);
const assetDeleted = computed(() => (chain.value?.asset.deletedAt ?? null) !== null);
/** 弹层头一行：当前那一版的文件名与版本数（链还没取到时不显示）。 */
const lead = computed(() => {
  const current = chain.value;
  if (current === null) return null;
  const head = current.versions.find((version) => version.id === current.asset.currentVersionId);
  return head ? `${head.filename} · 共 ${current.versions.length} 版` : null;
});

function isCurrent(version: ProjectAssetVersion): boolean {
  return chain.value !== null && version.id === chain.value.asset.currentVersionId;
}

function canRestore(version: ProjectAssetVersion): boolean {
  const current = chain.value;
  if (current === null) return false;
  return canRestoreAssetVersion(version, current.asset, {
    canWrite: store.canWrite,
    isArchived: store.isArchived,
  });
}

async function askRestore(version: ProjectAssetVersion): Promise<void> {
  pending.value = version;
  failure.value = null;
  // 触发按钮随列表步卸载，焦点不能掉到 body 上：落到确认按钮（键盘用户一回车就能确认）。
  await nextTick();
  confirmButton.value?.focus();
}

function backToList(): void {
  if (busy.value) return;
  pending.value = null;
  failure.value = null;
}

async function confirmRestore(): Promise<void> {
  const version = pending.value;
  if (version === null || busy.value) return;
  busy.value = true;
  failure.value = null;
  try {
    const outcome = await store.restoreAssetVersion(props.projectId, version.id);
    if (outcome.ok) {
      pending.value = null;
      return;
    }
    if (outcome.notice !== null) {
      failure.value = { notice: outcome.notice, serverCode: outcome.serverCode };
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell :title="title" @close="emit('close')">
    <div v-if="pending" class="asset-restore" data-testid="asset-version-restore-step">
      <p class="asset-restore__text">{{ ASSET_VERSION_RESTORE_TEXT }}</p>
      <p class="asset-restore__target tnum" data-testid="asset-version-restore-target">
        v{{ pending.versionNo }} · {{ pending.filename }}
      </p>
      <div
        v-if="failure"
        class="asset-restore__error"
        role="alert"
        data-testid="asset-version-restore-error"
      >
        <span>{{ failure.notice.message }}</span>
        <ReferenceIdCopy
          v-if="failure.notice.referenceCode"
          :reference-id="failure.notice.referenceCode"
        />
        <button
          v-if="failure.serverCode === 'asset_deleted'"
          class="btn btn--secondary"
          type="button"
          data-testid="asset-version-restore-open-trash"
          @click="emit('openTrash')"
        >
          {{ ASSET_OPEN_TRASH_ACTION }}
        </button>
      </div>
    </div>

    <div v-else class="asset-history" data-testid="asset-versions-dialog">
      <p v-if="lead" class="asset-history__lead tnum">{{ lead }}</p>

      <div
        v-if="assetDeleted"
        class="asset-history__deleted"
        role="alert"
        data-testid="asset-versions-deleted"
      >
        <span>{{ ASSET_VERSIONS_DELETED_HINT }}</span>
        <button
          class="btn btn--secondary"
          type="button"
          data-testid="asset-versions-open-trash"
          @click="emit('openTrash')"
        >
          {{ ASSET_OPEN_TRASH_ACTION }}
        </button>
      </div>

      <div
        v-if="store.assetVersionChainError && chain === null"
        class="asset-history__state asset-history__state--danger"
        role="alert"
        data-testid="asset-versions-load-error"
      >
        <span>{{ store.assetVersionChainError.message }}</span>
        <ReferenceIdCopy
          v-if="store.assetVersionChainError.referenceCode"
          :reference-id="store.assetVersionChainError.referenceCode"
        />
        <button
          class="btn btn--secondary"
          type="button"
          @click="store.loadAssetVersionChain(props.projectId)"
        >
          重试
        </button>
      </div>
      <p v-else-if="chain === null" class="asset-history__state" role="status">正在加载版本历史…</p>
      <p v-else-if="chain.versions.length === 0" class="asset-history__state" role="status">
        这份资产还没有版本。
      </p>
      <ol v-else class="asset-history__list" data-testid="asset-versions-list">
        <li
          v-for="version in chain.versions"
          :key="version.id"
          class="asset-history__card"
          :data-version-id="version.id"
        >
          <div class="asset-history__head">
            <b class="asset-history__who tnum" data-testid="asset-version-heading">
              v{{ version.versionNo }} · {{ version.authorDisplayName || '成员' }}
            </b>
            <small class="asset-history__time tnum">{{
              formatProjectTime(version.createdAt)
            }}</small>
          </div>
          <p class="asset-history__summary">{{ assetVersionSummary(version) }}</p>
          <div class="asset-history__foot">
            <span
              v-if="isCurrent(version)"
              class="asset-history__tag"
              data-testid="asset-version-current"
              >当前版本</span
            >
            <span
              v-if="!isAssetVersionContentAvailable(version)"
              class="asset-history__tag asset-history__tag--danger"
              data-testid="asset-version-content-deleted"
              >内容已删除</span
            >
            <span class="asset-history__spacer"></span>
            <button
              class="btn btn--ghost"
              type="button"
              data-testid="asset-version-preview"
              @click="openPreview(version.id, $event)"
            >
              预览
            </button>
            <button
              v-if="canRestore(version)"
              class="btn btn--ghost"
              type="button"
              data-testid="asset-version-restore"
              @click="askRestore(version)"
            >
              {{ ASSET_VERSION_RESTORE_ACTION }}
            </button>
          </div>
        </li>
      </ol>
      <ProjectAssetPreviewPanel
        v-if="previewVersion"
        :key="previewVersion.id"
        :project-id="props.projectId"
        :version="previewVersion"
        @close="closePreview"
      />
    </div>

    <template v-if="pending" #foot>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="asset-version-restore-cancel"
        :disabled="busy"
        @click="backToList"
      >
        取消
      </button>
      <button
        ref="confirmButton"
        class="btn btn--primary"
        type="button"
        data-testid="asset-version-restore-confirm"
        :disabled="busy"
        @click="confirmRestore"
      >
        {{ busy ? '恢复中…' : '确认恢复' }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.asset-restore,
.asset-history {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.asset-restore__text {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: 1.6;
}
.asset-restore__target {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.asset-restore__error,
.asset-history__deleted {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.asset-history__deleted {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--danger-line);
  border-radius: var(--r-md);
  background: var(--danger-soft);
}
.asset-history__lead {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.asset-history__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-4) 0;
  color: var(--muted2);
  font-size: var(--fs-body);
}
.asset-history__state--danger {
  color: var(--danger-text);
}
.asset-history__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 版本卡片（原型 .review-card）：头一行「v序号 · 操作人」与时间两端对齐，下面摘要与动作。 */
.asset-history__card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.asset-history__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}
.asset-history__who {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
}
.asset-history__time {
  color: var(--muted);
  font-size: var(--fs-100);
}
.asset-history__summary {
  margin: 0;
  overflow: hidden;
  color: var(--muted2);
  font-size: var(--fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-history__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.asset-history__spacer {
  flex: 1;
}
.asset-history__tag {
  display: inline-flex;
  align-items: center;
  padding: var(--px-1) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted2);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.asset-history__tag--danger {
  border-color: var(--danger-line);
  color: var(--danger-text);
  background: var(--danger-soft);
}
</style>
