<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  PROJECT_SUBMISSION_GATE_FIELDS,
  type ProjectSubmissionGateValues,
} from '@shared/protocol/project-submission-gate.js';
import ProjectDialogShell from './ProjectDialogShell.vue';

const props = defineProps<{
  value: ProjectSubmissionGateValues;
  baseline: ProjectSubmissionGateValues;
  gateVersion: number;
  saving: boolean;
  notice: string | null;
}>();
const emit = defineEmits<{
  input: [value: ProjectSubmissionGateValues];
  save: [];
  close: [];
}>();
const help = ref(false);
const confirmingLeave = ref(false);
const dirty = computed(() =>
  PROJECT_SUBMISSION_GATE_FIELDS.some(({ key }) => props.value[key] !== props.baseline[key]),
);
function change(key: keyof ProjectSubmissionGateValues, event: Event): void {
  if (props.saving) return;
  emit('input', { ...props.value, [key]: (event.target as HTMLInputElement).checked });
}
function close(): void {
  if (props.saving) return;
  if (dirty.value) confirmingLeave.value = true;
  else emit('close');
}
</script>

<template>
  <ProjectDialogShell title="编辑提交测试规则" size="full" @close="close">
    <div class="gate-editor" data-testid="submission-gate-editor">
      <p>当前门槛 v{{ gateVersion }} · 仅影响后续提交的测试轮次，历史快照保持不变。</p>
      <label
        v-for="field in PROJECT_SUBMISSION_GATE_FIELDS"
        :key="field.key"
        class="gate-editor__field"
      >
        <input
          type="checkbox"
          :data-testid="`gate-${field.key}`"
          :checked="value[field.key]"
          :disabled="saving"
          @change="change(field.key, $event)"
        />
        {{ field.label }}
      </label>
      <button type="button" @click="help = !help">查看填写说明</button>
      <p v-if="help">
        按整条需求提交测试。权限校验、项目归档限制、轮次一致性等安全检查始终执行，不属于可关闭的配置。
      </p>
      <p v-if="notice" role="alert">{{ notice }}</p>
      <div v-if="confirmingLeave" role="alert">
        <p>还有未保存的修改，离开后草稿会保留。</p>
        <button type="button" @click="confirmingLeave = false">继续编辑</button>
        <button type="button" data-testid="gate-confirm-leave" @click="emit('close')">
          保留草稿并离开
        </button>
      </div>
    </div>
    <template #foot>
      <button type="button" :disabled="saving" @click="close">取消</button>
      <button
        type="button"
        data-testid="gate-save"
        :disabled="saving || !dirty"
        @click="emit('save')"
      >
        {{ saving ? '保存中…' : '保存规则' }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.gate-editor {
  display: flex;
  flex-direction: column;
  gap: var(--px-16);
  color: var(--muted2);
}
.gate-editor__field {
  display: flex;
  align-items: center;
  gap: var(--px-10);
}
button {
  padding: var(--px-6) var(--px-12);
  color: var(--ink);
  background: var(--panel);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
