<script setup lang="ts">
import IterationFormDialog from './IterationFormDialog.vue';
import MilestoneFormDialog from './MilestoneFormDialog.vue';
import RequirementScheduleDialog from './RequirementScheduleDialog.vue';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 里程碑页写入口弹层的挂载点（MIL-09）：新建 / 编辑里程碑、添加 / 编辑迭代计划、安排需求。
 *
 * ⭐ 与 `PlanningLifecycleLayer` 同一个理由挂在里程碑页：弹层状态都在 store，收起所在目标、切换视图或列表
 *    因事件刷新重渲染，都不会把开着的弹层连同用户写的字一起卸掉。
 */
defineProps<{ projectId: string }>();

const store = useProjectCollabStore();
</script>

<template>
  <MilestoneFormDialog v-if="store.milestoneForm" :project-id="projectId" />
  <IterationFormDialog v-if="store.iterationForm" :project-id="projectId" />
  <RequirementScheduleDialog v-if="store.requirementScheduleDialog" :project-id="projectId" />
</template>
