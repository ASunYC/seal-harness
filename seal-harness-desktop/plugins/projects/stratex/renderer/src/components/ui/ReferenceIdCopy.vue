<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import { copyText } from '../../sdk/clipboard';

/**
 * 可复制参考编号（报错条内）。参考编号是排查的唯一抓手，肉眼抄错一个字符就取不到诊断——
 * 点击 / 回车 / 空格即复制**编号本身**（不含「参考编号」这个前缀，复制出来能直接粘贴）。
 *
 * 分层：复制统一走 `sdk/clipboard` 的 `copyText()`（主进程通道优先，再回落 Web 与
 * execCommand）；渲染层不直接引 electron。整条链都失败才如实标失败——按钮文案不撒谎
 * （§复制失败要如实提示）。
 * 无障碍：用原生 <button>，Tab 可聚焦、Enter/空格由平台路由到 click，键鼠走同一条路径。
 * 白标：文案零内核品牌词根。
 */
const props = defineProps<{
  /** 待复制的参考编号；复制内容仅此串。空 / 空白则不渲染可复制元素。 */
  referenceId: string;
  /** 可见与无障碍前缀，默认「参考编号」；不进入复制内容。 */
  label?: string;
  /**
   * 视觉上藏起前缀（仍在无障碍名与文本里）：表头已经写明「需求标识」的列里，每行再印一遍
   * 「需求 ID」只是噪音。⛔ 不用 v-if 去掉——读屏与复制反馈都还要这个前缀。
   */
  labelHidden?: boolean;
}>();

/** 复制成功 / 失败反馈的驻留时长；到点回落 idle。 */
const COPY_FEEDBACK_MS = 1500;

const referenceId = computed(() => props.referenceId.trim());
const prefix = computed(() => props.label ?? '参考编号');
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
let resetTimer: ReturnType<typeof setTimeout> | undefined;
// 单调递增的尝试号：异步完成回来时若已被后续点击或卸载抢占，则丢弃本次结果。
let attempt = 0;

const hint = computed(() => {
  if (copyState.value === 'copied') return '已复制';
  if (copyState.value === 'failed') return '复制失败';
  return '复制';
});
// 读屏播报：仅在成功 / 失败时有内容，idle 保持空串不打扰。
const statusText = computed(() => {
  if (copyState.value === 'copied') return `已复制${prefix.value} ${referenceId.value}`;
  if (copyState.value === 'failed') return '复制失败，请手动选中编号后复制';
  return '';
});

function clearResetTimer(): void {
  if (resetTimer === undefined) return;
  clearTimeout(resetTimer);
  resetTimer = undefined;
}

function scheduleReset(): void {
  clearResetTimer();
  resetTimer = setTimeout(() => {
    copyState.value = 'idle';
    resetTimer = undefined;
  }, COPY_FEEDBACK_MS);
}

async function copyReferenceId(): Promise<void> {
  const current = ++attempt;
  const copied = await copyText(referenceId.value);
  // 异步回来时若已被后续点击或卸载抢占，丢弃本次结果（含计时器）。
  if (current !== attempt) return;
  copyState.value = copied ? 'copied' : 'failed';
  scheduleReset();
}

onBeforeUnmount(() => {
  // 卸载后作废在途的复制回调，避免它落到已卸载组件上或残留计时器。
  attempt += 1;
  clearResetTimer();
});
</script>

<template>
  <button
    v-if="referenceId"
    type="button"
    class="ref-copy tnum"
    :class="{ 'is-copied': copyState === 'copied', 'is-failed': copyState === 'failed' }"
    :aria-label="`复制${prefix} ${referenceId}`"
    :title="copyState === 'failed' ? '复制失败，请手动选中编号复制' : `点击复制${prefix}`"
    @click="copyReferenceId"
  >
    <!-- 前缀与编号分两段：前缀不断行，编号在窄处可任意断开，整串仍完整可复制。
         分隔空格收在前缀段尾部：模板里两段之间换行会被编译器吞掉，文本就成了「需求 IDxxxx」。 -->
    <span class="ref-copy__text"
      ><span class="ref-copy__label" :class="{ 'is-hidden': props.labelHidden }">{{
        `${prefix} `
      }}</span
      ><span class="ref-copy__value">{{ referenceId }}</span></span
    >
    <span class="ref-copy__hint" aria-hidden="true">{{ hint }}</span>
    <span class="ref-copy__status" role="status" aria-live="polite">{{ statusText }}</span>
  </button>
</template>

<style scoped>
.ref-copy {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  color: inherit;
  font: inherit;
  background: transparent;
  /* 透明描边占位：hover/focus 补色时不发生尺寸跳动。 */
  border: var(--bw) solid transparent;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.ref-copy__text {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.ref-copy__label {
  white-space: nowrap;
}
/* 视觉隐藏但保留在文本与无障碍树里（同下方读屏播报的做法）。 */
.ref-copy__label.is-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  border: 0;
}
.ref-copy:hover {
  border-color: var(--line-strong);
}
.ref-copy:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 「复制」提示：常驻但克制，让「可点」看得出来；成功/失败时点亮。 */
.ref-copy__hint {
  flex-shrink: 0;
  font-size: 0.85em;
  opacity: 0.6;
}
.ref-copy:hover .ref-copy__hint,
.ref-copy:focus-visible .ref-copy__hint {
  opacity: 0.9;
}
.ref-copy.is-copied .ref-copy__hint {
  color: var(--ok-text);
  opacity: 1;
}
.ref-copy.is-failed .ref-copy__hint {
  opacity: 1;
  font-weight: var(--fw-label);
}
/* 读屏专用：视觉隐藏但保留在无障碍树，供 aria-live 播报复制结果。 */
.ref-copy__status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
