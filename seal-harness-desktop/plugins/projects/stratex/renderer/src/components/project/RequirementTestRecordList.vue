<script setup lang="ts">
import { REQUIREMENT_SUBMIT_TEXT, type RequirementTestRecordRow } from './requirement-submission';

/**
 * 「测试记录」页签的内容（TST-02，原型 `reviewCard` 的提交人 → 测试负责人一行）：一条需求的测试轮次，
 * 最新在前（服务端定序，⛔ 不重排）。
 *
 * 四态分开：还在取（没有旧内容时才说「正在读取」）、取失败（有旧内容照旧列出，另起一条可重试的提示）、
 * 取了是空（「暂无测试记录。」——⛔ 不与「暂未开放」混用，那一句只属于服务不支持整需求提测）、有记录。
 * ⚠️ 只取了第一页：服务端说还有更早的轮次时如实标出，⛔ 不假装这就是全部。
 *
 * TST-04（原型 `reviewCard` 的「N 个用例」与「进入测试」）：协商到用例能力（`canEnter`）才每轮一个「进入测试」，
 * 点了冒 `enter`（轮次 id），由上层打开测试页签的轮次视图；各轮条数取到了才接在行尾说「N 个用例」
 * （没有用例的轮次说 0），⛔ 没取到不编。缺陷数要等 TST-06。
 */
const props = withDefaults(
  defineProps<{
    rows: readonly RequirementTestRecordRow[];
    loaded: boolean;
    loading: boolean;
    errorMessage: string | null;
    hasMore: boolean;
    /** 各轮用例条数（轮次 id → 条数）；null ＝ 不支持或还没取到，行尾不说条数。 */
    caseCounts?: Readonly<Record<string, number>> | null;
    /** 协商到 `requirement.test_cases`：摆「进入测试」。 */
    canEnter?: boolean;
  }>(),
  { caseCounts: null, canEnter: false },
);

const emit = defineEmits<{ retry: []; enter: [string]; loadMore: [] }>();

function lineOf(row: RequirementTestRecordRow): string {
  if (props.caseCounts === null) return row.line;
  return `${row.line} · ${String(props.caseCounts[row.id] ?? 0)} ${REQUIREMENT_SUBMIT_TEXT.caseCountUnit}`;
}
</script>

<template>
  <div class="req-tests">
    <p v-if="errorMessage !== null" class="req-tests__alert" role="alert">
      {{ REQUIREMENT_SUBMIT_TEXT.recordsError }}
      <button class="req-tests__retry" type="button" :disabled="loading" @click="emit('retry')">
        {{ REQUIREMENT_SUBMIT_TEXT.retry }}
      </button>
    </p>
    <ol v-if="rows.length > 0" class="req-tests__list">
      <li
        v-for="row in rows"
        :key="row.id"
        class="req-tests__item"
        :data-state="row.state"
        data-testid="requirement-test-record"
      >
        <p class="req-tests__head">
          <b class="req-tests__round tnum">{{ row.roundLabel }}</b>
          <span class="req-tests__state" :data-state="row.state">{{ row.stateLabel }}</span>
        </p>
        <p class="req-tests__line">{{ lineOf(row) }}</p>
        <button
          v-if="props.canEnter"
          class="req-tests__enter"
          type="button"
          data-testid="requirement-test-record-enter"
          @click="emit('enter', row.id)"
        >
          {{ REQUIREMENT_SUBMIT_TEXT.enterTesting }}
        </button>
      </li>
    </ol>
    <p v-else-if="!loaded && errorMessage === null" class="req-tests__empty" role="status">
      {{ REQUIREMENT_SUBMIT_TEXT.recordsLoading }}
    </p>
    <p v-else-if="loaded" class="req-tests__empty">{{ REQUIREMENT_SUBMIT_TEXT.recordsEmpty }}</p>
    <p v-if="hasMore && rows.length > 0" class="req-tests__more">
      {{ REQUIREMENT_SUBMIT_TEXT.recordsTruncated(rows.length) }}
      <button
        class="req-tests__retry"
        type="button"
        :disabled="loading"
        data-testid="requirement-test-record-more"
        @click="emit('loadMore')"
      >
        {{ loading ? '正在读取…' : '加载更早轮次' }}
      </button>
    </p>
  </div>
</template>

<style scoped>
.req-tests {
  display: flex;
  flex-direction: column;
  gap: var(--px-8);
  margin-top: var(--px-8);
}
.req-tests__alert {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-200);
  line-height: var(--lh-1p5);
}
.req-tests__retry {
  padding: 0 var(--px-4);
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.req-tests__list {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  list-style: none;
}
.req-tests__item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-2);
  padding: var(--px-8) var(--px-12);
}
.req-tests__item + .req-tests__item {
  border-top: var(--bw) solid var(--line);
}
.req-tests__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
  margin: 0;
}
.req-tests__round {
  color: var(--ink);
  font-size: var(--fs-300);
  font-weight: var(--fw-label);
}
.req-tests__state {
  padding: 0 var(--px-6);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-200);
}
/* 在测的两档要人盯着：警示色；通过用成功色；退回与撤回留默认灰（结论另读）。 */
.req-tests__state[data-state='queued'],
.req-tests__state[data-state='testing'] {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.req-tests__state[data-state='passed'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.req-tests__line {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p5);
  overflow-wrap: anywhere;
}
/* 原型 reviewCard 右下角的「进入测试」：强调色文字钮，贴行尾。 */
.req-tests__enter {
  align-self: flex-end;
  padding: 0 var(--px-4);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
  cursor: pointer;
}
.req-tests__enter:hover {
  background: var(--accent-soft);
}
.req-tests__enter:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.req-tests__empty {
  margin: 0;
  padding: var(--px-32) var(--px-16);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  font-size: var(--fs-300);
  line-height: var(--lh-body);
  text-align: center;
}
.req-tests__more {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
}
</style>
