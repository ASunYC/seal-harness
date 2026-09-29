<script setup lang="ts">
import OverlaySurface from './overlay/OverlaySurface.vue';

/**
 * 通用确认对话框（自研壳，替代原生 `window.confirm`）。
 *
 * 为什么必须自研：原生 `window.confirm` 在本壳里关闭后（点确定与取消都一样）
 * 整个 webContents 会丧失键盘输入能力，只有 OS 级重新激活窗口才恢复——这正是
 * 「输入框卡死、光标进不去」的根因。修复的核心是「开框时记住触发它的元素、
 * 关框后把焦点还回去」，原生框做不到这件事。
 *
 * 这套时序原本手抄在本文件里，现已收进 Overlay 原语（`OverlaySurface`）——
 * 焦点陷阱、Esc、点外关闭、还焦、退场动画全部由它承担，本组件只剩内容与按钮。
 * **对外 props/emits 一字不改**：5 个调用点与 guard-native-dialog 都指着它。
 *
 * 样式自带、不引 `mcp-ui.css`——从通用 UI 反向依赖 capabilities 域是跨域耦合。
 */
const props = withDefaults(
  defineProps<{
    /** 用于 aria-labelledby / aria-describedby 的稳定前缀。 */
    id: string;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    initialFocus?: 'confirm' | 'cancel';
    /** 确认按钮色调：危险操作用 danger，其余用 primary。 */
    tone?: 'danger' | 'primary';
    /** 操作在途：两个按钮均禁用，避免连点产生互相覆盖的回执。 */
    busy?: boolean;
  }>(),
  { busy: false, cancelLabel: '取消', initialFocus: 'confirm', tone: 'danger' },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <!--
    open 恒真：显隐由调用方的 `v-if` 决定（5 个调用点都是这个形态），本组件
    不自持开关状态——那会变成第二个真相源。整壳被卸载时原语同样会还焦。
    initial-focus 走选择器：破坏性确认把焦点落在「取消」上（规范 D3.50），
    调用方通过既有的 initialFocus prop 指定，默认值不变。
  -->
  <OverlaySurface
    open
    variant="modal"
    semantics="alertdialog"
    :dismiss-on-outside="true"
    :busy="props.busy"
    :labelled-by="`${id}-title`"
    :described-by="`${id}-description`"
    :initial-focus="props.initialFocus === 'cancel' ? '[data-cancel]' : '[data-confirm]'"
    width="min(480px, 100%)"
    @close="emit('cancel')"
  >
    <div class="confirm-dialog">
      <h3 :id="`${id}-title`" class="confirm-dialog__title">{{ title }}</h3>
      <p :id="`${id}-description`" class="confirm-dialog__description">{{ description }}</p>
      <div class="confirm-dialog__actions">
        <button
          class="btn"
          :class="tone === 'danger' ? 'btn--primary btn--danger' : 'btn--primary'"
          type="button"
          data-confirm
          :disabled="props.busy"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
        <button
          class="btn btn--secondary"
          type="button"
          data-cancel
          :disabled="props.busy"
          @click="emit('cancel')"
        >
          {{ props.cancelLabel }}
        </button>
      </div>
    </div>
  </OverlaySurface>
</template>

<style scoped>
/* 外框（定位、scrim、z 阶梯、边框与阴影）全部由 OverlaySurface 承担，这里只管内容。 */
.confirm-dialog {
  display: grid;
  gap: var(--sp-4);
}
.confirm-dialog__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-400) / 1.4 var(--font-sans);
}
.confirm-dialog__description {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-300);
  line-height: 1.6;
  /* 原生框把 \n 渲染成换行；pre-line 保留换行并正常折行，逐字沿用旧文案。 */
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
</style>
