<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { projectRuntime } from '../../../../../src/ui/runtime'

import ProjectPlanningDraftCard from './ProjectPlanningDraftCard.vue'

const reviewSessionId = ref<string | null>(null)
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ open: [sessionId: string] }>()
const runtime = projectRuntime()
const sessions = ref<Array<{ sessionId: string; title: string; updatedAt: string }>>([])
const loading = ref(true)
const error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await runtime.api.listProjectSessions({ projectId: props.projectId })
    if (current !== generation) return
    if (result.ok) sessions.value = [...result.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    else error.value = result.message
  } catch (failure) {
    if (current === generation) error.value = failure instanceof Error ? failure.message : '会话读取失败，请重试。'
  } finally { if (current === generation) loading.value = false }
}
watch(() => props.projectId, () => { sessions.value = []; reviewSessionId.value = null; void load() }, { immediate: true })
const stop = runtime.api.onProjectAgentChanged(event => { if (event.projectId === props.projectId) void load() })
onBeforeUnmount(() => { generation++; stop() })
</script>
<template>
  <section class="pjsess" aria-label="本项目的会话">
    <p v-if="loading && !sessions.length" role="status">正在读取本机会话…</p>
    <div v-else-if="error" role="alert"><p>{{ error }}</p><button class="btn btn--secondary" type="button" @click="load">重试</button></div>
    <ul v-else-if="sessions.length" class="pjsess__list">
      <li v-for="session in sessions" :key="session.sessionId"><button class="pjsess__row" type="button" @click="emit('open', session.sessionId)"><span class="pjsess__name">{{ session.title || '未命名会话' }}</span><time class="pjsess__time" :datetime="session.updatedAt">{{ new Date(session.updatedAt).toLocaleString() }}</time></button><button class="btn btn--ghost" type="button" @click="reviewSessionId = session.sessionId">查看规划草案</button></li>
    </ul>
    <div v-else class="pjsess__empty" role="status">
      <div class="pjsess__art" aria-hidden="true">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2" focusable="false">
          <rect x="8" y="12" width="40" height="28" rx="4" />
          <path d="M18 46h20M28 40v6M16 22h24M16 30h14" stroke-linecap="round" />
        </svg>
      </div>
      <p class="pjsess__emptyTitle">还没有属于本项目的会话</p><p class="pjsess__emptyHint">在「项目助理」中发送请求，即可创建本项目的会话。</p>
    </div>
    <ProjectPlanningDraftCard v-if="reviewSessionId" :session-id="reviewSessionId" :project-id="projectId" />
  </section>
</template>

<style scoped>
.pjsess {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.pjsess__state {
  margin: 0;
  padding: var(--sp-5) 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.pjsess__state.is-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  color: var(--danger-text);
}
.pjsess__errorMessage {
  margin: 0;
  overflow-wrap: anywhere;
}
.pjsess__errorActions {
  display: flex;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.pjsess__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4) 0;
}
.pjsess__bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.pjsess__title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-400) / 1.3 var(--font-sans);
}
.pjsess__count {
  padding: var(--px-1) var(--px-7); /* 原型 .cnt2 = padding 1px 7px */
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
  font-weight: var(--fw-body);
}
.pjsess__list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: var(--sp-3); /* 原型 .sess-list gap=7px（proto 档 --sp-3=7px；旧 2px 过密） */
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.pjsess__row {
  display: flex;
  width: 100%;
  min-height: var(--ctl-h);
  align-items: center;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
  border: var(--bw) solid transparent;
  border-radius: var(--r-md);
  color: var(--muted2);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.pjsess__row:hover {
  color: var(--ink);
  border-color: var(--line);
  background: var(--sunken);
}
.pjsess__row:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.pjsess__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pjsess__status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--px-5); /* 原型 .sst gap=5px */
  color: var(--muted);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.pjsess__dot {
  width: var(--px-7); /* 原型 .sst .dot=7px（旧 6px 偏小） */
  height: var(--px-7);
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--muted2);
}
.pjsess__status[data-status='running'] {
  color: var(--accent-text);
}
.pjsess__status[data-status='running'] .pjsess__dot {
  background: var(--accent);
}
.pjsess__status[data-status='failed'] {
  color: var(--danger-text);
}
.pjsess__status[data-status='failed'] .pjsess__dot {
  background: var(--danger);
}
.pjsess__time {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: var(--fs-100);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 空态（规范 §3.8 形态）：只剩一句话与一个动作，视觉重心与信息重心因此对齐 */
.pjsess__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
/* ⚠️ 结构差异（未改，见报告）：原型空/错态图标为 46px 填充圆角方块（radius 14px）内嵌 ~24px 图标；
   本处是 56px 裸 SVG 字形。非单值可替，改 56→46 只会缩小裸字形、仍不成原型形态，另议。 */
.pjsess__art {
  width: 56px;
  height: 56px;
  color: var(--muted);
  opacity: 0.7;
}
.pjsess__art svg {
  display: block;
  width: 100%;
  height: 100%;
}
.pjsess__emptyTitle {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
.pjsess__emptyHint {
  max-width: 44ch;
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
</style>
