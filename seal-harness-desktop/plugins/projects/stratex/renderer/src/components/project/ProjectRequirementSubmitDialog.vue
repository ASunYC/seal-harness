<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import { PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH } from '@shared/protocol/project-testing.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  REQUIREMENT_SUBMIT_TEXT,
  nextRoundNo,
  submissionArtifactOptions,
  submissionReviewerOptions,
  submitDialogSubline,
  unfinishedTaskSummary,
} from './requirement-submission';
import { useProjectCollabStore, type RequirementSubmitOutcome } from '../../stores/projectCollab';

/**
 * 整条需求提测弹窗（TST-02）。版式照协作原型 `submitDialog`（末层把标题改成「整条需求提测 · 标题」，
 * 只许需求处理人打开）：需求标题 + 「第 N 轮 · 任务进度」→ 整体完成说明 → 本轮交付物 → 测试负责人 → 说明行。
 *
 * ⛔ **取消零写入**：取消只 `emit('close')`，绝不调提交——只打开又取消时服务端一个字节都不写。
 * ⛔ **失败不伪成功**：失败就地显示真实原因（业务码文案 + 参考编号），弹层留在原地、输入一个字不丢；
 *    只有成功才 `emit('done')`。未完成任务逐条列出（从清单按 id 找标题，找不到的合并成「另有 N 项」）。
 * ⭐ `clientRequestId` 每次打开生成一次、同一次打开内的重试沿用：同号同内容的重试回原轮次（幂等），
 *    换号等于把幂等关掉。版本号读清单里的**活**需求——撞版本冲突时 store 已重取清单，重试带的就是新版本。
 * ⭐ 测试负责人候选排除我与需求处理人（D-TEST-01 选 A）；这只是不摆必错入口，门在服务端。
 * ⚠️ 登出 / 登入是原地换号、视图不卸载：身份或项目一变弹层即关，上一个账号的草稿不留到下一个账号。
 * ⚠️【埋点红线】整体完成说明是用户亲笔：⛔ 不进日志与埋点。
 */
const props = defineProps<{ requirement: Todo; projectId: string }>();
const emit = defineEmits<{ close: []; done: [] }>();

const store = useProjectCollabStore();

/** 清单里的活需求（撞冲突重取后版本已是新的）；清单里没有时退回打开时的快照。 */
const requirement = computed(() => store.todosById.get(props.requirement.id) ?? props.requirement);

const clientRequestId = crypto.randomUUID();
const summary = ref('');
const selectedVersionIds = ref<readonly string[]>([]);
const busy = ref(false);
const failure = ref<Extract<RequirementSubmitOutcome, { ok: false }> | null>(null);

const members = computed(() => store.detail?.members ?? []);
const reviewers = computed(() =>
  submissionReviewerOptions(members.value, {
    mySubject: store.mySubject,
    assigneeSubject: requirement.value.assigneeSubject,
  }),
);
const reviewerSubject = ref('');
// 名册变化使选择失效时恢复待认领，不替用户选择另一位成员。
watch(reviewers, (options) => {
  if (!options.some((option) => option.subject === reviewerSubject.value)) {
    reviewerSubject.value = '';
  }
});

const rounds = computed(() => store.requirementRounds[props.requirement.id] ?? null);
const subline = computed(() =>
  submitDialogSubline(
    requirement.value,
    rounds.value?.loaded ? nextRoundNo(rounds.value.items) : null,
  ),
);

const artifactOptions = computed(() => submissionArtifactOptions(store.assets));
const assetsPending = computed(() => !store.assetsLoaded && store.assetsError === null);

const unfinished = computed(() => {
  const current = failure.value;
  if (current === null || current.serverCode !== 'submission_tasks_unfinished') return null;
  return unfinishedTaskSummary(current.unfinishedTaskIds, current.unfinishedTaskCount, store.todos);
});

const canSend = computed(() => !busy.value && summary.value.trim().length > 0);

onMounted(() => {
  void store.loadAssets(props.projectId);
});

watch([() => store.mySubject, () => store.activeProjectId], () => emit('close'));

/** 勾选 / 取消一份交付物（选的是资产的**当前版本** id）；没有版本的行本来就是禁用的。 */
function onArtifactChange(versionId: string | null, event: Event): void {
  if (versionId === null) return;
  const checked = (event.target as HTMLInputElement).checked;
  const others = selectedVersionIds.value.filter((id) => id !== versionId);
  selectedVersionIds.value = checked ? [...others, versionId] : others;
}

function cancel(): void {
  if (busy.value) return;
  emit('close');
}

async function submit(): Promise<void> {
  if (!canSend.value) return;
  busy.value = true;
  failure.value = null;
  try {
    const outcome = await store.submitRequirementForTest({
      projectId: props.projectId,
      requirementId: requirement.value.id,
      expectedVersion: requirement.value.version,
      clientRequestId,
      summary: summary.value.trim(),
      reviewerSubject: reviewerSubject.value || null,
      artifactVersionIds: [...selectedVersionIds.value],
    });
    if (outcome.ok) {
      emit('done');
      return;
    }
    // 作废的结果（在途换号 / 切项目）不提示：弹层随之关闭。
    if (outcome.notice !== null) failure.value = outcome;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ProjectDialogShell
    :title="REQUIREMENT_SUBMIT_TEXT.dialogTitle(requirement.title)"
    @close="cancel"
  >
    <div class="submit" data-testid="requirement-submit-dialog">
      <div class="submit__head">
        <p class="submit__title" data-testid="requirement-submit-title">{{ requirement.title }}</p>
        <p class="submit__subline tnum" data-testid="requirement-submit-subline">{{ subline }}</p>
      </div>

      <label class="submit__field">
        <span class="submit__label">{{ REQUIREMENT_SUBMIT_TEXT.summaryLabel }}</span>
        <textarea
          v-model="summary"
          class="submit__textarea"
          rows="4"
          required
          :maxlength="PROJECT_TEST_ROUND_MAX_SUMMARY_LENGTH"
          :disabled="busy"
          data-testid="requirement-submit-summary"
        ></textarea>
      </label>

      <fieldset class="submit__field submit__artifacts" :disabled="busy">
        <legend class="submit__label">{{ REQUIREMENT_SUBMIT_TEXT.artifactsLabel }}</legend>
        <p v-if="assetsPending" class="submit__hint" role="status">
          {{ REQUIREMENT_SUBMIT_TEXT.artifactsLoading }}
        </p>
        <p
          v-else-if="store.assetsError !== null && artifactOptions.length === 0"
          class="submit__hint"
          role="alert"
        >
          {{ REQUIREMENT_SUBMIT_TEXT.artifactsError }}
          <button class="submit__retry" type="button" @click="store.loadAssets(props.projectId)">
            {{ REQUIREMENT_SUBMIT_TEXT.retry }}
          </button>
        </p>
        <p
          v-else-if="artifactOptions.length === 0"
          class="submit__hint"
          data-testid="requirement-submit-artifacts-empty"
        >
          {{ REQUIREMENT_SUBMIT_TEXT.artifactsEmpty }}
        </p>
        <ul v-else class="submit__artifactList">
          <li v-for="option in artifactOptions" :key="option.assetId" class="submit__artifact">
            <label class="submit__check" :class="{ 'is-disabled': option.disabledReason !== null }">
              <input
                type="checkbox"
                :value="option.versionId ?? ''"
                :checked="
                  option.versionId !== null && selectedVersionIds.includes(option.versionId)
                "
                :disabled="option.versionId === null || option.disabledReason !== null"
                data-testid="requirement-submit-artifact"
                @change="onArtifactChange(option.versionId, $event)"
              />
              <span class="submit__artifactName">{{ option.label }}</span>
              <small v-if="option.disabledReason" class="submit__artifactReason">{{
                option.disabledReason
              }}</small>
            </label>
          </li>
        </ul>
      </fieldset>

      <div class="submit__field">
        <label class="submit__label" for="requirement-submit-reviewer">
          {{ REQUIREMENT_SUBMIT_TEXT.reviewerLabel }}
        </label>
        <select
          v-if="reviewers.length > 0"
          id="requirement-submit-reviewer"
          v-model="reviewerSubject"
          class="submit__select"
          :disabled="busy"
          data-testid="requirement-submit-reviewer"
        >
          <option value="">待认领</option>
          <option v-for="reviewer in reviewers" :key="reviewer.subject" :value="reviewer.subject">
            {{ reviewer.displayName || reviewer.subject }}
          </option>
        </select>
        <p
          v-else
          class="submit__hint submit__hint--warn"
          role="status"
          data-testid="requirement-submit-reviewer-missing"
        >
          {{ REQUIREMENT_SUBMIT_TEXT.reviewerMissing }}
        </p>
      </div>

      <p class="submit__note" data-testid="requirement-submit-note">
        {{ REQUIREMENT_SUBMIT_TEXT.dialogNote }}
      </p>

      <div v-if="failure" class="submit__error" role="alert" data-testid="requirement-submit-error">
        <p class="submit__errorText">
          <span>{{ failure.notice?.message }}</span>
          <ReferenceIdCopy
            v-if="failure.notice?.referenceCode"
            :reference-id="failure.notice.referenceCode"
          />
        </p>
        <section
          v-if="unfinished"
          class="submit__unfinished"
          data-testid="requirement-submit-unfinished"
        >
          <h4 class="submit__unfinishedTitle">{{ REQUIREMENT_SUBMIT_TEXT.unfinishedTitle }}</h4>
          <ul class="submit__unfinishedList">
            <li v-for="(title, index) in unfinished.titles" :key="`${index}-${title}`">
              {{ title }}
            </li>
            <li v-if="unfinished.restCount > 0">
              {{ REQUIREMENT_SUBMIT_TEXT.unfinishedRest(unfinished.restCount) }}
            </li>
          </ul>
        </section>
      </div>
    </div>

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="busy"
        data-testid="requirement-submit-cancel"
        @click="cancel"
      >
        {{ REQUIREMENT_SUBMIT_TEXT.cancel }}
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="!canSend"
        data-testid="requirement-submit-confirm"
        @click="submit"
      >
        {{ busy ? REQUIREMENT_SUBMIT_TEXT.submitting : REQUIREMENT_SUBMIT_TEXT.submit }}
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.submit {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.submit__head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.submit__title {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-title);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.submit__subline {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.submit__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.submit__label {
  padding: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
}
.submit__textarea,
.submit__select {
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.submit__textarea {
  resize: vertical;
}
.submit__textarea:focus,
.submit__select:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.submit__hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.6;
}
.submit__hint--warn {
  color: var(--warn-text);
}
.submit__retry {
  padding: 0 var(--sp-1);
  border: 0;
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.submit__artifactList {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
  list-style: none;
}
.submit__check {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-meta);
  cursor: pointer;
}
.submit__check.is-disabled {
  color: var(--muted);
  cursor: not-allowed;
}
.submit__artifactName {
  min-width: 0;
  overflow-wrap: anywhere;
}
.submit__artifactReason {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--fs-100);
}
.submit__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.submit__error {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.submit__errorText {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
/* 「提交前还需要完成」是一张待办清单不是一条报错：警示色但不用危险色（与工作单「还差哪几条」同形）。 */
.submit__unfinished {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-md);
  color: var(--warn-text);
  background: var(--warn-soft);
  font-size: var(--fs-100);
}
.submit__unfinishedTitle {
  margin: 0;
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
}
.submit__unfinishedList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 0 0 var(--sp-3);
  list-style: none;
  overflow-wrap: anywhere;
}
</style>
