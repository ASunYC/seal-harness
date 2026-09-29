<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectWorkOverviewGroup } from '@shared/protocol/project-work-overview.js';
import { projectWorkOverviewApi, type ProjectWorkOverviewApi } from '../../sdk/projectWorkOverview';
import type { ProjectRefTarget } from './project-refs';
import { useProjectWorkOverview } from './useProjectWorkOverview';

const props = withDefaults(
  defineProps<{
    projectId: string;
    accountEpoch: number;
    projectEpoch: number;
    api?: ProjectWorkOverviewApi;
    compact?: boolean | undefined;
  }>(),
  { compact: undefined },
);
const emit = defineEmits<{ openRef: [ProjectRefTarget]; toggleOverview: [] }>();
const state = useProjectWorkOverview(() => props, props.api ?? projectWorkOverviewApi);
const { group, counts, total, items, nextCursor, loading, error } = state;
const mode = ref<'list' | 'quadrants'>('list');
const groups: readonly {
  id: ProjectWorkOverviewGroup;
  key: 'overdue' | 'dueToday' | 'incomplete' | 'participating';
  label: string;
}[] = [
  { id: 'overdue', key: 'overdue', label: '已超期' },
  { id: 'due_today', key: 'dueToday', label: '今日到期' },
  { id: 'incomplete', key: 'incomplete', label: '待完成' },
  { id: 'participating', key: 'participating', label: '我参与执行' },
];
const formatCount = (count: number): string => count.toLocaleString('zh-CN');
</script>

<template>
  <section
    class="work-overview"
    :class="{ 'work-overview--compact': compact }"
    aria-label="我的工作概览"
    :aria-busy="loading"
    data-testid="work-overview"
  >
    <header class="work-overview__header">
      <div>
        <h3>我的工作概览</h3>
        <p v-if="!compact">当前项目共 {{ total === null ? '—' : formatCount(total) }} 项工作</p>
      </div>
      <button
        v-if="compact !== undefined"
        type="button"
        :aria-expanded="!compact"
        @click="emit('toggleOverview')"
      >
        {{ compact ? '打开工作概览' : '返回任务清单' }}
      </button>
      <div v-if="!compact" class="work-overview__controls" role="group" aria-label="概览显示方式">
        <button type="button" :aria-pressed="mode === 'list'" @click="mode = 'list'">列表</button>
        <button type="button" :aria-pressed="mode === 'quadrants'" @click="mode = 'quadrants'">
          四象限
        </button>
        <button type="button" :disabled="loading" @click="state.refresh()">刷新</button>
      </div>
    </header>
    <div
      class="work-overview__groups"
      :class="{ 'is-quadrants': !compact && mode === 'quadrants' }"
      role="group"
      aria-label="工作分组"
    >
      <button
        v-for="bucket in groups"
        :key="bucket.id"
        type="button"
        :data-group="bucket.id"
        :aria-pressed="!compact && group === bucket.id"
        @click="
          group = bucket.id;
          if (compact) emit('toggleOverview');
        "
      >
        <span>{{ bucket.label }}</span
        ><strong>{{ counts === null ? '—' : formatCount(counts[bucket.key]) }}</strong>
      </button>
    </div>
    <p v-if="error" role="alert">
      {{ error }} <button type="button" :disabled="loading" @click="state.refresh()">重试</button>
    </p>
    <p v-if="loading" role="status">正在读取工作概览…</p>
    <p v-else-if="!compact && !error && items.length === 0" class="work-overview__empty">
      此分组暂无工作
    </p>
    <ul v-if="!compact && items.length" class="work-overview__items" aria-label="分组工作列表">
      <li v-for="todo in items" :key="todo.id">
        <button
          type="button"
          :data-todo-id="todo.id"
          @click="emit('openRef', { kind: 'todo', id: todo.id })"
        >
          <span class="work-overview__title">{{ todo.title }}</span>
          <span class="work-overview__due">{{
            todo.dueAt ? `截止 ${todo.dueAt.slice(0, 10)}` : '无截止日期'
          }}</span>
        </button>
      </li>
    </ul>
    <button
      v-if="!compact && nextCursor"
      type="button"
      class="work-overview__more"
      :disabled="loading"
      @click="state.loadMore()"
    >
      加载更多
    </button>
  </section>
</template>

<style scoped>
.work-overview {
  container-type: inline-size;
  min-width: 0;
  margin: var(--px-12);
  padding: var(--px-16);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  color: var(--ink);
}
.work-overview__header {
  display: flex;
  justify-content: space-between;
  gap: var(--px-12);
  flex-wrap: wrap;
}
.work-overview--compact {
  border: 0;
  border-radius: 0;
  background: transparent;
}
.work-overview--compact .work-overview__header {
  align-items: center;
  margin-bottom: var(--px-12);
}
.work-overview h3 {
  margin: 0;
  font-size: var(--fs-400);
}
.work-overview p {
  color: var(--muted);
  font-size: var(--fs-200);
}
.work-overview button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  padding: var(--px-8);
}
.work-overview button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.work-overview button:disabled {
  opacity: 0.6;
  cursor: default;
}
.work-overview button[aria-pressed='true'] {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.work-overview__controls {
  display: flex;
  gap: var(--px-4);
  align-items: start;
  flex-wrap: wrap;
}
.work-overview__groups {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--px-8);
}
.work-overview__groups.is-quadrants {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.work-overview__groups button {
  display: flex;
  flex-direction: column;
  gap: var(--px-6);
  align-items: start;
  min-width: 0;
  overflow-wrap: anywhere;
}
.work-overview__groups strong {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-500);
}
.work-overview__items {
  list-style: none;
  margin: var(--px-12) 0 0;
  padding: 0;
  max-height: 260px;
  overflow: auto;
}
.work-overview__items button {
  display: flex;
  width: 100%;
  text-align: left;
  justify-content: space-between;
  gap: var(--px-8);
  margin-bottom: var(--px-4);
}
.work-overview__title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.work-overview__due {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-200);
}
.work-overview__more {
  margin-top: var(--px-8);
}
@container (max-width: 600px) {
  .work-overview__groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .work-overview__items button {
    flex-direction: column;
  }
}
</style>
