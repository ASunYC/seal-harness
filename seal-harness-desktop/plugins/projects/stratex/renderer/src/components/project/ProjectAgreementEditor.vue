<script setup lang="ts">
/**
 * 项目约定的**全屏编辑器**（CTX-01）：项目说明与 AI 录入规则共用一个外壳。
 *
 * 原型 `index.html` `.agreement-editor-full`（全屏、头/脚固定、正文自适应）。四条判据
 * 都收在这里（acceptance「409 / 保存失败 / 打开帮助 / 离开确认不丢长文」）：
 *  1. 打开帮助（`toggleHelp`）只切显隐，**不碰草稿**；
 *  2. 保存失败 / 409 由父组件决定「不关」——本组件在 `save` 后不自行清空 `draft`；
 *  3. 离开（取消 / X / Esc / 点遮罩）先经 `tryClose`：脏时出确认，草稿仍在（父层暂存）。
 *
 * ⚠️ 草稿的**权威暂存在父层 store**（按项目 + 字段）：本组件每次输入 `emit('input')` 回写，
 *    重开时父层把暂存值经 `initialValue` 传回——所以「取消后再打开还在」不靠本组件存活。
 */
import { computed, onMounted, ref } from 'vue';

import ProjectDialogShell from './ProjectDialogShell.vue';

const props = defineProps<{
  /** 弹窗标题（如「编辑项目说明」/「编辑 AI 录入规则」）。 */
  title: string;
  /** 起笔值：父层的「草稿暂存 ?? 服务端当前值」。仅在挂载时读取一次。 */
  initialValue: string;
  /** 服务端当前已保存值：用于判「有没有未保存修改」（离开确认门槛）。 */
  baseline: string;
  /** 字符上限（说明与规则各自一档，见 PROJECT_MAX_*）。 */
  maxLength: number;
  saving: boolean;
  /** 主按钮文案（说明→「保存说明」；规则→「发布新版本」）。 */
  saveLabel: string;
  placeholder?: string;
  /** 规则专用：「当前规则 v3 · 建议稿」等版本副标（说明不传）。 */
  versionLabel?: string;
  /** 填写说明的要点（点开「查看填写说明」才展开）。 */
  help?: readonly string[];
  /** 保存失败 / 409 的就地提示（父层保存返回失败时传入）；null = 无提示。 */
  notice?: string | null;
}>();

const emit = defineEmits<{
  /** 每次输入：把最新值回写父层 store 暂存（草稿保留的载体）。 */
  input: [value: string];
  /** 点保存/发布：交父层落库；父层成功才关，失败保持打开。 */
  save: [value: string];
  /** 关闭编辑器（脏时已经过离开确认）。 */
  close: [];
}>();

/** 本地草稿：起笔于 `initialValue`（= 父层暂存 ?? 服务端值），此后由用户输入驱动。 */
const draft = ref(props.initialValue);
const showHelp = ref(false);
/** 未保存离开的二次确认（脏时才出）。 */
const confirmingLeave = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const helpLines = computed(() => props.help ?? []);
const countLabel = computed(
  () => `${draft.value.length.toLocaleString()} / ${props.maxLength.toLocaleString()} 字符`,
);
/** 有没有未保存修改：与服务端当前值比较（不是与草稿起笔值）。 */
const dirty = computed(() => draft.value !== props.baseline);

onMounted(() => {
  textareaRef.value?.focus();
});

function onInput(): void {
  emit('input', draft.value);
}

/** 打开/收起填写说明——⛔ 只切显隐，绝不动 `draft`（判据：打开帮助不丢长文）。 */
function toggleHelp(): void {
  showHelp.value = !showHelp.value;
}

function onSave(): void {
  if (props.saving) return;
  emit('save', draft.value);
}

/** 任何关闭入口（取消 / X / Esc / 遮罩）都走这里：脏则先确认，净则直接关。 */
function tryClose(): void {
  if (dirty.value) {
    confirmingLeave.value = true;
    return;
  }
  emit('close');
}

/** 确认离开：草稿已在父层暂存，这里只关闭（下次打开仍在）。 */
function confirmLeave(): void {
  confirmingLeave.value = false;
  emit('close');
}

function cancelLeave(): void {
  confirmingLeave.value = false;
}
</script>

<template>
  <ProjectDialogShell :title="title" size="full" @close="tryClose">
    <div class="agreement-editor" data-testid="agreement-editor">
      <p v-if="versionLabel" class="agreement-editor__version">{{ versionLabel }}</p>
      <button
        v-if="helpLines.length > 0"
        type="button"
        class="agreement-editor__helpToggle"
        :aria-expanded="showHelp"
        data-testid="agreement-editor-help-toggle"
        @click="toggleHelp"
      >
        {{ showHelp ? '收起填写说明' : '查看填写说明' }}
      </button>
      <section
        v-if="showHelp"
        class="agreement-editor__help"
        data-testid="agreement-editor-help"
        role="note"
      >
        <p v-for="(line, index) in helpLines" :key="index">{{ line }}</p>
      </section>
      <textarea
        ref="textareaRef"
        v-model="draft"
        class="agreement-editor__input"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :aria-label="title"
        data-testid="agreement-editor-input"
        @input="onInput"
      ></textarea>
      <p
        v-if="notice"
        class="agreement-editor__notice"
        role="alert"
        data-testid="agreement-editor-notice"
      >
        {{ notice }}
      </p>
    </div>
    <template #foot>
      <span
        class="agreement-editor__count"
        aria-live="polite"
        data-testid="agreement-editor-count"
        >{{ countLabel }}</span
      >
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="saving"
        data-testid="agreement-editor-cancel"
        @click="tryClose"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="saving"
        data-testid="agreement-editor-save"
        @click="onSave"
      >
        {{ saveLabel }}
      </button>
    </template>
  </ProjectDialogShell>

  <!--
    未保存离开确认：离开只是关闭，草稿仍在父层暂存（判据：离开确认不丢长文）。
    ⛔ 不自造 role=alertdialog 浮层——走 ProjectDialogShell（OverlaySurface：焦点陷阱 /
    点外关 / 叠层号都归原语），guard-overlay 只认这一个实现处。
  -->
  <ProjectDialogShell v-if="confirmingLeave" title="放弃未保存的修改？" @close="cancelLeave">
    <p class="agreement-editor__confirmBody" data-testid="agreement-leave-confirm">
      有未保存的修改。离开后草稿会保留，下次打开可继续编辑。
    </p>
    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="agreement-leave-stay"
        @click="cancelLeave"
      >
        继续编辑
      </button>
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="agreement-leave-discard"
        @click="confirmLeave"
      >
        离开（保留草稿）
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.agreement-editor {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-3);
}
.agreement-editor__version {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.agreement-editor__helpToggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-meta);
  cursor: pointer;
}
.agreement-editor__helpToggle:hover {
  text-decoration: underline;
}
.agreement-editor__help {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--accent-soft);
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.agreement-editor__help p {
  margin: 0 0 var(--sp-1);
}
.agreement-editor__help p:last-child {
  margin-bottom: 0;
}
.agreement-editor__input {
  width: 100%;
  min-height: 220px;
  box-sizing: border-box;
  flex: 1;
  padding: var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-body);
  line-height: var(--lh-1p7);
  resize: none;
}
.agreement-editor__input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.agreement-editor__notice {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
.agreement-editor__count {
  margin-right: auto;
  color: var(--muted);
  font-size: var(--fs-meta);
}
/* 离开确认正文（外框、按钮排布归 ProjectDialogShell）。 */
.agreement-editor__confirmBody {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
</style>
