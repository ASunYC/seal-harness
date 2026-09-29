<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { projectRuntime } from '../../../../src/ui/runtime';

import {
  PROJECT_JOIN_LINK_SCHEME,
  PROJECT_MAX_INSTRUCTIONS_LENGTH,
  PROJECT_MAX_NAME_LENGTH,
  parseProjectJoinLink,
  projectExtraMemberCount,
} from '@shared/protocol/project-collab.js';

import { pendingJoinCodeSignal, takePendingJoinCode } from '../composables/projectJoinLinkInbox';
import AppIcon from '../components/ui/AppIcon.vue';
import ReferenceIdCopy from '../components/ui/ReferenceIdCopy.vue';
import ProjectAvatar from '../components/project/ProjectAvatar.vue';
import ProjectDialogShell from '../components/project/ProjectDialogShell.vue';
import {
  PROJECT_ROLE_LABELS,
  avatarText,
  avatarTone,
  formatProjectTime,
} from '../components/project/project-format';
import {
  projectConnectionIndicatorLabel,
  projectOpenInvitationNotice,
  useProjectCollabStore,
} from '../stores/projectCollab';
import { useReturnToConversation } from '../router/use-return-to-conversation';

const runtime = projectRuntime();
const store = useProjectCollabStore();
const router = useRouter();
const returnToConversation = useReturnToConversation();

/** 弹窗只开一个：新建与加入互斥，避免两块输入同时抢注意力。 */
const activeForm = ref<'none' | 'create' | 'join'>('none');
const createName = ref('');
/** 项目说明（可选）：建成后经 project:update 落库（create 协议只收名称）。 */
const createInstructions = ref('');
const joinCode = ref('');
const formBusy = ref(false);
const formError = ref<string | null>(null);
const notice = ref<string | null>(null);
/** 深链预填后要聚焦的「加入」按钮（由人点，⛔ 不自动兑换）。 */
const joinButton = ref<HTMLButtonElement | null>(null);

/** 目录页搜索：纯客户端按项目名过滤（列表投影没有更多可搜字段）。 */
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

const nameLimit = PROJECT_MAX_NAME_LENGTH;
const instructionsLimit = PROJECT_MAX_INSTRUCTIONS_LENGTH;
/** 加入输入框可粘**整条深链**：长度 = 协议前缀 + `?code=` + 邀请码（≤128）。 */
const joinInputMax = PROJECT_JOIN_LINK_SCHEME.length + '?code='.length + 128;
const enabled = computed(() => store.availability === true);
/* 与详情页同一枚指示器：同一个 store.connection、同一份文案（措辞住在 projectCollabErrors）。
   首帧尚无连接帧（null）按在线呈现——列表能打开即说明链路是通的。 */
const connectionIndicatorLabel = computed(() => projectConnectionIndicatorLabel(store.connection));

/** 出错优先于空态：只有列表拉不到且一条都没有时，才算「不可用」而不是「没有」。 */
const listErrored = computed(() => store.projectsError !== null && store.projects.length === 0);

const visibleProjects = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return store.projects;
  return store.projects.filter((project) => project.name.toLowerCase().includes(keyword));
});

onMounted(async () => {
  const available = await store.hydrateAvailability();
  if (available) await store.loadProjects();
  // 冷启动 / 跨页深链：投递格里已有码时取走并预填（能力关断时表单不渲染，取走仍清格）。
  consumePendingJoinCode();
});

/**
 * 热态深链：本页已挂载时又来一条深链，`watch` 到投递格变化即消费。
 * 非 immediate——挂载那一刻已存在的码由上面的 `onMounted` 消费，两处经 `take` 各消费一次不重复。
 */
watch(pendingJoinCodeSignal(), (code) => {
  if (code !== null) consumePendingJoinCode();
});

/**
 * 深链预填（R6）：打开「加入项目」表单、填入邀请码、聚焦「加入」按钮——**由人点，
 * ⛔ 不自动兑换**。code 只落表单局部态；投递格 `take` 即清（一次性消费）。
 */
function consumePendingJoinCode(): void {
  const code = takePendingJoinCode();
  if (code === null) return;
  activeForm.value = 'join';
  joinCode.value = code;
  formError.value = null;
  void nextTick(() => joinButton.value?.focus());
}

// 参照资源目录页的 Ctrl/⌘ K：命中即把焦点送进搜索框（能力关断时不抢热键）。
onMounted(() => runtime.shadow.addEventListener('keydown', focusSearchOnHotkey));
onBeforeUnmount(() => runtime.shadow.removeEventListener('keydown', focusSearchOnHotkey));

function focusSearchOnHotkey(event: Event): void {
  if (!(event instanceof KeyboardEvent)) return;
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
  if (!enabled.value) return;
  event.preventDefault();
  searchInput.value?.focus();
}

function clearSearch(): void {
  query.value = '';
  searchInput.value?.focus();
}

function openForm(kind: 'create' | 'join'): void {
  activeForm.value = activeForm.value === kind ? 'none' : kind;
  formError.value = null;
}

function closeForm(): void {
  activeForm.value = 'none';
  createName.value = '';
  createInstructions.value = '';
  joinCode.value = '';
  formError.value = null;
}

async function submitCreate(): Promise<void> {
  const name = createName.value.trim();
  if (!name || formBusy.value) return;
  formBusy.value = true;
  formError.value = null;
  try {
    const result = await store.createProject(name, createInstructions.value);
    if (!result.ok) {
      formError.value = result.message;
      return;
    }
    closeForm();
    await router.push(`/projects/${encodeURIComponent(result.project.id)}`);
  } finally {
    formBusy.value = false;
  }
}

async function submitJoin(): Promise<void> {
  const raw = joinCode.value.trim();
  if (!raw || formBusy.value) return;
  // 粘贴整条深链或纯码都认：抽不出合规邀请码就地报错，**不发请求**（服务端也会拒，
  // 但一个格式明显不对的输入不该占一趟网络往返）。抽码正则与主进程严格解析同一条。
  const code = parseProjectJoinLink(raw);
  if (code === null) {
    formError.value = '邀请码或链接格式不对，请检查后重试。';
    return;
  }
  formBusy.value = true;
  formError.value = null;
  try {
    const result = await store.redeemInvitation(code);
    if (!result.ok) {
      // 兑换到已关闭 / 已满员的开放邀请（410 `invitation_revoked` / 409 `invitation_exhausted`）时
      // 就地覆盖通用文案，让人分得清「已关闭」与「已满员」；无 serverCode 回落通用失败文案。
      formError.value = projectOpenInvitationNotice(result.serverCode)?.message ?? result.message;
      return;
    }
    closeForm();
    notice.value = '已加入项目。';
    await router.push(`/projects/${encodeURIComponent(result.projectId)}`);
  } finally {
    formBusy.value = false;
  }
}

function openProject(projectId: string): void {
  void router.push(`/projects/${encodeURIComponent(projectId)}`);
}
</script>

<template>
  <!-- 版式对齐资源目录页（能力仓库/连接器）：复用全局 resource-page 骨架 + 大页头 hero。 -->
  <div class="projects-page resource-page-shell" :aria-busy="store.projectsLoading">
    <header class="resource-page-nav">
      <div class="resource-page-nav__path">
        <button
          type="button"
          class="resource-page-nav__back"
          aria-label="返回会话，离开项目"
          title="返回会话，离开项目"
          @click="returnToConversation"
        >
          <AppIcon name="back" :size="17" />
        </button>
        <strong>项目</strong>
        <span class="resource-page-nav__badge">RESOURCE</span>
      </div>
      <div class="projects-nav__actions">
        <!--
          连接指示：与详情页顶栏同一枚（同一个 store.connection、同一份文案）。
          放在列表页是因为它回答的是「我看到的这份清单是不是最新的」——断开时列表
          可能已经过时，而用户在这一屏没有别的线索能看出来。
          ⚠️ 只在能力启用时出：能力关掉时连"连不连得上"这个问题都不成立。
        -->
        <span
          v-if="enabled"
          class="projects-conn"
          :data-state="store.connection ?? 'online'"
          role="status"
          data-testid="projects-connection"
        >
          <span class="projects-conn__dot" aria-hidden="true"></span>
          {{ connectionIndicatorLabel }}
        </span>
        <!-- 归档项目默认不进列表；这个开关是拥有者找回并恢复它们的唯一入口。 -->
        <button
          v-if="enabled"
          class="btn btn--ghost"
          type="button"
          :aria-pressed="store.includeArchivedProjects"
          data-testid="projects-archived-toggle"
          @click="store.setIncludeArchivedProjects(!store.includeArchivedProjects)"
        >
          {{ store.includeArchivedProjects ? '隐藏已归档' : '显示已归档' }}
        </button>
        <button class="btn btn--secondary" type="button" @click="openForm('join')">加入项目</button>
        <button class="btn btn--primary" type="button" @click="openForm('create')">新建项目</button>
      </div>
    </header>

    <div class="projects-page__content">
      <section class="resource-page-hero" aria-labelledby="projects-hero-title">
        <div class="resource-page-hero__copy">
          <p class="resource-page-hero__eyebrow">WORKBENCH RESOURCE</p>
          <h1 id="projects-hero-title">项目</h1>
          <p class="resource-page-hero__subtitle">
            把人、讨论与资产放进同一个空间，围绕目标协作交付。
          </p>
        </div>
        <div v-if="enabled" class="projects-search" role="search" aria-label="项目搜索">
          <span class="projects-search__icon" aria-hidden="true">
            <AppIcon name="search" :size="16" />
          </span>
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="搜索项目名称"
            aria-label="搜索项目"
            aria-controls="projects-directory"
          />
          <button
            v-if="query"
            type="button"
            class="projects-search__clear"
            aria-label="清除搜索"
            @mousedown.prevent
            @click="clearSearch"
          >
            <AppIcon name="close" :size="15" aria-hidden="true" />
          </button>
          <kbd>Ctrl K</kbd>
        </div>
      </section>

      <div v-if="notice" class="projects-notice" role="status">
        <span>{{ notice }}</span>
        <button type="button" aria-label="关闭提示" @click="notice = null">
          <AppIcon name="close" :size="15" />
        </button>
      </div>

      <!--
        新建 / 加入都走模态弹窗（Overlay 原语的 modal 变体，经 ProjectDialogShell）：
        与原型 md-pj-new / md-pj-join 对齐，取代此前挤在页头与分区之间的内联行。
        两条路各一个弹窗，避免「内联 + 弹窗」两套形态并存。
      -->
      <ProjectDialogShell
        v-if="enabled && activeForm === 'create'"
        title="新建项目"
        @close="closeForm"
      >
        <form class="projects-dialog" data-testid="projects-form" @submit.prevent="submitCreate">
          <div class="projects-field">
            <label class="projects-field__label" for="project-create-name">项目名称</label>
            <input
              id="project-create-name"
              v-model="createName"
              class="projects-field__input"
              type="text"
              :maxlength="nameLimit"
              placeholder="例如：智慧管网二期交付"
              @keydown.enter.prevent="submitCreate"
            />
          </div>
          <div class="projects-field">
            <label class="projects-field__label" for="project-create-instructions"
              >项目说明（可选）</label
            >
            <textarea
              id="project-create-instructions"
              v-model="createInstructions"
              class="projects-field__input projects-field__textarea"
              rows="3"
              :maxlength="instructionsLimit"
              placeholder="这个项目要做什么、口径与产出要求…"
            ></textarea>
          </div>
          <p class="projects-dialog__hint">创建后你是拥有者，可邀请同事以编辑者或查看者加入。</p>
          <p v-if="formError" class="projects-dialog__error" role="alert">{{ formError }}</p>
        </form>
        <template #foot>
          <button class="btn btn--secondary" type="button" @click="closeForm">取消</button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="formBusy || !createName.trim()"
            @click="submitCreate"
          >
            创建项目
          </button>
        </template>
      </ProjectDialogShell>

      <ProjectDialogShell
        v-if="enabled && activeForm === 'join'"
        title="加入项目"
        @close="closeForm"
      >
        <form class="projects-dialog" data-testid="projects-form" @submit.prevent="submitJoin">
          <div class="projects-field">
            <label class="projects-field__label" for="project-join-code">邀请码或加入链接</label>
            <input
              id="project-join-code"
              v-model="joinCode"
              class="projects-field__input projects-field__input--code"
              type="text"
              :maxlength="joinInputMax"
              placeholder="粘贴邀请码，或整条加入链接"
              @keydown.enter.prevent="submitJoin"
            />
          </div>
          <p class="projects-dialog__hint">
            粘贴同事发来的邀请码或加入链接均可；加入后你的角色由对方的邀请方式决定。
          </p>
          <p v-if="formError" class="projects-dialog__error" role="alert">{{ formError }}</p>
        </form>
        <template #foot>
          <button class="btn btn--secondary" type="button" @click="closeForm">取消</button>
          <button
            ref="joinButton"
            class="btn btn--primary"
            type="button"
            :disabled="formBusy || !joinCode.trim()"
            @click="submitJoin"
          >
            加入项目
          </button>
        </template>
      </ProjectDialogShell>

      <!-- 能力关断：整块未装配，不出现「我的项目」分区（那会撒谎说你有 0 个项目）。 -->
      <div
        v-if="store.availability === false"
        class="projects-state projects-state--empty projects-state--gate"
        role="status"
      >
        <span class="projects-state__symbol" aria-hidden="true">⊘</span>
        <p class="projects-state__title">项目组能力未启用</p>
        <p class="projects-state__desc">
          当前构建未装配项目组多人协作，请联系管理员或改用支持该能力的版本。
        </p>
      </div>

      <section
        v-else-if="enabled"
        id="projects-directory"
        class="projects-directory"
        aria-labelledby="projects-directory-title"
      >
        <header class="projects-section__header">
          <div class="projects-section__title">
            <h2 id="projects-directory-title">我的项目</h2>
            <span v-if="store.projects.length > 0" class="projects-section__count tnum">{{
              visibleProjects.length
            }}</span>
            <span class="projects-section__divider" aria-hidden="true"></span>
          </div>
          <p>你创建或加入的项目，包含项目组与个人项目。</p>
        </header>

        <!-- 出错优先于空态（纪律 1）。 -->
        <div
          v-if="listErrored"
          class="projects-state projects-state--slim projects-state--error"
          role="alert"
        >
          <p class="projects-state__title">项目列表暂时不可用</p>
          <p class="projects-state__desc">
            {{ store.projectsError?.message }}
            <ReferenceIdCopy
              v-if="store.projectsError?.referenceCode"
              :reference-id="store.projectsError.referenceCode"
            />
          </p>
          <button class="btn btn--secondary" type="button" @click="store.loadProjects()">
            重试
          </button>
        </div>
        <div
          v-else-if="store.projectsLoading && store.projects.length === 0"
          class="projects-state projects-state--slim"
          role="status"
        >
          <span class="projects-state__desc">正在加载项目…</span>
        </div>
        <!-- 空组不许消失（纪律 2）：分区标题保留，内容位给出显式空态块。 -->
        <div
          v-else-if="store.projects.length === 0"
          class="projects-state projects-state--empty"
          role="status"
        >
          <span class="projects-state__symbol" aria-hidden="true">＋</span>
          <p class="projects-state__title">还没有项目</p>
          <p class="projects-state__desc">创建一个项目组，或用邀请码加入同事的项目。</p>
          <button class="btn btn--primary" type="button" @click="openForm('create')">
            新建项目
          </button>
        </div>
        <div
          v-else-if="visibleProjects.length === 0"
          class="projects-state projects-state--slim"
          role="status"
        >
          <span class="projects-state__symbol" aria-hidden="true">⌕</span>
          <p class="projects-state__title">没有符合条件的项目</p>
          <p class="projects-state__desc">换个关键词，或清除搜索查看全部项目。</p>
          <button class="btn btn--secondary" type="button" @click="clearSearch">清除搜索</button>
        </div>
        <div v-else class="projects-grid">
          <article
            v-for="project in visibleProjects"
            :key="project.id"
            class="project-card"
            :data-project-id="project.id"
            role="button"
            tabindex="0"
            @click="openProject(project.id)"
            @keydown.enter="openProject(project.id)"
          >
            <header class="project-card__head">
              <span
                class="project-card__avatar"
                :data-tone="avatarTone(project.name)"
                aria-hidden="true"
                >{{ avatarText(project.name) }}</span
              >
              <h3 class="project-card__title">{{ project.name }}</h3>
              <span
                v-if="project.archivedAt"
                class="project-chip"
                data-testid="project-archived-chip"
                >已归档</span
              >
              <span
                :class="['project-chip', { 'project-chip--accent': project.memberCount > 1 }]"
                >{{ project.memberCount > 1 ? '项目组' : '个人项目' }}</span
              >
              <span
                v-if="project.unreadCount > 0"
                class="project-card__unread tnum"
                data-testid="project-unread"
                :aria-label="`${project.unreadCount} 条未读`"
                >{{ project.unreadCount > 99 ? '99+' : project.unreadCount }}</span
              >
            </header>
            <!-- 描述行数封顶不能省：不封顶时卡片高度随文字长短参差，栅格立刻乱。 -->
            <p v-if="project.summary" class="project-card__desc" data-testid="project-card-summary">
              {{ project.summary }}
            </p>
            <div class="project-card__meta">
              <span class="project-chip">{{ PROJECT_ROLE_LABELS[project.myRole] }}</span>
              <!-- 只画服务端给的前 3 个：列表投影刻意不带全量名册（随成员数膨胀），
                   也不逐卡拉详情（N+1）。「+N」由总数减去已画出的算得。 -->
              <span
                v-if="project.memberPreview.length > 0"
                class="project-card__members"
                data-testid="project-card-members"
              >
                <ProjectAvatar
                  v-for="member in project.memberPreview"
                  :key="member.subject"
                  :name="member.displayName"
                  size="s"
                />
                <span
                  v-if="projectExtraMemberCount(project) > 0"
                  class="project-card__moreMembers tnum"
                  data-testid="project-card-more-members"
                  >+{{ projectExtraMemberCount(project) }}</span
                >
              </span>
              <span class="tnum">{{
                project.memberCount > 1 ? `${project.memberCount} 名成员` : '仅自己'
              }}</span>
            </div>
            <footer class="project-card__foot">
              <span class="tnum">{{
                project.lastActivityAt
                  ? `${formatProjectTime(project.lastActivityAt)} 有动态`
                  : '暂无动态'
              }}</span>
            </footer>
          </article>
        </div>
      </section>

      <!-- 能力水合尚未落地（availability === null）：不谎报「没有项目」，先给一条中性等待。 -->
      <div v-else class="projects-state projects-state--slim" role="status">
        <span class="projects-state__desc">正在检查项目组…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 页壳：与资源目录页同壳（.resource-page-shell 提供 padding/最大宽/背景，全局注入）── */
.projects-page {
  position: relative;
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
}
.projects-page__content {
  display: flex;
  width: 100%;
  max-width: 1740px;
  box-sizing: border-box;
  flex-direction: column;
  gap: var(--sp-6);
  margin-inline: auto;
  padding: 36px clamp(36px, 4vw, 72px) 100px;
}

/* ── 顶栏右侧动作区（对齐参照页 header-actions）───────────────── */
.projects-nav__actions {
  display: flex;
  min-width: 0;
  margin-left: auto;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* ── 连接指示：与详情页顶栏同形（一枚圆点 + 短标签，三态各色，在线态脉冲）。
   两处刻意长一样：同一个信号在两屏应当认得出是同一件事，而不是两种说法。
   ⛔ 断线时不在这里说长句——那是详情页横幅的活；列表页只答「是哪一档」。 */
.projects-conn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin-right: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.projects-conn__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--muted2);
}
.projects-conn[data-state='online'] .projects-conn__dot {
  background: var(--ok);
  animation: projects-conn-pulse 1.8s var(--spring-smooth) infinite;
}
.projects-conn[data-state='degraded'] {
  color: var(--warn-text);
}
.projects-conn[data-state='degraded'] .projects-conn__dot {
  background: var(--warn);
}
.projects-conn[data-state='offline'] {
  color: var(--danger-text);
}
.projects-conn[data-state='offline'] .projects-conn__dot {
  background: var(--danger);
}
@keyframes projects-conn-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 45%, transparent);
  }
  55% {
    box-shadow: 0 0 0 5px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .projects-conn[data-state='online'] .projects-conn__dot {
    animation: none;
  }
}

/* ── Hero 搜索框（对齐参照页 capability-header-search 形态）───── */
.projects-search {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  gap: 12px;
  border-radius: 12px;
  background: var(--panel);
  box-shadow: inset 0 0 0 1px var(--line);
  transition:
    box-shadow var(--dur-2) var(--ease-out),
    background var(--dur-2) var(--ease-out);
}
.projects-search:focus-within {
  background: var(--raised);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 3px var(--accent-soft);
}
.projects-search__icon {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--muted2);
}
.projects-search input {
  flex: 1;
  min-width: 0;
  height: 46px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--fs-300);
  user-select: text;
}
.projects-search input::placeholder {
  color: var(--muted2);
}
.projects-search__clear {
  display: inline-grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.projects-search__clear:hover {
  color: var(--ink);
  background: var(--sunken);
}
.projects-search__clear:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.projects-search kbd {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
  background: var(--bg);
  font: var(--fs-100) / 1.4 var(--font-mono);
  white-space: nowrap;
}

/* ── 提示条 ─────────────────────────────────────────────────── */
.projects-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-md);
  color: var(--accent-text);
  background: var(--accent-soft);
}
.projects-notice button {
  display: inline-grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.projects-notice button:hover {
  background: var(--panel);
}

/* ── 新建 / 加入弹窗内的表单（壳＝ProjectDialogShell，这里只画字段与说明）── */
.projects-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.projects-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.projects-field__label {
  color: var(--muted2);
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
}
.projects-field__input {
  width: 100%;
  height: var(--ctl-h);
  box-sizing: border-box;
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.projects-field__input::placeholder {
  color: var(--muted);
}
/* 多行说明：高度交给内容与 rows，允许纵向拉伸 */
.projects-field__textarea {
  height: auto;
  min-height: calc(var(--ctl-h) * 2);
  padding: var(--sp-2) var(--sp-3);
  line-height: var(--lh-body);
  resize: vertical;
}
/* 邀请码是机器 token：等宽 + 字距，与邀请弹窗 codebox 同一语言 */
.projects-field__input--code {
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}
.projects-field__input--code::placeholder {
  font-family: var(--font-sans);
  letter-spacing: normal;
}
.projects-field__input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.projects-dialog__hint {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-200);
  line-height: var(--lh-body);
}
.projects-dialog__error {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}

/* ── 分区标题（对齐参照页 catalog-section__header：标题 + 计数 + 分隔线 + 描述）── */
.projects-directory {
  min-width: 0;
}
.projects-section__header {
  padding-bottom: var(--sp-3);
}
.projects-section__title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.projects-section__title h2 {
  margin: 0;
  font-size: 15px;
  font-weight: var(--fw-title);
  line-height: 1.3;
}
.projects-section__count {
  color: var(--muted);
  font: var(--fs-100) / 1 var(--font-mono);
}
.projects-section__divider {
  height: var(--bw);
  min-width: var(--sp-4);
  flex: 1 1 auto;
  margin-left: var(--sp-1);
  background: var(--line);
}
.projects-section__header p {
  max-width: 72ch;
  margin: 4px 0 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: 1.5;
}

/* ── 显式状态块（加载 / 空 / 出错 / 无匹配）：对齐参照页 directory-state 形态 ── */
.projects-state {
  display: grid;
  min-height: 240px;
  place-content: center;
  justify-items: center;
  gap: var(--sp-3);
  padding: var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.projects-state--slim {
  min-height: 140px;
}
.projects-state--empty {
  min-height: 46vh;
}
.projects-state__symbol {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border-radius: 50%;
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: 28px;
  line-height: 1;
}
/* 能力关断是「不可用」不是「邀请」——符号退到中性色，不用 accent 诱导点击。 */
.projects-state--gate .projects-state__symbol {
  color: var(--muted2);
  background: var(--sunken);
}
.projects-state__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
.projects-state--error .projects-state__title {
  color: var(--danger-text);
}
.projects-state__desc {
  max-width: 44ch;
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}

/* ── 项目卡 ─────────────────────────────────────────────────── */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min), 1fr));
  gap: var(--card-gap);
}
.project-card {
  display: flex;
  min-height: 118px;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--card-pad);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
  box-shadow: var(--sh-1);
  cursor: pointer;
  /* 进场（原型 card-in）：卡片是 role=button 可点，入场期间 pointer-events:none（§7.5 硬要求） */
  animation: card-in var(--d-flow) var(--spring-smooth) backwards;
  /* 统一卡片 hover（原型 .pjcard:hover，行 670）：上浮 2px + sh-pop，spring 节奏 */
  transition:
    transform var(--d-pop) var(--spring-smooth),
    border-color var(--d-pop) var(--spring-smooth),
    box-shadow var(--d-pop) var(--spring-smooth);
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(7px) scale(0.985);
    pointer-events: none;
  }
  99% {
    pointer-events: none;
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.project-card:hover {
  transform: translateY(-2px);
  border-color: var(--line-strong);
  box-shadow: var(--sh-2);
}
.project-card:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.project-card__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
/* 项目头像（原型 .pjav，行 672）：圆角方块贴牌，色调按项目名稳定分桶（token 组合，无裸色值）。 */
.project-card__avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--r-md);
  font-size: var(--fs-300);
  font-weight: var(--fw-title);
  letter-spacing: -0.02em;
  user-select: none;
}
.project-card__avatar[data-tone='1'] {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.project-card__avatar[data-tone='2'] {
  color: var(--ok-text);
  background: var(--ok-soft);
}
.project-card__avatar[data-tone='3'] {
  color: var(--warn-text);
  background: var(--warn-soft);
}
.project-card__avatar[data-tone='4'] {
  color: var(--muted2);
  background: var(--sunken);
}
.project-card__title {
  flex: 1;
  margin: 0;
  overflow: hidden;
  font: var(--fw-title) var(--fs-body) / 1.4 var(--font-sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card__unread {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 var(--sp-1);
  border-radius: var(--r-pill);
  color: var(--on-danger);
  background: var(--danger);
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
}
/* 描述：两行封顶后省略号。**行数封顶不能省**——说明可以写到 160 字，
   不封顶的话内容多的卡片会比旁边的高出一截，整片栅格跟着参差 */
.project-card__desc {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--muted2);
  font-size: var(--fs-meta);
  line-height: var(--lh-tight);
}
.project-card__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
/* 头像叠放：负外边距让相邻两枚压住 6px，三枚只占两枚半的宽。
   ⚠️ flex 收缩关掉（头像不能被挤扁），整块定宽 ⇒ 成员再多卡片也不变形 */
.project-card__faces {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}
.project-card__faces > :not(:first-child) {
  margin-left: -6px;
}
/* 头像之间留一圈卡片底色的描边，叠起来才分得开层次 */
.project-card__faces :deep(.pj-avatar) {
  box-shadow: 0 0 0 2px var(--panel);
}
.project-card__more {
  display: inline-flex;
  height: 18px;
  align-items: center;
  margin-left: var(--sp-1);
  padding: 0 5px;
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  color: var(--muted);
  background: var(--sunken);
  font-size: var(--fs-100);
  white-space: nowrap;
}
.project-card__foot {
  display: flex;
  align-items: center;
  margin-top: auto;
  color: var(--muted);
  font-size: var(--fs-100);
}
.project-chip {
  display: inline-flex;
  height: 20px;
  align-items: center;
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font-size: var(--fs-100);
  white-space: nowrap;
}
.project-chip--accent {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .project-card {
    animation: none;
  }
}
</style>
