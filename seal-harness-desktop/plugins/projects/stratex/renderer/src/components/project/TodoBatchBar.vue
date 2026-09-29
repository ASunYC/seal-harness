<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Todo, TodoStatus } from '@shared/protocol/project-collab.js';

import { TODO_DELETE_BATCH_LABEL, TODO_STATUS_LABELS, TODO_STATUS_ORDER } from './project-format';
import { todoAssigneeMemberOptions } from './todo-assignee';
import { applyTodoBatch, todoBatchLeavesWorkToUser, todoBatchReceipt } from './todo-batch';
import { projectCollabInfoNotice } from '../../stores/projectCollabErrors';
import { pushProjectCollabReceipt } from '../../stores/projectCollabReceipts';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 选中若干行后浮出的批量操作条。
 *
 * ⚠️ 它只对 `props.todos`（＝当前选中且渲染在表里的那些行）动手，绝不去够
 *    `store.todos`——判据在 `todo-batch.ts` 的注释里，那里也是唯一的执行本体。
 *
 * 「删除所选」manager+ 才出现，且**只冒泡不自己删**：确认框（级联条数、壳内确认态、
 * 超根上界拦截）挂在项目页壳层上——批量条够不着那个弹层，也不该就地弹原生 confirm。
 *
 * 处理人只对拥有者放开：跨成员转交是拥有者的动作（G-11），成员点了必撞 403。
 */
const props = defineProps<{ todos: readonly Todo[] }>();
const emit = defineEmits<{ done: []; clear: []; delete: [readonly Todo[]] }>();

const store = useProjectCollabStore();

const busy = ref(false);

/** 选中的里面有几条真能改——报得出「5 选 3」，用户才不会以为剩下两条丢了。 */
const editableCount = computed(() => props.todos.filter((todo) => store.canEditTodo(todo)).length);

async function run(patch: Parameters<typeof applyTodoBatch>[2]): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const outcome = await applyTodoBatch(store, props.todos, patch);
    // 回执会整句盖掉 store 逐条写下的提示，所以逐条失败原因并进回执本身（`todoBatchReceipt`，
    // 原因句来自共享文案表）；成功回执不带参考编号（没什么可上报的）。
    //
    // 出口二选一（判据见 `todoBatchLeavesWorkToUser`）：全落地是纯报告 ⇒ 3 秒 toast；
    // 只要有一条没改成，用户还得决定重来还是去找拥有者 ⇒ 留常驻条等他自己关。
    const receipt = todoBatchReceipt(outcome);
    if (todoBatchLeavesWorkToUser(outcome)) store.actionNotice = projectCollabInfoNotice(receipt);
    else pushProjectCollabReceipt(receipt);
    emit('done');
  } finally {
    busy.value = false;
  }
}

function onStatusPick(event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  const value = el.value;
  el.value = '';
  if (value === '') return;
  void run({ status: value as TodoStatus });
}

function onAssigneePick(event: Event): void {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement)) return;
  const value = el.value;
  el.value = '';
  // '' ＝没选（下拉回到提示项）；'__none__' ＝显式清空处理人。两者不可混为一谈。
  if (value === '') return;
  void run({ assigneeSubject: value === '__none__' ? null : value });
}

/**
 * 批量转交的承接人候选：在册且成员及以上（观察者只读，服务端 400 `assignee_not_editor`）。
 * 批量没有「当前值」要显示，所以不留观察者例外；已在目标名下的逐条跳过（`applyTodoBatch`）。
 */
const members = computed(() => todoAssigneeMemberOptions(store.detail?.members ?? [], null));
</script>

<template>
  <div class="tbatch" data-testid="todo-batch-bar" role="group" aria-label="批量操作">
    <span class="tbatch__count tnum" data-testid="todo-batch-count"
      >已选 {{ props.todos.length }} 项</span
    >
    <span
      v-if="editableCount < props.todos.length"
      class="tbatch__note"
      data-testid="todo-batch-partial"
      >其中 {{ editableCount }} 项可改</span
    >
    <span class="tbatch__spacer"></span>

    <label class="tbatch__cell">
      <span class="sr-only">批量改状态</span>
      <select
        class="tbatch__select"
        data-testid="todo-batch-status"
        :disabled="busy || editableCount === 0"
        value=""
        @change="onStatusPick"
      >
        <option value="">改状态为…</option>
        <option v-for="value in TODO_STATUS_ORDER" :key="value" :value="value">
          {{ TODO_STATUS_LABELS[value] }}
        </option>
      </select>
    </label>

    <!--
      批量改处理人＝批量转交，判据与单条编辑同一支 `canTransferTodo`（manager+，
      服务端 `todo_patch_decision` 的 transfer 支同判）。
      ⛔ 别改回 `store.isOwner`：那会让管理者看得见单条转交却用不了批量——
      同一件事两处给出不同答案，用户只会以为批量坏了。
    -->

    <label v-if="store.canTransferTodo" class="tbatch__cell">
      <span class="sr-only">批量改处理人</span>
      <select
        class="tbatch__select"
        data-testid="todo-batch-assignee"
        :disabled="busy || editableCount === 0"
        value=""
        @change="onAssigneePick"
      >
        <option value="">改处理人为…</option>
        <option value="__none__">未分配</option>
        <option v-for="member in members" :key="member.subject" :value="member.subject">
          {{ member.displayName || member.subject }}
        </option>
      </select>
    </label>

    <!--
      「删除所选」manager+ 才出现（服务端同判）。只冒泡整批选中的行，级联条数与超根上界
      拦截都在确认框里判 —— ⛔ 别在这里发删除请求，也别弹原生 confirm。
    -->
    <button
      v-if="store.canDeleteTodos"
      class="tbatch__delete"
      type="button"
      data-testid="todo-batch-delete"
      :disabled="busy"
      @click="emit('delete', props.todos)"
    >
      {{ TODO_DELETE_BATCH_LABEL }}
    </button>

    <button
      class="tbatch__clear"
      type="button"
      data-testid="todo-batch-clear"
      :disabled="busy"
      @click="emit('clear')"
    >
      取消选择
    </button>
  </div>
</template>

<style scoped>
/* 强调底 + 描边：它是一个「当前有选中」的持续状态，不是一条普通工具行 */
.tbatch {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-md);
  background: var(--accent-soft);
}
.tbatch__count {
  color: var(--accent-text);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
.tbatch__note {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.tbatch__spacer {
  flex: 1;
}
.tbatch__cell {
  display: block;
}
.tbatch__select {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
  cursor: pointer;
}
.tbatch__select:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.tbatch__select:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 「删除所选」：批量里唯一的破坏性动作——静息描边弱色，hover 才亮危险色。 */
.tbatch__delete {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font-size: var(--fs-100);
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.tbatch__delete:hover:not(:disabled) {
  border-color: var(--danger-line);
  color: var(--danger-text);
  background: var(--danger-soft);
}
.tbatch__delete:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.tbatch__delete:focus-visible {
  border-color: var(--danger-line);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.tbatch__clear {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.tbatch__clear:hover {
  color: var(--ink);
  background: var(--panel);
}
.tbatch__clear:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
