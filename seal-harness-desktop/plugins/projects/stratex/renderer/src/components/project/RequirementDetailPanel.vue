<script setup lang="ts">
/**
 * 单屏需求详情里的一块面板（原型 `.req-card-spec12` / `.req-card-work12` 的外壳）：
 * 头部（标题 + 就地动作，或整条换成页签）＋ 自己滚动的正文。
 *
 * 内容全由调用方插槽给——插槽内容按编译处算 scoped，样式仍归调用方；本组件只管外壳与滚动。
 * 窄时（按详情容器宽度，阈值与 ProjectRequirementDetail.vue 同为 660px）面板不再各自滚动，
 * 整张卡交给页签的纵向滚动：长文照样读得完，⛔ 不缩字号。
 */
const props = defineProps<{
  /** 面板标题（面板由它命名）。页签面板不给标题，改用 `head` 插槽放页签、`label` 命名面板。 */
  title?: string;
  titleId?: string;
  label?: string;
  /**
   * 给了就把正文标成可聚焦的具名区域：长文正文里没有可聚焦的东西，键盘用户要先落到它上面
   * 才滚得动。正文本身带可聚焦项（页签面板）时不给，免得多一个 Tab 位。
   */
  regionLabel?: string;
  bodyTestid?: string;
}>();
</script>

<template>
  <section
    class="req-detail__panel"
    :aria-labelledby="props.title ? props.titleId : undefined"
    :aria-label="props.title ? undefined : props.label"
  >
    <header class="req-detail__panelHead">
      <slot name="head">
        <h3 :id="props.titleId" class="req-detail__panelTitle">{{ props.title }}</h3>
      </slot>
      <slot name="actions" />
    </header>
    <div
      class="req-detail__scroll"
      :tabindex="props.regionLabel ? 0 : undefined"
      :role="props.regionLabel ? 'region' : undefined"
      :aria-label="props.regionLabel"
      :data-testid="props.bodyTestid"
    >
      <slot />
    </div>
  </section>
</template>

<style scoped>
/* 原型 .req-card-spec12 / .req-card-work12：描边圆角、panel 底，正文区自己滚。 */
.req-detail__panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.req-detail__panelHead {
  display: flex;
  min-width: 0;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--px-8);
  padding: var(--px-12) var(--px-16) var(--px-8);
}
.req-detail__panelTitle {
  margin: 0 auto 0 0;
  color: var(--ink);
  font-size: var(--fs-400);
  font-weight: var(--fw-title);
}
/* 面板正文自己滚（原型 .req-card-spec12 overflow:auto + scrollbar-gutter:stable）。
   ⛔ 长文靠滚动容纳，不缩字号。 */
.req-detail__scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 var(--px-16) var(--px-12);
  scrollbar-gutter: stable;
}
.req-detail__scroll:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring-flat);
}
@container (max-width: 660px) {
  .req-detail__panel {
    min-height: 200px; /* 原型窄屏 .req-card-spec12 min-height=200px（不在 --px-* 梯） */
    overflow: visible;
  }
  .req-detail__scroll {
    overflow: visible;
  }
}
</style>
