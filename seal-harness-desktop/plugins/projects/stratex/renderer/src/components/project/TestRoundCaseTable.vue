<script setup lang="ts">
import { TEST_ROUND_VIEW_TEXT, type TestCaseRowView } from './test-round-view';

/**
 * 轮次用例表（TST-04，原型 `renderVerification` 测试用例子页签的 `.req-table`）：用例 / 执行结果 / 关联缺陷 /
 * 操作四列。只呈现、只发意图：点操作列冒 `open`，由容器开弹层（执行 / 编辑还是查看由容器判身份）。
 * ⚠️ 表头「操作」写明：原型那一格是空的，空表头读屏读不出这一列是干什么的。
 */
defineProps<{ rows: readonly TestCaseRowView[] }>();

const emit = defineEmits<{ open: [string] }>();
</script>

<template>
  <div class="case-table">
    <table class="case-table__table" data-testid="test-case-table">
      <thead>
        <tr>
          <th scope="col">{{ TEST_ROUND_VIEW_TEXT.columns.case }}</th>
          <th scope="col">{{ TEST_ROUND_VIEW_TEXT.columns.result }}</th>
          <th scope="col">{{ TEST_ROUND_VIEW_TEXT.columns.defects }}</th>
          <th scope="col">{{ TEST_ROUND_VIEW_TEXT.columns.action }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" data-testid="test-case-row" :data-result="row.result">
          <td class="case-table__case">
            <span class="case-table__ordinal tnum">{{ row.ordinalLabel }}</span>
            <span class="case-table__title">{{ row.title }}</span>
          </td>
          <td>
            <span class="case-table__result" :data-result="row.result">{{ row.resultLabel }}</span>
          </td>
          <td class="case-table__defects tnum">{{ row.defectsLabel }}</td>
          <td>
            <button
              class="case-table__action"
              type="button"
              data-testid="test-case-open"
              @click="emit('open', row.id)"
            >
              {{ row.actionLabel }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 原型 .table-shell：描边圆角容器，窄宽时表格自己横滚、⛔ 不撑破页面。 */
.case-table {
  overflow-x: auto;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
.case-table__table {
  width: 100%;
  min-width: 520px; /* 四列最窄可读宽度：再窄就横滚，不把用例名称挤成一列一字 */
  border-collapse: collapse;
  font-size: var(--fs-300);
}
.case-table__table th {
  padding: var(--px-8) var(--px-12);
  border-bottom: var(--bw) solid var(--line);
  color: var(--muted);
  background: var(--sunken);
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
  text-align: left;
  white-space: nowrap;
}
.case-table__table td {
  padding: var(--px-8) var(--px-12);
  vertical-align: middle;
}
.case-table__table tbody tr + tr td {
  border-top: var(--bw) solid var(--line);
}
.case-table__case {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--px-8);
}
.case-table__ordinal {
  flex: 0 0 auto;
  color: var(--muted2);
  font-size: var(--fs-200);
}
.case-table__title {
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.case-table__result {
  padding: 0 var(--px-6);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-200);
  white-space: nowrap;
}
/* 原型 caseTag：通过绿、失败与阻塞警示、未执行默认灰。 */
.case-table__result[data-result='passed'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.case-table__result[data-result='failed'],
.case-table__result[data-result='blocked'] {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.case-table__defects {
  color: var(--muted2);
}
/* 原型 textbtn：强调色文字钮。 */
.case-table__action {
  padding: 0 var(--px-4);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-weight: var(--fw-label);
  white-space: nowrap;
  cursor: pointer;
}
.case-table__action:hover {
  background: var(--accent-soft);
}
.case-table__action:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
</style>
