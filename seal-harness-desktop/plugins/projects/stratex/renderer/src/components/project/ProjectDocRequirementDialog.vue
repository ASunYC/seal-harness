<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { formatBytes, formatProjectTime } from './project-format';
import {
  REQUIREMENT_DOC_SOURCES,
  REQUIREMENT_FROM_DOC_TITLE,
  requirementDocAssets,
  requirementDocTempFiles,
} from './requirement-from-doc';
import type { RequirementDocCandidate, RequirementDocSource } from './requirement-from-doc';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「从一份文档开始」建需求的**第一步：选来源**（流程文档 §2①）。
 *
 * 这一层只回答「哪份文档」，并保证选出来的那份**已经是项目资产**；标题预填与关联
 * 挂载发生在下一步的建单框（`ProjectTodoDialog` 的 `defaultTitle` / `defaultRefs`）。
 * 拆成两步不是为了好看：入库是一次可能失败、可能被用户在系统对话框里取消的写操作，
 * 混进建单表单里会得到一个「填了一半、文件却没传上去」的中间态。
 *
 * ⛔ 这里**没有**「跳过入库直接关联」这条路。需求关联一个组员打不开的东西等于没
 * 关联——本机文件别人机器上没有，临时件会到期回收。三档来源到这一步之后必须都是
 * `asset`，判据只有 `promote` / `upload` 两次写入的结果，⛔ 不靠调用方记得。
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{
  close: [];
  /** 选定并已入库：把文件名与资产 id 交给上层去开建单框。 */
  pick: [{ readonly fileId: string; readonly filename: string }];
}>();

const store = useProjectCollabStore();

const source = ref<RequirementDocSource>('asset');
const busy = ref(false);

/** 资产列表未必取过（从需求页直接开这个框时就没有）——没有候选就选不出东西。 */
onMounted(() => {
  if (store.files.length === 0) void store.loadFiles(props.projectId);
});

const assets = computed(() => requirementDocAssets(store.files));
const tempFiles = computed(() => requirementDocTempFiles(store.files));

const candidates = computed<readonly RequirementDocCandidate[]>(() =>
  source.value === 'temp' ? tempFiles.value : assets.value,
);

const activeSource = computed(
  () => REQUIREMENT_DOC_SOURCES.find((option) => option.kind === source.value) ?? null,
);

/**
 * 挑一份已经在项目里的文件。
 *
 * 临时件先转存为资产再交出去——**转存失败就不往下走**：那样交出去的是一个会到期
 * 的 id，建出来的需求过几天就指向一个不存在的文件。失败提示由 store 落。
 */
async function choose(candidate: RequirementDocCandidate): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    if (candidate.needsPromote) {
      const promoted = await store.promoteFile(candidate.fileId);
      if (!promoted) return;
    }
    emit('pick', { fileId: candidate.fileId, filename: candidate.filename });
  } finally {
    busy.value = false;
  }
}

/**
 * 从本机选一份传进来。
 *
 * 走既有的 `project:file-upload`：**渲染层只表达「为哪个项目、传哪类」**，Main 自己
 * 弹系统文件选择框、读盘、直发服务端（路径绝不跨 IPC）。所以这里没有 `<input type=file>`。
 * ⚠️ 落 `asset` 档，⛔ 不是 `temp`——临时件会到期回收，关联它等于埋一颗定时炸弹。
 */
async function uploadFromDevice(): Promise<void> {
  if (busy.value || store.fileActionBusy) return;
  busy.value = true;
  try {
    const before = new Set(store.files.map((file) => file.id));
    const uploaded = await store.uploadFile(props.projectId, 'asset');
    // 取消（用户在系统对话框里点了取消）与失败在这里是同一件事：什么都不做。
    if (!uploaded) return;
    // 刚传上来的那一份＝列表里新出现的那个 asset。⛔ 不拿「最后一条」当它——
    // 列表次序由服务端定，不保证新上传的排在末尾。
    const fresh = requirementDocAssets(store.files).find(
      (candidate) => !before.has(candidate.fileId),
    );
    if (fresh) emit('pick', { fileId: fresh.fileId, filename: fresh.filename });
  } finally {
    busy.value = false;
  }
}

function fileMeta(fileId: string): string {
  const file = store.files.find((item) => item.id === fileId);
  if (!file) return '';
  return `${formatBytes(file.bytes)} · ${formatProjectTime(file.createdAt)}`;
}
</script>

<template>
  <ProjectDialogShell :title="REQUIREMENT_FROM_DOC_TITLE" @close="emit('close')">
    <div class="docpick__tabs" role="group" aria-label="文档来源">
      <button
        v-for="option in REQUIREMENT_DOC_SOURCES"
        :key="option.kind"
        class="docpick__tab"
        :class="{ 'is-on': source === option.kind }"
        type="button"
        :data-testid="`doc-source-${option.kind}`"
        :aria-pressed="source === option.kind"
        @click="source = option.kind"
      >
        {{ option.label }}
      </button>
    </div>
    <p v-if="activeSource" class="docpick__hint" data-testid="doc-source-hint">
      {{ activeSource.hint }}
    </p>

    <!-- 本机档只有一个动作：Main 弹选择框。没有列表可挑，也不该假装有 -->
    <div v-if="source === 'device'" class="docpick__device">
      <button
        class="btn btn--primary"
        type="button"
        data-testid="doc-upload"
        :disabled="busy || store.fileActionBusy || !store.canWrite"
        @click="uploadFromDevice"
      >
        {{ busy ? '正在上传…' : '选一份文件并存为资产' }}
      </button>
      <p v-if="!store.canWrite" class="docpick__hint" data-testid="doc-upload-readonly">
        观察者不能往项目里传文件，可以先从「项目资产」里挑一份已有的。
      </p>
    </div>

    <template v-else>
      <p v-if="candidates.length === 0" class="docpick__hint" data-testid="doc-empty" role="status">
        {{
          source === 'temp' ? '项目里没有临时件。' : '项目里还没有资产，先到「本机文件」传一份。'
        }}
      </p>
      <ul v-else class="docpick__list">
        <li v-for="candidate in candidates" :key="candidate.fileId">
          <button
            class="docpick__item"
            type="button"
            data-testid="doc-candidate"
            :data-file-id="candidate.fileId"
            :disabled="busy || (candidate.needsPromote && !store.canWrite)"
            @click="choose(candidate)"
          >
            <span class="docpick__name">{{ candidate.filename }}</span>
            <span class="docpick__meta tnum">{{ fileMeta(candidate.fileId) }}</span>
            <span v-if="candidate.needsPromote" class="docpick__promote">选中即转存为资产</span>
          </button>
        </li>
      </ul>
    </template>

    <template #foot>
      <button class="btn btn--ghost" type="button" :disabled="busy" @click="emit('close')">
        取消
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
/* 来源三档做成一组芯片：它们是同一个问题的三个答案，不是三个独立开关 */
.docpick__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.docpick__tab {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-100);
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.docpick__tab:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}
.docpick__tab.is-on {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-weight: var(--fw-label);
}
.docpick__tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.docpick__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.docpick__device {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  align-items: flex-start;
}
.docpick__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.docpick__item {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.docpick__item:hover:not(:disabled) {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.docpick__item:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.docpick__item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.docpick__name {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
.docpick__meta {
  color: var(--muted);
  font-size: var(--fs-100);
}
/* 临期件那一档要先转存：把代价写在按钮里，而不是等点完才说 */
.docpick__promote {
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-sm);
  color: var(--warn-text);
  background: var(--warn-soft);
  font-size: var(--fs-100);
}
@media (prefers-reduced-motion: reduce) {
  .docpick__tab,
  .docpick__item {
    transition: none;
  }
}
</style>
