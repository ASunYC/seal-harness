<script setup lang="ts">
import { ref } from 'vue';

import type { ProjectAssetCatalogueEntry } from '@shared/protocol/project-collab-assets.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  ASSET_TRASH_EMPTY,
  ASSET_TRASH_NOTE,
  ASSET_TRASH_TITLE,
  assetEntryTitle,
  canRestoreTrashedAsset,
} from './asset-recovery';
import { formatProjectTime } from './project-format';
import { useProjectCollabStore, type ProjectCollabNotice } from '../../stores/projectCollab';

/**
 * 资产回收站（原型 `asset-trash`，`:980–981`）：逐条名称 + 「恢复」；空态「回收站为空。」。
 *
 * - 列表对**在册成员**都可见（服务端同目录一道门）；「恢复」只对**本人或拥有者**出现
 *   （`canRestoreTrashedAsset`），成员与观察者只读。⚠️ 与原型的偏离：原型按「本人或管理者」
 *   过滤列表本身，这里列全量、只收窄按钮，且管理者不在恢复之列（ADR-0037 决策 2）。
 * - ⛔ 不假成功：失败留在框内（按业务码的说法 + 参考编号）；成功由 store 推回执，这一行随
 *   回收站重取消失、并回到目录（目录与回收站由 store 一起重取）。
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();

const store = useProjectCollabStore();

/** 在途的那一条（一次只恢复一条：并发两条的回执会互相覆盖，用户分不清哪条失败了）。 */
const busyAssetId = ref<string | null>(null);
const failure = ref<ProjectCollabNotice | null>(null);

function canRestore(entry: ProjectAssetCatalogueEntry): boolean {
  return canRestoreTrashedAsset(entry, {
    isOwner: store.isOwner,
    canWrite: store.canWrite,
    isArchived: store.isArchived,
    isSelf: (subject) => store.isSelf(subject),
  });
}

async function restore(entry: ProjectAssetCatalogueEntry): Promise<void> {
  if (busyAssetId.value !== null) return;
  busyAssetId.value = entry.id;
  failure.value = null;
  try {
    const outcome = await store.restoreAsset(props.projectId, entry.id);
    if (!outcome.ok && outcome.notice !== null) failure.value = outcome.notice;
  } finally {
    busyAssetId.value = null;
  }
}
</script>

<template>
  <ProjectDialogShell :title="ASSET_TRASH_TITLE" @close="emit('close')">
    <div class="asset-trash" data-testid="asset-trash-dialog">
      <p class="asset-trash__note">{{ ASSET_TRASH_NOTE }}</p>

      <p v-if="failure" class="asset-trash__error" role="alert" data-testid="asset-trash-error">
        <span>{{ failure.message }}</span>
        <ReferenceIdCopy v-if="failure.referenceCode" :reference-id="failure.referenceCode" />
      </p>

      <div
        v-if="store.assetTrashError && store.assetTrash.length === 0"
        class="asset-trash__state asset-trash__state--danger"
        role="alert"
        data-testid="asset-trash-load-error"
      >
        <span>{{ store.assetTrashError.message }}</span>
        <ReferenceIdCopy
          v-if="store.assetTrashError.referenceCode"
          :reference-id="store.assetTrashError.referenceCode"
        />
        <button
          class="btn btn--secondary"
          type="button"
          @click="store.loadAssetTrash(props.projectId)"
        >
          重试
        </button>
      </div>
      <p
        v-else-if="store.assetTrashLoading && store.assetTrash.length === 0"
        class="asset-trash__state"
        role="status"
      >
        正在加载回收站…
      </p>
      <p
        v-else-if="store.assetTrash.length === 0"
        class="asset-trash__state"
        role="status"
        data-testid="asset-trash-empty"
      >
        {{ ASSET_TRASH_EMPTY }}
      </p>
      <ul v-else class="asset-trash__list" data-testid="asset-trash-list">
        <li
          v-for="entry in store.assetTrash"
          :key="entry.id"
          class="asset-trash__row"
          :data-asset-id="entry.id"
        >
          <div class="asset-trash__info">
            <span class="asset-trash__name">{{ assetEntryTitle(entry) }}</span>
            <span class="asset-trash__meta tnum">
              <template v-if="entry.currentVersion">
                v{{ entry.currentVersion.versionNo }} ·
              </template>
              删除于 {{ formatProjectTime(entry.deletedAt) }}
            </span>
          </div>
          <button
            v-if="canRestore(entry)"
            class="btn btn--secondary asset-trash__restore"
            type="button"
            data-testid="asset-restore"
            :disabled="busyAssetId !== null"
            @click="restore(entry)"
          >
            {{ busyAssetId === entry.id ? '恢复中…' : '恢复' }}
          </button>
        </li>
      </ul>
    </div>
  </ProjectDialogShell>
</template>

<style scoped>
.asset-trash {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.asset-trash__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.asset-trash__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.asset-trash__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-4) 0;
  color: var(--muted2);
  font-size: var(--fs-body);
}
.asset-trash__state--danger {
  color: var(--danger-text);
}
.asset-trash__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.asset-trash__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.asset-trash__info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--px-1);
}
.asset-trash__name {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-trash__meta {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.asset-trash__restore {
  flex: 0 0 auto;
}
</style>
