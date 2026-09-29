<script setup lang="ts">
import { computed } from 'vue';

import { resolveRefLabel, resolveRefTarget } from './project-refs';
import type { ProjectRefSources, ProjectRefTarget } from './project-refs';

/**
 * 一枚引用芯片（原型 refcard 形态：k 标 + 粗体名），动态主贴、动态评论、讨论消息三处共用。
 *
 * 认得出原对象（`resolveRefTarget` 非 null）⇒ 原生 `<button type="button">`：可聚焦，回车 /
 * 空格由浏览器触发，点击向上发 `open`，跳到哪儿由项目页决定（测试提单 2552）。
 * 认不出（已删除 / 看不到 / 已移出）⇒ 仍是 `<span>` 文字，⛔ 不摆一个点了没反应的按钮。
 *
 * ⛔ 别改成 `<span role="button" tabindex="0">` 再手接键盘：原生按钮的回车 / 空格语义是白来的，
 *    手接一遍只会漏掉其中一个。
 */
const props = withDefaults(
  defineProps<{
    token: string;
    sources: ProjectRefSources;
    /** `sm` 给评论那一档（评论本来就是次级层次）。 */
    size?: 'md' | 'sm';
  }>(),
  { size: 'md' },
);

const emit = defineEmits<{ open: [ProjectRefTarget] }>();

const label = computed(() => resolveRefLabel(props.token, props.sources));
const target = computed(() => resolveRefTarget(props.token, props.sources));
const actionLabel = computed(() => `打开${label.value.kindLabel ?? '引用'}：${label.value.name}`);

function open(): void {
  if (target.value !== null) emit('open', target.value);
}
</script>

<template>
  <button
    v-if="target"
    class="ref-chip ref-chip--link"
    type="button"
    :data-size="props.size"
    :data-ref-kind="target.kind"
    :title="actionLabel"
    :aria-label="actionLabel"
    @click="open"
  >
    <span v-if="label.kindLabel" class="ref-chip__k" aria-hidden="true">{{ label.kindLabel }}</span>
    <b class="ref-chip__name">{{ label.name }}</b>
  </button>
  <span v-else class="ref-chip" :data-size="props.size">
    <span v-if="label.kindLabel" class="ref-chip__k">{{ label.kindLabel }}</span>
    <b class="ref-chip__name">{{ label.name }}</b>
  </span>
</template>

<style scoped>
.ref-chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
  text-align: left;
  overflow-wrap: anywhere;
}
/* 评论那一档：同形态、压小一档 */
.ref-chip[data-size='sm'] {
  padding: 0 var(--sp-2);
  font-size: var(--fs-100);
}
.ref-chip__k {
  flex: 0 0 auto;
  padding: 0 var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font: var(--fw-body) var(--fs-100) / 1.5 var(--font-mono);
}
.ref-chip__name {
  color: var(--ink);
  font-weight: var(--fw-label);
  overflow-wrap: anywhere;
}
/* 可跳转的芯片：名字换强调色、悬停描边与名字下划线——与不可点的文字芯片一眼分开，不只靠光标 */
.ref-chip--link {
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.ref-chip--link .ref-chip__name {
  color: var(--accent-text);
}
.ref-chip--link:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.ref-chip--link:hover .ref-chip__name {
  text-decoration: underline;
}
.ref-chip--link:active {
  border-color: var(--accent);
}
.ref-chip--link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
@media (prefers-reduced-motion: reduce) {
  .ref-chip--link {
    transition: none;
  }
}
</style>
