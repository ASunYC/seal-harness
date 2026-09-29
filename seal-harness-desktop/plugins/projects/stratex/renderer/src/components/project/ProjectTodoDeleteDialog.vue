<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { PROJECT_TODO_DELETE_MAX_ROOTS } from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

import ProjectDialogShell from './ProjectDialogShell.vue';
import type { ProjectTodoDeletePreview } from '@shared/protocol/project-todo-collaboration.js';
import { projectTodoCollaborationApi } from '../../sdk/projectTodoCollaboration';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 删除需求/任务的**壳内确认框**（照本仓既有确认态：ProjectDialogShell = OverlaySurface）。
 *
 * ⛔ 绝不用原生 `confirm`/`alert`/`dialog`（guard-native-dialog 会拦，且原生弹窗弄死整页键盘）。
 *
 * 删除会级联整棵子树；确认前必须取得服务端预检，分页缓存不能作为关联范围的依据。
 *
 * `roots` 超过一次可提交的根上界（`PROJECT_TODO_DELETE_MAX_ROOTS`）时**拦在这里**、不发请求
 * ——服务端会 422，但让用户先在界面上看清「选太多了」比发出去等一个报错好。
 */
const props = defineProps<{ roots: readonly Todo[] }>();
const emit = defineEmits<{ close: []; done: [] }>();

const store = useProjectCollabStore();

const busy = ref(false);
const error = ref<string | null>(null);
const preview = ref<ProjectTodoDeletePreview | null>(null);
const previewLoading = ref(false);
let epoch = 0;
let closed = false;

const rootIds = computed(() => [...new Set(props.roots.map((todo) => todo.id))]);
const context = computed(() =>
  [store.accountEpoch, store.projectEpoch, store.activeProjectId, ...rootIds.value].join(':'),
);
const confirmText = computed(() =>
  preview.value
    ? `将删除 ${preview.value.requirementCount} 条需求、${preview.value.taskCount} 条任务。`
    : '正在核对关联范围…',
);
/** 选中的根超过一次可提交的上界 ⇒ 拦住（不发请求，也不摆一个点了必 422 的确认）。 */
const overCap = computed(() => rootIds.value.length > PROJECT_TODO_DELETE_MAX_ROOTS);
const canConfirm = computed(
  () =>
    !busy.value &&
    !previewLoading.value &&
    !error.value &&
    !overCap.value &&
    preview.value?.canDelete === true &&
    preview.value.activeRoundCount === 0,
);

async function loadPreview(): Promise<void> {
  const current = ++epoch;
  preview.value = null;
  error.value = null;
  if (closed || overCap.value || rootIds.value.length === 0 || !store.activeProjectId) return;
  previewLoading.value = true;
  const ids = [...rootIds.value];
  try {
    const result = await projectTodoCollaborationApi.deletePreview({
      projectId: store.activeProjectId,
      ids,
    });
    if (current !== epoch || closed) return;
    if (!result.ok) {
      error.value = result.message || '关联范围读取失败，请重试。';
      return;
    }
    if (result.rootIds.length === 0 || result.rootIds.some((id) => !ids.includes(id))) {
      error.value = '预检结果与当前选择不一致，请重新选择。';
      return;
    }
    preview.value = result;
  } catch {
    if (current === epoch && !closed) error.value = '关联范围读取失败，请重试。';
  } finally {
    if (current === epoch) previewLoading.value = false;
  }
}
watch(
  context,
  () => {
    busy.value = false;
    void loadPreview();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  closed = true;
  epoch += 1;
});
function closeDialog(): void {
  if (busy.value) return;
  closed = true;
  epoch += 1;
  emit('close');
}

async function runDelete(): Promise<void> {
  if (!canConfirm.value || closed) return;
  const current = epoch;
  busy.value = true;
  error.value = null;
  try {
    const result = await store.deleteTodos(rootIds.value);
    if (current !== epoch || closed) return;
    if (result.ok) {
      emit('done');
      return;
    }
    // 多根整批里有一条已不在 ⇒ 已重取对齐、选中集陈旧，关框让用户在新清单上重来
    //（提示已由 store 落到常驻条）。其余失败留在框内可重试。
    if (result.realigned) {
      emit('done');
      return;
    }
    error.value = result.message;
  } catch {
    if (current === epoch) error.value = '删除失败，请刷新关联范围后重试。';
  } finally {
    if (current === epoch) busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell title="删除需求 / 任务" @close="closeDialog">
    <div class="todel" data-testid="todo-delete-dialog">
      <p class="todel__count" data-testid="todo-delete-count">{{ confirmText }}</p>
      <p class="todel__note">删除后需求与任务会从业务清单中移除，此操作不可撤销。</p>
      <p v-if="preview" class="todel__note">
        保留 {{ preview.testRoundCount }} 个测试轮次、{{ preview.testCaseCount }}
        条测试用例，可按权限读取历史。
      </p>
      <p v-if="preview && preview.activeRoundCount > 0" class="todel__error" role="alert">
        存在 {{ preview.activeRoundCount }} 个活动测试轮次，请先撤回或退回后再删除。
      </p>

      <p v-if="overCap" class="todel__error" role="alert" data-testid="todo-delete-overcap">
        一次最多删除 {{ PROJECT_TODO_DELETE_MAX_ROOTS }} 个根条目，当前选中
        {{ rootIds.length }} 个，请减少选择后再试。
      </p>
      <p v-else-if="error" class="todel__error" role="alert" data-testid="todo-delete-error">
        {{ error }}
      </p>
      <button
        v-if="error"
        type="button"
        class="btn btn--ghost"
        :disabled="busy || previewLoading"
        data-testid="todo-delete-preview-retry"
        @click="loadPreview"
      >
        重新核对范围
      </button>
    </div>

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="todo-delete-cancel"
        :disabled="busy"
        @click="closeDialog"
      >
        取消
      </button>
      <button
        class="btn btn--primary btn--danger"
        type="button"
        data-testid="todo-delete-confirm"
        :disabled="!canConfirm"
        @click="runDelete"
      >
        {{ busy ? '删除中…' : '确认删除' }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.todel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.todel__count {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  line-height: 1.6;
}
.todel__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.todel__error {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
</style>
