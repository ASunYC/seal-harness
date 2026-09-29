<script setup lang="ts">
import type { ProjectTestRoundDetail } from '@shared/protocol/project-testing.js';
import { isProjectTestRoundActive } from '@shared/protocol/project-testing.js';
import type { ProjectMember } from '@shared/protocol/project-collab.js';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import { memberDisplayName, TEST_ROUND_STATE_LABELS } from './requirement-submission';
import { formatProjectTime } from './project-format';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
withDefaults(
  defineProps<{
    rounds: readonly ProjectTestRoundDetail[];
    loading: boolean;
    loaded?: boolean;
    error?: ProjectCollabNotice | null;
    hasMore: boolean;
    members?: readonly ProjectMember[];
    requirementTitles?: Readonly<Record<string, string>>;
  }>(),
  { error: null, loaded: true, members: () => [], requirementTitles: () => ({}) },
);
const emit = defineEmits<{
  open: [requirementId: string, submissionId: string];
  loadMore: [];
  retry: [];
  openRequirement: [requirementId: string];
}>();
</script>
<template>
  <section
    class="testing-list"
    aria-label="项目测试记录"
    :aria-busy="loading"
    data-testid="project-testing-pane"
  >
    <header>
      <h2>测试记录</h2>
      <button type="button" class="btn btn--ghost" :disabled="loading" @click="emit('retry')">
        刷新
      </button>
    </header>
    <p class="testing-list__hint">按提交轮次查看测试内容、执行用例，并跟踪缺陷与测试结论。</p>
    <p v-if="error" class="testing-list__error" role="alert">
      {{ error.message
      }}<ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
    </p>
    <p v-if="loading" role="status">
      {{ rounds.length ? '正在更新测试记录…' : '正在读取测试记录…' }}
    </p>
    <p v-else-if="!loaded && !error" role="status">尚未读取测试记录，请刷新。</p>
    <div v-else-if="rounds.length === 0 && !error" class="testing-list__empty">
      <p>暂无测试记录。</p>
      <p class="testing-list__hint">需要测试的需求可从需求详情提交，测试负责人也可以稍后认领。</p>
    </div>
    <ol class="testing-list__rows">
      <li v-for="round in rounds" :key="round.id" :data-state="round.state">
        <div class="testing-list__row-head">
          <ReferenceIdCopy :reference-id="round.requirementId" label="需求标识" />
          <span>第 {{ round.roundNo }} 轮</span>
          <span class="testing-list__state">{{ TEST_ROUND_STATE_LABELS[round.state] }}</span>
        </div>
        <h3>{{ requirementTitles[round.requirementId] || '需求标题尚未加载' }}</h3>
        <p class="testing-list__summary">{{ round.summary }}</p>
        <dl class="testing-list__meta">
          <div>
            <dt>提交人</dt>
            <dd>{{ memberDisplayName(members, round.submittedBySubject) }}</dd>
          </div>
          <div>
            <dt>测试负责人</dt>
            <dd>
              {{
                round.reviewerSubject === null
                  ? isProjectTestRoundActive(round)
                    ? '待认领'
                    : '未指定'
                  : memberDisplayName(members, round.reviewerSubject)
              }}
            </dd>
          </div>
          <div>
            <dt>提交时间</dt>
            <dd>
              <time :datetime="round.createdAt">{{ formatProjectTime(round.createdAt) }}</time>
            </dd>
          </div>
        </dl>
        <div class="testing-list__actions">
          <button
            type="button"
            class="btn btn--ghost"
            :aria-label="`打开需求 ${requirementTitles[round.requirementId] || round.requirementId}`"
            @click="emit('openRequirement', round.requirementId)"
          >
            打开需求
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :aria-label="`${isProjectTestRoundActive(round) ? '进入测试' : '查看历史'}：${requirementTitles[round.requirementId] || round.requirementId} 第 ${round.roundNo} 轮`"
            @click="emit('open', round.requirementId, round.id)"
          >
            {{ isProjectTestRoundActive(round) ? '进入测试' : '查看历史' }}
          </button>
        </div>
      </li>
    </ol>
    <button
      v-if="hasMore"
      type="button"
      class="btn btn--ghost"
      :disabled="loading"
      data-testid="project-testing-more"
      @click="emit('loadMore')"
    >
      加载更多
    </button>
  </section>
</template>
<style scoped>
.testing-list {
  display: grid;
  gap: var(--px-12);
  padding: var(--px-16) 0;
  min-width: 0;
}
header,
.testing-list__row-head,
.testing-list__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--px-12);
  flex-wrap: wrap;
}
h2,
h3,
p,
dl,
dd {
  margin: 0;
}
.testing-list__rows {
  display: grid;
  gap: var(--px-12);
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: grid;
  gap: var(--px-12);
  min-width: 0;
  padding: var(--px-16);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
h3 {
  font-size: var(--fs-400);
  overflow-wrap: anywhere;
}
.testing-list__row-head {
  justify-content: flex-start;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.testing-list__state {
  margin-inline-start: auto;
  padding: var(--px-4) var(--px-8);
  border-radius: var(--r-pill);
  background: var(--sunken);
  color: var(--ink);
}
.testing-list__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-12) var(--px-24);
  font-size: var(--fs-meta);
}
.testing-list__meta > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
dt,
.testing-list__hint {
  color: var(--muted2);
}
.testing-list__hint {
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.testing-list__error {
  color: var(--danger-text);
}
.testing-list__empty {
  display: grid;
  gap: var(--px-8);
  padding: var(--px-24) var(--px-12);
  text-align: center;
}
.testing-list__actions {
  justify-content: flex-end;
}
button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.testing-list__summary {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
