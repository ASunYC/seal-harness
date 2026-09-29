<script setup lang="ts">
/**
 * 项目约定 · 右侧统一展示（CTX-01）：把**项目说明**与 **AI 录入规则**并排放在一处，
 * 各自一个「编辑」入口，点开走同一个全屏编辑器（`ProjectAgreementEditor`）。
 *
 * 原型 `index.html` `renderAsideV3` + `agreementContent11`：说明提供背景、规则指导 AI 的
 * 录入与协作。两份内容、两个上限、**两条保存路径**——说明走 `store.saveInstructions`
 * （`project:update` 的 `instructionsText`），规则走 `store.publishAiRules`
 * （`project:conventions-update` 的 `aiEntryRules`）。⛔ 不合成一格、不互相覆写。
 *
 * 复用于右栏（`ProjectConfigAside`）与头部「项目约定」抽屉两处——同一份草稿暂存在 store，
 * 两处打开看到的是同一份草稿。
 */
import { computed, onMounted, ref, watch } from 'vue';

import {
  PROJECT_MAX_AI_ENTRY_RULES_LENGTH,
  PROJECT_MAX_INSTRUCTIONS_LENGTH,
} from '@shared/protocol/project-collab.js';

import AppIcon from '../ui/AppIcon.vue';
import ProjectAgreementEditor from './ProjectAgreementEditor.vue';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { useProjectSubmissionGateStore } from '../../stores/projectSubmissionGate';
import ProjectSubmissionGatePanel from './ProjectSubmissionGatePanel.vue';

const props = defineProps<{ projectId: string }>();

const store = useProjectCollabStore();
const gateStore = useProjectSubmissionGateStore();

// 项目与账号变化同步作废在途结果；同项目的服务端规则更新仅回读，不清草稿。
watch(
  () => [props.projectId, store.projectEpoch, store.accountEpoch],
  () => {
    gateStore.activateScope({
      projectId: props.projectId,
      projectEpoch: store.projectEpoch,
      accountEpoch: store.accountEpoch,
    });
    void gateStore.load(props.projectId);
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => store.conventions?.ruleVersion,
  () => {
    void gateStore.load(props.projectId);
  },
);

/**
 * 当前打开的编辑器（null = 未编辑）。取值即**草稿字段键**（`instructions` / `aiRules`），
 * 与 store 的 `agreementDraft` 键一一对应——⛔ 别再引入第二套「rules」别名去对照。
 * 说明与规则互斥，同一时刻只开一个。
 */
const editing = ref<null | 'instructions' | 'aiRules'>(null);
const saving = ref(false);
/** 保存失败 / 409 的就地提示（传给编辑器展示；成功或重开时清空）。 */
const saveError = ref<string | null>(null);

/** AI 录入规则由本组件按需取（与详情/各域取数各自独立）。 */
onMounted(() => {
  void store.loadConventions(props.projectId);
});

const instructionsText = computed(() => store.detail?.instructionsText ?? '');
const aiRules = computed(() => store.conventions?.aiEntryRules ?? '');
const ruleVersion = computed(() => store.conventions?.ruleVersion ?? 0);
/** 说明与规则同档：manager+ 且未归档（服务端 `project_patch_minimum_role` / conventions 同判）。 */
const canEdit = computed(() => store.canEditInstructions);

/** 编辑器起笔值：优先草稿暂存（保留草稿），否则服务端当前值。 */
const editorInitial = computed(() => {
  if (editing.value === 'instructions') {
    return store.agreementDraft.instructions ?? instructionsText.value;
  }
  return store.agreementDraft.aiRules ?? aiRules.value;
});
/** 服务端当前值（编辑器判「有无未保存修改」用）。 */
const editorBaseline = computed(() =>
  editing.value === 'instructions' ? instructionsText.value : aiRules.value,
);

const INSTRUCTIONS_HELP = [
  '项目说明是团队与 AI 共同遵守的背景：写清目标、范围、交付与协作约定。',
  '修改说明不会改动任何需求、任务或测试结果。',
] as const;
const RULES_HELP = [
  '规则指导 AI 何时把讨论整理成需求 / 任务草稿，以及协作边界。',
  '发布生成新版本；历史轮次仍按其提交时的版本读取，不会被追改。',
  '发布后旧草稿需重新生成——不会覆盖任何已有业务记录。',
] as const;

function openEditor(field: 'instructions' | 'aiRules'): void {
  saveError.value = null;
  editing.value = field;
}

/** 每次输入回写 store 暂存（草稿保留的载体；取消 / 关闭后仍在）。 */
function onEditorInput(field: 'instructions' | 'aiRules', value: string): void {
  store.setAgreementDraft(field, value);
}

/** 关闭编辑器：⛔ 不清草稿（离开只是收起，暂存仍在 store）。 */
function closeEditor(): void {
  editing.value = null;
}

async function onSave(value: string): Promise<void> {
  if (saving.value) return;
  const field = editing.value;
  if (field === null) return;
  saving.value = true;
  saveError.value = null;
  try {
    const ok =
      field === 'instructions'
        ? await store.saveInstructions(props.projectId, value)
        : await store.publishAiRules(props.projectId, value, ruleVersion.value);
    if (ok) {
      // 说明成功后手动清草稿；规则由 `publishAiRules` 内部清（发布即换版本）。
      if (field === 'instructions') store.clearAgreementDraft('instructions');
      editing.value = null;
    } else {
      // 失败（含 409）：保持打开、草稿不动，就地显示失败原因（判据：不吞长文）。
      saveError.value = store.actionNotice?.message ?? '保存失败，请稍后重试。';
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <!--
    协作原型 `agreementContent11`：一个「项目约定」分区，下挂可折叠的各段约定——项目说明默认展开、
    AI 录入规则和提交测试规则默认收起；各自保存，不互相覆写。
  -->
  <section class="pj-cfg agreements" data-testid="project-agreements">
    <header class="pj-cfg__head">
      <AppIcon name="plan" :size="14" class="pj-cfg__headIcon" />
      <span class="pj-cfg__title">项目约定</span>
    </header>
    <p class="pj-cfg__ruleNote">说明提供背景，规则指导 AI 的录入与协作；发布新版本不改历史记录。</p>

    <details class="pj-agree" data-testid="project-instructions" open>
      <summary class="pj-agree__summary">
        <span class="pj-cfg__title">项目说明</span>
      </summary>
      <div class="pj-agree__body">
        <p v-if="instructionsText" class="pj-cfg__excerpt">{{ instructionsText }}</p>
        <p v-else class="pj-cfg__empty">
          {{ canEdit ? '还没有项目说明，点「编辑说明」写下第一版。' : '还没有人设置项目说明。' }}
        </p>
        <button
          v-if="canEdit"
          class="pj-cfg__action"
          type="button"
          data-testid="project-instructions-edit"
          @click="openEditor('instructions')"
        >
          编辑说明
        </button>
      </div>
    </details>

    <details class="pj-agree" data-testid="project-ai-rules">
      <summary class="pj-agree__summary">
        <span class="pj-cfg__title">AI 录入规则</span>
        <span v-if="ruleVersion > 0" class="pj-cfg__ruleVersion tnum" data-testid="ai-rules-version"
          >v{{ ruleVersion }}</span
        >
      </summary>
      <div class="pj-agree__body">
        <p v-if="aiRules" class="pj-cfg__excerpt">{{ aiRules }}</p>
        <p v-else class="pj-cfg__empty">
          {{
            canEdit ? '还没有 AI 录入规则，点「编辑规则」写下第一版。' : '还没有设置 AI 录入规则。'
          }}
        </p>
        <button
          v-if="canEdit"
          class="pj-cfg__action"
          type="button"
          data-testid="project-ai-rules-edit"
          @click="openEditor('aiRules')"
        >
          编辑规则
        </button>
      </div>
    </details>

    <ProjectSubmissionGatePanel
      :key="`${props.projectId}:${store.projectEpoch}:${store.accountEpoch}`"
      :gate="gateStore.gate"
      :draft="gateStore.draft"
      :loading="gateStore.loading"
      :saving="gateStore.saving"
      :notice="gateStore.notice"
      :can-edit="canEdit"
      @input="gateStore.setDraft"
      @save="gateStore.save(props.projectId)"
      @reload="gateStore.load(props.projectId)"
    />

    <ProjectAgreementEditor
      v-if="editing === 'instructions'"
      title="编辑项目说明"
      :initial-value="editorInitial"
      :baseline="editorBaseline"
      :max-length="PROJECT_MAX_INSTRUCTIONS_LENGTH"
      :saving="saving"
      save-label="保存说明"
      placeholder="写下项目背景、目标与协作约定…"
      :help="INSTRUCTIONS_HELP"
      :notice="saveError"
      @input="(value) => onEditorInput('instructions', value)"
      @save="onSave"
      @close="closeEditor"
    />
    <ProjectAgreementEditor
      v-else-if="editing === 'aiRules'"
      title="编辑 AI 录入规则"
      :initial-value="editorInitial"
      :baseline="editorBaseline"
      :max-length="PROJECT_MAX_AI_ENTRY_RULES_LENGTH"
      :saving="saving"
      save-label="发布新版本"
      :version-label="ruleVersion > 0 ? `当前规则 v${ruleVersion} · 建议稿` : '尚未发布 · 建议稿'"
      placeholder="写下 AI 何时录入需求 / 任务，以及协作边界…"
      :help="RULES_HELP"
      :notice="saveError"
      @input="(value) => onEditorInput('aiRules', value)"
      @save="onSave"
      @close="closeEditor"
    />
  </section>
</template>

<style scoped>
/*
 * 与 `ProjectConfigAside` 的 `.pj-cfg` 同款（scoped，故此处自带一份）：右栏配置块。
 * 只保留本面板用到的选择器，值取同一套 token（视觉与相邻的成员块对齐）。
 */
/* 折叠段（原型 agreementContent11 的 <details>）：摘要行即段标题，展开态箭头转向。 */
.pj-agree {
  border-top: var(--bw) solid var(--line-weak);
}
.pj-agree__summary {
  display: flex;
  min-height: var(--px-30);
  align-items: center;
  gap: var(--px-7);
  border-radius: var(--r-sm);
  cursor: pointer;
  list-style: none;
}
.pj-agree__summary::-webkit-details-marker {
  display: none;
}
.pj-agree__summary::after {
  content: '';
  width: var(--px-6);
  height: var(--px-6);
  margin-left: auto;
  border-right: var(--bw-strong) solid var(--muted);
  border-bottom: var(--bw-strong) solid var(--muted);
  transform: rotate(-45deg);
  transition: transform var(--dur-1) var(--ease-out);
}
.pj-agree[open] > .pj-agree__summary::after {
  transform: rotate(45deg);
}
.pj-agree__summary:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.pj-agree__body {
  display: flex;
  flex-direction: column;
  gap: var(--px-10);
  padding-bottom: var(--px-6);
}
.pj-cfg {
  display: flex;
  flex-direction: column;
  gap: var(--px-10);
  padding: var(--px-16) var(--px-18);
  border-bottom: var(--bw) solid var(--line);
}
.pj-cfg:first-child {
  padding-top: var(--px-20);
}
.pj-cfg__head {
  display: flex;
  align-items: center;
  gap: var(--px-7);
  margin: 0;
}
.pj-cfg__headIcon {
  color: var(--muted);
}
.pj-cfg__title {
  color: var(--muted2);
  font-size: var(--fs-200);
  font-weight: var(--fw-620);
  letter-spacing: 0.04em;
}
.pj-cfg__ruleVersion {
  padding: var(--px-1) var(--px-7);
  border-radius: var(--r-pill);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
}
.pj-cfg__excerpt {
  margin: 0;
  overflow-wrap: anywhere;
  padding: var(--px-10) var(--px-12);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--panel);
  font-size: var(--fs-200);
  line-height: var(--lh-1p7);
  white-space: pre-wrap;
}
.pj-cfg__empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p7);
}
.pj-cfg__ruleNote {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.6;
}
.pj-cfg__action {
  height: var(--px-26);
  align-self: flex-start;
  padding: 0 var(--px-11);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted2);
  background: var(--panel);
  font-size: var(--fs-200);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.pj-cfg__action:hover {
  color: var(--accent-text);
  background: var(--accent-soft);
}
</style>
