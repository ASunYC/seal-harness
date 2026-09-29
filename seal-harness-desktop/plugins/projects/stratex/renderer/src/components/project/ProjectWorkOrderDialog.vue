<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  PROJECT_TODO_ACCEPTANCE_NOTE_MAX_LENGTH,
  PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH,
  todoConstraints,
} from '@shared/protocol/project-collab.js';
import type { Todo, TodoAcceptanceItem } from '@shared/protocol/project-collab.js';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { TODO_STATUS_LABELS, formatProjectTime } from './project-format';
import {
  ACCEPTANCE_NOTE_PLACEHOLDER,
  COMPLETION_ENTRY_LABELS,
  COMPLETION_SUMMARY_HINT,
  REJECT_REASON_REQUIRED_HINT,
  SELF_REVIEW_BLOCKED_HINT,
  WORK_ORDER_NO_DIRECT_DONE_HINT,
  acceptanceProgressText,
  canReviewWorkOrder,
  canSubmitWorkOrder,
  isWorkOrderSelfReview,
  pendingAcceptanceItems,
} from './work-order';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 工作单详情：一份规格 + 两个方向的动作。
 *
 * **执行方**：逐条写「这条我是怎么满足的」，连同「做了什么」一起提交待验收。
 * ⛔ 这里**没有**「直接标完成」——有验收清单的单，服务端一律拒绝那条路，
 * 摆一个必然失败的按钮只会让人以为是界面坏了。
 *
 * **派单方**：逐条勾验收，全勾才能通过；不满意就打回，**理由必填**。
 * 前端拦一道只是不给必错的按钮：契约层 refine 与服务端各有一道，⛔ 别指望这一处。
 *
 * 弹层自己持有详情快照（逐条判据 + 完成记录时间线）：它只在打开时有意义，
 * 放进 store 就得再写一套「什么时候作废」。列表里的那条待办由 store 负责保持权威。
 */
const props = defineProps<{ todo: Todo }>();
const emit = defineEmits<{ close: [] }>();

const store = useProjectCollabStore();

const loading = ref(true);
const busy = ref(false);
/** 服务端回的这张单的当下样子；null ＝还没取到（或取失败）。 */
const todo = ref<Todo>(props.todo);
const acceptanceItems = ref<readonly TodoAcceptanceItem[]>([]);
const completionRecords = ref<
  readonly {
    id: string;
    entryKind: 'completion' | 'rejection';
    authorDisplayName: string;
    summary: string;
    createdAt: string;
  }[]
>([]);

/** 执行方逐条自述（序号 → 正文），提交待验收时一起带上。 */
const itemNotes = ref<Record<number, string>>({});
/** 执行方的「做了什么」。必填——验收人只能看到这些。 */
const summary = ref('');
/** 派单方本次勾上的判据序号（服务端 accept 时一并落库）。 */
const stagedOrdinals = ref<readonly number[]>([]);
/** 打回理由。必填——不写理由的打回等于让执行方猜。 */
const rejectReason = ref('');
/** 打回表单是否展开：默认收着，别把「打回」摆成与「通过」同等重量的第一选择。 */
const rejectOpen = ref(false);

const progress = computed(() => acceptanceProgressText(todo.value));
const constraints = computed(() => todoConstraints(todo.value));

const canEdit = computed(() => store.canEditTodo(todo.value));
const canSubmit = computed(() => canSubmitWorkOrder(todo.value, { canEdit: canEdit.value }));
const canReview = computed(() =>
  canReviewWorkOrder(todo.value, { canWrite: store.canWrite, mySubject: store.mySubject }),
);
/** 「我就是执行方」——待验收中的自证那一档，说清为什么这里没有验收按钮。 */
const selfReviewBlocked = computed(
  () => todo.value.status === 'inReview' && isWorkOrderSelfReview(todo.value, store.mySubject),
);

/** 勾选态 ＝ 服务端已勾 ∪ 本次刚勾。已勾的不给取消（服务端没有「取消勾选」这条路）。 */
function isChecked(item: TodoAcceptanceItem): boolean {
  return item.checked || stagedOrdinals.value.includes(item.ordinal);
}

/** 还差哪几条——通过被拒时把它们原样列出来，⛔ 不丢一句「操作失败」让人回去自己数。 */
const pendingItems = computed(() =>
  pendingAcceptanceItems(acceptanceItems.value, stagedOrdinals.value),
);
const canAccept = computed(() => canReview.value && !busy.value && pendingItems.value.length === 0);
/** 打回理由为空 ⇒ 提交不了。契约层同判（refine），这里只是不给必错的按钮。 */
const canReject = computed(
  () => canReview.value && !busy.value && rejectReason.value.trim() !== '',
);
const canSend = computed(() => canSubmit.value && !busy.value && summary.value.trim() !== '');

onMounted(() => {
  void reload();
});

async function reload(): Promise<void> {
  loading.value = true;
  try {
    const detail = await store.loadTodoDetail(props.todo.id);
    if (detail === null) return;
    todo.value = detail.todo;
    acceptanceItems.value = detail.acceptanceItems;
    completionRecords.value = detail.completionRecords.map((record) => ({
      id: record.id,
      entryKind: record.entryKind,
      authorDisplayName: record.authorDisplayName,
      summary: record.summary,
      createdAt: record.createdAt,
    }));
    // 服务端那份勾选态才是权威：重取之后本地暂存的勾一律清掉，
    // 否则「已勾」会在两份来源之间叠加，界面上看着比实际多。
    stagedOrdinals.value = [];
    itemNotes.value = Object.fromEntries(
      detail.acceptanceItems.map((item) => [item.ordinal, item.executorNote]),
    );
  } finally {
    loading.value = false;
  }
}

function toggleCheck(item: TodoAcceptanceItem): void {
  if (item.checked) return;
  stagedOrdinals.value = stagedOrdinals.value.includes(item.ordinal)
    ? stagedOrdinals.value.filter((ordinal) => ordinal !== item.ordinal)
    : [...stagedOrdinals.value, item.ordinal];
}

function noteOf(ordinal: number): string {
  return itemNotes.value[ordinal] ?? '';
}

function setNote(ordinal: number, event: Event): void {
  itemNotes.value = {
    ...itemNotes.value,
    [ordinal]: (event.target as HTMLTextAreaElement).value,
  };
}

async function submit(): Promise<void> {
  if (!canSend.value) return;
  busy.value = true;
  try {
    const notes = acceptanceItems.value
      .map((item) => ({ ordinal: item.ordinal, note: noteOf(item.ordinal).trim() }))
      .filter((entry) => entry.note.length > 0);
    const outcome = await store.submitTodoReview({
      todoId: todo.value.id,
      expectedVersion: todo.value.version,
      summary: summary.value.trim(),
      ...(notes.length > 0 ? { itemNotes: notes } : {}),
    });
    if (outcome === 'ok') {
      summary.value = '';
      await reload();
      return;
    }
    // 409：手上这份快照已经过期，重取即可；其余失败保留用户输入（那是几百字亲笔）。
    if (outcome === 'conflict') await reload();
  } finally {
    busy.value = false;
  }
}

async function decide(decision: 'accept' | 'reject'): Promise<void> {
  if (decision === 'accept' ? !canAccept.value : !canReject.value) return;
  busy.value = true;
  try {
    const outcome = await store.reviewTodo({
      todoId: todo.value.id,
      expectedVersion: todo.value.version,
      decision,
      ...(decision === 'accept'
        ? { checkedOrdinals: [...stagedOrdinals.value] }
        : { reason: rejectReason.value.trim() }),
    });
    if (outcome === 'ok') {
      rejectReason.value = '';
      rejectOpen.value = false;
      emit('close');
      return;
    }
    if (outcome === 'conflict') await reload();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell :title="`工作单 · ${todo.title}`" @close="emit('close')">
    <p v-if="loading" class="wo-state" data-testid="wo-loading" role="status">
      正在取这张单的规格…
    </p>

    <template v-else>
      <div class="wo-head">
        <span class="wo-chip" :data-status="todo.status">{{
          TODO_STATUS_LABELS[todo.status]
        }}</span>
        <span class="wo-chip wo-chip--count tnum" data-testid="wo-progress">{{
          progress.text
        }}</span>
      </div>

      <section v-if="todo.description" class="wo-sec" data-testid="wo-goal">
        <h4 class="wo-sec__title">要做成什么</h4>
        <p class="wo-sec__body">{{ todo.description }}</p>
      </section>

      <section v-if="constraints" class="wo-sec" data-testid="wo-constraints">
        <h4 class="wo-sec__title">注意事项</h4>
        <p class="wo-sec__body">{{ constraints }}</p>
      </section>

      <section class="wo-sec" data-testid="wo-acceptance">
        <h4 class="wo-sec__title">怎么算做完</h4>
        <ul class="wo-list">
          <li
            v-for="item in acceptanceItems"
            :key="item.ordinal"
            class="wo-item"
            :data-ordinal="item.ordinal"
            :data-checked="isChecked(item) ? 'yes' : 'no'"
          >
            <label class="wo-item__head">
              <input
                type="checkbox"
                class="wo-item__box"
                data-testid="wo-item-check"
                :checked="isChecked(item)"
                :disabled="!canReview || item.checked"
                @change="toggleCheck(item)"
              />
              <span class="wo-item__text">{{ item.text }}</span>
            </label>
            <p v-if="item.checked" class="wo-item__meta" data-testid="wo-item-checked-at">
              已勾 · {{ formatProjectTime(item.checkedAt) }}
            </p>
            <!-- 执行方在这里逐条自述；不是执行方就只读地看别人写了什么 -->
            <textarea
              v-if="canSubmit"
              class="wo-item__note"
              rows="2"
              data-testid="wo-item-note"
              :value="noteOf(item.ordinal)"
              :maxlength="PROJECT_TODO_ACCEPTANCE_NOTE_MAX_LENGTH"
              :aria-label="`第 ${item.ordinal} 条的自述`"
              :placeholder="ACCEPTANCE_NOTE_PLACEHOLDER"
              @input="setNote(item.ordinal, $event)"
            ></textarea>
            <p
              v-else-if="item.executorNote"
              class="wo-item__noteRead"
              data-testid="wo-item-note-read"
            >
              {{ item.executorNote }}
            </p>
          </li>
        </ul>
      </section>

      <!-- 执行方一侧：写完成记录并推到「待验收」。⛔ 这里没有「直接标完成」 -->
      <section v-if="canSubmit" class="wo-sec" data-testid="wo-submit">
        <h4 class="wo-sec__title">做了什么</h4>
        <textarea
          v-model="summary"
          class="wo-input wo-input--area"
          rows="3"
          data-testid="wo-summary"
          :maxlength="PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH"
          placeholder="几句话交待做了什么、产出在哪"
        ></textarea>
        <p class="wo-hint">{{ COMPLETION_SUMMARY_HINT }}</p>
        <p class="wo-hint" data-testid="wo-no-direct-done">{{ WORK_ORDER_NO_DIRECT_DONE_HINT }}</p>
        <button
          class="btn btn--primary"
          type="button"
          data-testid="wo-submit-send"
          :disabled="!canSend"
          @click="submit"
        >
          提交待验收
        </button>
      </section>
      <!-- 派单方一侧：全勾才能通过；打回必须写清哪里不满足 -->
      <section v-if="canReview" class="wo-sec" data-testid="wo-review">
        <h4 class="wo-sec__title">验收</h4>
        <div
          v-if="pendingItems.length > 0"
          class="wo-pending"
          data-testid="wo-pending"
          role="status"
        >
          <p class="wo-pending__title">还有 {{ pendingItems.length }} 条没勾，不能通过：</p>
          <ul class="wo-pending__list">
            <li v-for="item in pendingItems" :key="item.ordinal" data-testid="wo-pending-item">
              {{ item.ordinal }}. {{ item.text }}
            </li>
          </ul>
        </div>
        <div class="wo-actions">
          <button
            class="btn btn--primary"
            type="button"
            data-testid="wo-accept"
            :disabled="!canAccept"
            @click="decide('accept')"
          >
            通过
          </button>
          <button
            class="btn btn--secondary"
            type="button"
            data-testid="wo-reject-open"
            :disabled="busy"
            @click="rejectOpen = !rejectOpen"
          >
            打回
          </button>
        </div>
        <div v-if="rejectOpen" class="wo-reject" data-testid="wo-reject">
          <textarea
            v-model="rejectReason"
            class="wo-input wo-input--area"
            rows="3"
            data-testid="wo-reject-reason"
            :maxlength="PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH"
            placeholder="哪里不满足、要改成什么样"
          ></textarea>
          <p class="wo-hint">{{ REJECT_REASON_REQUIRED_HINT }}</p>
          <button
            class="btn btn--primary"
            type="button"
            data-testid="wo-reject-send"
            :disabled="!canReject"
            @click="decide('reject')"
          >
            确认打回
          </button>
        </div>
      </section>

      <p v-else-if="selfReviewBlocked" class="wo-hint" data-testid="wo-self-review">
        {{ SELF_REVIEW_BLOCKED_HINT }}
      </p>

      <section v-if="completionRecords.length > 0" class="wo-sec" data-testid="wo-records">
        <h4 class="wo-sec__title">往来记录</h4>
        <ol class="wo-records">
          <li
            v-for="record in completionRecords"
            :key="record.id"
            class="wo-record"
            :data-kind="record.entryKind"
          >
            <p class="wo-record__head">
              <b>{{ COMPLETION_ENTRY_LABELS[record.entryKind] }}</b>
              <span>{{ record.authorDisplayName || '成员' }}</span>
              <span class="tnum">{{ formatProjectTime(record.createdAt) }}</span>
            </p>
            <p class="wo-record__body">{{ record.summary }}</p>
          </li>
        </ol>
      </section>
    </template>

    <template #foot>
      <button class="btn btn--ghost" type="button" :disabled="busy" @click="emit('close')">
        关闭
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.wo-state {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.wo-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.wo-chip {
  display: inline-flex;
  height: 20px;
  align-items: center;
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
}
/* 待验收是**要人动手**的一档：给它强调底，别与「未开始」同一个灰 */
.wo-chip[data-status='inReview'] {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.wo-chip[data-status='done'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.wo-chip--count {
  color: var(--muted);
}
.wo-sec {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.wo-sec__title {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
.wo-sec__body {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  white-space: pre-wrap;
}
.wo-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.wo-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
}
/* 已勾的条目退到背景里：验收时眼睛该落在还没勾的那几条上 */
.wo-item[data-checked='yes'] {
  border-color: var(--ok-line);
  background: var(--ok-soft);
}
.wo-item__head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  cursor: pointer;
}
.wo-item__box {
  margin-top: 3px;
  accent-color: var(--accent);
}
.wo-item__box:disabled {
  cursor: not-allowed;
}
.wo-item__text {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.wo-item__meta {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
}
.wo-item__note,
.wo-input {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-meta);
  resize: vertical;
}
.wo-item__note:focus,
.wo-input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.wo-item__noteRead {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
  white-space: pre-wrap;
}
.wo-input--area {
  width: 100%;
  box-sizing: border-box;
}
.wo-hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
/* 「还差哪几条」是一张待办清单不是一条报错：警示色但不用危险色 */
.wo-pending {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-md);
  color: var(--warn-text);
  background: var(--warn-soft);
  font-size: var(--fs-100);
}
.wo-pending__title {
  margin: 0;
  font-weight: var(--fw-label);
}
.wo-pending__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 0 0 var(--sp-3);
  list-style: none;
}
.wo-actions,
.wo-reject {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.wo-actions {
  flex-direction: row;
}
.wo-records {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.wo-record {
  padding: var(--sp-2);
  border-left: var(--bw-rule) solid var(--line-strong);
  padding-left: var(--sp-3);
}
/* 打回条目一眼认得出：这条时间线上「又被退回来了」是最要紧的信息 */
.wo-record[data-kind='rejection'] {
  border-left-color: var(--warn-line);
}
.wo-record__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-100);
}
.wo-record__body {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  white-space: pre-wrap;
}
</style>
