<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { FEED_MAX_BODY_LENGTH } from '@shared/protocol/project-collab.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAvatar from './ProjectAvatar.vue';
import ProjectRefChip from './ProjectRefChip.vue';
import ProjectRefComposer from './ProjectRefComposer.vue';
import {
  PROJECT_FEED_VIEWS,
  feedEntriesInView,
  persistFeedView,
  readStoredFeedView,
} from './project-feed-view';
import type { ProjectFeedView } from './project-feed-view';
import { formatProjectTimestamp } from './project-format';
import type { ProjectRefTarget } from './project-refs';
import { useProjectRefSources } from './useProjectRefSources';
import { renderMarkdown, renderMarkdownInline } from '../../features/session/markdown';
import { useProjectCollabStore } from '../../stores/projectCollab';

const props = defineProps<{ projectId: string }>();
/**
 * 引用芯片的「打开」上冒给项目页（测试提单 2552）：切页签、打开详情、定位行都属于页面层，
 * 本面板只出芯片，⛔ 不自己跳转。
 */
const emit = defineEmits<{ openRef: [ProjectRefTarget] }>();
const store = useProjectCollabStore();

/** 时间戳「当天只出时分」的判定基准：进页快照即可（动态多为过去事件，无需心跳）。 */
const nowMs = Date.now();

const draft = ref('');
const draftRefs = ref<readonly string[]>([]);
const posting = ref(false);

/**
 * 引用候选、芯片文案与跳转目标的来源：全部取自**已载**数据。动态里已有待办 / 资产引用而清单
 * 没取过时补取一次，`#` 浮层首次打开时同样补齐（进动态页签时资产与看板通常还没取过）。
 */
const { refSources, ensureRefCandidates } = useProjectRefSources(
  () => props.projectId,
  () =>
    store.feedEntries.flatMap((entry) => [
      ...entry.refs,
      ...entry.comments.flatMap((comment) => comment.refs),
    ]),
);
/**
 * 三视图收窄。归类口径与持久化都在 `project-feed-view`——这里只管呈现与切换。
 * ⚠️ 列表与芯片上的计数读**同一支** `feedEntriesInView`，不许各筛各的。
 */
const view = ref<ProjectFeedView>(readStoredFeedView());
watch(view, (next) => persistFeedView(next));

const visibleEntries = computed(() => feedEntriesInView(store.feedEntries, view.value));
const viewOptions = computed(() =>
  PROJECT_FEED_VIEWS.map((option) => ({
    ...option,
    count: feedEntriesInView(store.feedEntries, option.value).length,
  })),
);

const viewGroup = ref<HTMLElement | null>(null);

function pickView(next: ProjectFeedView): void {
  view.value = next;
}

/** radiogroup：左右方向键在组内移动，Tab 只进出整组（与看板视图芯片同口径）。 */
function onViewKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const index = PROJECT_FEED_VIEWS.findIndex((option) => option.value === view.value);
  const next =
    PROJECT_FEED_VIEWS[(index + step + PROJECT_FEED_VIEWS.length) % PROJECT_FEED_VIEWS.length];
  if (!next) return;
  pickView(next.value);
  void nextTick(() =>
    viewGroup.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
  );
}

/**
 * 「这个项目还没有动态」与「当前视图筛没了」是两回事，两个分支不得合并：
 * 前者该去发一条，后者该去看全部。合成一句「暂无数据」会让人以为动态丢了。
 */
const isFeedEmpty = computed(() => !store.feedLoading && store.feedEntries.length === 0);
const isViewEmpty = computed(
  () => store.feedEntries.length > 0 && visibleEntries.value.length === 0,
);

/** 正在展开评论输入的动态条目 id（一次只开一条）。 */
const commentingEntryId = ref<string | null>(null);
const commentDraft = ref('');
const commentDraftRefs = ref<readonly string[]>([]);
const commentPosting = ref(false);

/**
 * 评论输入框的候选来源：**只有本项目成员**。
 *
 * ⚠️ 三件事各有理由：
 *  - `members` 取自已载的项目名册（服务端权威），所以候选天然只有本项目的人——
 *    「只列本项目成员」是取数决定的，不靠一层过滤，也就没有漏筛的可能；
 *  - `files` / `todos` 给空数组：评论这一档**只做 @ 提及**，`#` 引用本轮没做。
 *    浮层因此在 `#` 上开不出来（候选为空即不开）——⛔ 没实现的能力不摆出来；
 *  - 已移出的成员由 `memberCandidates` 自己排掉（它只认 `state === 'active'`）。
 */
const commentRefSources = computed(() => ({
  members: store.detail?.members ?? [],
  files: [],
  todos: [],
}));

async function publish(): Promise<void> {
  const body = draft.value.trim();
  if (!body || posting.value) return;
  posting.value = true;
  try {
    if (await store.postFeed(props.projectId, body, draftRefs.value)) {
      draft.value = '';
      draftRefs.value = [];
    }
  } finally {
    posting.value = false;
  }
}

function toggleComment(entryId: string): void {
  commentingEntryId.value = commentingEntryId.value === entryId ? null : entryId;
  commentDraft.value = '';
  // 换一条动态评论时旧的提及必须一起清：留着会把上一条的 @ 对象带到这一条上。
  commentDraftRefs.value = [];
}

async function submitComment(entryId: string): Promise<void> {
  const body = commentDraft.value.trim();
  if (!body || commentPosting.value) return;
  commentPosting.value = true;
  try {
    if (await store.postComment(entryId, body, commentDraftRefs.value)) {
      commentDraft.value = '';
      commentDraftRefs.value = [];
      commentingEntryId.value = null;
    }
  } finally {
    commentPosting.value = false;
  }
}
</script>

<template>
  <div class="feed-pane">
    <div v-if="store.canWrite" class="feed-composer">
      <ProjectRefComposer
        v-model="draft"
        :refs="draftRefs"
        :sources="refSources"
        :rows="2"
        :maxlength="FEED_MAX_BODY_LENGTH"
        aria-label="发布留言"
        placeholder="发布留言，与项目成员同步进展…　@ 提及成员，# 引用资产或待办"
        @update:refs="draftRefs = $event"
        @need-candidates="ensureRefCandidates"
      />
      <div class="feed-composer__foot">
        <button
          class="btn btn--primary"
          type="button"
          :disabled="posting || !draft.trim()"
          @click="publish"
        >
          发布
        </button>
      </div>
    </div>

    <div v-if="store.feedError && store.feedEntries.length === 0" class="feed-state" role="alert">
      <p class="feed-state__title feed-state__title--danger">动态暂时不可用</p>
      <p class="feed-state__desc">
        {{ store.feedError.message }}
        <ReferenceIdCopy
          v-if="store.feedError.referenceCode"
          :reference-id="store.feedError.referenceCode"
        />
      </p>
      <button class="btn btn--secondary" type="button" @click="store.loadFeed(projectId)">
        重试
      </button>
    </div>
    <div
      v-else-if="store.feedLoading && store.feedEntries.length === 0"
      class="feed-state"
      role="status"
    >
      <span class="feed-state__desc">正在加载动态…</span>
    </div>
    <div v-else-if="isFeedEmpty" class="feed-state" data-testid="feed-empty" role="status">
      <div class="feed-state__art" aria-hidden="true">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 14h36v22H26l-8 8v-8h-8z" stroke-linejoin="round" />
          <path d="M18 22h20M18 28h13" stroke-linecap="round" />
        </svg>
      </div>
      <p class="feed-state__title">这个项目还没有动态</p>
      <p class="feed-state__desc">发布第一条留言，或等成员的操作生成系统动态。</p>
    </div>

    <!-- 三视图切换。整条动态一条都没有时不摆它——一个筛不出东西的开关只是噪音 -->
    <div
      v-if="store.feedEntries.length > 0"
      ref="viewGroup"
      class="feed-views"
      role="radiogroup"
      aria-label="动态视图"
      @keydown="onViewKeydown"
    >
      <button
        v-for="option in viewOptions"
        :key="option.value"
        class="feed-views__chip"
        :class="{ 'is-on': option.value === view }"
        type="button"
        role="radio"
        :aria-checked="option.value === view"
        :tabindex="option.value === view ? 0 : -1"
        :data-testid="`feed-view-${option.value}`"
        @click="pickView(option.value)"
      >
        {{ option.label }}
        <span class="feed-views__cnt tnum">{{ option.count }}</span>
      </button>
    </div>

    <!-- 「筛没了」自成一态：给的动作是「看全部」而不是「发一条」 -->
    <div v-if="isViewEmpty" class="feed-state" data-testid="feed-view-empty" role="status">
      <p class="feed-state__title">这个视图里没有动态</p>
      <p class="feed-state__desc">
        本项目有 {{ store.feedEntries.length }} 条动态，都不属于「{{
          viewOptions.find((option) => option.value === view)?.label
        }}」。
      </p>
      <button
        class="btn btn--secondary"
        type="button"
        data-testid="feed-view-reset"
        @click="pickView('all')"
      >
        看全部
      </button>
    </div>

    <div class="feed-list">
      <template v-for="entry in visibleEntries" :key="entry.id">
        <!-- system：虚线卡片（原型 .feed-item.sys）——虚线 + 透明底把「机器产生的」与
             「人写的」分开，是信息不是装饰；正文由服务端生成，无评论/操作。 -->
        <article
          v-if="entry.kind === 'system'"
          class="feed-entry feed-entry--sys"
          data-feed-kind="system"
          :data-feed-id="entry.id"
        >
          <header class="feed-entry__head">
            <span class="feed-entry__sysavatar" aria-hidden="true">↻</span>
            <span class="feed-entry__name">系统</span>
            <span class="feed-entry__chip feed-entry__chip--sys">自动</span>
            <span class="feed-entry__spacer"></span>
            <span class="feed-entry__time tnum">{{
              formatProjectTimestamp(entry.createdAt, nowMs)
            }}</span>
          </header>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 关闭 html 且全量转义，见 features/session/markdown.ts 安全边界；成员/系统正文比模型输出更不可信，正需这层转义 -->
          <div
            class="feed-entry__body feed-entry__body--sys feed-md"
            v-html="renderMarkdown(entry.bodyMd, { copyButton: false })"
          ></div>
        </article>
        <!-- member_post / assistant：卡片 -->
        <article v-else class="feed-entry" :data-feed-kind="entry.kind" :data-feed-id="entry.id">
          <header class="feed-entry__head">
            <ProjectAvatar
              :name="entry.authorDisplayName"
              :variant="entry.kind === 'assistant' ? 'ai' : 'member'"
            />
            <span class="feed-entry__name">{{
              entry.authorDisplayName || (entry.kind === 'assistant' ? '项目助理' : '成员')
            }}</span>
            <span v-if="entry.kind === 'assistant'" class="feed-entry__chip">自动化</span>
            <span class="feed-entry__spacer"></span>
            <span class="feed-entry__time tnum">{{
              formatProjectTimestamp(entry.createdAt, nowMs)
            }}</span>
          </header>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 关闭 html 且全量转义，见 features/session/markdown.ts 安全边界；成员正文比模型输出更不可信，正需这层转义 -->
          <div
            class="feed-entry__body feed-md"
            v-html="renderMarkdown(entry.bodyMd, { copyButton: false })"
          ></div>
          <!-- 引用芯片：认得出原对象的可点（跳转由项目页接住），已删除 / 看不到的只是文字 -->
          <div v-if="entry.refs.length > 0" class="feed-entry__refs">
            <ProjectRefChip
              v-for="refToken in entry.refs"
              :key="refToken"
              class="feed-ref"
              :token="refToken"
              :sources="refSources"
              @open="emit('openRef', $event)"
            />
          </div>
          <div class="feed-entry__actions">
            <button v-if="store.canWrite" type="button" @click="toggleComment(entry.id)">
              评论{{ entry.comments.length > 0 ? ` ${entry.comments.length}` : '' }}
            </button>
            <span v-else-if="entry.comments.length > 0">评论 {{ entry.comments.length }}</span>
          </div>
          <div v-if="entry.comments.length > 0" class="feed-entry__comments">
            <div
              v-for="comment in entry.comments"
              :key="comment.id"
              class="feed-comment"
              :data-comment-id="comment.id"
            >
              <ProjectAvatar :name="comment.authorDisplayName" size="s" />
              <div class="feed-comment__main">
                <p class="feed-comment__body">
                  <b>{{ comment.authorDisplayName || '成员' }}</b>
                  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdownInline 关闭 html 且全量转义，见 features/session/markdown.ts 安全边界；评论是成员亲笔、比模型更不可信，正需这层转义 -->
                  <span class="feed-md-inline" v-html="renderMarkdownInline(comment.bodyMd)"></span>
                  <span class="feed-comment__time tnum">{{
                    formatProjectTimestamp(comment.createdAt, nowMs)
                  }}</span>
                </p>
                <!-- @ 对象是**结构化引用**：认得出就显示人话，认不出照实显示那串 id。
                     ⛔ 不去正文里找「@某某」——正文里那几个字与被叫的账号没有可靠对应。 -->
                <div v-if="comment.refs.length > 0" class="feed-comment__refs">
                  <ProjectRefChip
                    v-for="refToken in comment.refs"
                    :key="refToken"
                    class="feed-ref"
                    size="sm"
                    data-testid="comment-ref"
                    :token="refToken"
                    :sources="refSources"
                    @open="emit('openRef', $event)"
                  />
                </div>
              </div>
            </div>
          </div>
          <div
            v-if="commentingEntryId === entry.id"
            class="feed-commentbox"
            data-testid="comment-composer"
          >
            <ProjectRefComposer
              v-model="commentDraft"
              :refs="commentDraftRefs"
              :sources="commentRefSources"
              :rows="1"
              :maxlength="FEED_MAX_BODY_LENGTH"
              submit-on-enter
              aria-label="追加评论"
              placeholder="追加一条评论…　@ 提及成员"
              @update:refs="commentDraftRefs = $event"
              @submit="submitComment(entry.id)"
            />
            <button
              class="btn btn--secondary"
              type="button"
              :disabled="commentPosting || !commentDraft.trim()"
              @click="submitComment(entry.id)"
            >
              发送
            </button>
          </div>
        </article>
      </template>
    </div>

    <button
      v-if="store.feedHasMore"
      class="btn btn--ghost feed-more"
      type="button"
      :disabled="store.feedLoading"
      @click="store.loadOlderFeed(projectId)"
    >
      加载更早的动态
    </button>
  </div>
</template>

<style scoped>
.feed-pane {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--px-12);
  margin: 0;
  padding: 0;
}
/* 发布框（原型 .cbox + .cbar）：输入在上、动作在下——「发布」沉到框**内右下**，
   不再与输入框并排浮在右侧（那样看着像框外的按钮）。 */
.feed-composer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.feed-composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.feed-composer__foot {
  display: flex;
  align-items: center;
}
.feed-composer__foot .btn {
  margin-left: auto;
}
.feed-state {
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
.feed-state__art {
  width: 56px;
  height: 56px;
  color: var(--muted);
  opacity: 0.7;
}
.feed-state__art svg {
  display: block;
  width: 100%;
  height: 100%;
}
.feed-state__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
.feed-state__title--danger {
  color: var(--danger-text);
}
.feed-state__desc {
  max-width: 44ch;
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
/* ── 三视图芯片组（原型 .vchips/.vchip 语汇：沉底 pill「轨道」内套 pill 分段，
      选中段浮起为 raised 面）。这三个筛选是程序侧增量、原型没有，但形态归位到原型
      的分段芯片语汇——不自成一套。 ── */
.feed-views {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  align-self: flex-start;
  padding: var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  background: var(--sunken);
}
.feed-views__chip {
  display: inline-flex;
  height: var(--ctl-h-sm);
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-3);
  border: var(--bw) solid transparent;
  border-radius: var(--r-pill);
  color: var(--muted2);
  background: transparent;
  font: var(--fw-label) var(--fs-meta) / 1 var(--font-sans);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.feed-views__chip:hover:not(.is-on) {
  color: var(--ink);
}
.feed-views__chip.is-on {
  color: var(--ink);
  background: var(--raised);
  box-shadow: var(--sh-1);
}
.feed-views__chip:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.feed-views__cnt {
  color: var(--muted);
  font-size: var(--fs-100);
  font-weight: var(--fw-body);
}
.feed-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.feed-entry {
  padding: var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
}
.feed-entry__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-meta);
}
.feed-entry__name {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-title);
}
.feed-entry__chip {
  display: inline-flex;
  align-items: center;
  padding: var(--px-1) var(--px-8); /* 原型角色标 .tag2 = padding 1px 8px、高度由内边距撑开（旧 height:18px + 0 6px） */
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
}
.feed-entry__spacer {
  flex: 1;
}
.feed-entry__time {
  color: var(--muted);
}
.feed-entry__body {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  /* 正文经受限 Markdown 渲染（feed-md）：软换行由 breaks:true 出 <br>，不再靠 pre-wrap，
     否则会与块级结构（段/表/围栏）叠加出多余空白。 */
}
.feed-entry__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
/* 引用芯片的形态与交互态归 ProjectRefChip（三处共用），这里只管排布 */
.feed-entry__actions {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-100);
}
.feed-entry__actions button {
  padding: 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.feed-entry__actions button:hover {
  color: var(--accent-text);
}
.feed-entry__comments {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: var(--bw) solid var(--line-weak);
}
.feed-comment {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-meta);
}
.feed-comment__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}
.feed-comment__body {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--muted2);
  line-height: 1.6;
  white-space: pre-wrap;
}
/* 评论里的引用芯片：与动态那一排同形态、压小一档（`size="sm"`，评论本来就是次级层次） */
.feed-comment__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.feed-comment__body b {
  color: var(--ink);
  font-weight: var(--fw-label);
}
.feed-comment__time {
  margin-left: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-100);
}
/* 评论输入区：与顶部合成区同一种「框住整块」的形态（浮层要贴着框沿弹） */
.feed-commentbox {
  display: flex;
  align-items: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.feed-commentbox:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* 系统事件卡（原型 .feed-item.sys）：虚线 + 透明底 + 无阴影，与成员/助手的实底卡拉开 */
.feed-entry--sys {
  border-style: dashed;
  background: transparent;
}
/* 系统头像：与成员头像同尺寸的圆，沉底 + 弱色 ↻，不占用真实成员的色分桶。
   ⚠️ 原型动态头像为 30px（.feed-item span），成员头像走共享 ProjectAvatar(--m=22px)；
   系统头像须与成员头像同尺寸，故与 --m 绑定一起改（见报告 ProjectAvatar --m 待确认项），此处不单独动。 */
.feed-entry__sysavatar {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--muted);
  background: var(--sunken);
  font-size: var(--fs-100);
}
/* 「自动」徽标：与助手的「自动化」（强调色）区分——系统走中性弱色 */
.feed-entry__chip--sys {
  border-color: var(--line);
  color: var(--muted2);
  background: var(--sunken);
}
.feed-entry__body--sys {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.feed-more {
  align-self: center;
}
/* 降低动效偏好：只去掉补间，视图切换与输入焦点等能力一分不减 */
@media (prefers-reduced-motion: reduce) {
  .feed-views__chip,
  .feed-composer,
  .feed-commentbox,
  .feed-entry__actions button {
    transition: none;
  }
}
</style>
