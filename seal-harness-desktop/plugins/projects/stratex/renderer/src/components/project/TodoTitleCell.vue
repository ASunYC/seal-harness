<script setup lang="ts">
import { computed } from 'vue';

import {
  hasTodoChildProgress,
  isTodoRequirement,
  todoChildProgress,
} from '@shared/protocol/project-collab.js';
import type { Todo } from '@shared/protocol/project-collab.js';

import TodoMetaBadges from './TodoMetaBadges.vue';
import { todoProgressHint } from './project-format';
import { requirementTaskTotalOf, requirementTaskTotalText } from './todo-hierarchy';

/**
 * 表格的标题格——锚列，也是这张表里唯一携带「这条是什么」的一格：
 * 层级（展开件与缩进）、标题、来源/可见性徽标、任务数、标签、关联数。
 *
 * 单拎成组件的理由与 TodoTableAddRow 相同：它自带一整套排布与标记样式，
 * 留在表格里会把那个文件推到 800 行上限门口，往后加一个标记就得先拆。
 *
 * 展开件可出现在任意深度行；递归与循环保护由表格树投影统一处理。
 */
const props = withDefaults(
  defineProps<{
    todo: Todo;
    /** 0 ＝需求（或不分层的行）；1 ＝展开出来的任务行。 */
    depth?: number;
    /** 这条需求下有几条任务（0 ＝不出展开件）。 */
    childCount?: number;
    expanded?: boolean;
    /** 有展开件的表里，没有子项的行也要占住那一格，标题才对得齐。 */
    reserveCaret?: boolean;
    /**
     * 任务页（FLOW-05）：需求行的子任务数取**服务端权威总数** `requirementTaskTotal`
     * 而非手里那点已加载子行的条数——分页时手里只有一部分（判据 1「总数非当前页计算」）。
     * 需求池仍按 FLOW-01 显示当前展开能看到的 `childCount`，故默认关。
     */
    showTaskTotal?: boolean;
  }>(),
  { depth: 0, childCount: 0, expanded: false, reserveCaret: false, showTaskTotal: false },
);
/** `open`：点了需求标题（UX-02 单屏详情）；表格把它连同这一行的待办冒泡到看板那一层。 */
const emit = defineEmits<{ toggle: []; open: []; openDrafts: [] }>();

/**
 * 进度汇总（「已完成 / 总数」）。
 *
 * ⚠️ 与旁边的「任务 N」是**两个数、两件事**，刻意不合并：
 *  - `childCount` 是「当前筛选下展开能看到几条」——跟着筛选变；
 *  - 进度是这条需求的**属性**，由服务端按看的人算，不跟筛选变。
 * 合成一个数会让人以为筛选把进度也筛掉了。
 * ⛔ 这里不自己数子任务：判据在协议的 `todoChildProgress`（见那里的说明）。
 */
const progress = computed(() => todoChildProgress(props.todo));
const showProgress = computed(() => hasTodoChildProgress(props.todo));

/**
 * 任务页需求行的**权威**子任务总数徽标（FLOW-05 判据 1「总数非当前页计算」）。
 *  - 只在任务页（`showTaskTotal`）且这一行是**需求**时出现（task 行不带这个字段）；
 *  - 文案取 `requirementTaskTotal`：有数就是数（含 0），⛔ 缺席显示「未知」而非 0
 *    （`requirementTaskTotalText`），把「服务端没算」与「确实没有子任务」分开。
 * ⛔ 绝不用 `props.childCount`（手里已加载的直接子行条数）当总数——那会随翻页/筛选变。
 */
const showTaskTotalBadge = computed(() => props.showTaskTotal && isTodoRequirement(props.todo));
const taskTotalText = computed(() => requirementTaskTotalText(requirementTaskTotalOf(props.todo)));
</script>

<template>
  <span
    class="todo-tbl__titleMain"
    :data-depth="props.depth"
    :style="{ paddingInlineStart: `calc(var(--sp-5) * ${props.depth})` }"
  >
    <button
      v-if="props.childCount > 0"
      class="todo-tbl__caret"
      type="button"
      data-testid="todo-expand"
      :aria-expanded="props.expanded"
      :aria-label="`${props.expanded ? '收起' : '展开'} ${props.todo.title} 的任务`"
      @click="emit('toggle')"
    >
      <span aria-hidden="true">{{ props.expanded ? '▾' : '▸' }}</span>
    </button>
    <span v-else-if="props.reserveCaret" class="todo-tbl__caretGap" aria-hidden="true"></span>
    <!-- 完整需求 ID 已移到独立的「需求标识」列（ProjectTodoTable，对齐原型 .requirement-id18）：
         ⛔ 别再塞回标题格——36 位编号在标题格里会把整列压成几个字宽、竖排十几行。
         需求标题＝「查看需求详情」按钮（UX-02）：键盘入口，返回时焦点回到它。任务标题照旧纯文本。 -->
    <button
      v-if="isTodoRequirement(props.todo)"
      class="todo-tbl__titleText todo-tbl__titleBtn"
      :class="{ 'is-cancelled': props.todo.status === 'cancelled' }"
      type="button"
      data-todo-open-detail
      data-testid="todo-open-detail"
      :aria-label="`查看需求详情：${props.todo.title}`"
      @click="emit('open')"
    >
      {{ props.todo.title }}
    </button>
    <span
      v-else
      class="todo-tbl__titleText"
      :class="{ 'is-cancelled': props.todo.status === 'cancelled' }"
      >{{ props.todo.title }}</span
    >
    <!-- 标题右侧的徽标（对齐原型 visChip 的位置）：可见性（协同 / 个人，逐行都标）+
         进度 + 子任务数。
         ⚠️ 合并说明：main 侧这里还渲染**标签**与**关联计数**，并把整组另起一行
         （`todo-tbl__tags`）。本分支已把标签与关联各自做成独立列（对齐原型的两列），
         若照收就是同一份数据在同一行出现两次，且行高会随标签数抖动。⇒ 保留单行结构，
         只吸收 main 新增的 `@open-drafts`（草案徽标点击要能冒到调用方去开审阅弹层）。 -->
    <span class="todo-tbl__titleMeta">
      <TodoMetaBadges :todo="props.todo" show-shared-visibility @open-drafts="emit('openDrafts')" />
      <span
        v-if="showProgress"
        class="todo-tbl__progress"
        :class="{ 'is-complete': progress.done === progress.total }"
        data-testid="todo-progress"
        :title="todoProgressHint"
        >{{ progress.done }}/{{ progress.total }}</span
      >
      <!-- 任务页需求行：权威子任务总数（服务端 requirementTaskTotal），缺席显示「未知」。
           ⛔ 不用 childCount（当前已加载/筛选后的直接子行数）——分页时它只是一部分。 -->
      <span
        v-if="showTaskTotalBadge"
        class="todo-tbl__kids"
        data-testid="todo-task-total"
        :aria-label="`已拆任务 ${taskTotalText}`"
        >任务 {{ taskTotalText }}</span
      >
      <!-- 需求池（FLOW-01）：仍显示当前展开能看到几条任务（`childCount`）。 -->
      <span v-else-if="props.childCount > 0" class="todo-tbl__kids" data-testid="todo-child-count"
        >任务 {{ props.childCount }}</span
      >
    </span>
  </span>
</template>

<style scoped>
.todo-tbl__titleMain {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
/* 缩进走 padding 而不是空格字符：读屏念的是标题，不是一串空白 */
.todo-tbl__caret,
.todo-tbl__caretGap {
  display: inline-flex;
  width: var(--px-18); /* 原型 .exp（展开箭头钮）=18px（旧 16px） */
  height: var(--px-18);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}
.todo-tbl__caret {
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.todo-tbl__caret:hover {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.todo-tbl__caret:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.todo-tbl__titleText {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--fw-label);
  line-height: 1.45;
  text-overflow: ellipsis;
}
.todo-tbl__titleText.is-cancelled {
  text-decoration: line-through;
}
/* 需求标题按钮：外观仍是标题文字（无底色描边），指到才上强调色，键盘有焦点环。 */
.todo-tbl__titleBtn {
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  /* `font: inherit` 会连带重置行高与字重：补回与纯文本标题（.todo-tbl__titleText）同一度量，行高不跳 */
  font-weight: var(--fw-label);
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
}
.todo-tbl__titleBtn:hover {
  color: var(--accent-text);
}
.todo-tbl__titleBtn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 标题右侧的徽标组（原型 visChip 位置）：可见性 + 进度 + 子任务数，与标题居中对齐、不换行 */
.todo-tbl__titleMeta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--sp-1);
}
.todo-tbl__kids,
.todo-tbl__progress {
  display: inline-flex;
  /* 对齐原型标题行徽标标准 .vis/.dft = 17px / padding 0 7px（程序增量：子任务数/进度；旧 16px / 0 5px） */
  height: var(--px-17);
  align-items: center;
  padding: 0 var(--px-7);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-100);
}
/* 进度是这一行里唯一「还欠多少」的信号：等宽数字 + 比标签重一档的描边。
   做满时转绿——扫一列需求时，「哪几条已经收口」不该靠逐个读分数 */
.todo-tbl__progress {
  border-color: var(--line-strong);
  color: var(--muted2);
  background: var(--sunken);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-label);
}
.todo-tbl__progress.is-complete {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.todo-tbl__kids {
  color: var(--muted2);
  background: var(--sunken);
}
</style>
