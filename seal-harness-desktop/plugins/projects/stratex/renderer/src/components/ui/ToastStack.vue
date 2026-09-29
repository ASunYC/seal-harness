<script setup lang="ts">
/**
 * Toast 通知栈 —— 规范 §3.7 逐条落地。
 *
 * 分工：本组件只做**渲染与事件转发**，全部队列判定（三档时长、最多 3 条、
 * 超出排队、暂停/恢复）在 `toastQueue.ts` 的纯函数里，可被穷举测试。
 *
 * D3.35【铁律】接口只有 `{ level, text, code?, actions[] }`：
 * **无默认文案、无 fallback 句、无 `error.message` 透传路径**。
 * 未映射的错误由上层走兜底码（集成方案 §5.6），不是这里"实在不行显示原文"。
 *
 * D3.37 Toast **不承载审批** —— `actions` 只接受普通动作；任何需要授权的
 * 交互一律走审批卡。这条靠约定 + 评审保证，组件不做语义判别。
 *
 * 与错误行（§3.16）的分工：**打断性走 Toast，就地上下文走错误行**。
 *
 * 状态全集（D3.1）：
 * - 默认：右下堆叠，最多 3 条，超出排队
 * - 悬停 / 聚焦：暂停自动消失计时；`Esc` 关闭最新一条
 * - 激活：内部按钮走 `.btn` 的激活态
 * - 禁用 / 加载：**不适用** —— 长任务用工具卡或状态条，不用 Toast
 * - 错误：`role="alert"`，且 error 级不自动消失
 *
 * 两档密度（D3.2）：**无差异** —— Toast 是全局层，固定用 comfortable
 * 尺度保证可读性。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getActivePinia } from 'pinia';

import { useToastStore } from '../../stores/toasts.js';
import { projectRuntime } from '../../../../../src/ui/runtime';
const { overlayStack } = projectRuntime();
import {
  TOAST_ROLE,
  advanceToasts,
  createToastQueue,
  dismissNewestToast,
  dismissToast,
  enqueueToast,
  nextExpiryMs,
  pauseToasts,
  resumeToasts,
  type ToastInput,
  type ToastQueueState,
} from './toastQueue.js';

const props = defineProps<{
  /** 上层持有的通知列表；新增项会被入队，已消失的不会复活 */
  toasts: readonly ToastInput[];
  /** 通知区域的 aria-label，由上层传入（D3.3） */
  regionLabel: string;
  /** 关闭按钮的 aria-label，由上层传入（D3.3） */
  closeLabel: string;
}>();

const emit = defineEmits<{ dismiss: [id: string] }>();

/**
 * 两个来源汇入同一个队列：
 * - `props.toasts` —— 壳层（`MainWindow`）自己那条一次性列表（更新提示、子组件 `@notice`）。
 * - `toastStore.entries` —— 路由到的**视图**经共享 store 推来的通知（§3.7 通知唯一出口）。
 * 两路都是 `ToastInput`，`seen` 按 id 去重（两路 id 前缀不同，不相撞）。这样视图不必各自
 * 自绘 notice 块，也不必改壳层就能报一条带级别的通知；沉浸态状态栏隐藏时仍照常可见。
 *
 * 无活动 Pinia 时（个别孤立组件测试直接挂 `ToastStack`、不装 store）退化为**仅 prop** 模式：
 * 渲染原语不因缺 store 就崩，store 那一路静默停用即可。
 */
const toastStore = getActivePinia() ? useToastStore() : null;

const now = (): number => performance.now();

const state = ref<ToastQueueState>(createToastQueue(now()));
const seen = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

const visible = computed(() => state.value.visible);

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** 只在真正有到期项时挂一次性定时器；error-only 或暂停时不挂 */
function scheduleTick(): void {
  clearTimer();
  const due = nextExpiryMs(state.value);
  if (due === null) return;
  timer = setTimeout(
    () => {
      timer = null;
      state.value = advanceToasts(state.value, now());
      scheduleTick();
    },
    Math.max(0, due),
  );
}

function ingest(list: readonly ToastInput[]): void {
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    state.value = enqueueToast(state.value, item, now());
  }
  scheduleTick();
}

watch(
  () => props.toasts,
  (list, previous) => {
    // 父级撤销的状态通知也必须退出内部队列；另一来源仍持有时保留。
    const retained = new Set([...list, ...(toastStore?.entries ?? [])].map((item) => item.id));
    for (const item of previous ?? []) {
      if (!retained.has(item.id)) state.value = dismissToast(state.value, item.id, now());
    }
    ingest(list);
  },
  { immediate: true, deep: true },
);
if (toastStore) {
  watch(() => toastStore.entries, ingest, { immediate: true, deep: true });
}

/** 两路来源都通知一遍：`emit` 给壳层的 prop 列表、`toastStore.dismiss` 给视图队列，各自幂等。 */
function dismissEverywhere(id: string): void {
  emit('dismiss', id);
  toastStore?.dismiss(id);
}

function close(id: string): void {
  state.value = dismissToast(state.value, id, now());
  scheduleTick();
  dismissEverywhere(id);
}

function onPointerEnter(): void {
  state.value = pauseToasts(state.value, now());
  clearTimer();
}

function onPointerLeave(): void {
  state.value = resumeToasts(state.value, now());
  scheduleTick();
}

/**
 * Esc 关最新一条 —— **栈非空时栈优先**。
 *
 * Toast 不是模态，也**不进** Overlay 的叠层栈（多实例流式队列 ≠ 单实例弹层），
 * 所以它不能把 Esc 从弹层手里抢走：栈里还有层时这一下归栈。
 *
 * ⚠️ 这里查 `isEmpty()` 而不是调 `handleEscape()`：后者**会真的关掉栈顶那一层**，
 *    而 `overlayStack` 自己已经在 window 捕获阶段处置过这次 Esc 了，再调一次
 *    就是连关两层。要的是「谁优先」这个判定，不是再执行一遍。
 */
function onEscape(): void {
  if (!overlayStack.isEmpty()) return;
  const newest = state.value.visible[state.value.visible.length - 1];
  if (newest === undefined) return;
  state.value = dismissNewestToast(state.value, now());
  scheduleTick();
  dismissEverywhere(newest.id);
}

onBeforeUnmount(clearTimer);
</script>

<template>
  <!--
    始终挂载（不 v-if）：<TransitionGroup> 只对「已挂载容器内新增/移除的键」播进出场——
    容器随首条 toast 一起挂载会让首条走「初始渲染」而无进场，且末条移除时容器被卸载会吞掉退场。
    空栈时它是右下角一个零尺寸的不可见定位盒，无副作用。
  -->
  <TransitionGroup
    tag="div"
    class="toasts"
    role="region"
    :aria-label="regionLabel"
    name="toast"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onPointerEnter"
    @focusout="onPointerLeave"
    @keydown.esc="onEscape"
  >
    <div
      v-for="item in visible"
      :key="item.id"
      class="toast"
      :class="`toast--${item.level}`"
      :role="TOAST_ROLE[item.level]"
    >
      <span class="toast__rule" aria-hidden="true" />
      <div class="toast__body">
        <p class="toast__text">
          {{ item.text }}
          <code v-if="item.code" class="toast__code">{{ item.code }}</code>
        </p>
        <div v-if="item.actions && item.actions.length > 0" class="toast__acts">
          <button
            v-for="action in item.actions"
            :key="action.label"
            class="btn btn--ghost"
            type="button"
            @click="action.onSelect()"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
      <button
        class="toast__close btn btn--ghost"
        type="button"
        :aria-label="closeLabel"
        @click="close(item.id)"
      >
        <span class="toast__closeGlyph" aria-hidden="true" />
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/*
 * 动效参数直接引用 tokens.css 的 --d-* / --spring-*（P0-1 的 S5 已落地）。
 * Toast 不换壳到 OverlaySurface（多实例流式队列 ≠ 单实例弹层），进出场自带一套
 * <TransitionGroup> 过渡，不走 Overlay 原语。
 */
.toasts {
  position: fixed;
  right: var(--sp-5);
  bottom: var(--sp-5);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: min(420px, calc(100vw - var(--sp-6)));
}

.toast {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--raised);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
}

.toast__rule {
  width: var(--bw-strong);
  border-radius: var(--r-pill);
  background: var(--accent);
  flex: 0 0 auto;
}
.toast--warn .toast__rule {
  background: var(--warn);
}
.toast--error .toast__rule {
  background: var(--danger);
}

.toast__body {
  flex: 1;
  min-width: 0;
}

.toast__text {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  color: var(--ink);
}

/* 参考码局部等宽（D1.12）—— 便于用户照着念给支持人员 */
.toast__code {
  font-family: var(--font-mono);
  color: var(--muted2);
}

.toast__acts {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.toast__close {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 0 var(--sp-2);
}

/* 关闭符号用 CSS 画，不写字符字面量 —— 组件层零文案（D3.3） */
.toast__closeGlyph {
  position: relative;
  display: block;
  width: 10px;
  height: 10px;
}
.toast__closeGlyph::before,
.toast__closeGlyph::after {
  content: '';
  position: absolute;
  inset: 50% 0 auto 0;
  height: var(--bw-strong);
  border-radius: var(--r-pill);
  background: currentColor;
}
.toast__closeGlyph::before {
  transform: translateY(-50%) rotate(45deg);
}
.toast__closeGlyph::after {
  transform: translateY(-50%) rotate(-45deg);
}

/*
 * 进出场（§7.5 场景矩阵「Toast 进/出」，照抄原型 toast-in / toast-out 关键帧）。
 * 进场一次性不可逆 → keyframes；落位用 bounce（分工宪法三处之一）。
 * 退场经 <TransitionGroup> 的 leave-active 触发，= 入场逆路径 × smooth（退场永不回弹）。
 * reduced-motion 由 tokens.css 全局块统管（D2.24），此处不再单独降级。
 */
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(9px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes toast-out {
  to {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
.toast-enter-active {
  animation: toast-in var(--d-pop) var(--spring-bounce);
}
.toast-leave-active {
  /* 离场时脱离流，后继项由 .toast-move 平滑补位 */
  position: absolute;
  width: 100%;
  animation: toast-out 200ms var(--spring-smooth) forwards;
}
.toast-move {
  transition: transform var(--d-pop) var(--spring-smooth);
}
</style>
