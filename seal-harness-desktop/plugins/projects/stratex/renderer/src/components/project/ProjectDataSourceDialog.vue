<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import {
  PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH,
  type ProjectDataSource,
  type ProjectDataSourceSyncSummary,
  type ProjectDataSourceTicketScheme,
  type ProjectExternalLink,
} from '@shared/protocol/project-datasource.js';

import ConfirmDialog from '../ui/ConfirmDialog.vue';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDataSourceForm from './ProjectDataSourceForm.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import {
  EXTERNAL_LINK_KIND_LABELS,
  describeDataSourceTarget,
  describeDiagnosticsOverflow,
  describeLastSync,
  describeSyncCounts,
  formatSyncTime,
  projectDataSourceErrorNotice,
  projectDataSourceInfoNotice,
  type ProjectDataSourceNotice,
} from './project-datasource-copy';

import { projectDataSourceApi } from '../../sdk/projectDataSource';

/**
 * 外部数据源管理面（拥有者）。
 *
 * 五件必须做对的事，各自的落点都在本文件：
 *  ① 权限：入口由调用方按角色收窄（工具栏只对拥有者渲染那一组）；本组件再按
 *     `canManage` 收一次写入口——服务端仍是真正的门，界面收窄只是不给点了必错的钮。
 *  ② 白名单 fail-closed：`externalSourcesDisabled` 单独一档，翻成「本部署尚未开放，
 *     请联系管理员」，并把新增入口一并收起；⛔ 不混进通用错误。
 *  ③ 同步是长动作：`syncingId` 全程占位，按钮转「同步中…」且不可再点；失败按码给
 *     可读原因（分支上没有任务目录 / 票据被拒 / 仓库看不到…），不塌缩成「同步失败」。
 *  ④ 护栏超限：回执里的 `diagnostics` 逐条列出来，被截断时如实说还有多少条。
 *  ⑤ 对账面：外部条目消失时服务端只标记来源失效、不删本地数据——这里给它一个
 *     看得见的地方，否则「不删」等于「悄悄留着谁也不知道」。
 */
const props = defineProps<{
  projectId: string;
  /** 拥有者才为 true；false 时本面只读（列表与对账行仍可看）。 */
  canManage: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const loading = ref(true);
const sources = ref<readonly ProjectDataSource[]>([]);
const ticketedIds = ref<readonly string[]>([]);
const notice = ref<ProjectDataSourceNotice | null>(null);
/** 本部署没开外部数据源：**设计如此**，不是故障。命中后收起全部新增/同步入口。 */
const externalSourcesBlocked = ref(false);

/** 行内在途标记：一次只允许一个写操作，避免连点产生互相覆盖的回执。 */
const busyId = ref<string | null>(null);
const syncingId = ref<string | null>(null);
const syncSummary = ref<{ dataSourceId: string; summary: ProjectDataSourceSyncSummary } | null>(
  null,
);

/** 表单态：'new' = 新建；ProjectDataSource = 编辑；null = 收起。 */
const formTarget = ref<ProjectDataSource | 'new' | null>(null);
const formBusy = ref(false);

const ticketTarget = ref<string | null>(null);
const ticketInput = ref('');
const ticketScheme = ref<ProjectDataSourceTicketScheme>('privateToken');

const deleteTarget = ref<ProjectDataSource | null>(null);

const links = ref<readonly ProjectExternalLink[]>([]);
const linksLoaded = ref(false);
const linksLoading = ref(false);

const editingSource = computed(() =>
  formTarget.value === 'new' || formTarget.value === null ? null : formTarget.value,
);
const orphanedLinks = computed(() => links.value.filter((link) => link.linkState === 'orphaned'));
const activeLinkCount = computed(() => links.value.length - orphanedLinks.value.length);

function hasTicket(id: string): boolean {
  return ticketedIds.value.includes(id);
}

/** 失败落地的唯一入口：顺带把「白名单没开」这一档记成状态（它会改变可用入口）。 */
function fail(code: Parameters<typeof projectDataSourceErrorNotice>[0]): void {
  if (code === 'externalSourcesDisabled') externalSourcesBlocked.value = true;
  notice.value = projectDataSourceErrorNotice(code);
}

async function loadSources(): Promise<void> {
  loading.value = true;
  try {
    const result = await projectDataSourceApi.list({ projectId: props.projectId });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    sources.value = result.dataSources;
    ticketedIds.value = result.ticketedDataSourceIds;
  } catch {
    fail('transient');
  } finally {
    loading.value = false;
  }
}

async function loadLinks(): Promise<void> {
  linksLoading.value = true;
  try {
    const result = await projectDataSourceApi.externalLinks({ projectId: props.projectId });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    links.value = result.links;
    linksLoaded.value = true;
  } catch {
    fail('transient');
  } finally {
    linksLoading.value = false;
  }
}

async function submitForm(value: {
  baseUrl: string;
  repoPath: string;
  gitRef: string | null;
  enabled: boolean;
  includeDocuments: boolean;
}): Promise<void> {
  if (formBusy.value) return;
  formBusy.value = true;
  notice.value = null;
  try {
    const editing = editingSource.value;
    const result = editing
      ? await projectDataSourceApi.update({
          projectId: props.projectId,
          dataSourceId: editing.id,
          ...value,
        })
      : await projectDataSourceApi.create({ projectId: props.projectId, ...value });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    formTarget.value = null;
    notice.value = projectDataSourceInfoNotice(editing ? '数据源已更新。' : '数据源已添加。');
    await loadSources();
  } catch {
    fail('transient');
  } finally {
    formBusy.value = false;
  }
}

async function saveTicket(dataSourceId: string): Promise<void> {
  if (busyId.value !== null || ticketInput.value.trim().length === 0) return;
  busyId.value = dataSourceId;
  notice.value = null;
  try {
    const result = await projectDataSourceApi.saveTicket({
      projectId: props.projectId,
      dataSourceId,
      ticket: ticketInput.value,
      scheme: ticketScheme.value,
    });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    // 票据只往下走，不回到这里：输入框立刻清空，内存里也不留一份。
    ticketInput.value = '';
    ticketTarget.value = null;
    ticketedIds.value = [...new Set([...ticketedIds.value, dataSourceId])];
    notice.value = projectDataSourceInfoNotice('访问票据已保存在本机，不会上传。');
  } catch {
    fail('transient');
  } finally {
    busyId.value = null;
  }
}

async function clearTicket(dataSourceId: string): Promise<void> {
  if (busyId.value !== null) return;
  busyId.value = dataSourceId;
  try {
    const result = await projectDataSourceApi.clearTicket({
      projectId: props.projectId,
      dataSourceId,
    });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    ticketedIds.value = ticketedIds.value.filter((id) => id !== dataSourceId);
    notice.value = projectDataSourceInfoNotice('已撤销本机保存的访问票据。');
  } catch {
    fail('transient');
  } finally {
    busyId.value = null;
  }
}

async function sync(dataSourceId: string): Promise<void> {
  if (syncingId.value !== null) return;
  syncingId.value = dataSourceId;
  notice.value = null;
  syncSummary.value = null;
  try {
    const result = await projectDataSourceApi.sync({ projectId: props.projectId, dataSourceId });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    syncSummary.value = { dataSourceId, summary: result.summary };
    // 同步会改「上次同步」与对账行两处，都重取——不然界面停在同步前那一刻。
    await loadSources();
    if (linksLoaded.value) await loadLinks();
  } catch {
    fail('transient');
  } finally {
    syncingId.value = null;
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target || busyId.value !== null) return;
  busyId.value = target.id;
  try {
    const result = await projectDataSourceApi.remove({
      projectId: props.projectId,
      dataSourceId: target.id,
    });
    if (!result.ok) {
      fail(result.code);
      return;
    }
    deleteTarget.value = null;
    notice.value = projectDataSourceInfoNotice(
      '已断开该数据源；已导入的需求、任务与文档保留在项目里。',
    );
    await loadSources();
  } catch {
    fail('transient');
  } finally {
    busyId.value = null;
  }
}

function openTicketForm(dataSourceId: string): void {
  ticketTarget.value = dataSourceId;
  ticketInput.value = '';
}

/** 收起授权表单：⚠️ 一并清空输入，别把一枚票据留在组件状态里等着被别处读到。 */
function closeTicketForm(): void {
  ticketTarget.value = null;
  ticketInput.value = '';
}

onMounted(() => {
  void loadSources();
});
</script>

<template>
  <ProjectDialogShell title="数据源设置" @close="emit('close')">
    <p class="ds__intro">
      从代码仓库导入需求、任务与需求文档。导入是单向只读的：不会写回外部仓库。
    </p>

    <p
      v-if="notice"
      class="ds__notice"
      :class="{ 'ds__notice--error': notice.referenceCode !== null }"
      role="alert"
      data-testid="datasource-notice"
    >
      {{ notice.message }}
      <ReferenceIdCopy v-if="notice.referenceCode" :reference-id="notice.referenceCode" />
    </p>

    <div v-if="externalSourcesBlocked" class="ds__blocked" data-testid="datasource-blocked">
      <p class="ds__blockedTitle">本部署尚未开放外部数据源</p>
      <p class="ds__blockedDesc">
        这不是故障：本部署没有列出可访问的外部实例名单，外部数据源整体处于关闭状态。
        请联系管理员开放后再配置。
      </p>
    </div>

    <p v-if="loading" class="ds__state" role="status" data-testid="datasource-loading">
      正在读取数据源…
    </p>

    <p
      v-else-if="sources.length === 0"
      class="ds__state"
      role="status"
      data-testid="datasource-empty"
    >
      还没有接入外部数据源。
    </p>

    <ul v-else class="ds__list">
      <li
        v-for="source in sources"
        :key="source.id"
        class="ds__row"
        data-testid="datasource-row"
        :data-source-id="source.id"
      >
        <div class="ds__rowHead">
          <span class="ds__target" data-testid="datasource-target">{{
            describeDataSourceTarget(source)
          }}</span>
          <span v-if="!source.enabled" class="ds__badge" data-testid="datasource-badge-disabled"
            >已停用</span
          >
          <span
            v-if="!hasTicket(source.id)"
            class="ds__badge ds__badge--warn"
            data-testid="datasource-badge-unauthorized"
            >未授权</span
          >
          <span v-if="!source.includeDocuments" class="ds__badge">只导任务</span>
        </div>

        <p class="ds__meta">{{ source.baseUrl }}</p>
        <p class="ds__meta" data-testid="datasource-last-sync">{{ describeLastSync(source) }}</p>
        <pre v-if="source.lastSyncDetail" class="ds__detail" data-testid="datasource-last-detail">{{
          source.lastSyncDetail
        }}</pre>

        <div v-if="canManage" class="ds__ops">
          <button
            class="btn btn--secondary"
            type="button"
            data-testid="datasource-sync"
            :disabled="
              syncingId !== null ||
              busyId !== null ||
              externalSourcesBlocked ||
              !source.enabled ||
              !hasTicket(source.id)
            "
            :aria-busy="syncingId === source.id"
            @click="sync(source.id)"
          >
            {{ syncingId === source.id ? '同步中…' : '立即同步' }}
          </button>
          <button
            class="btn btn--secondary"
            type="button"
            data-testid="datasource-authorize"
            :disabled="busyId !== null"
            @click="openTicketForm(source.id)"
          >
            {{ hasTicket(source.id) ? '更换访问票据' : '填写访问票据' }}
          </button>
          <button
            v-if="hasTicket(source.id)"
            class="btn btn--secondary"
            type="button"
            data-testid="datasource-revoke"
            :disabled="busyId !== null"
            @click="clearTicket(source.id)"
          >
            撤销票据
          </button>
          <button
            class="btn btn--secondary"
            type="button"
            data-testid="datasource-edit"
            :disabled="busyId !== null"
            @click="formTarget = source"
          >
            编辑
          </button>
          <button
            class="btn btn--secondary ds__danger"
            type="button"
            data-testid="datasource-delete"
            :disabled="busyId !== null"
            @click="deleteTarget = source"
          >
            断开
          </button>
        </div>

        <p
          v-if="syncingId === source.id"
          class="ds__progress"
          role="status"
          data-testid="datasource-syncing"
        >
          正在从外部仓库拉取并导入，请稍候…
        </p>

        <div v-if="ticketTarget === source.id" class="ds__ticket" data-testid="datasource-ticket">
          <p class="ds__ticketNote">
            访问票据是你本人的外部仓库凭据，只保存在本机加密存储里，不会被协作服务保存下来。
          </p>
          <label class="ds__ticketField">
            <span>访问票据</span>
            <input
              v-model="ticketInput"
              type="password"
              autocomplete="off"
              :maxlength="PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH"
              data-testid="datasource-ticket-input"
            />
          </label>
          <label class="ds__ticketField">
            <span>携带方式</span>
            <select v-model="ticketScheme" data-testid="datasource-ticket-scheme">
              <option value="privateToken">私有令牌头</option>
              <option value="bearer">Bearer 头</option>
            </select>
          </label>
          <div class="ds__ticketOps">
            <button class="btn btn--secondary" type="button" @click="closeTicketForm()">
              取消
            </button>
            <button
              class="btn btn--primary"
              type="button"
              data-testid="datasource-ticket-save"
              :disabled="busyId !== null || ticketInput.trim().length === 0"
              @click="saveTicket(source.id)"
            >
              保存到本机
            </button>
          </div>
        </div>

        <section
          v-if="syncSummary && syncSummary.dataSourceId === source.id"
          class="ds__report"
          data-testid="datasource-sync-report"
        >
          <p class="ds__reportCounts" data-testid="datasource-sync-counts">
            {{ describeSyncCounts(syncSummary.summary) }}
          </p>
          <template v-if="syncSummary.summary.diagnostics.length > 0">
            <p class="ds__reportHead">以下条目本次未按原样导入，请逐条确认：</p>
            <ul class="ds__diagnostics" data-testid="datasource-diagnostics">
              <li
                v-for="(line, index) in syncSummary.summary.diagnostics"
                :key="index"
                data-testid="datasource-diagnostic"
              >
                {{ line }}
              </li>
            </ul>
            <p
              v-if="describeDiagnosticsOverflow(syncSummary.summary)"
              class="ds__reportHead"
              data-testid="datasource-diagnostics-overflow"
            >
              {{ describeDiagnosticsOverflow(syncSummary.summary) }}
            </p>
          </template>
        </section>
      </li>
    </ul>

    <div v-if="canManage && !externalSourcesBlocked" class="ds__add">
      <ProjectDataSourceForm
        v-if="formTarget !== null"
        :source="editingSource"
        :busy="formBusy"
        @submit="submitForm"
        @cancel="formTarget = null"
      />
      <button
        v-else
        class="btn btn--primary"
        type="button"
        data-testid="datasource-add"
        @click="formTarget = 'new'"
      >
        ＋ 添加数据源
      </button>
    </div>

    <section class="ds__links">
      <div class="ds__linksHead">
        <h4 class="ds__linksTitle">来源对账</h4>
        <button
          class="btn btn--secondary"
          type="button"
          data-testid="datasource-links-load"
          :disabled="linksLoading"
          @click="loadLinks()"
        >
          {{ linksLoaded ? '刷新' : '查看对账' }}
        </button>
      </div>
      <p v-if="!linksLoaded && !linksLoading" class="ds__meta">
        外部条目消失时，本地的需求、任务与文档不会被删掉，只会标记为来源失效。这里能看到它们。
      </p>
      <p v-else-if="linksLoading" class="ds__meta" role="status">正在读取对账行…</p>
      <template v-else>
        <p class="ds__meta" data-testid="datasource-links-counts">
          外部同步来的条目 {{ links.length }} 条：来源正常 {{ activeLinkCount }} 条，来源已失效
          {{ orphanedLinks.length }} 条。
        </p>
        <ul v-if="orphanedLinks.length > 0" class="ds__orphans">
          <li
            v-for="link in orphanedLinks"
            :key="link.id"
            data-testid="datasource-link-orphaned"
            class="ds__orphan"
          >
            <span class="ds__badge ds__badge--warn">来源已失效</span>
            <span class="ds__orphanKind">{{ EXTERNAL_LINK_KIND_LABELS[link.externalKind] }}</span>
            <span class="ds__orphanKey">{{ link.externalKey }}</span>
            <span v-if="link.orphanedAt" class="ds__meta">{{
              formatSyncTime(link.orphanedAt)
            }}</span>
          </li>
        </ul>
        <p v-else class="ds__meta" data-testid="datasource-links-all-active">
          没有来源失效的条目。
        </p>
      </template>
    </section>

    <ConfirmDialog
      v-if="deleteTarget"
      id="datasource-delete-confirm"
      title="断开这个数据源？"
      description="断开后不再同步。已经导入的需求、任务与需求文档会保留在项目里，不会被删除。"
      confirm-label="断开"
      tone="danger"
      :busy="busyId !== null"
      @confirm="confirmDelete()"
      @cancel="deleteTarget = null"
    />
  </ProjectDialogShell>
</template>

<style scoped>
.ds__intro,
.ds__state,
.ds__meta {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.ds__notice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-md);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
}
.ds__notice--error {
  border-color: var(--danger-line);
  color: var(--danger-text);
  background: var(--danger-soft);
}
.ds__blocked {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-md);
  background: var(--warn-soft);
}
.ds__blockedTitle {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
}
.ds__blockedDesc {
  margin: 0;
  color: var(--warn-text);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.ds__list,
.ds__diagnostics,
.ds__orphans {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.ds__row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
}
.ds__rowHead {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.ds__target {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
}
.ds__badge {
  display: inline-flex;
  height: 18px;
  align-items: center;
  padding: 0 6px;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  font-size: var(--fs-100);
}
.ds__badge--warn {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.ds__detail {
  max-height: 8em;
  margin: 0;
  overflow: auto;
  color: var(--muted2);
  font-family: var(--font-mono);
  font-size: var(--fs-100);
  line-height: var(--lh-mono);
  white-space: pre-wrap;
}
.ds__ops {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  padding-top: var(--sp-1);
}
.ds__danger:hover:not(:disabled) {
  border-color: var(--danger-line);
  color: var(--danger-text);
}
.ds__progress {
  margin: 0;
  color: var(--accent-text);
  font-size: var(--fs-100);
}
.ds__ticket,
.ds__report {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
}
.ds__ticketNote,
.ds__reportHead,
.ds__reportCounts {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.ds__reportCounts {
  color: var(--ink);
}
.ds__ticketField {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-100);
}
.ds__ticketField input,
.ds__ticketField select {
  height: var(--ctl-h-sm);
  flex: 1;
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--panel);
  font-size: var(--fs-100);
}
.ds__ticketOps {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.ds__diagnostics li {
  padding-left: var(--sp-3);
  border-left: 2px solid var(--warn-line);
  color: var(--ink);
  font-size: var(--fs-100);
  line-height: var(--lh-body);
}
.ds__links {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: var(--bw) solid var(--line);
}
.ds__linksHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.ds__linksTitle {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-body) / 1.4 var(--font-sans);
}
.ds__orphan {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-100);
}
.ds__orphanKind {
  color: var(--muted);
}
.ds__orphanKey {
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
}
</style>
