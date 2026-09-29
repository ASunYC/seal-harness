<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH,
  PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH,
  PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH,
  type ProjectDataSource,
} from '@shared/protocol/project-datasource.js';

/**
 * 数据源的新建 / 编辑表单。
 *
 * 只表达**服务端真的接受**的那几项：实例地址、仓库标识、分支、是否启用、是否同时
 * 导入需求文档。⛔ 过程件开关不给控件——服务端那一列是被 CHECK 钉死的预留位，
 * 摆一个点了不生效的勾比不摆更糟；改成一句如实的说明。
 *
 * 分支留空 ＝ 用仓库默认分支（与服务端 `git_ref = null` 同义）。
 */
const props = defineProps<{
  /** 非空＝编辑既有数据源；null＝新建。 */
  source: ProjectDataSource | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  submit: [
    value: {
      baseUrl: string;
      repoPath: string;
      gitRef: string | null;
      enabled: boolean;
      includeDocuments: boolean;
    },
  ];
  cancel: [];
}>();

const baseUrl = ref(props.source?.baseUrl ?? '');
const repoPath = ref(props.source?.repoPath ?? '');
const gitRef = ref(props.source?.gitRef ?? '');
const enabled = ref(props.source?.enabled ?? true);
const includeDocuments = ref(props.source?.includeDocuments ?? true);

const isEditing = computed(() => props.source !== null);
/** 提交闸：两个必填项去空白后非空才放行（服务端也拒空白，早一步拦住少一次往返）。 */
const canSubmit = computed(
  () => !props.busy && baseUrl.value.trim().length > 0 && repoPath.value.trim().length > 0,
);

function onSubmit(): void {
  if (!canSubmit.value) return;
  const ref_ = gitRef.value.trim();
  emit('submit', {
    baseUrl: baseUrl.value.trim(),
    repoPath: repoPath.value.trim(),
    gitRef: ref_.length > 0 ? ref_ : null,
    enabled: enabled.value,
    includeDocuments: includeDocuments.value,
  });
}
</script>

<template>
  <form class="dsform" data-testid="datasource-form" @submit.prevent="onSubmit">
    <label class="dsform__field">
      <span class="dsform__label">实例地址</span>
      <input
        v-model="baseUrl"
        class="dsform__input"
        type="text"
        required
        :maxlength="PROJECT_DATA_SOURCE_BASE_URL_MAX_LENGTH"
        placeholder="http://代码平台内网地址"
        data-testid="datasource-form-base-url"
      />
      <span class="dsform__hint">只填实例根地址；⛔ 不要把账号或令牌拼在地址里。</span>
    </label>

    <label class="dsform__field">
      <span class="dsform__label">仓库标识</span>
      <input
        v-model="repoPath"
        class="dsform__input"
        type="text"
        required
        :maxlength="PROJECT_DATA_SOURCE_REPO_PATH_MAX_LENGTH"
        placeholder="群组/子群组/仓库名"
        data-testid="datasource-form-repo-path"
      />
    </label>

    <label class="dsform__field">
      <span class="dsform__label">分支或标签</span>
      <input
        v-model="gitRef"
        class="dsform__input"
        type="text"
        :maxlength="PROJECT_DATA_SOURCE_GIT_REF_MAX_LENGTH"
        placeholder="留空 = 仓库默认分支"
        data-testid="datasource-form-git-ref"
      />
      <span class="dsform__hint">任务记录是仓库文件，不同分支上的内容可以完全不同。</span>
    </label>

    <label class="dsform__check">
      <input v-model="enabled" type="checkbox" data-testid="datasource-form-enabled" />
      <span>启用（停用后保留配置但不再同步）</span>
    </label>

    <label class="dsform__check">
      <input
        v-model="includeDocuments"
        type="checkbox"
        data-testid="datasource-form-include-documents"
      />
      <span>同时导入需求文档，作为项目资产</span>
    </label>

    <p class="dsform__note">过程文档（调研、验证等过程件）本版本不导入。</p>

    <div class="dsform__ops">
      <button class="btn btn--secondary" type="button" @click="emit('cancel')">取消</button>
      <button
        class="btn btn--primary"
        type="submit"
        :disabled="!canSubmit"
        data-testid="datasource-form-submit"
      >
        {{ isEditing ? '保存修改' : '添加数据源' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.dsform {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--sunken);
}
.dsform__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.dsform__label {
  color: var(--muted);
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
}
.dsform__input {
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--panel);
  font-size: var(--fs-body);
}
.dsform__input:focus-visible {
  border-color: var(--accent-line);
  outline: none;
}
.dsform__hint,
.dsform__note {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.dsform__check {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-body);
}
.dsform__ops {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding-top: var(--sp-1);
}
</style>
