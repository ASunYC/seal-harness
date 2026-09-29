<script setup lang="ts">
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import { TODO_NO_REQUIREMENT_HINT } from './project-format';
const props = defineProps<{
  noun: string;
  taskScope: boolean;
  error: ProjectCollabNotice | null;
  queryError: string | null;
  loading: boolean;
  empty: boolean;
  filtered: boolean;
  canCreate: boolean;
  canWrite: boolean;
}>();
const emit = defineEmits<{ retry: []; reset: []; create: [] }>();
</script>
<template>
  <section>
    <div v-if="props.queryError" class="board-state" role="alert">
      <p>{{ props.queryError }}</p>
      <button type="button" class="btn btn--secondary" @click="emit('reset')">
        重置搜索、筛选与排序
      </button>
    </div>
    <div v-else-if="props.error" class="board-state" role="alert">
      <p class="board-state__title">{{ props.noun }}暂时不可用</p>
      <p class="board-state__desc">
        {{ props.error.message }}
        <ReferenceIdCopy
          v-if="props.error.referenceCode"
          :reference-id="props.error.referenceCode"
        />
      </p>
      <button class="btn btn--secondary" type="button" @click="emit('retry')">重试</button>
    </div>

    <div v-else-if="props.loading" class="board-state" role="status">
      <p class="board-state__desc">正在加载{{ props.noun }}…</p>
    </div>

    <div v-else-if="props.empty" class="board-state" data-testid="todos-empty" role="status">
      <div class="board-state__art" aria-hidden="true">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="10" y="10" width="36" height="36" rx="4" />
          <path d="M18 22h20M18 30h14M18 38h8" stroke-linecap="round" />
        </svg>
      </div>
      <p class="board-state__title board-state__title--calm">还没有{{ props.noun }}</p>
      <p v-if="props.taskScope" class="board-state__desc">
        任务挂在需求下：先选一条需求，再把它拆成能开工的几件事。看板看流转，表格扫全量，两个视图读的是同一份清单。
      </p>
      <p v-else class="board-state__desc">
        需求是粗颗粒的工作项，拆出来的细活挂到它下面成为任务。看板看流转，表格扫全量，两个视图读的是同一份清单。
      </p>
      <button
        v-if="props.canCreate"
        class="btn btn--primary"
        type="button"
        data-testid="todo-create-empty"
        @click="emit('create')"
      >
        新建{{ props.noun }}
      </button>
      <p
        v-else-if="props.canWrite && props.taskScope"
        class="board-state__desc"
        data-testid="todos-need-requirement"
      >
        {{ TODO_NO_REQUIREMENT_HINT }}
      </p>
    </div>

    <div
      v-else-if="props.filtered"
      class="board-state"
      data-testid="todos-filtered-empty"
      role="status"
    >
      <p class="board-state__title board-state__title--calm">没有符合条件的{{ props.noun }}</p>
      <p class="board-state__desc">没有符合当前搜索与筛选条件的{{ props.noun }}。</p>
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="todos-clear-narrowing"
        @click="emit('reset')"
      >
        清空搜索与筛选
      </button>
    </div>
  </section>
</template>
<style scoped>
.board-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.board-state__title {
  margin: 0;
  color: var(--danger-text);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
/* 空态不是故障态：同一块骨架，只把标题从危险色换回正文色 */
.board-state__title--calm {
  color: var(--ink);
}
/* ⚠️ 结构差异（未改，见报告）：原型空/错态图标为 46–48px 填充圆角方块内嵌小图标；
   本处是 56px 裸 SVG 字形，非单值可替，另议。 */
.board-state__art {
  width: 56px;
  height: 56px;
  color: var(--muted);
  opacity: 0.7;
}
.board-state__art svg {
  display: block;
  width: 100%;
  height: 100%;
}
.board-state__desc {
  max-width: 44ch;
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
</style>
