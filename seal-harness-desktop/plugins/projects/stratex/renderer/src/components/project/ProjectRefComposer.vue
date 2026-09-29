<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { PROJECT_MAX_REFS } from '@shared/protocol/project-collab.js';

import {
  applyRefSelection,
  appendRef,
  findRefTrigger,
  refCandidates,
  removeRef,
  resolveRefLabel,
  type ProjectRefCandidate,
  type ProjectRefSources,
  type ProjectRefTrigger,
} from './project-refs';

/**
 * 讨论与动态共用的输入框：纯文本正文 + `@` 提及 / `#` 引用（G-9）。
 *
 * 正文照旧是纯文本（⛔ 不引入 Markdown 渲染器）；被选中的成员/资产/待办另落成
 * `refs` 里的结构化 token，由父组件在提交时一并带上。浮层只从**已载**的成员名册、
 * 资产与待办里挑——需要更多候选时由父组件先去取（`@needCandidates`）。
 */

const props = withDefaults(
  defineProps<{
    modelValue: string;
    refs: readonly string[];
    sources: ProjectRefSources;
    placeholder?: string;
    ariaLabel?: string;
    maxlength?: number;
    rows?: number;
    /** true＝回车即提交（讨论页）；false＝回车换行，由按钮提交（动态页）。 */
    submitOnEnter?: boolean;
    disabled?: boolean;
  }>(),
  {
    placeholder: '',
    ariaLabel: '输入内容',
    maxlength: 8_000,
    rows: 1,
    submitOnEnter: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:refs': [refs: readonly string[]];
  submit: [];
  /** 引用浮层打开：父组件按需去取资产/待办（不由本组件碰 store）。 */
  needCandidates: [];
}>();

const field = ref<HTMLTextAreaElement | null>(null);
const trigger = ref<ProjectRefTrigger | null>(null);
const triggerStart = ref(0);
const triggerQuery = ref('');
const activeIndex = ref(0);

const suggestions = computed<readonly ProjectRefCandidate[]>(() =>
  trigger.value === null ? [] : refCandidates(trigger.value, props.sources, triggerQuery.value),
);
const pickerOpen = computed(() => trigger.value !== null && suggestions.value.length > 0);
const refsFull = computed(() => props.refs.length >= PROJECT_MAX_REFS);

/** 已附引用的芯片文案（认得出 id 就显示人话，认不出照实显示 token）。 */
const refChips = computed(() =>
  props.refs.map((token) => ({ token, ...resolveRefLabel(token, props.sources) })),
);

function closePicker(): void {
  trigger.value = null;
  triggerQuery.value = '';
  activeIndex.value = 0;
}

/** 每次输入/移动光标后重算触发词——用户回删把 `@` 删掉时浮层要跟着关。 */
function syncTrigger(): void {
  const element = field.value;
  if (!element) return;
  const found = findRefTrigger(element.value, element.selectionStart ?? element.value.length);
  if (found === null) {
    closePicker();
    return;
  }
  const opening = trigger.value !== found.trigger;
  trigger.value = found.trigger;
  triggerStart.value = found.start;
  triggerQuery.value = found.query;
  activeIndex.value = 0;
  if (opening && found.trigger === '#') emit('needCandidates');
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  syncTrigger();
}

async function select(candidate: ProjectRefCandidate): Promise<void> {
  const element = field.value;
  if (!element) return;
  const caret = element.selectionStart ?? element.value.length;
  const applied = applyRefSelection(element.value, triggerStart.value, caret, candidate.insertText);
  emit('update:modelValue', applied.text);
  emit('update:refs', appendRef(props.refs, candidate.token));
  closePicker();
  // 正文由父组件回灌，等一帧再把光标放回落点，否则会被重渲染顶到末尾。
  await nextTick();
  element.setSelectionRange(applied.caret, applied.caret);
  element.focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (pickerOpen.value) {
    const total = suggestions.value.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex.value = (activeIndex.value + 1) % total;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex.value = (activeIndex.value - 1 + total) % total;
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const candidate = suggestions.value[activeIndex.value];
      if (candidate) {
        event.preventDefault();
        void select(candidate);
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker();
      return;
    }
  }
  if (event.key === 'Enter' && props.submitOnEnter && !event.shiftKey) {
    event.preventDefault();
    emit('submit');
  }
}

/** 父组件清空草稿（发送成功）后浮层要跟着收——否则悬着一个对不上正文的列表。 */
watch(
  () => props.modelValue,
  (value) => {
    if (value.length === 0) closePicker();
  },
);
</script>

<template>
  <div class="refcomposer">
    <textarea
      ref="field"
      class="refcomposer__input"
      :value="modelValue"
      :rows="rows"
      :maxlength="maxlength"
      :aria-label="ariaLabel"
      :placeholder="placeholder"
      :disabled="disabled"
      data-testid="ref-composer-input"
      @input="onInput"
      @keydown="onKeydown"
      @click="syncTrigger"
      @keyup="syncTrigger"
    ></textarea>

    <ul v-if="pickerOpen" class="refcomposer__picker" role="listbox" data-testid="ref-picker">
      <li
        v-for="(candidate, index) in suggestions"
        :key="candidate.token"
        class="refcomposer__option"
        :class="{ 'is-active': index === activeIndex }"
        role="option"
        :aria-selected="index === activeIndex"
        data-testid="ref-option"
        @mousedown.prevent="select(candidate)"
      >
        <span class="refcomposer__optionKind">{{ candidate.kindLabel }}</span>
        <span class="refcomposer__optionName">{{ candidate.name }}</span>
      </li>
    </ul>

    <div v-if="refChips.length > 0" class="refcomposer__chips" data-testid="ref-chips">
      <span v-for="chip in refChips" :key="chip.token" class="refcomposer__chip">
        <span v-if="chip.kindLabel" class="refcomposer__chipKind">{{ chip.kindLabel }}</span>
        <b class="refcomposer__chipName">{{ chip.name }}</b>
        <button
          class="refcomposer__chipDrop"
          type="button"
          :aria-label="`移除引用 ${chip.name}`"
          data-testid="ref-chip-remove"
          @click="emit('update:refs', removeRef(refs, chip.token))"
        >
          ×
        </button>
      </span>
    </div>
    <p v-if="refsFull" class="refcomposer__full" role="status">
      单条最多附 {{ PROJECT_MAX_REFS }} 条引用，移除一条才能再加。
    </p>
  </div>
</template>

<style scoped>
.refcomposer {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-2);
}
.refcomposer__input {
  width: 100%;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--fs-body);
  line-height: var(--lh-tight);
  outline: none;
  box-shadow: none;
  resize: vertical;
}
.refcomposer__input::placeholder {
  color: var(--muted);
}
/* 候选浮层贴着输入框上沿弹出（输入框在底部合成区，往下没有空间） */
.refcomposer__picker {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + var(--sp-2));
  left: 0;
  width: min(320px, 100%);
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: var(--sp-1);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: var(--sh-2);
  list-style: none;
}
.refcomposer__option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.refcomposer__option:hover,
.refcomposer__option.is-active {
  background: var(--accent-soft);
}
.refcomposer__optionKind {
  flex: 0 0 auto;
  padding: 0 var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-100);
}
.refcomposer__optionName {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refcomposer__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.refcomposer__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--sunken);
  font-size: var(--fs-100);
}
.refcomposer__chipKind {
  color: var(--muted);
}
.refcomposer__chipName {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-weight: var(--fw-label);
}
.refcomposer__chipDrop {
  padding: 0 2px;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-meta);
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.refcomposer__chipDrop:hover {
  color: var(--danger-text);
}
.refcomposer__full {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-100);
}
</style>
