<script setup lang="ts">
import { computed, ref } from 'vue';

import type { TodoDraft, TodoDraftBatch } from '@shared/protocol/project-collab.js';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { TODO_PRIORITY_LABELS, formatProjectTime } from './project-format';
import {
  DRAFT_ASSUMED_BADGE_TEXT,
  DRAFT_ASSUMED_HINT,
  DRAFT_NOT_YET_TODO_HINT,
  DRAFT_STATE_LABELS,
  isDraftBatchVisibleTo,
} from './work-order';
import { useProjectCollabStore } from '../../stores/projectCollab';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';

/**
 * 拆解草案的**审阅闸**：整批确认 / 逐条剔除 / 整批丢弃。
 *
 * 这道闸存在的全部理由，是不让 AI 拆出来的东西成为既成事实——所以：
 *  - 草案落在服务端独立的两张表里，正式清单的任何查询都看不见它；
 *  - 可见集合至多两人（拆解发起方 + 派单方），**项目拥有者也看不见**；
 *  - 事件只定向投递给批次的可见者，不把半成品广播给全组。
 *
 * ⛔ 这里没有「新建一批草案」：产出草案是智能助手拆解那条线的事（未做），
 * 不摆一个自己造半成品的入口。
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();

const store = useProjectCollabStore();

const busy = ref(false);
/** 二次确认：整批丢弃是终态且不删行，先让人看清丢的是哪一批（⛔ 不用原生 confirm）。 */
const discardingBatchId = ref<string | null>(null);
/**
 * 最近一次动作被拒的原因：整批处理挂在**出错那一批**的按钮旁，逐条剔除挂在**那一条**旁。
 * 只留最近一次——新动作一开始就收起旧原因，不与这一次的结果混在一起。
 *
 * ⚠️ 报错条本在页顶，而页顶在这个弹层背后：只落页顶，用户点了「确认 N 条成单」或「剔除」看到的
 * 就是什么都没发生。认领门、来源已删、批次 / 草案已处理要人做的事各不相同，必须在这里看得见。
 */
const failure = ref<{
  readonly target: 'batch' | 'draft';
  readonly id: string;
  readonly notice: ProjectCollabNotice;
} | null>(null);

/**
 * 只出「审阅中」且**给我看的**批次：已确认与已丢弃是终态留痕，不再接受任何动作；
 * 可见性与横幅同一条判据（服务端已过滤，这里是第二道）。
 */
const openBatches = computed(() =>
  store.draftBatches.filter(
    (batch) => batch.state === 'open' && isDraftBatchVisibleTo(batch, store.mySubject),
  ),
);

/** 一批里还等着人做决定的那几条——「确认成单」落的正是它们。 */
function pendingDrafts(batch: TodoDraftBatch): readonly TodoDraft[] {
  return batch.drafts.filter((draft) => draft.state === 'pending');
}

function draftKindLabel(batch: TodoDraftBatch): string {
  return batch.targetItemKind === 'requirement' ? '需求草案' : '任务草案';
}

function draftParentLabel(batch: TodoDraftBatch): string {
  if (batch.parentId === null) return '无父项';
  return store.todos.find((todo) => todo.id === batch.parentId)?.title ?? batch.parentId;
}

/**
 * 还等着审的条目里，有几条是助手自己补的。
 *
 * 只数 `pending`：已剔除/已成单的那些不再需要人做决定，把它们算进来会让顶部那句
 * 提示与逐条的标记对不上，人会开始怀疑到底哪个数是真的。
 */
const assumedTotal = computed(() =>
  openBatches.value.reduce(
    (total, batch) =>
      total + pendingDrafts(batch).filter((draft) => draft.basis === 'assumed').length,
    0,
  ),
);

/**
 * 跑一次草案动作；被拒时把**这一次调用新写下的**那条报错挂到目标旁。
 *
 * 只认新写下的那条（身份比对）：请求在途时切了项目的作废路径不写报错条，
 * ⛔ 不能把此前残留在页顶的另一条提示错挂到这一批 / 这一条上。
 */
async function runDraftAction(
  target: 'batch' | 'draft',
  id: string,
  action: () => Promise<boolean>,
): Promise<boolean> {
  failure.value = null;
  const noticeBefore = store.actionNotice;
  const done = await action();
  if (!done) {
    const notice = store.actionNotice;
    if (notice !== null && notice !== noticeBefore) failure.value = { target, id, notice };
  }
  return done;
}

async function drop(draftId: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await runDraftAction('draft', draftId, () => store.dropDraft(draftId));
  } finally {
    busy.value = false;
  }
}

async function resolve(batchId: string, decision: 'confirm' | 'discard'): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const done = await runDraftAction('batch', batchId, () =>
      store.resolveDraftBatch(batchId, decision),
    );
    if (!done) return;
    discardingBatchId.value = null;
    // 确认会落出新任务；草案面不发事件、待办面的事件也不为草案而发，只能自己重取。
    if (decision === 'confirm') await store.loadTodos(props.projectId);
    if (openBatches.value.length === 0) emit('close');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell title="审阅拆解草案" size="wide" @close="emit('close')">
    <p class="dr-hint">{{ DRAFT_NOT_YET_TODO_HINT }}</p>
    <p v-if="assumedTotal > 0" class="dr-hint is-assumed" data-testid="draft-assumed-summary">
      其中 <span class="tnum">{{ assumedTotal }}</span> 条标了「{{ DRAFT_ASSUMED_BADGE_TEXT }}」——
      {{ DRAFT_ASSUMED_HINT }}
    </p>

    <p v-if="openBatches.length === 0" class="dr-hint" data-testid="draft-empty" role="status">
      没有待审阅的草案。
    </p>

    <section
      v-for="batch in openBatches"
      :key="batch.id"
      class="dr-batch"
      :data-batch-id="batch.id"
      data-testid="draft-batch"
    >
      <header class="dr-batch__head">
        <span class="dr-batch__kind" data-testid="draft-kind">{{ draftKindLabel(batch) }}</span>
        <span class="dr-batch__parent" data-testid="draft-parent"
          >父项：{{ draftParentLabel(batch) }}</span
        >
        <span class="dr-batch__count tnum" data-testid="draft-pending-count"
          >{{ pendingDrafts(batch).length }} / {{ batch.drafts.length }} 条待审</span
        >
        <span class="dr-batch__time tnum">{{ formatProjectTime(batch.createdAt) }}</span>
      </header>

      <ol class="dr-list">
        <li
          v-for="draft in batch.drafts"
          :key="draft.id"
          class="dr-item"
          :data-draft-id="draft.id"
          :data-state="draft.state"
          data-testid="draft-item"
        >
          <div class="dr-item__head">
            <b class="dr-item__title">{{ draft.title }}</b>
            <!--
              ⭐ 「输入里有的」与「助手补的」必须**可区分**：草案确认后就成单进团队
              看板，别人会照着干。审阅的人对自己写过的那部分有把握、对补出来的那部分
              没有——他要一眼看出该重点看哪几条。⛔ 混在一起交出去等于没有区分。
              只标 assumed 那一档：缺省是「有依据」，每条都挂一枚等于每条都在说废话。
            -->
            <span
              v-if="draft.basis === 'assumed'"
              class="dr-item__assumed"
              data-testid="draft-assumed-badge"
              :title="DRAFT_ASSUMED_HINT"
              >{{ DRAFT_ASSUMED_BADGE_TEXT }}</span
            >
            <span class="dr-item__prio" :data-priority="draft.priority">{{
              TODO_PRIORITY_LABELS[draft.priority]
            }}</span>
            <span
              v-if="draft.state !== 'pending'"
              class="dr-item__state"
              data-testid="draft-item-state"
              >{{ DRAFT_STATE_LABELS[draft.state] }}</span
            >
            <button
              v-else
              class="dr-item__drop"
              type="button"
              data-testid="draft-drop"
              :disabled="busy"
              :aria-label="`剔除草案 ${draft.title}`"
              @click="drop(draft.id)"
            >
              剔除
            </button>
          </div>
          <p
            v-if="failure && failure.target === 'draft' && failure.id === draft.id"
            class="dr-item__error"
            role="alert"
            data-testid="draft-drop-error"
          >
            <span>{{ failure.notice.message }}</span>
            <ReferenceIdCopy
              v-if="failure.notice.referenceCode"
              :reference-id="failure.notice.referenceCode"
            />
          </p>
          <p v-if="draft.description" class="dr-item__desc">{{ draft.description }}</p>
          <p v-if="draft.constraintsText" class="dr-item__desc">
            注意事项：{{ draft.constraintsText }}
          </p>
          <ul v-if="draft.acceptanceItems.length > 0" class="dr-item__acc">
            <li v-for="(text, index) in draft.acceptanceItems" :key="index">{{ text }}</li>
          </ul>
        </li>
      </ol>

      <div class="dr-batch__ops">
        <button
          class="btn btn--primary"
          type="button"
          data-testid="draft-confirm"
          :disabled="busy || pendingDrafts(batch).length === 0"
          @click="resolve(batch.id, 'confirm')"
        >
          确认 {{ pendingDrafts(batch).length }} 条成单
        </button>
        <button
          v-if="discardingBatchId !== batch.id"
          class="btn btn--secondary"
          type="button"
          data-testid="draft-discard-open"
          :disabled="busy"
          @click="discardingBatchId = batch.id"
        >
          整批丢弃
        </button>
        <template v-else>
          <span class="dr-batch__warn" data-testid="draft-discard-warn"
            >丢弃后这批草案一条都不会成单，且不可翻案。</span
          >
          <button
            class="btn btn--primary btn--danger"
            type="button"
            data-testid="draft-discard-confirm"
            :disabled="busy"
            @click="resolve(batch.id, 'discard')"
          >
            确认丢弃
          </button>
          <button
            class="btn btn--ghost"
            type="button"
            data-testid="draft-discard-cancel"
            :disabled="busy"
            @click="discardingBatchId = null"
          >
            取消
          </button>
        </template>
      </div>
      <p
        v-if="failure && failure.target === 'batch' && failure.id === batch.id"
        class="dr-batch__error"
        role="alert"
        data-testid="draft-resolve-error"
      >
        <span>{{ failure.notice.message }}</span>
        <ReferenceIdCopy
          v-if="failure.notice.referenceCode"
          :reference-id="failure.notice.referenceCode"
        />
      </p>
    </section>

    <template #foot>
      <button class="btn btn--ghost" type="button" :disabled="busy" @click="emit('close')">
        关闭
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.dr-hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.dr-batch {
  display: flex;
  min-height: 0;
  flex: 1 1 0;
  flex-direction: column;
  gap: var(--sp-3);
  overflow: hidden;
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--sunken);
}
.dr-batch__head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-100);
}
.dr-batch__time {
  margin-left: auto;
}
.dr-list {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  overflow: auto;
  padding: 0;
  list-style: none;
}
.dr-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: var(--bw) solid var(--line-weak);
  border-radius: var(--r-md);
  background: var(--panel);
}
/* 已剔除的留在原地但整条降噪：留痕是这道闸的一部分，⛔ 不删行 */
.dr-item[data-state='dropped'] {
  border-style: dashed;
  opacity: 0.6;
}
.dr-item__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.dr-item__title {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
/* 草案审阅弹层原型未画其内部，无对应元素；小徽标对齐原型衍生标准 .vis/.dft = 17px / 0 7px */
.dr-item__prio,
.dr-item__state {
  display: inline-flex;
  height: var(--px-17);
  align-items: center;
  padding: 0 var(--px-7);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.dr-item__drop {
  padding: 0 var(--sp-2);
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
.dr-item__drop:hover {
  color: var(--danger-text);
  background: var(--danger-soft);
}
.dr-item__drop:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.dr-item__desc {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.dr-item__acc {
  display: flex;
  flex-direction: column;
  gap: var(--px-2); /* 验收项列表行距（弹层原型未画，保留 2px） */
  margin: 0;
  padding: 0 0 0 var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-100);
  list-style: disc;
}
.dr-batch__ops {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.dr-batch__warn {
  color: var(--warn-text);
  font-size: var(--fs-100);
}
/* 被拒原因：整批的紧跟按钮行、不随草案列表滚走（列表才是可伸缩的那一格）；逐条的紧跟那条的标题行。 */
.dr-batch__error,
.dr-item__error {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
@media (prefers-reduced-motion: reduce) {
  .dr-item__drop {
    transition: none;
  }
}
/* 「助手补的」标记：与优先级/状态标记同一排，但用 warn 档——它要人多看一眼。 */
.dr-item__assumed {
  display: inline-flex;
  height: var(--px-17); /* 同上：对齐原型衍生徽标标准 17px（旧 18px） */
  align-items: center;
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-pill);
  color: var(--warn-text);
  background: var(--warn-soft);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.dr-hint.is-assumed {
  color: var(--warn-text);
}
</style>
