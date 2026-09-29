<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ProjectIterationRequirement } from '@shared/protocol/project-planning.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import { PLANNING_EVIDENCE_LABEL, planningEvidenceLabel } from './planning-lifecycle-view';
import type { ProjectCollabNotice } from '../../stores/projectCollabErrors';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 一组只读的证据引用芯片（原型 `evidenceChipsG1`：「证据引用」+ 芯片）。业务目标达成信息、目标记录与
 * 已归档区的阶段记录共用。
 *
 * ⭐ 外部链接沿用 ADR-0036 的两道校验：渲染时 `planningEvidenceLabel`（内含 `planningEvidenceLink`）
 *    再判一次，过得了才是按钮，点了交 `store.openPlanningEvidenceLink`（主进程二次校验后给系统浏览器）；
 *    过不了显示「引用已不可见」、不可点。⛔ 不渲染会自己跳转的超链接、不开窗、不写第二份链接文法。
 *    打开失败就地回执（通用句 + 参考编号），⛔ 不回显地址。
 * ⚠️ 需求 / 资产的名字要靠调用方先载好待办与资产（`resolveRefLabel` 认不出的待办会显示「已删除」）。
 */

const props = withDefaults(
  defineProps<{
    tokens: readonly string[];
    /** 这条记录所属迭代的关联需求摘要：比待办列表更早在手，优先按它认名字。 */
    linkedRequirements?: readonly ProjectIterationRequirement[];
    testId: string;
  }>(),
  { linkedRequirements: () => [] },
);

const store = useProjectCollabStore();

const chips = computed(() =>
  props.tokens.map((token) => {
    const label = planningEvidenceLabel(token, {
      linkedRequirements: props.linkedRequirements,
      members: store.detail?.members ?? [],
      files: store.files,
      todos: store.todos,
    });
    // 「类别 · 名称」：分隔符连同尾随空格放进类别文字里，读屏与复制出来的文字都是完整一句。
    return { token, ...label, kindPrefix: label.kindLabel ? `${label.kindLabel} · ` : null };
  }),
);

const linkNotice = ref<ProjectCollabNotice | null>(null);
async function openLink(href: string): Promise<void> {
  linkNotice.value = null;
  linkNotice.value = await store.openPlanningEvidenceLink(href);
}
</script>

<template>
  <div v-if="chips.length > 0" class="evidence-refs" :data-testid="testId">
    <b class="evidence-refs__label">{{ PLANNING_EVIDENCE_LABEL }}</b>
    <template v-for="chip in chips" :key="chip.token">
      <button
        v-if="chip.href"
        class="evidence-refs__chip evidence-refs__chip--link"
        type="button"
        :title="chip.href"
        :data-testid="`${testId}-link`"
        @click="openLink(chip.href)"
      >
        <span class="evidence-refs__kind">{{ chip.kindPrefix }}</span>
        <b>{{ chip.name }}</b>
      </button>
      <span v-else class="evidence-refs__chip" :data-testid="`${testId}-ref`">
        <span v-if="chip.kindPrefix" class="evidence-refs__kind">{{ chip.kindPrefix }}</span>
        <b>{{ chip.name }}</b>
      </span>
    </template>
    <p
      v-if="linkNotice"
      class="evidence-refs__notice"
      role="alert"
      :data-testid="`${testId}-notice`"
    >
      <span>{{ linkNotice.message }}</span>
      <ReferenceIdCopy v-if="linkNotice.referenceCode" :reference-id="linkNotice.referenceCode" />
    </p>
  </div>
</template>

<style scoped>
.evidence-refs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.evidence-refs__label {
  color: var(--muted);
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
}
.evidence-refs__chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--sp-1);
  padding: 2px var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.evidence-refs__chip b {
  color: var(--ink);
  font-weight: var(--fw-label);
}
.evidence-refs__chip--link {
  cursor: pointer;
}
.evidence-refs__chip--link b {
  color: var(--accent-text);
}
.evidence-refs__chip--link:hover b {
  text-decoration: underline;
}
.evidence-refs__chip--link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.evidence-refs__kind {
  color: var(--muted);
}
.evidence-refs__notice {
  display: flex;
  flex-basis: 100%;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-100);
}
</style>
