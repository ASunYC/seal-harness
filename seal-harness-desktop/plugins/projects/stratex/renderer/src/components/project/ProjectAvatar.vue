<script setup lang="ts">
import { computed } from 'vue';

import { avatarText, avatarTone } from './project-format';

/**
 * 项目组成员头像字。色调按显示名稳定分桶（token 组合，无裸色值）；
 * `variant="ai"` 用于服务端生成的 system/assistant 条目。
 */
const props = withDefaults(
  defineProps<{
    name: string | null;
    size?: 's' | 'm';
    variant?: 'member' | 'ai';
  }>(),
  { size: 'm', variant: 'member' },
);

const text = computed(() => (props.variant === 'ai' ? '助' : avatarText(props.name)));
const tone = computed(() => (props.variant === 'ai' ? 'ai' : String(avatarTone(props.name))));
</script>

<template>
  <span class="pj-avatar" :class="`pj-avatar--${size}`" :data-tone="tone" aria-hidden="true">{{
    text
  }}</span>
</template>

<style scoped>
.pj-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  font-weight: var(--fw-title);
  user-select: none;
}
/* size="m"（默认）：动态/讨论作者头像。⚠️ 待确认（见报告）——原型此语境为两种尺寸：
   动态 .feed-item span=30px、讨论 .cmsg span=28px，单一 token 无法同时对上；且本 token
   还被项目列表页（ProjectsView，本轮范围外）共用，改动会外溢。故暂不改 22px，待拍板。 */
.pj-avatar--m {
  width: 22px;
  height: 22px;
  font-size: var(--fs-100);
}
/* size="s"：表格/看板处理人头像 —— 原型 .m2 / .as = 20px、字号 9.5px。
   （旧 18px/10px 偏小。配置栏成员用的原型 .m 为 24px，属另一语境的小幅偏差，见报告。） */
.pj-avatar--s {
  width: var(--px-20);
  height: var(--px-20);
  font-size: var(--fs-px-9p5);
}
.pj-avatar[data-tone='1'] {
  color: var(--accent-text);
  background: var(--accent-soft);
  border: var(--bw) solid var(--accent-line);
}
.pj-avatar[data-tone='2'] {
  color: var(--ok-text);
  background: var(--ok-soft);
  border: var(--bw) solid var(--ok-line);
}
.pj-avatar[data-tone='3'] {
  color: var(--warn-text);
  background: var(--warn-soft);
  border: var(--bw) solid var(--warn-line);
}
.pj-avatar[data-tone='4'] {
  color: var(--muted2);
  background: var(--sunken);
  border: var(--bw) solid var(--line-strong);
}
.pj-avatar[data-tone='ai'] {
  color: var(--accent-text);
  background: var(--accent-soft);
  border: var(--bw) dashed var(--accent-line);
}
</style>
