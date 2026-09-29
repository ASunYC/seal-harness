<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import type { ProjectFile } from '@shared/protocol/project-collab.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAssetVersionsSection from './ProjectAssetVersionsSection.vue';
import {
  PROJECT_FILE_KIND_LABELS,
  TODO_SOURCE_LABELS,
  fileTypeBadge,
  formatBytes,
  formatProjectTime,
} from './project-format';
import {
  ASSET_DECOMPOSE_ACTION_LABEL,
  ASSET_DECOMPOSE_HINT,
  buildAssetDecomposeRequest,
  canDecomposeAsset,
} from './todo-decompose';
import { useProjectCollabStore } from '../../stores/projectCollab';

const props = withDefaults(
  defineProps<{
    projectId: string;
    /**
     * 从动态 / 讨论的资产引用跳过来要定位的**文件 id**（测试提单 2552）。
     * ⚠️ 是 `store.files` 的文件 id，⛔ 不是资产版本 id——别拿它去开版本弹层。
     */
    focusFileId?: string | null;
  }>(),
  { focusFileId: null },
);
/**
 * 「据此拆解」冒泡给页面：发送口只有项目页壳层那个常驻会话框一个，本面板不自己发。
 * ⛔ 别在这里另写一份拆解逻辑——真正的拆解在会话里，走受审批的工具面。
 *
 * `focusHandled`：定位请求处理完（true＝找到并定位，false＝清单里没有），页面据此清请求、给提示。
 */
const emit = defineEmits<{ decompose: [string]; focusHandled: [boolean] }>();
const store = useProjectCollabStore();

/** 定位高亮停留多久（之后回到普通行；焦点仍留在那一行上）。 */
const REF_FOCUS_HIGHLIGHT_MS = 3000;

const listEl = ref<HTMLElement | null>(null);
/** 当前高亮的行（限时）。 */
const highlightedFileId = ref<string | null>(null);
/** 最近一次定位到的行：给它 `tabindex=-1` 才接得住焦点；高亮褪掉后仍保留，焦点不被挤掉。 */
const focusedFileId = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function clearHighlightTimer(): void {
  if (highlightTimer !== null) clearTimeout(highlightTimer);
  highlightTimer = null;
}

/** 按 id 找行：逐个比 dataset，⛔ 不把 id 拼进选择器（id 里有引号就是一次选择器注入）。 */
function fileRowElement(fileId: string): HTMLElement | null {
  const rows = listEl.value?.querySelectorAll<HTMLElement>('[data-file-id]') ?? [];
  return [...rows].find((row) => row.dataset['fileId'] === fileId) ?? null;
}

function locateFile(fileId: string): void {
  clearHighlightTimer();
  highlightedFileId.value = fileId;
  focusedFileId.value = fileId;
  highlightTimer = setTimeout(() => {
    highlightedFileId.value = null;
    highlightTimer = null;
  }, REF_FOCUS_HIGHLIGHT_MS);
  void nextTick(() => {
    const row = fileRowElement(fileId);
    row?.scrollIntoView({ block: 'center', inline: 'nearest' });
    row?.focus({ preventScroll: true });
  });
}

/**
 * 接住资产引用的定位请求。清单还在取、又还没有这一份时先不判（切到资产页时 `loadFiles` 正在
 * 重取，此刻报「找不到」是假阴性）；之后找没找到都回发一次 `focusHandled`。
 */
watch(
  () => [props.focusFileId, store.files, store.filesLoading] as const,
  ([fileId]) => {
    if (fileId === null) return;
    const exists = store.files.some((file) => file.id === fileId);
    if (!exists && store.filesLoading) return;
    if (exists) locateFile(fileId);
    emit('focusHandled', exists);
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(clearHighlightTimer);

/** 删除权限的 UI 判据：本人上传或项目拥有者（服务端另有强判）。 */
function canDelete(file: ProjectFile): boolean {
  return store.isOwner || store.isSelf(file.uploaderSubject);
}

function canPromote(file: ProjectFile): boolean {
  return file.kind === 'temp' && store.canWrite;
}

/** 「据此拆解」的入口收窄（是资产、写得动、没归档）——判据在 `canDecomposeAsset`。 */
function canDecompose(file: ProjectFile): boolean {
  return canDecomposeAsset(file, { canWrite: store.canWrite, isArchived: store.isArchived });
}

function decompose(file: ProjectFile): void {
  emit('decompose', buildAssetDecomposeRequest(file));
}

/** 计数按形态拆分（原型「N 份资产 · M 份临时件」）；两类都空时退回中性「N 个文件」。 */
const assetCount = computed(() => store.files.filter((file) => file.kind === 'asset').length);
const tempCount = computed(() => store.files.filter((file) => file.kind === 'temp').length);
const countLabel = computed(() => {
  const parts: string[] = [];
  if (assetCount.value > 0) parts.push(`${assetCount.value} 份资产`);
  if (tempCount.value > 0) parts.push(`${tempCount.value} 份临时件`);
  return parts.length > 0 ? parts.join(' · ') : `${store.files.length} 个文件`;
});

/** 每行预算好类型徽标一次（避免模板里对同一文件名反复求值）。 */
const fileRows = computed(() =>
  store.files.map((file) => ({ file, badge: fileTypeBadge(file.filename) })),
);
const uploadPercent = computed(() => {
  const upload = store.fileUpload;
  return upload ? Math.min(100, Math.round((upload.progress / upload.size) * 100)) : 0;
});
</script>

<template>
  <div class="assets-pane">
    <div class="assets-bar">
      <span class="assets-bar__count tnum">{{ countLabel }}</span>
      <span class="assets-bar__spacer"></span>
      <template v-if="store.canWrite">
        <button
          class="btn btn--ghost"
          type="button"
          :disabled="store.fileActionBusy"
          data-testid="upload-temp"
          @click="store.uploadFile(props.projectId, 'temp')"
        >
          上传临时件
        </button>
        <button
          class="btn btn--secondary"
          type="button"
          :disabled="store.fileActionBusy"
          data-testid="upload-asset"
          @click="store.uploadFile(props.projectId, 'asset')"
        >
          上传资产
        </button>
      </template>
    </div>

    <div
      v-if="store.fileUpload"
      class="upload-progress"
      role="status"
      data-testid="upload-progress"
    >
      <div class="upload-progress__copy">
        <span>{{ store.fileUpload.name }}</span>
        <span class="tnum">{{ uploadPercent }}% · {{ formatBytes(store.fileUpload.size) }}</span>
      </div>
      <progress :value="store.fileUpload.progress" :max="store.fileUpload.size"></progress>
      <button
        type="button"
        class="btn btn--ghost"
        data-testid="upload-cancel"
        @click="store.cancelFileUpload()"
      >
        取消上传
      </button>
    </div>

    <div v-if="store.filesError && store.files.length === 0" class="assets-state" role="alert">
      <p class="assets-state__title assets-state__title--danger">文件列表暂时不可用</p>
      <p class="assets-state__desc">
        {{ store.filesError.message }}
        <ReferenceIdCopy
          v-if="store.filesError.referenceCode"
          :reference-id="store.filesError.referenceCode"
        />
      </p>
      <button class="btn btn--secondary" type="button" @click="store.loadFiles(projectId)">
        重试
      </button>
    </div>
    <div
      v-else-if="store.filesLoading && store.files.length === 0"
      class="assets-state"
      role="status"
    >
      <span class="assets-state__desc">正在加载文件…</span>
    </div>
    <div
      v-else-if="!store.filesLoading && store.files.length === 0"
      class="assets-state"
      role="status"
    >
      <div class="assets-state__art" aria-hidden="true">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 8h16l10 10v30H16z" stroke-linejoin="round" />
          <path d="M32 8v10h10M23 30h12M23 38h8" stroke-linecap="round" />
        </svg>
      </div>
      <p class="assets-state__title">还没有文件</p>
      <p class="assets-state__desc">上传资产沉淀交付物；临时件会到期回收，可随时转存为资产。</p>
      <button
        v-if="store.canWrite"
        class="btn btn--primary"
        type="button"
        :disabled="store.fileActionBusy"
        @click="store.uploadFile(props.projectId, 'asset')"
      >
        上传资产
      </button>
    </div>

    <!-- 资产行（原型 asset-row）：类型徽标 + 文件名/元信息 + 形态标 + 行操作。
         扫读型列表，随详情页壳的 compact 密度收紧行高。 -->
    <div v-else ref="listEl" class="assets-list" data-testid="assets-list">
      <!-- 从引用跳过来的那一行：限时高亮（data-ref-focus），并接住焦点（tabindex=-1，不进 Tab 序） -->
      <div
        v-for="{ file, badge } in fileRows"
        :key="file.id"
        class="asset-row"
        :class="{ 'is-ref-focus': highlightedFileId === file.id }"
        :data-file-id="file.id"
        :data-ref-focus="highlightedFileId === file.id ? 'true' : undefined"
        :tabindex="focusedFileId === file.id ? -1 : undefined"
      >
        <span class="asset-row__badge" :data-tone="badge.tone" aria-hidden="true">{{
          badge.label
        }}</span>
        <div class="asset-row__info">
          <span class="asset-row__name">{{ file.filename }}</span>
          <span class="asset-row__meta tnum">
            {{ formatBytes(file.bytes) }} · {{ file.uploaderDisplayName || '成员' }}
            <!--
              来源徽标（合并自 main）：助手是**用登录人的账号**把文件传上去的，所以「上传人」
              两种情况下都是同一个名字——只看它分辨不出这份资产是人自己传的，还是项目助理
              在会话里存的。这枚徽标是唯一的区分点，⛔ 不能因为"卡片行更紧凑"就省掉。
              ⚠️ 只在非 `manual` 时出：缺省档每行都挂一枚只是噪音（同看板来源徽标口径）。
              ⚠️【白标】文案取自 `TODO_SOURCE_LABELS`，与看板/表格来源徽标**同一张表**——
                 分头写迟早出现两种叫法。
              ⚠️ 它是**声明值**（服务端凭身份分不出人与助手），只作展示，
                 ⛔ 不参与任何权限或可见性判定。
            -->
            <span
              v-if="file.source !== 'manual'"
              class="asset-row__src"
              :data-source="file.source"
              data-testid="file-source-badge"
              >{{ TODO_SOURCE_LABELS[file.source] }}</span
            >
            · {{ formatProjectTime(file.createdAt) }}
          </span>
        </div>
        <span class="asset-row__spacer"></span>
        <span class="asset-row__kind" :data-kind="file.kind">
          {{ PROJECT_FILE_KIND_LABELS[file.kind] }}
          <span v-if="file.kind === 'temp' && file.expiresAt" class="asset-row__expire tnum"
            >· {{ formatProjectTime(file.expiresAt) }} 到期</span
          >
        </span>
        <div class="asset-row__ops">
          <button type="button" data-testid="file-download" @click="store.downloadFile(file.id)">
            下载
          </button>
          <!--
            「据此拆解」：快捷方式，不是主路——主路仍是项目助理面板里那个常驻会话框，
            这里只是把正文替用户敲一遍（`buildAssetDecomposeRequest`）。
            ⛔ 只对**资产**出：临时件会到期回收，据它拆出来的任务过几天就没有依据了。
          -->
          <button
            v-if="canDecompose(file)"
            type="button"
            data-testid="file-decompose"
            :title="ASSET_DECOMPOSE_HINT"
            @click="decompose(file)"
          >
            {{ ASSET_DECOMPOSE_ACTION_LABEL }}
          </button>
          <button
            v-if="canPromote(file)"
            type="button"
            data-testid="file-promote"
            @click="store.promoteFile(file.id)"
          >
            转存为资产
          </button>
          <button
            v-if="canDelete(file)"
            type="button"
            class="asset-row__danger"
            data-testid="file-delete"
            @click="store.deleteFile(file.id)"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!--
      资产版本（RPT-08）：资产目录 + 回收站 + 版本历史。与上面的文件列表是两套模型，
      各取各的、⛔ 不按 fileId 拼表（ADR-0037 决策 8）；只在本项目真有资产版本数据时出现。
    -->
    <ProjectAssetVersionsSection :project-id="props.projectId" />
  </div>
</template>

<style scoped>
.assets-pane {
  display: flex;
  width: 100%;
  max-width: 960px; /* 页面内容最大宽度（程序布局，原型 pj-body 无此上限），保留（960 不在 --px-* 梯） */
  flex-direction: column;
  gap: var(--sp-3);
  margin: 0 auto;
  padding: var(--sp-3) 0 var(--sp-5);
}
.assets-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.assets-bar__spacer {
  flex: 1;
}
.assets-bar__count {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.upload-progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sp-2) var(--sp-3);
  align-items: center;
  padding: var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.upload-progress__copy {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.upload-progress progress {
  width: 100%;
}
.assets-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
/* ⚠️ 结构差异（未改，见报告）：原型空/错态图标为 46–48px 填充圆角方块内嵌小图标；
   本处是 56px 裸 SVG 字形，非单值可替，另议。 */
.assets-state__art {
  width: 56px;
  height: 56px;
  color: var(--muted);
  opacity: 0.7;
}
.assets-state__art svg {
  display: block;
  width: 100%;
  height: 100%;
}
.assets-state__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
.assets-state__title--danger {
  color: var(--danger-text);
}
.assets-state__desc {
  max-width: 44ch;
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}

/* ── 资产行（原型 .asset-row）：卡片手感的横排行，hover 抬底 ── */
.assets-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.asset-row {
  /* 来源是元数据不是状态：与看板来源徽标同一档弱色，别跟类型徽标抢注意力。
   （合并自 main 的 .assets-src，类名随卡片行改名，样式口径不动） */
  /* 来源徽标（合并自 main，原型资产行无此徽标 → 无对应元素）：token 化保留原值 */
  .asset-row__src {
    display: inline-flex;
    height: var(--px-16);
    align-items: center;
    margin-left: var(--sp-1);
    padding: 0 var(--px-5);
    border: var(--bw) solid var(--line);
    border-radius: var(--r-sm);
    color: var(--muted);
    font-size: var(--fs-100);
    white-space: nowrap;
  }
  .asset-row__src[data-source='external'] {
    border-style: dashed;
  }
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.asset-row:hover {
  border-color: var(--line-strong);
  background: var(--raised);
}
/* 从引用跳过来的那一行：强调描边 + 强调底，限时褪去（颜色之外还有 data-ref-focus） */
.asset-row.is-ref-focus {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.asset-row:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 类型徽标（原型 .tbadge）：等宽圆角方块，色调按扩展名分桶（token 组合，无裸色值） */
.asset-row__badge {
  display: grid;
  width: var(--px-30); /* 原型 .tbadge = 30px（实测一致） */
  height: var(--px-30);
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--sunken);
  font: 700 var(--fs-px-10) / 1 var(--font-mono); /* 原型 .tbadge 字号 10px（实测一致） */
  letter-spacing: 0.02em;
}
.asset-row__badge[data-tone='pdf'] {
  color: var(--danger-text);
  background: var(--danger-soft);
}
.asset-row__badge[data-tone='sheet'] {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.asset-row__badge[data-tone='slides'] {
  color: var(--warn-text);
  background: var(--warn-soft);
}
.asset-row__badge[data-tone='doc'] {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.asset-row__info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--px-1); /* 名称/元信息两行贴排的微间距（原型无独立度量），保留 1px */
}
.asset-row__name {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-row__meta {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.asset-row__spacer {
  flex: 1;
}
/* 形态标（原型 .tagp）：资产＝实心弱色药丸；临时件＝虚线中性药丸（不是错误，只是「不长久」） */
.asset-row__kind {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--px-1) var(--px-8); /* 原型 .tagp = padding 1px 8px（旧 1px var(--sp-2)=6px 偏窄） */
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted2);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.asset-row__kind[data-kind='asset'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
.asset-row__kind[data-kind='temp'] {
  border-style: dashed;
  color: var(--muted);
}
.asset-row__expire {
  color: var(--muted);
}
.asset-row__ops {
  display: flex;
  flex: 0 0 auto;
  gap: var(--sp-1);
}
.asset-row__ops button {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.asset-row__ops button:hover {
  color: var(--accent-text);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.asset-row__ops button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.asset-row__ops .asset-row__danger:hover {
  color: var(--danger-text);
  border-color: var(--danger-line);
  background: var(--danger-soft);
}
@media (prefers-reduced-motion: reduce) {
  .asset-row,
  .asset-row__ops button {
    transition: none;
  }
}
</style>
