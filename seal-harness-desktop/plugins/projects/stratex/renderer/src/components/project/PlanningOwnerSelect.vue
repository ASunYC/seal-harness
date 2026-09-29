<script setup lang="ts">
import { computed } from 'vue';

import type { ProjectMember } from '@shared/protocol/project-collab.js';

import { assignableOwnerMembers, departedOwnerOption } from './planning-form-view';
import { PLANNING_UNASSIGNED_OWNER_LABEL } from './project-planning-view';

/**
 * 负责人下拉：里程碑 / 迭代计划的手工新建与编辑（MIL-09）和项目助理规划草案审阅（mil-11）用同一份。
 *
 * ⭐ 只列在册（active）成员：受邀未加入、已移出的人服务端会以 `owner_not_member` 拒收。
 * ⭐ 选中的负责人不在可选名单里（原负责人已离开项目）⇒ 保留一项「（已离组）」，否则下拉会静默改成「待分配」。
 * ⚠️ 根元素就是 `<select>`：调用方给的类名、`data-testid` 与父组件样式直接落在它上面。
 */

const props = defineProps<{
  modelValue: string;
  members: readonly ProjectMember[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const options = computed(() => assignableOwnerMembers(props.members));
const departed = computed(() => departedOwnerOption(props.modelValue, props.members));

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <select :value="modelValue" :disabled="disabled" @change="onChange">
    <option value="">{{ PLANNING_UNASSIGNED_OWNER_LABEL }}</option>
    <option v-for="member in options" :key="member.subject" :value="member.subject">
      {{ member.displayName }}
    </option>
    <option v-if="departed" :value="departed.subject">{{ departed.label }}</option>
  </select>
</template>
