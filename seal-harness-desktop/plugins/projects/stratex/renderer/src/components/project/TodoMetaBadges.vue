<script setup lang="ts">
import { computed } from 'vue';

import { todoSource, todoVisibility } from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

import {
  TODO_PERSONAL_BADGE_TEXT,
  TODO_PERSONAL_HINT,
  TODO_SOURCE_LABELS,
  TODO_VISIBILITY_LABELS,
} from './project-format';
import {
  DRAFT_NOT_YET_TODO_HINT,
  pendingDraftBadgeText,
  pendingDraftCountsBySourceTodo,
} from './work-order';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 待办的来源徽标与可见性徽标（看板卡与表格行共用同一份呈现）。
 *
 * **来源只标非缺省值**：缺省是「手动创建」——绝大多数行都是人建的，每行挂一枚徽标
 * 等于每行都在说同一句废话，真正要被看见的「项目助理 / 外部同步」反而淹在里面。
 * 没有徽标＝人建的，这条口径在弹层里（只读的「来源」一行）有完整交代。
 *
 * **可见性两态口径按调用方决定**（`showSharedVisibility`）：
 *  - 看板卡缺省只标「个人」——协同是常态、逐卡都标只是噪声；
 *  - 表格行传 `showSharedVisibility`，逐行都标（协同 / 个人）——对齐原型 visChip
 *    「每行都有一枚可见性」。两处差异是**有意的**：由页面各自决定，不在此处写死。
 *
 * ⚠️ 个人徽标是**结果口径**而不是字段名：写「个人」说不出后果，用户看不出别人
 *    到底能不能看见，所以直接写「仅自己可见」，并在 title 里补上「拥有者也看不到」。
 *
 * ⚠️【白标】来源文案取自 `TODO_SOURCE_LABELS`，`assistant` 一律叫「项目助理」——
 *    与**处理人**列同词。⛔ 不许写回「智能助手」：那是一级模块名（专家目录里那些
 *    可挂载的助手），同一个角色在相邻两列有两个名字会让整行读起来自相矛盾。
 */
const props = withDefaults(defineProps<{ todo: Todo; showSharedVisibility?: boolean }>(), {
  showSharedVisibility: false,
});

const emit = defineEmits<{
  /** 点了「N 条草案待审阅」；打开审阅界面由父级做（弹层挂在看板那一层）。 */
  openDrafts: [];
}>();

const store = useProjectCollabStore();

const source = computed(() => todoSource(props.todo));
const isPersonal = computed(() => todoVisibility(props.todo) === 'personal');

/**
 * 「这条需求下有几条草案在等我审阅」。
 *
 * 通知可能被错过（关了开关、当时不在电脑前、锁屏划掉了）；这枚徽标是那条闭环的
 * 另一半——事后回到这一页照样找得到。与通知**判据同源**：都只认我看得见的、
 * 还开着的批次里仍待审的那些条（`pendingDraftCountsBySourceTodo`）。
 *
 * ⛔ 徽标上**不写草案标题**：草案是半成品，不该在团队看板上先占一个说法。
 */
const pendingDrafts = computed(
  () => pendingDraftCountsBySourceTodo(store.draftBatches, store.mySubject).get(props.todo.id) ?? 0,
);
</script>

<template>
  <span
    v-if="isPersonal"
    class="todo-badge todo-badge--personal"
    data-testid="todo-visibility-badge"
    :title="TODO_PERSONAL_HINT"
  >
    <svg
      class="todo-badge__ico"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <rect x="2.5" y="5.2" width="7" height="5" rx="1.2" stroke-width="1.2" />
      <path d="M4.2 5.2V4a1.8 1.8 0 0 1 3.6 0v1.2" stroke-width="1.2" stroke-linecap="round" />
    </svg>
    {{ TODO_PERSONAL_BADGE_TEXT }}
  </span>
  <!-- 协同徽标只在调用方要求逐行都标时出（表格）：压到最弱一档，不与个人/来源抢眼 -->
  <span
    v-else-if="props.showSharedVisibility"
    class="todo-badge todo-badge--shared"
    data-testid="todo-visibility-badge"
    >{{ TODO_VISIBILITY_LABELS.shared }}</span
  >
  <span
    v-if="source !== 'manual'"
    class="todo-badge todo-badge--source"
    :data-source="source"
    data-testid="todo-source-badge"
    >{{ TODO_SOURCE_LABELS[source] }}</span
  >
  <!--
    ⚠️ `data-todo-interactive` 不能省：表格行整行可点（点开＝详情或编辑），没有这个标记
    点徽标会同时打开那一条，用户看到的是弹错了的那个界面。
  -->
  <button
    v-if="pendingDrafts > 0"
    class="todo-badge todo-badge--drafts"
    type="button"
    data-todo-interactive
    data-testid="todo-draft-badge"
    :title="DRAFT_NOT_YET_TODO_HINT"
    @click="emit('openDrafts')"
  >
    {{ pendingDraftBadgeText(pendingDrafts) }}
  </button>
</template>

<style scoped>
.todo-badge {
  display: inline-flex;
  height: var(--px-17); /* 原型 .vis / .dft = height 17px（旧 16px） */
  align-items: center;
  gap: var(--px-4); /* 原型 .vis gap=4px（旧 3px） */
  padding: 0 var(--px-7); /* 原型 .vis / .dft = padding 0 7px（旧 0 5px） */
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.todo-badge__ico {
  display: block;
  width: 10px; /* 图标固有尺寸（D2.15 例外，不 token 化） */
  height: 10px;
}
/* 个人条目要一眼认得出：实心底 + 强调描边，不与「标签」那种虚线弱标记混淆 */
.todo-badge--personal {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-weight: var(--fw-label);
}
/* 协同是缺省态、逐行都在：压到最弱一档（无描边 + 沉底），只作背景不抢注意力 */
.todo-badge--shared {
  border-color: transparent;
  color: var(--muted);
  background: var(--sunken);
}
/* 来源是元数据不是状态：留在弱色档，别与优先级/临期抢注意力 */
.todo-badge--source[data-source='external'] {
  border-style: dashed;
}
/* 草案徽标：可点（打开审阅界面），用强调色与只读的来源/可见性徽标区分。 */
.todo-badge--drafts {
  border: var(--bw) solid var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
  font: inherit;
  font-size: var(--fs-100);
  cursor: pointer;
}
.todo-badge--drafts:hover {
  border-color: var(--accent);
}
.todo-badge--drafts:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
</style>
