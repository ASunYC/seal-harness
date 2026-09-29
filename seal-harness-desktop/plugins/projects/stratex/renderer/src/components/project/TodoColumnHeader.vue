<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import type { TodoFieldDescriptor } from './todo-fields';
import { isTodoFieldHideable } from './todo-fields';
import type { TodoViewState } from './useTodoViewState';
import { todoColumnWidth } from './todo-column-layout';

const props = defineProps<{
  field: TodoFieldDescriptor;
  state: TodoViewState;
  sortable: boolean;
}>();
const emit = defineEmits<{ sort: [] }>();
const width = computed(() =>
  todoColumnWidth(props.field.key, props.state.config.columnWidths ?? {}),
);
const pinned = computed(
  () => props.state.config.pinnedFieldKeys?.includes(props.field.key) ?? false,
);
let stopDrag: (() => void) | null = null;
function resize(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  stopDrag?.();
  const startX = event.clientX;
  const initialWidth = width.value;
  const move = (next: PointerEvent): void =>
    props.state.setColumnWidth(props.field.key, initialWidth + next.clientX - startX);
  const stop = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    stopDrag = null;
  };
  stopDrag = stop;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}
function resizeKey(event: KeyboardEvent): void {
  const delta = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0;
  if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  props.state.setColumnWidth(
    props.field.key,
    event.key === 'Home' ? 80 : event.key === 'End' ? 720 : width.value + delta,
  );
}
onBeforeUnmount(() => stopDrag?.());
</script>

<template>
  <div class="todo-column-head">
    <button
      class="todo-tbl__sort"
      type="button"
      :disabled="!props.sortable"
      :data-direction="
        props.state.config.sort.key === props.field.key
          ? props.state.config.sort.direction
          : undefined
      "
      :data-testid="`todo-sort-${props.field.key}`"
      @click="emit('sort')"
    >
      {{ props.field.label }}
    </button>
    <details class="todo-column-menu">
      <summary :aria-label="`${props.field.label}列设置`">⋯</summary>
      <div class="todo-column-menu__items">
        <button
          type="button"
          :aria-pressed="pinned"
          @click="props.state.setColumnPinned(props.field.key, !pinned)"
        >
          {{ pinned ? '取消冻结' : '冻结到左侧' }}
        </button>
        <button
          type="button"
          :disabled="!isTodoFieldHideable(props.field)"
          @click="props.state.setFieldVisible(props.field, false)"
        >
          收起列
        </button>
      </div>
    </details>
    <span
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="`调整${props.field.label}列宽`"
      :aria-valuenow="width"
      :aria-valuemin="props.field.key === 'title' ? 210 : 80"
      :aria-valuemax="720"
      class="todo-column-resize"
      @pointerdown="resize"
      @keydown="resizeKey"
    />
  </div>
</template>

<style scoped>
.todo-column-head {
  display: flex;
  position: relative;
  align-items: center;
  min-height: var(--ctl-h);
}
.todo-tbl__sort {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.todo-tbl__sort:disabled {
  cursor: default;
}
.todo-tbl__sort[data-direction='asc']::after {
  content: ' ↑';
}
.todo-tbl__sort[data-direction='desc']::after {
  content: ' ↓';
}
.todo-tbl__sort:focus-visible {
  outline: var(--bw) solid var(--focus-ring-color);
}
.todo-column-menu {
  margin-right: var(--sp-3);
}
.todo-column-menu summary {
  cursor: pointer;
  list-style: none;
  padding: var(--sp-1);
}
.todo-column-menu__items {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: var(--z-sticky);
  display: grid;
  padding: var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel);
}
.todo-column-menu__items button {
  padding: var(--sp-2);
  border: 0;
  background: transparent;
  color: var(--ink);
  white-space: nowrap;
  text-align: left;
}
.todo-column-menu__items button:disabled {
  color: var(--muted);
}
.todo-column-resize {
  position: absolute;
  inset: 0 0 0 auto;
  width: var(--px-7);
  cursor: col-resize;
  touch-action: none;
}
.todo-column-resize:hover,
.todo-column-resize:focus-visible {
  background: var(--accent-line);
  outline: var(--bw) solid var(--focus-ring-color);
}
</style>
