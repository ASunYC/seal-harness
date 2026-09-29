<script setup lang="ts">
/**
 * 项目组域的轻量弹层壳（邀请 / 待办编辑共用）：
 * scrim + 面板 + 标题行 + 关闭。Escape 与点 scrim 均可关，不用原生 confirm/prompt。
 *
 * 壳组件内换即修平全部调用方（邀请成员 / 新建与编辑待办）。迁移前 Esc 靠自写的
 * `onKeydown`、点外靠 scrim 上的 click self 修饰符，既无焦点陷阱也不还焦；
 * 换壳后这些连同退场动画一并归 Overlay 原语。
 */
import OverlaySurface from '../ui/overlay/OverlaySurface.vue';

defineProps<{ title: string; size?: 'default' | 'wide' | 'full' }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <!--
    `chrome=false`：`.pj-modal` 自带完整卡片样式，再叠原语外框就是双边框。
    `dismiss-on-outside` 显式传 true：保持迁移前「点 scrim 即关」的语义——
    原语给 modal 的缺省是「点外不关」，不显式传就等于顺手改了行为。
  -->
  <OverlaySurface
    open
    variant="modal"
    semantics="dialog"
    :chrome="false"
    :dismiss-on-outside="true"
    :label="title"
    @close="emit('close')"
  >
    <div class="pj-scrim is-overlay-surface" :class="{ 'pj-scrim--full': size === 'full' }">
      <section
        class="pj-modal"
        data-testid="project-dialog-shell"
        data-density="comfortable"
        :data-size="size ?? 'default'"
      >
        <header class="pj-modal__head">
          <h3 class="pj-modal__title">{{ title }}</h3>
          <button class="pj-modal__x" type="button" aria-label="关闭" @click="emit('close')">
            ✕
          </button>
        </header>
        <div
          class="pj-modal__body"
          :class="{ 'pj-modal__body--fill': size === 'wide' || size === 'full' }"
        >
          <slot />
        </div>
        <footer v-if="$slots.foot" class="pj-modal__foot"><slot name="foot" /></footer>
      </section>
    </div>
  </OverlaySurface>
</template>

<style scoped>
/*
 * 规范 §3.13 模态形态：scrim + raised 面板 + sh-3。
 * 换壳后 scrim、定位、z 阶梯与入退场动效都归 Overlay 原语，这一层只剩居中盒。
 * ⚠️ 原语的 bare 面板不吃指针事件（见 overlay.css），卡片必须自己开 auto，
 *    否则点外判定会把整屏算作层内、点遮罩再也关不掉。
 */
.pj-scrim {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: var(--sp-5);
}
.pj-modal {
  display: flex;
  width: min(440px, 100%);
  max-height: min(78vh, 720px);
  flex-direction: column;
  overflow: hidden;
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-xl);
  background: var(--raised);
  box-shadow: var(--sh-3);
  pointer-events: auto;
}
.pj-modal[data-size='wide'] {
  box-sizing: border-box;
  width: min(85vw, 1400px);
  height: 85vh;
  max-width: 100%;
  max-height: min(85vh, 100%);
}
/* 全屏形态（原型 .agreement-editor-full）：铺满视口、无圆角，头/脚固定、正文自适应。
   逐帧对齐留给设计批；此处只落「占满 + 保存/取消固定」的骨架（CTX-01 全屏编辑）。 */
.pj-scrim--full {
  padding: 0;
}
.pj-modal[data-size='full'] {
  width: 100vw;
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  border: 0;
  border-radius: 0;
}
.pj-modal__body--fill {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.pj-modal__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  border-bottom: var(--bw) solid var(--line);
}
.pj-modal__title {
  flex: 1;
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.3 var(--font-sans);
}
.pj-modal__x {
  display: inline-grid;
  width: var(--ctl-h-sm);
  height: var(--ctl-h-sm);
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-body);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.pj-modal__x:hover {
  color: var(--ink);
  background: var(--sunken);
}
.pj-modal__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  overflow: auto;
  padding: var(--sp-5);
  font-size: var(--fs-body);
}
.pj-modal__foot {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-5);
  border-top: var(--bw) solid var(--line);
}
</style>
