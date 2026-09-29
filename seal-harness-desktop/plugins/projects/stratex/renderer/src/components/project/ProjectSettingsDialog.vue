<script setup lang="ts">
import { computed, ref } from 'vue';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import { formatProjectDate } from './project-format';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「项目设置」弹层（右栏「项目管理」入口，对齐协作原型 `project-settings`）。
 *
 * 只放**已有真实能力**的东西：项目名称 / 完整项目 ID / 创建日期 / 状态，以及拥有者专属的
 * 归档与恢复。改名仍在页头标题旁（owner-only，服务端同判），⛔ 这里不做第二个改名入口。
 *
 * 归档的二次确认在同一弹层里换页（与「成员与权限」同一做法），⛔ 不叠第二层模态、不用原生 confirm。
 * 恢复不是破坏性操作：直接执行，不拦确认。
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();

const store = useProjectCollabStore();

const busy = ref(false);
const confirmingArchive = ref(false);

const project = computed(() => store.detail);
const createdAt = computed(() => formatProjectDate(store.detail?.createdAt ?? null));

function askArchive(): void {
  if (!store.canAdministerProject) return;
  confirmingArchive.value = true;
}

function cancelArchive(): void {
  if (busy.value) return;
  confirmingArchive.value = false;
}

async function confirmArchive(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    // 失败时停在确认页：常驻回执里有参考编号，用户看完自己决定重试还是返回。
    if (await store.setProjectArchived(props.projectId, true)) confirmingArchive.value = false;
  } finally {
    busy.value = false;
  }
}

async function restoreProject(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.setProjectArchived(props.projectId, false);
  } finally {
    busy.value = false;
  }
}

function close(): void {
  if (busy.value) return;
  emit('close');
}
</script>

<template>
  <ProjectDialogShell :title="confirmingArchive ? '归档项目' : '项目设置'" @close="close">
    <div v-if="confirmingArchive" class="pj-settings" data-testid="project-archive-confirm-body">
      <p class="pj-settings__body">确定归档本项目？</p>
      <p class="pj-settings__note">
        归档后项目转为只读：所有人都无法再发消息、改待办或上传文件，内容与历史全部保留；项目将从列表中隐藏，你可以随时恢复。
      </p>
    </div>

    <div v-else class="pj-settings" data-testid="project-settings-dialog">
      <dl class="pj-settings__facts">
        <div class="pj-settings__fact">
          <dt>项目名称</dt>
          <dd class="pj-settings__name">{{ project?.name ?? '—' }}</dd>
        </div>
        <div class="pj-settings__fact">
          <dt>项目 ID</dt>
          <dd>
            <ReferenceIdCopy
              v-if="project"
              :reference-id="project.id"
              label="项目 ID"
              label-hidden
              class="pj-settings__id"
            />
          </dd>
        </div>
        <div class="pj-settings__fact">
          <dt>创建日期</dt>
          <dd class="tnum">{{ createdAt }}</dd>
        </div>
        <div class="pj-settings__fact">
          <dt>状态</dt>
          <dd>{{ store.isArchived ? '已归档（只读）' : '进行中' }}</dd>
        </div>
      </dl>

      <p v-if="!store.isOwner" class="pj-settings__note">归档与恢复项目仅限项目拥有者。</p>
    </div>

    <template #foot>
      <template v-if="confirmingArchive">
        <button class="btn btn--ghost" type="button" :disabled="busy" @click="cancelArchive">
          返回
        </button>
        <button
          class="btn btn--primary btn--danger"
          type="button"
          :disabled="busy"
          data-testid="project-archive-confirm"
          @click="confirmArchive"
        >
          归档项目
        </button>
      </template>
      <template v-else>
        <button
          v-if="store.canAdministerProject"
          class="btn btn--ghost pj-settings__danger"
          type="button"
          :disabled="busy"
          data-testid="project-archive"
          @click="askArchive"
        >
          归档项目
        </button>
        <!-- ⚠️ 判据是裸 `isOwner`：恢复按钮只在归档态出现，挂任何含「未归档」的具名能力就再也解不开了。 -->
        <button
          v-if="store.isOwner && store.isArchived"
          class="btn btn--secondary"
          type="button"
          :disabled="busy"
          data-testid="project-settings-unarchive"
          @click="restoreProject"
        >
          恢复项目
        </button>
        <button class="btn btn--ghost" type="button" @click="close">关闭</button>
      </template>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.pj-settings {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.pj-settings__body {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.pj-settings__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-1p7);
}
.pj-settings__facts {
  display: flex;
  margin: 0;
  flex-direction: column;
  gap: var(--sp-2);
}
.pj-settings__fact {
  display: grid;
  grid-template-columns: var(--px-84) minmax(0, 1fr);
  align-items: baseline;
  gap: var(--sp-3);
}
.pj-settings__fact dt {
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.pj-settings__fact dd {
  min-width: 0;
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-meta);
}
.pj-settings__name {
  overflow-wrap: anywhere;
}
.pj-settings__id {
  margin-left: calc(-1 * var(--sp-2));
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
}
.pj-settings__danger {
  margin-right: auto;
  color: var(--danger-text);
}
</style>
