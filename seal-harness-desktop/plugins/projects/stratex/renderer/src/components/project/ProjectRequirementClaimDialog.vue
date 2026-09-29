<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import { PROJECT_TODO_PLAN_DATE_TEXT } from '@shared/protocol/project-collab-plan-dates.js';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 认领无主需求的壳内对话框（FLOW-02）。打开 → 填计划日期 → 确认认领 → 该需求进入本人任务页。
 *
 * ⛔ **取消零写入**：取消只 `emit('close')`，**绝不调用 `store.claimRequirement`**——认领是
 *    唯一的写入路径，只打开又取消时服务端一个字节都不写（含审计行）。
 * ⛔ **失败不伪成功**：认领失败（含「已被他人认领」，store 回 `'error'`）时对话框**留在原地**
 *    并显示一条真实失败提示，⛔ 不关框、不报「已认领」。只有 `'ok'` 才 `emit('done')` 关框——
 *    否则就是「显示成功再被下次刷新默默纠正」那个最糟的形态。
 */
const props = defineProps<{ requirement: Todo }>();
const emit = defineEmits<{ close: []; done: [] }>();

const store = useProjectCollabStore();

const busy = ref(false);
const failure = ref<string | null>(null);
// 计划日期预填自需求现值（只取日期部分）；空＝未排期。复用 startAt/dueAt，不新增字段。
const startDate = ref(props.requirement.startAt?.slice(0, 10) ?? '');
const dueDate = ref(props.requirement.dueAt?.slice(0, 10) ?? '');

/**
 * 计划日期的两道先手校验（CORE-08，ADR-0042）：认领整写两端，服务端对它一律判——有开始没截止、开始晚于截止
 * 都不发请求。就地提示与服务端码（`start_requires_due` / `invalid_date_range`）的那一句是同一个常量；
 * 服务端若仍拒绝（例如别处刚改了需求），store 按同一个码给出同一句，走下面的失败提示。
 */
const dateProblem = computed<string | null>(() => {
  if (startDate.value && !dueDate.value) return PROJECT_TODO_PLAN_DATE_TEXT.startRequiresDue;
  if (startDate.value && dueDate.value && startDate.value > dueDate.value)
    return PROJECT_TODO_PLAN_DATE_TEXT.dateOrder;
  return null;
});

async function runClaim(): Promise<void> {
  if (busy.value || dateProblem.value !== null) return;
  busy.value = true;
  failure.value = null;
  try {
    const outcome = await store.claimRequirement({
      todoId: props.requirement.id,
      // 空＝写空（null 须保留，undefined 会被 JSON 丢）；服务端同样写空。
      startAt: startDate.value || null,
      dueAt: dueDate.value || null,
    });
    if (outcome === 'ok') {
      emit('done');
      return;
    }
    // ⛔ 不伪成功：认领失败留在框内显示真实失败提示（已被他人认领 / 被拒 / 瞬时）。
    failure.value = store.actionNotice?.message ?? '认领失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell title="认领需求" @close="emit('close')">
    <div class="claim" data-testid="requirement-claim-dialog">
      <p class="claim__title" data-testid="requirement-claim-title">{{ requirement.title }}</p>
      <p class="claim__note">认领后这条需求成为你名下的任务；取消不改变归属。</p>
      <label class="claim__field">
        <span>计划开始</span>
        <input
          v-model="startDate"
          type="date"
          data-testid="requirement-claim-start"
          :disabled="busy"
        />
      </label>
      <label class="claim__field">
        <span>计划完成</span>
        <input v-model="dueDate" type="date" data-testid="requirement-claim-due" :disabled="busy" />
      </label>
      <p
        v-if="dateProblem"
        class="claim__error"
        role="alert"
        data-testid="requirement-claim-date-hint"
      >
        {{ dateProblem }}
      </p>
      <p v-if="failure" class="claim__error" role="alert" data-testid="requirement-claim-error">
        {{ failure }}
      </p>
    </div>

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="requirement-claim-cancel"
        :disabled="busy"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        data-testid="requirement-claim-confirm"
        :disabled="busy || dateProblem !== null"
        @click="runClaim"
      >
        {{ busy ? '认领中…' : '认领并保存' }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.claim {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.claim__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  line-height: 1.6;
}
.claim__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.claim__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--fs-meta);
  color: var(--muted);
}
.claim__field input {
  font-size: var(--fs-100);
}
.claim__error {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
</style>
