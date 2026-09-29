<script setup lang="ts">
import { ref, watch } from 'vue';
import type {
  ProjectTestDefect,
  ProjectTestDefectHistory,
} from '@shared/protocol/project-testing-defects.js';
import { parseTestEvidenceRefs } from './test-round-view';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
type DefectRow = Pick<
  ProjectTestDefect,
  'id' | 'title' | 'description' | 'severity' | 'assigneeSubject' | 'state' | 'version' | 'caseId'
>;
type HistoryRow = Pick<
  ProjectTestDefectHistory,
  'id' | 'action' | 'actorSubject' | 'summary' | 'evidenceRefs' | 'createdAt'
>;
const props = withDefaults(
  defineProps<{
    defects: readonly DefectRow[];
    selected: DefectRow | null;
    history: readonly HistoryRow[];
    roundVersion: number;
    readonly: boolean;
    busy: boolean;
    error?: ProjectCollabNotice | null;
    hasMore?: boolean;
    canCreate?: boolean;
    canAssign?: boolean;
    canFix?: boolean;
    canRetest?: boolean;
    historyHasMore?: boolean;
  }>(),
  {
    error: null,
    hasMore: false,
    canCreate: false,
    canAssign: false,
    canFix: false,
    canRetest: false,
    historyHasMore: false,
  },
);
const emit = defineEmits<{
  select: [id: string];
  loadMore: [];
  moreHistory: [];
  create: [
    value: {
      expectedVersion: number;
      title: string;
      description: string;
      severity: 'blocker' | 'major' | 'minor';
      assigneeSubject: string;
      caseId: string | null;
    },
  ];
  assign: [
    value: { defectId: string; expectedVersion: number; assigneeSubject: string; reason: string },
  ];
  fix: [
    value: { defectId: string; expectedVersion: number; summary: string; evidenceRefs: string[] },
  ];
  retest: [
    value: {
      defectId: string;
      expectedVersion: number;
      result: 'passed' | 'failed';
      summary: string;
      evidenceRefs: string[];
    },
  ];
}>();
const validation = ref('');
const title = ref('');
const description = ref('');
const severity = ref<'blocker' | 'major' | 'minor'>('major');
const assignee = ref('');
const caseId = ref('');
const summary = ref('');
const evidence = ref('');
const stateLabels = { open: '待修复', fixed: '待复测', closed: '已关闭' } as const;
const actionLabels = {
  created: '登记缺陷',
  assigned: '分派',
  fixed: '提交修复',
  'retest-passed': '复测通过',
  'retest-failed': '复测失败',
} as const;
watch(
  () => props.selected?.id,
  () => {
    summary.value = '';
    evidence.value = '';
    assignee.value = '';
  },
);
watch(
  () => props.readonly,
  (value) => {
    if (value) {
      title.value = '';
      description.value = '';
      summary.value = '';
      evidence.value = '';
      assignee.value = '';
      caseId.value = '';
    }
  },
);
function create() {
  if (
    props.readonly ||
    props.busy ||
    !props.canCreate ||
    !title.value.trim() ||
    !assignee.value.trim()
  )
    return;
  emit('create', {
    expectedVersion: props.roundVersion,
    title: title.value.trim(),
    description: description.value,
    severity: severity.value,
    assigneeSubject: assignee.value.trim(),
    caseId: caseId.value.trim() || null,
  });
}
function act(action: 'assign' | 'fix' | 'passed' | 'failed') {
  const defect = props.selected;
  if (props.readonly || props.busy || !defect || !summary.value.trim()) return;
  const base = { defectId: defect.id, expectedVersion: defect.version };
  if (action === 'assign') {
    if (!props.canAssign || !assignee.value.trim()) return;
    emit('assign', {
      ...base,
      assigneeSubject: assignee.value.trim(),
      reason: summary.value.trim(),
    });
    return;
  }
  const evidenceRefs = parseTestEvidenceRefs(evidence.value);
  if (evidenceRefs === null) {
    validation.value = '证据须为文件版本引用或不含账号密码的网页链接。';
    return;
  }
  validation.value = '';
  const body = { ...base, summary: summary.value.trim(), evidenceRefs };
  if (action === 'fix') {
    if (props.canFix && defect.state === 'open') emit('fix', body);
  } else if (props.canRetest && defect.state === 'fixed')
    emit('retest', { ...body, result: action });
}
</script>
<template>
  <section class="test-defects" aria-label="缺陷记录">
    <h3>缺陷记录</h3>
    <p v-if="validation" role="alert">{{ validation }}</p>
    <p v-if="readonly">本轮缺陷记录只读。</p>
    <p v-if="error" role="alert">
      {{ error.message
      }}<ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
    </p>
    <ul>
      <li v-for="defect in defects" :key="defect.id">
        <button type="button" class="btn btn--ghost" @click="emit('select', defect.id)">
          {{ defect.title }} · {{ stateLabels[defect.state] }}
        </button>
      </li>
    </ul>
    <p v-if="!defects.length && !busy && !error">暂无缺陷记录。</p>
    <button
      v-if="hasMore"
      class="btn btn--ghost"
      type="button"
      :disabled="busy"
      @click="emit('loadMore')"
    >
      加载更多缺陷
    </button>
    <fieldset v-if="canCreate && !readonly" :disabled="busy">
      <legend>登记缺陷</legend>
      <label>标题<input v-model="title" maxlength="200" data-testid="defect-title" /></label
      ><label>描述<textarea v-model="description" rows="3" maxlength="4000" /></label
      ><label
        >严重程度<select v-model="severity">
          <option value="blocker">阻断</option>
          <option value="major">主要</option>
          <option value="minor">次要</option>
        </select></label
      ><label>研发处理人标识<input v-model="assignee" data-testid="defect-assignee" /></label
      ><label>关联用例标识（可选）<input v-model="caseId" /></label
      ><button
        type="button"
        class="btn btn--primary"
        :disabled="!title.trim() || !assignee.trim()"
        data-testid="defect-create"
        @click="create"
      >
        登记缺陷
      </button>
    </fieldset>
    <section v-if="selected" aria-label="缺陷详情">
      <h4>{{ selected.title }}</h4>
      <p class="preserve">{{ selected.description }}</p>
      <p>{{ stateLabels[selected.state] }} · 研发处理人 {{ selected.assigneeSubject }}</p>
      <p v-if="selected.caseId">关联用例：{{ selected.caseId }}</p>
      <ol>
        <li v-for="entry in history" :key="entry.id">
          <strong>{{ actionLabels[entry.action] }}</strong> · {{ entry.actorSubject }} ·
          {{ entry.createdAt }}
          <p class="preserve">{{ entry.summary }}</p>
          <ul>
            <li v-for="(reference, index) in entry.evidenceRefs" :key="index">{{ reference }}</li>
          </ul>
        </li>
      </ol>
      <button v-if="historyHasMore" type="button" :disabled="busy" @click="emit('moreHistory')">
        加载更多缺陷历史
      </button>
      <fieldset v-if="!readonly && (canAssign || canFix || canRetest)" :disabled="busy">
        <legend>处理缺陷</legend>
        <label v-if="canAssign">新的研发处理人标识<input v-model="assignee" /></label
        ><label
          >处理说明<textarea
            v-model="summary"
            rows="3"
            maxlength="4000"
            data-testid="defect-action-summary"
          /></label
        ><label>证据引用（每行一项）<textarea v-model="evidence" rows="2" /></label>
        <div class="actions">
          <button
            v-if="canAssign"
            type="button"
            class="btn btn--ghost"
            :disabled="!summary.trim() || !assignee.trim()"
            @click="act('assign')"
          >
            改派</button
          ><button
            v-if="canFix && selected.state === 'open'"
            type="button"
            class="btn btn--primary"
            :disabled="!summary.trim()"
            data-testid="defect-fix"
            @click="act('fix')"
          >
            提交修复</button
          ><button
            v-if="canRetest && selected.state === 'fixed'"
            type="button"
            class="btn btn--primary"
            :disabled="!summary.trim()"
            data-testid="defect-retest-pass"
            @click="act('passed')"
          >
            复测通过</button
          ><button
            v-if="canRetest && selected.state === 'fixed'"
            type="button"
            class="btn btn--ghost"
            :disabled="!summary.trim()"
            data-testid="defect-retest-fail"
            @click="act('failed')"
          >
            复测失败并重开
          </button>
        </div>
      </fieldset>
    </section>
  </section>
</template>
<style scoped>
.test-defects,
fieldset,
label {
  display: grid;
  gap: var(--px-8);
}
h3,
h4,
p {
  margin: 0;
}
fieldset {
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  padding: var(--px-12);
}
input,
textarea,
select {
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  padding: var(--px-8);
  font: inherit;
}
.preserve {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--px-8);
}
</style>
