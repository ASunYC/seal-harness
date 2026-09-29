<script setup lang="ts">
import { ref, watch } from 'vue';


const props = defineProps<{ open: boolean; tab: 'overview' | 'assistant' }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
const expanded = ref(false);
const width = defineModel<number>('width', { required: true });
let drag: { x: number; width: number } | undefined;

watch(() => props.open, open => {
  if (!open) { expanded.value = false; drag = undefined; }
});

function setWidth(value: number): void {
  const available = panel.value?.parentElement?.clientWidth ?? 1200;
  width.value = Math.round(Math.max(360, Math.min(available, value)));
}
function startResize(event: PointerEvent): void {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  event.currentTarget.focus();
  drag = { x: event.clientX, width: panel.value?.getBoundingClientRect().width ?? width.value };
  event.currentTarget.setPointerCapture(event.pointerId);
}
function resize(event: PointerEvent): void {
  if (drag) setWidth(drag.width + drag.x - event.clientX);
}
function resizeKey(event: KeyboardEvent): void {
  const delta = event.key === 'ArrowLeft' ? 20 : event.key === 'ArrowRight' ? -20 : 0;
  if (!delta && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  setWidth(event.key === 'Home' ? 360 : event.key === 'End' ? panel.value?.parentElement?.clientWidth ?? width.value : width.value + delta);
}
</script>

<template>
  <aside
    v-show="open"
    ref="panel"
    class="project-assistant"
    :class="{ 'is-expanded': expanded && open }"
    :style="{ '--assistant-width': `${width}px` }"
    aria-label="项目侧栏"
  >
    <div
      class="project-assistant__resize"
      role="separator"
      tabindex="0"
      aria-label="调整项目侧栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="width"
      :aria-valuemin="360"
      :aria-valuemax="panel?.parentElement?.clientWidth"
      @pointerdown="startResize"
      @pointermove="resize"
      @pointerup="drag = undefined"
      @pointercancel="drag = undefined"
      @lostpointercapture="drag = undefined"
      @keydown="resizeKey"
    />
    <header class="project-assistant__head">
      <b>{{ tab === 'overview' ? '项目概览' : '项目助理' }}</b>
      <span class="project-assistant__spacer" />
      <button class="btn btn--ghost" type="button" data-testid="project-assistant-expand"
        :aria-pressed="expanded" @click="expanded = !expanded">
        {{ expanded ? '还原' : '展开' }}
      </button>
      <button class="btn btn--ghost" type="button" data-testid="project-assistant-collapse" @click="emit('close')">
        收起
      </button>
    </header>
    <div v-show="tab === 'overview'" id="project-overview-panel" class="project-assistant__content"
      role="region" aria-label="项目概览">
      <slot name="overview" />
    </div>
    <div v-show="tab === 'assistant'" id="project-chat-panel" class="project-assistant__content"
      role="region" aria-label="项目助理对话">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.project-assistant {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: var(--assistant-width);
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  border-left: var(--bw) solid var(--line);
  background: var(--panel);
  z-index: 2;
}
.project-assistant__content { display: flex; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.project-assistant__content > :deep(*) { flex: 1; min-width: 0; border-left: 0; }
.project-assistant__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border-bottom: var(--bw) solid var(--line);
}
.project-assistant__spacer { flex: 1; }
.project-assistant__resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  z-index: 1;
}
.project-assistant__resize:hover, .project-assistant__resize:focus-visible {
  background: var(--accent-line);
  outline: none;
}
.project-assistant.is-expanded {
  position: absolute;
  inset: 0;
  width: 100%;
  max-width: none;
}
.is-expanded > .project-assistant__resize { display: none; }
@container project-assistant-layout (max-width: 980px) {
  .project-assistant {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(var(--assistant-width), 100%);
    max-width: 100%;
    box-shadow: -8px 0 24px #0002;
  }
  .project-assistant.is-expanded { width: 100%; }
  .project-assistant__resize { display: none; }
}
</style>
