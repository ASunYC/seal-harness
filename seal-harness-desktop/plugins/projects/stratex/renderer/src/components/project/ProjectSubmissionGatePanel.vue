<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  PROJECT_SUBMISSION_GATE_FIELDS,
  type ProjectSubmissionGate,
  type ProjectSubmissionGateValues,
} from '@shared/protocol/project-submission-gate.js';
import ProjectSubmissionGateEditor from './ProjectSubmissionGateEditor.vue';

const props = defineProps<{
  gate: ProjectSubmissionGate | null;
  draft: ProjectSubmissionGateValues | null;
  canEdit: boolean;
  loading: boolean;
  saving: boolean;
  notice: string | null;
}>();
const emit = defineEmits<{ input: [value: ProjectSubmissionGateValues]; save: []; reload: [] }>();
const editing = ref(false);
watch(
  () => [props.canEdit, props.gate] as const,
  () => {
    if (!props.canEdit || !props.gate) editing.value = false;
  },
);
watch(
  () => props.saving,
  (saving, previous) => {
    if (previous && !saving && props.draft === null && !props.notice) editing.value = false;
  },
);
function open(): void {
  if (!props.canEdit || !props.gate) return;
  if (!props.draft) emit('input', props.gate.submissionGate);
  editing.value = true;
}
</script>

<template>
  <details class="gate-panel" data-testid="submission-gate-panel">
    <summary>
      提交测试规则 <span v-if="gate">v{{ gate.gateVersion }}</span>
    </summary>
    <p v-if="loading">正在读取规则…</p>
    <template v-else-if="gate">
      <ul>
        <li v-for="field in PROJECT_SUBMISSION_GATE_FIELDS" :key="field.key">
          {{ field.label }}：{{ gate.submissionGate[field.key] ? '开启' : '关闭' }}
        </li>
      </ul>
      <p>仅影响新轮次，历史快照不变。</p>
      <button v-if="canEdit" type="button" data-testid="gate-edit" @click="open">编辑规则</button>
    </template>
    <p v-if="notice" role="alert">{{ notice }}</p>
    <button v-if="!loading" type="button" @click="emit('reload')">刷新规则</button>
    <ProjectSubmissionGateEditor
      v-if="editing && gate && draft"
      :value="draft"
      :baseline="gate.submissionGate"
      :gate-version="gate.gateVersion"
      :saving="saving"
      :notice="notice"
      @input="emit('input', $event)"
      @save="emit('save')"
      @close="editing = false"
    />
  </details>
</template>

<style scoped>
.gate-panel {
  border-top: var(--bw) solid var(--line-weak);
  color: var(--muted2);
  font-size: var(--fs-200);
}
summary {
  padding: var(--px-10) 0;
  cursor: pointer;
  font-weight: var(--fw-620);
}
ul {
  padding-left: var(--px-20);
  line-height: var(--lh-1p7);
}
button {
  margin-right: var(--px-7);
  padding: var(--px-6) var(--px-12);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  color: var(--muted2);
  cursor: pointer;
}
</style>
