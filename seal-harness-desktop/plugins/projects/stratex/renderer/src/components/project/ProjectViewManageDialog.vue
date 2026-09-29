<script setup lang="ts">
import { ref } from 'vue';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { EXTRA_VIEWS, PROJECT_VIEWS, type ProjectExtraView } from './project-views';

/**
 * 「添加或管理面板」弹层（原型 `index.html:1760` `addViewPanel`）。
 *
 * 表格、看板始终保留、不在这里增删；本框只勾选/取消**额外视图**（日历、时间轴）。
 * 保存把最新启用集冒泡给页面（`ProjectBoardPane`）落盘——⛔ 本框不碰 localStorage，
 * 也不碰任何需求：移除面板只调整显示（判据 2「移除面板不删需求」）。
 */
const props = defineProps<{ enabled: readonly ProjectExtraView[] }>();
const emit = defineEmits<{ close: []; save: [ProjectExtraView[]] }>();

/** 额外视图定义（带原型文案）。固定视图不出现在管理面里。 */
const options = PROJECT_VIEWS.filter((def) => !def.fixed);

/** 本地勾选态，从当前启用集初始化；保存前不改上层任何东西。 */
const checked = ref<Set<ProjectExtraView>>(new Set(props.enabled));

function toggle(id: ProjectExtraView, on: boolean): void {
  const next = new Set(checked.value);
  if (on) next.add(id);
  else next.delete(id);
  checked.value = next;
}

function onSave(): void {
  // 按 EXTRA_VIEWS 的稳定序输出，勾了哪些就启用哪些。
  emit(
    'save',
    EXTRA_VIEWS.filter((id) => checked.value.has(id)),
  );
}
</script>

<template>
  <ProjectDialogShell title="添加或管理面板" @close="emit('close')">
    <p class="vm-lead">表格、看板始终保留。其他面板按当前项目需要添加。</p>
    <div class="vm-options">
      <label v-for="def in options" :key="def.id" class="vm-option" :data-view="def.id">
        <input
          type="checkbox"
          :data-testid="`view-manage-${def.id}`"
          :checked="checked.has(def.id as ProjectExtraView)"
          @change="toggle(def.id as ProjectExtraView, ($event.target as HTMLInputElement).checked)"
        />
        <span class="vm-option__text">
          <b>{{ def.label }}</b>
          <small>{{ def.description }}</small>
        </span>
      </label>
    </div>
    <p class="vm-note">移除面板只调整显示，需求和日期记录保留。</p>

    <template #foot>
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="view-manage-cancel"
        @click="emit('close')"
      >
        取消
      </button>
      <button class="btn btn--primary" type="button" data-testid="view-manage-save" @click="onSave">
        保存面板
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.vm-lead {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.vm-options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.vm-option {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
  cursor: pointer;
}
.vm-option:hover {
  border-color: var(--line-strong);
}
.vm-option__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-2);
}
.vm-option__text b {
  color: var(--ink);
  font-weight: var(--fw-title);
}
.vm-option__text small {
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.vm-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
</style>
