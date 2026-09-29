<script setup lang="ts">
import { nextTick, ref } from 'vue';

import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 表体末尾的行内新建行。
 *
 * 为什么单拎成一个组件：它自带一小撮状态（草稿标题、提交中、焦点），与表格本身的
 * 「读—排—分组」没有任何交集；留在表格里只会把那个文件推过 800 行的上限。
 *
 * 与弹层新建（ProjectTodoDialog）的分工：这里只收**标题**，一行敲完就落。
 * 要填处理人/截止/关联的仍走弹层——把七个字段塞进一行只会两头都不好用。
 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    colspan: number;
    /** 这一页把新建出来的东西叫什么（需求页＝「需求」）。⚠️ 不带父级，建出来的恒是顶层。 */
    noun?: string;
  }>(),
  { noun: '待办' },
);

const store = useProjectCollabStore();

const drafting = ref(false);
const title = ref('');
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);

async function start(): Promise<void> {
  drafting.value = true;
  await nextTick();
  input.value?.focus();
}

function cancel(): void {
  drafting.value = false;
  title.value = '';
}

/**
 * 提交成功才清输入并留在行内（连着敲第二条是这个入口存在的理由）；
 * 失败时**保留已输入的标题**，让人改一改再试，而不是白打一遍。
 */
async function submit(): Promise<void> {
  const trimmed = title.value.trim();
  if (trimmed.length === 0 || busy.value) return;
  busy.value = true;
  try {
    const created = await store.createTodo({
      projectId: props.projectId,
      itemKind: 'requirement',
      title: trimmed,
    });
    if (created) {
      title.value = '';
      await nextTick();
      input.value?.focus();
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <tr class="todo-add">
    <td :colspan="props.colspan">
      <button
        v-if="!drafting"
        class="todo-add__open"
        type="button"
        data-testid="todo-inline-add"
        @click="start"
      >
        <span aria-hidden="true">＋</span> 新建{{ props.noun }}
      </button>
      <form
        v-else
        class="todo-add__form"
        data-testid="todo-inline-add-form"
        @submit.prevent="submit"
      >
        <input
          ref="input"
          v-model="title"
          class="todo-add__input"
          type="text"
          :aria-label="`新${props.noun}标题`"
          placeholder="输入标题后回车新建，Esc 取消"
          data-testid="todo-inline-add-input"
          :disabled="busy"
          @keydown.esc.prevent="cancel"
        />
        <button
          class="todo-add__ok"
          type="submit"
          data-testid="todo-inline-add-submit"
          :disabled="busy || title.trim().length === 0"
        >
          新建
        </button>
        <button class="todo-add__cancel" type="button" @click="cancel">取消</button>
      </form>
    </td>
  </tr>
</template>

<style scoped>
/* 虚线上沿把它与数据行分开——它是一个动作，不是一条数据 */
.todo-add td {
  padding: 0 var(--sp-3);
  border-top: var(--bw) dashed var(--line);
  border-bottom: 0;
}
.todo-add__open {
  display: flex;
  width: 100%;
  height: var(--row-h);
  align-items: center;
  gap: var(--sp-2);
  padding: 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-100);
  text-align: left;
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.todo-add__open:hover {
  color: var(--accent-text);
}
.todo-add__open:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.todo-add__form {
  display: flex;
  height: var(--row-h);
  align-items: center;
  gap: var(--sp-2);
}
.todo-add__input {
  min-width: 0;
  flex: 1;
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
}
.todo-add__input:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.todo-add__ok {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
  cursor: pointer;
}
.todo-add__ok:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.todo-add__cancel {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
}
.todo-add__cancel:hover {
  color: var(--accent-text);
  background: var(--accent-soft);
}
</style>
