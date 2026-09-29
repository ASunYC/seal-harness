<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ProjectAssetCatalogueEntry } from '@shared/protocol/project-collab-assets.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAssetTrashDialog from './ProjectAssetTrashDialog.vue';
import ProjectAssetVersionsDialog from './ProjectAssetVersionsDialog.vue';
import { ASSET_VERSIONS_SECTION_TITLE, assetEntryTitle } from './asset-recovery';
import { fileTypeBadge, formatBytes, formatProjectTime } from './project-format';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 资产页上的「资产版本」区块（RPT-08）：资产目录 + 回收站入口 + 每条的版本历史。
 *
 * ⚠️ 与上方的文件列表是**两套模型**：文件列表是字节行（旧文件模型），这里只读资产血统
 *    （`project:asset-list` / `asset-trash-list` / `asset-version-list`）。服务端不回填、
 *    旧上传也不建血统 ⇒ ⛔ 不按 fileId 把两边拼成一张表（ADR-0037 决策 8）。
 * ⚠️ 只在本项目**真有资产版本数据**（目录或回收站非空）或目录取数失败时出现：客户端目前
 *    还没有任何界面能登记版本（ADR-0037 代价与限制），给每个项目摆一个永远是空的区块只是
 *    噪音。取数由详情页 `loadTab('assets')` 发起，本组件只呈现 store。
 */
const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();

const trashOpen = ref(false);
const versionsOpen = ref(false);

const visible = computed(
  () => store.assets.length > 0 || store.assetTrash.length > 0 || store.assetsError !== null,
);

/** 每行预算好类型徽标一次（与文件列表同一套徽标，按当前那一版的文件名取）。 */
const rows = computed(() =>
  store.assets.map((entry) => ({ entry, badge: fileTypeBadge(assetEntryTitle(entry)) })),
);

function openTrash(): void {
  closeVersions();
  trashOpen.value = true;
  void store.loadAssetTrash(props.projectId);
}

function openVersions(entry: ProjectAssetCatalogueEntry): void {
  versionsOpen.value = true;
  void store.openAssetVersions(props.projectId, entry.id);
}

function closeVersions(): void {
  versionsOpen.value = false;
  store.closeAssetVersions();
}

// 换项目 / 原地换号（MainWindow 不卸载本页，只重置 store）：弹层里是上一个项目或上一个
// 账号的东西 ⇒ 一律收起，⛔ 不让新账号在旧弹层里点「恢复」。
watch([() => props.projectId, () => store.mySubject], () => {
  trashOpen.value = false;
  closeVersions();
});
</script>

<template>
  <section
    v-if="visible"
    class="asset-versions"
    data-testid="asset-versions-section"
    :aria-label="ASSET_VERSIONS_SECTION_TITLE"
  >
    <div class="asset-versions__bar">
      <h3 class="asset-versions__title">{{ ASSET_VERSIONS_SECTION_TITLE }}</h3>
      <span class="asset-versions__count tnum">{{ store.assets.length }} 项资料</span>
      <span class="asset-versions__spacer"></span>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="asset-trash-open"
        @click="openTrash"
      >
        回收站
      </button>
    </div>

    <p
      v-if="store.assetsError"
      class="asset-versions__state asset-versions__state--danger"
      role="alert"
      data-testid="asset-versions-error"
    >
      <span>{{ store.assetsError.message }}</span>
      <ReferenceIdCopy
        v-if="store.assetsError.referenceCode"
        :reference-id="store.assetsError.referenceCode"
      />
      <button class="btn btn--ghost" type="button" @click="store.loadAssets(props.projectId)">
        重试
      </button>
    </p>
    <p
      v-else-if="store.assets.length === 0"
      class="asset-versions__state"
      role="status"
      data-testid="asset-versions-empty"
    >
      目录里暂时没有资产；移入回收站的资产可在回收站恢复。
    </p>
    <div v-else class="asset-versions__list" data-testid="asset-versions-list">
      <div
        v-for="{ entry, badge } in rows"
        :key="entry.id"
        class="asset-versions__row"
        :data-asset-id="entry.id"
      >
        <span class="asset-versions__badge" :data-tone="badge.tone" aria-hidden="true">{{
          badge.label
        }}</span>
        <div class="asset-versions__info">
          <span class="asset-versions__name">{{ assetEntryTitle(entry) }}</span>
          <span v-if="entry.currentVersion" class="asset-versions__meta tnum">
            {{ formatBytes(entry.currentVersion.bytes) }} ·
            {{ entry.currentVersion.authorDisplayName || '成员' }} ·
            {{ formatProjectTime(entry.currentVersion.createdAt) }}
          </span>
        </div>
        <span class="asset-versions__spacer"></span>
        <span
          v-if="entry.currentVersion"
          class="asset-versions__version tnum"
          data-testid="asset-versions-current-no"
          >v{{ entry.currentVersion.versionNo }}</span
        >
        <button
          type="button"
          class="asset-versions__op"
          data-testid="asset-versions-open"
          @click="openVersions(entry)"
        >
          版本历史
        </button>
      </div>
    </div>
  </section>

  <!-- 弹层不挂在区块的 v-if 里：恢复可能让区块的可见条件翻转，弹层不该跟着被拆掉。 -->
  <ProjectAssetTrashDialog v-if="trashOpen" :project-id="projectId" @close="trashOpen = false" />
  <ProjectAssetVersionsDialog
    v-if="versionsOpen"
    :project-id="projectId"
    @close="closeVersions"
    @open-trash="openTrash"
  />
</template>

<style scoped>
.asset-versions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: var(--bw) solid var(--line);
}
.asset-versions__bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.asset-versions__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-body) / 1.4 var(--font-sans);
}
.asset-versions__count {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.asset-versions__spacer {
  flex: 1;
}
.asset-versions__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.asset-versions__state--danger {
  color: var(--danger-text);
}
.asset-versions__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
/* 行形态与文件列表的资产行同一口径（原型 .asset-row），便于两套列表并排时视觉一致。 */
.asset-versions__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.asset-versions__row:hover {
  border-color: var(--line-strong);
  background: var(--raised);
}
.asset-versions__badge {
  display: grid;
  width: var(--px-30);
  height: var(--px-30);
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font: 700 var(--fs-px-10) / 1 var(--font-mono);
  letter-spacing: 0.02em;
}
.asset-versions__badge[data-tone='pdf'] {
  color: var(--danger-text);
  background: var(--danger-soft);
}
.asset-versions__badge[data-tone='sheet'] {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.asset-versions__badge[data-tone='slides'] {
  color: var(--warn-text);
  background: var(--warn-soft);
}
.asset-versions__badge[data-tone='doc'] {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.asset-versions__info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-1);
}
.asset-versions__name {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-versions__meta {
  color: var(--muted2);
  font-size: var(--fs-100);
}
/* 版本号（原型「版本」列 vN）：中性药丸，与文件列表的形态标同尺寸。 */
.asset-versions__version {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: var(--px-1) var(--px-8);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted2);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.asset-versions__op {
  height: var(--ctl-h-sm);
  flex: 0 0 auto;
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.asset-versions__op:hover {
  color: var(--accent-text);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.asset-versions__op:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
@media (prefers-reduced-motion: reduce) {
  .asset-versions__row,
  .asset-versions__op {
    transition: none;
  }
}
</style>
