<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import { useProjectDictionariesStore } from '../../stores/projectDictionaries';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';

const props = defineProps<{ projectId: string; todo: Todo | null }>();
const emit = defineEmits<{ ready: [boolean] }>();
const moduleId = defineModel<string | null | undefined>('moduleId', { required: true });
const categoryId = defineModel<string | null | undefined>('categoryId', { required: true });
const dictionaries = useProjectDictionariesStore();
const capabilities = useProjectServiceCapabilitiesStore();
const state = computed(() => dictionaries.getState(props.projectId));
const ready = computed(
  () =>
    capabilities.supportsRequirementDictionaries &&
    state.value.loaded &&
    !state.value.loading &&
    !state.value.error,
);
const fields = computed(
  () =>
    [
      {
        key: 'module',
        label: '所属模块',
        empty: '未分模块',
        entries: state.value.modules,
        originalId: props.todo?.moduleId,
        original: props.todo?.module,
      },
      {
        key: 'category',
        label: '需求分类',
        empty: '未分类',
        entries: state.value.categories,
        originalId: props.todo?.categoryId,
        original: props.todo?.category,
      },
    ] as const,
);
const hint = computed(() => {
  if (capabilities.loading) return '正在读取服务能力…';
  if (!capabilities.loaded) return '暂未获取服务能力，请重试后选择模块和分类。';
  if (!capabilities.supportsRequirementDictionaries) return '当前服务暂不支持修改模块和分类。';
  if (state.value.loading) return '正在读取模块和分类…';
  return state.value.error;
});

async function load(): Promise<void> {
  if (!capabilities.supportsRequirementDictionaries) {
    await capabilities.load();
    return;
  }
  await dictionaries.load(props.projectId);
}
function update(key: 'module' | 'category', event: Event): void {
  if (!ready.value || !(event.target instanceof HTMLSelectElement)) return;
  const value = event.target.value || null;
  if (key === 'module') moduleId.value = value;
  else categoryId.value = value;
}
watch(ready, (value) => emit('ready', value), { immediate: true });
watch(
  () => [props.projectId, capabilities.supportsRequirementDictionaries] as const,
  ([projectId, supported]) => {
    if (supported) void dictionaries.load(projectId);
  },
  { immediate: true },
);
onMounted(() => {
  if (!capabilities.loaded) void capabilities.load();
});
</script>

<template>
  <section class="todo-editor__section" aria-labelledby="todo-planning-heading">
    <h4 id="todo-planning-heading" class="todo-editor__heading">迭代与业务分类</h4>
    <slot />
    <div class="todo-grid">
      <label
        v-for="field in fields"
        :key="field.key"
        class="todo-field"
        :data-testid="`todo-${field.key}`"
      >
        <span class="todo-field__label">{{ field.label }}</span>
        <select
          class="todo-field__input"
          :data-testid="`todo-${field.key}-select`"
          :value="(field.key === 'module' ? moduleId : categoryId) ?? ''"
          :disabled="!ready"
          @change="update(field.key, $event)"
        >
          <option value="">
            {{
              todo &&
              field.originalId === undefined &&
              (field.key === 'module' ? moduleId : categoryId) === undefined
                ? '服务未提供此字段'
                : field.empty
            }}
          </option>
          <option
            v-if="field.originalId && !field.entries.some((entry) => entry.id === field.originalId)"
            :value="field.originalId"
            disabled
          >
            {{ field.original?.name ?? field.originalId
            }}{{
              field.original?.archivedAt
                ? '（已归档）'
                : state.loaded
                  ? '（当前值，已不可选）'
                  : '（当前值）'
            }}
          </option>
          <option v-for="entry in field.entries" :key="entry.id" :value="entry.id">
            {{ entry.name }}
          </option>
        </select>
        <span v-if="ready && field.entries.length === 0" class="todo-field__hint"
          >暂无可选{{ field.label }}，请联系项目管理者维护。</span
        >
      </label>
    </div>
    <p
      v-if="hint"
      class="todo-field__hint"
      :role="state.error ? 'alert' : 'status'"
      data-testid="todo-dictionaries-hint"
    >
      {{ hint }}
      <button
        v-if="!state.loading && !capabilities.loading"
        type="button"
        class="todo-field__link"
        @click="load"
      >
        重试
      </button>
    </p>
  </section>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
