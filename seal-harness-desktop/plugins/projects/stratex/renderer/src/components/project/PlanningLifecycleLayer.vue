<script setup lang="ts">
import IterationDetailDialog from './IterationDetailDialog.vue';
import PlanningLifecycleDialog from './PlanningLifecycleDialog.vue';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 规划域生命周期弹层的挂载点（MIL-07）：「迭代计划详情」+「记录达成 / 重新打开」。
 *
 * ⭐ 挂在里程碑页而不是列表行里：两层弹层的状态都在 store，收起所在目标、切换视图或列表因
 *    事件刷新重渲染，都不会把开着的弹层连同用户写的字一起卸掉；将来看板卡片上的同名入口也
 *    打开这同一对弹层。
 * ⚠️ 详情在前、达成弹层在后：从详情工具条点「记录达成」时两层叠放（后开的在上），成功后
 *    详情里的阶段记录就地重取。
 */
defineProps<{ projectId: string }>();

const store = useProjectCollabStore();
</script>

<template>
  <IterationDetailDialog v-if="store.planningDetail" :project-id="projectId" />
  <PlanningLifecycleDialog v-if="store.planningLifecycleDraft" :project-id="projectId" />
</template>
