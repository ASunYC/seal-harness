<script setup lang="ts">
import type { Todo } from '@shared/protocol/project-collab.js';

import type { RequirementChildSummary } from './requirement-detail';

/**
 * 单屏需求详情「执行进展」里的直接子项列表（原型紧凑任务层 `.compact-task12`：
 * 状态点 | 标题与副行 | 状态）。
 *
 * 只呈现、只发意图：点得开的子项上冒 `open`，由详情决定是换成子需求的详情还是开子任务的
 * 编辑弹层。进度数字不在这里算（服务端 childDone / childTotal，见 requirement-detail.ts）。
 */
const props = defineProps<{
  items: readonly RequirementChildSummary[];
  /** 这一条点不点得开：子需求恒可开详情；子任务要改得动才给开编辑（改不动的不摆入口）。 */
  canOpen: (todo: Todo) => boolean;
}>();

const emit = defineEmits<{ open: [Todo] }>();
</script>

<template>
  <ul class="req-detail__children">
    <li
      v-for="child in props.items"
      :key="child.todo.id"
      class="req-detail__child"
      :data-child-id="child.todo.id"
    >
      <span class="req-detail__childDot" :data-status="child.todo.status" aria-hidden="true"></span>
      <span class="req-detail__childCopy">
        <button
          v-if="props.canOpen(child.todo)"
          class="req-detail__childTitle"
          type="button"
          @click="emit('open', child.todo)"
        >
          {{ child.todo.title }}
        </button>
        <span v-else class="req-detail__childTitle">{{ child.todo.title }}</span>
        <small class="req-detail__childMeta"
          >{{ child.kindLabel }} · {{ child.assigneeLabel }}</small
        >
      </span>
      <span class="req-detail__childStatus" :data-status="child.todo.status">{{
        child.statusLabel
      }}</span>
    </li>
  </ul>
</template>

<style scoped>
.req-detail__children {
  margin: 0;
  padding: 0;
  list-style: none;
}
.req-detail__child {
  display: grid;
  min-height: var(--px-44);
  grid-template-columns: var(--px-12) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-6) var(--px-8);
  border-bottom: var(--bw) solid var(--line);
}
.req-detail__child:last-child {
  border-bottom: 0;
}
/* 状态点：颜色之外还有右侧的状态字，不单靠色相区分。 */
.req-detail__childDot {
  width: var(--px-8);
  height: var(--px-8);
  border-radius: 50%;
  background: var(--line-strong);
}
.req-detail__childDot[data-status='inProgress'] {
  background: var(--accent);
}
.req-detail__childDot[data-status='inReview'] {
  background: var(--warn);
}
.req-detail__childDot[data-status='done'] {
  background: var(--ok);
}
.req-detail__childCopy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.req-detail__childTitle {
  max-width: 100%;
  padding: 0;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-body);
  line-height: var(--lh-1p5);
  text-align: left;
  overflow-wrap: anywhere;
}
button.req-detail__childTitle {
  cursor: pointer;
}
button.req-detail__childTitle:hover {
  color: var(--accent-text);
}
button.req-detail__childTitle:focus-visible {
  border-radius: var(--r-sm);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.req-detail__childMeta {
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p4);
}
.req-detail__childStatus {
  color: var(--muted2);
  font-size: var(--fs-200);
  white-space: nowrap;
}
.req-detail__childStatus[data-status='inProgress'] {
  color: var(--accent-text);
}
.req-detail__childStatus[data-status='done'] {
  color: var(--ok-text);
}
</style>
