<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { CHAT_MAX_BODY_LENGTH } from '@shared/protocol/project-collab.js';
import type { ChatMessage } from '@shared/protocol/project-collab.js';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectAvatar from './ProjectAvatar.vue';
import ProjectChatSearchPanel from './ProjectChatSearchPanel.vue';
import ProjectRefChip from './ProjectRefChip.vue';
import ProjectRefComposer from './ProjectRefComposer.vue';
import {
  formatProjectDayLabel,
  formatProjectTimestamp,
  isWithinRevokeWindow,
} from './project-format';
import type { ProjectRefTarget } from './project-refs';
import { useProjectRefSources } from './useProjectRefSources';
import { renderMarkdown } from '../../features/session/markdown';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';
import { hasPendingChatHistory } from '../../stores/projectCollabChat';

const props = defineProps<{ projectId: string }>();
/**
 * 引用芯片的「打开」上冒给项目页（测试提单 2552；原型 index.html:1747「点击项目群聊消息中的
 * 需求或任务引用卡片，打开对应详情」）。跳转属于页面层，⛔ 讨论面自己不切页签、不建工作项。
 */
const emit = defineEmits<{ openRef: [ProjectRefTarget] }>();
const store = useProjectCollabStore();
const capabilities = useProjectServiceCapabilitiesStore();
const pendingHistory = computed(() => hasPendingChatHistory(store));
const searchOpen = ref(false);
watch(
  () => [
    props.projectId,
    store.projectEpoch,
    store.accountEpoch,
    store.mySubject,
    capabilities.supportsChatSearch,
  ],
  () => {
    searchOpen.value = false;
  },
  { flush: 'sync' },
);

interface SendSnapshot {
  body: string;
  originalDraft: string;
  refs: readonly string[];
  clientMessageId?: string;
}

const draft = ref('');
const draftRefs = ref<readonly string[]>([]);
const sending = ref(false);
const sendStatus = ref<'sending' | 'confirmed' | 'unconfirmed' | null>(null);
const checkingHistory = ref(false);
const refreshingCapabilities = ref(false);
const pendingMessage = ref<SendSnapshot | null>(null);
let composerEpoch = 0;

watch(
  () => [props.projectId, store.projectEpoch, store.mySubject],
  () => {
    composerEpoch += 1;
    draft.value = '';
    draftRefs.value = [];
    sending.value = false;
    sendStatus.value = null;
    checkingHistory.value = false;
    refreshingCapabilities.value = false;
    pendingMessage.value = null;
  },
  { flush: 'sync' },
);

/**
 * 引用候选、芯片文案与跳转目标的来源：全部取自**已载**数据。消息里已有待办 / 资产引用而清单
 * 没取过时补取一次，`#` 浮层首次打开时同样补齐（进讨论页签时资产与看板通常还没取过）。
 * 已撤回的消息不出芯片，它的引用也不触发补取。
 */
const { refSources, ensureRefCandidates } = useProjectRefSources(
  () => props.projectId,
  () => store.chatMessages.flatMap((message) => (message.revoked ? [] : message.refs)),
);

/** 撤回窗口是时间函数——用一个 30s 心跳让按钮到点自然消失，而不是等下次重渲。 */
const nowMs = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  nowTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  composerEpoch += 1;
  pendingMessage.value = null;
  if (nowTimer) clearInterval(nowTimer);
});

/** 新消息落地（事件重取 / 本人发送）即上报读游标——页签开着就等于在读。 */
watch(
  () => store.chatMessages.length,
  (length, previous) => {
    if (length > (previous ?? 0)) void store.markChatRead(props.projectId);
  },
);

function canRevoke(message: ChatMessage): boolean {
  return (
    !message.revoked &&
    store.isSelf(message.authorSubject) &&
    isWithinRevokeWindow(message.createdAt, nowMs.value)
  );
}

function isUnreadBoundary(message: ChatMessage, index: number): boolean {
  const from = store.chatUnreadFromSeq;
  if (from === null || message.seq < from) return false;
  const previous = store.chatMessages[index - 1];
  return previous === undefined || previous.seq < from;
}

/** 日期分割线：与上一条消息不同日（本地时区）时插入（原型 chat__day 形态）。 */
function isDayBoundary(message: ChatMessage, index: number): boolean {
  const previous = store.chatMessages[index - 1];
  if (previous === undefined) return true;
  return (
    formatProjectDayLabel(previous.createdAt, nowMs.value) !==
    formatProjectDayLabel(message.createdAt, nowMs.value)
  );
}

async function send(): Promise<void> {
  const body = draft.value.trim();
  if (!body || sending.value || pendingMessage.value || refreshingCapabilities.value) return;
  let snapshot: SendSnapshot;
  try {
    snapshot = {
      body,
      originalDraft: draft.value,
      refs: [...draftRefs.value],
      ...(capabilities.supportsChatIdempotency ? { clientMessageId: crypto.randomUUID() } : {}),
    };
  } catch {
    // 无法生成标识时保留草稿，不退回无标识请求。
    sendStatus.value = 'unconfirmed';
    return;
  }
  if (snapshot.clientMessageId) pendingMessage.value = snapshot;
  await sendSnapshot(snapshot);
}

async function retryOriginal(): Promise<void> {
  const snapshot = pendingMessage.value;
  if (!snapshot || sending.value) return;
  // 每次显式重试仍经过主进程的实时能力写门；不因缓存变化丢弃原标识。
  await sendSnapshot(snapshot);
}

async function endRetry(): Promise<void> {
  if (!pendingMessage.value || sending.value) return;
  const epoch = composerEpoch;
  pendingMessage.value = null;
  // 用户只结束本次重试；结果仍未确认，正文与引用不变。
  refreshingCapabilities.value = true;
  try {
    await capabilities.load();
  } finally {
    if (epoch === composerEpoch) refreshingCapabilities.value = false;
  }
}

async function sendSnapshot(snapshot: SendSnapshot): Promise<void> {
  const epoch = composerEpoch;
  const { originalDraft, refs } = snapshot;
  sending.value = true;
  sendStatus.value = 'sending';
  try {
    const confirmed = await store.sendChat(
      props.projectId,
      snapshot.body,
      refs,
      snapshot.clientMessageId,
    );
    if (epoch !== composerEpoch) return;
    sendStatus.value = confirmed ? 'confirmed' : 'unconfirmed';
    if (confirmed) pendingMessage.value = null;
    if (
      confirmed &&
      draft.value === originalDraft &&
      draftRefs.value.length === refs.length &&
      draftRefs.value.every((token, index) => token === refs[index])
    ) {
      draft.value = '';
      draftRefs.value = [];
    }
  } catch {
    // 结果未知时保留原消息快照与草稿；不透出底层异常，也不自动重发。
    if (epoch === composerEpoch) sendStatus.value = 'unconfirmed';
  } finally {
    if (epoch === composerEpoch) sending.value = false;
  }
}

async function resumeHistory(): Promise<void> {
  if (checkingHistory.value) return;
  const epoch = composerEpoch;
  checkingHistory.value = true;
  try {
    await store.refreshChatWindow(props.projectId);
  } finally {
    if (epoch === composerEpoch) checkingHistory.value = false;
  }
}
</script>

<template>
  <div class="chat-pane">
    <div>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="chat-search-open"
        :disabled="!capabilities.supportsChatSearch"
        @click="searchOpen = true"
      >
        搜索消息
      </button>
      <span v-if="!capabilities.supportsChatSearch" class="chat-composer__hint">{{
        capabilities.loaded ? '当前项目组暂不支持消息搜索' : '正在确认消息搜索能力'
      }}</span>
    </div>
    <ProjectChatSearchPanel
      v-if="searchOpen"
      :project-id="projectId"
      @close="searchOpen = false"
      @open-ref="emit('openRef', $event)"
    />
    <div class="chat-scroll">
      <div v-if="(store.chatError || pendingHistory) && store.chatMessages.length > 0" role="alert">
        {{ store.chatError?.message ?? '还有消息尚未载入，请继续核对最新消息。' }}
        <ReferenceIdCopy
          v-if="store.chatError?.referenceCode"
          :reference-id="store.chatError.referenceCode"
        />
        <button
          class="btn btn--ghost"
          type="button"
          data-testid="chat-resume"
          :disabled="checkingHistory"
          @click="resumeHistory"
        >
          {{ checkingHistory ? '正在核对…' : '继续核对最新消息' }}
        </button>
      </div>
      <button
        v-if="store.chatHasMore"
        class="btn btn--ghost chat-more"
        type="button"
        :disabled="store.chatLoading"
        @click="store.loadOlderChat(projectId)"
      >
        加载更早的消息
      </button>

      <div
        v-if="store.chatError && store.chatMessages.length === 0"
        class="chat-state"
        role="alert"
      >
        <p class="chat-state__title chat-state__title--danger">讨论暂时不可用</p>
        <p class="chat-state__desc">
          {{ store.chatError.message }}
          <ReferenceIdCopy
            v-if="store.chatError.referenceCode"
            :reference-id="store.chatError.referenceCode"
          />
        </p>
        <button class="btn btn--secondary" type="button" @click="store.loadChatLatest(projectId)">
          重试
        </button>
      </div>
      <div
        v-else-if="store.chatLoading && store.chatMessages.length === 0"
        class="chat-state"
        role="status"
      >
        <span class="chat-state__desc">正在加载讨论…</span>
      </div>
      <div
        v-else-if="!store.chatLoading && store.chatMessages.length === 0"
        class="chat-state"
        role="status"
      >
        <p class="chat-state__title">还没有讨论</p>
        <p class="chat-state__desc">发出第一条消息，成员会实时收到。</p>
      </div>

      <template v-for="(message, index) in store.chatMessages" :key="message.id">
        <div v-if="isDayBoundary(message, index)" class="chat-day" aria-hidden="true">
          {{ formatProjectDayLabel(message.createdAt, nowMs) }}
        </div>
        <div v-if="isUnreadBoundary(message, index)" class="chat-unread" data-testid="chat-unread">
          以下为未读
        </div>
        <!-- 讨论气泡（原型 cmsg/cb）：本人靠右、强调底气泡；他人靠左、面板底气泡。
             自他之分取自 store.isSelf（撤回入口同一支判据）——⛔ 不猜作者、不比显示名。 -->
        <div
          class="chat-msg"
          :class="{ 'chat-msg--me': store.isSelf(message.authorSubject) }"
          :data-message-id="message.id"
        >
          <ProjectAvatar :name="message.authorDisplayName" />
          <div class="chat-msg__body">
            <div class="chat-msg__head">
              <span class="chat-msg__name">{{
                store.isSelf(message.authorSubject) ? '我' : message.authorDisplayName || '成员'
              }}</span>
              <span class="chat-msg__time tnum">{{
                formatProjectTimestamp(message.createdAt, nowMs)
              }}</span>
              <button
                v-if="canRevoke(message)"
                class="chat-msg__revoke"
                type="button"
                data-testid="chat-revoke"
                @click="store.revokeChat(message.id)"
              >
                撤回
              </button>
            </div>
            <div class="chat-msg__bubble" :class="{ 'is-revoked': message.revoked }">
              <p v-if="message.revoked" class="chat-msg__revoked" data-testid="chat-revoked">
                已撤回
              </p>
              <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 关闭 html 且全量转义，见 features/session/markdown.ts 安全边界；讨论是成员亲笔、比模型更不可信，正需这层转义 -->
              <div
                v-else
                class="chat-msg__text feed-md"
                v-html="renderMarkdown(message.bodyMd, { copyButton: false })"
              ></div>
            </div>
            <!-- 引用芯片：认得出原对象的可点（跳转由项目页接住），已删除 / 看不到的只是文字 -->
            <div v-if="!message.revoked && message.refs.length > 0" class="chat-msg__refs">
              <ProjectRefChip
                v-for="refToken in message.refs"
                :key="refToken"
                class="chat-ref"
                :token="refToken"
                :sources="refSources"
                @open="emit('openRef', $event)"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="store.canWrite" class="chat-composer">
      <div class="chat-composer__row">
        <ProjectRefComposer
          v-model="draft"
          :refs="draftRefs"
          :sources="refSources"
          :maxlength="CHAT_MAX_BODY_LENGTH"
          aria-label="发消息"
          placeholder="发消息…　@ 提及成员，# 引用资产或待办"
          submit-on-enter
          @update:refs="draftRefs = $event"
          @submit="send"
          @need-candidates="ensureRefCandidates"
        />
        <button
          class="btn btn--primary"
          type="button"
          :disabled="sending || !!pendingMessage || refreshingCapabilities || !draft.trim()"
          @click="send"
        >
          {{ sending ? '发送中…' : refreshingCapabilities ? '正在核对服务…' : '发送' }}
        </button>
      </div>
      <p
        v-if="sendStatus"
        class="chat-composer__hint"
        role="status"
        aria-live="polite"
        data-testid="chat-send-status"
      >
        {{
          sendStatus === 'sending'
            ? '发送中…'
            : sendStatus === 'confirmed'
              ? '发送已确认'
              : pendingMessage
                ? '发送结果未确认，原消息已保留。可核对最新消息，或重试原消息。'
                : '发送结果未确认，草稿已保留。请先刷新消息核对，避免重复发送。'
        }}
      </p>
      <button
        v-if="pendingMessage"
        class="btn btn--secondary"
        type="button"
        data-testid="chat-retry"
        :disabled="sending"
        @click="retryOriginal"
      >
        重试原消息
      </button>
      <template v-if="pendingMessage && !sending">
        <p class="chat-composer__hint">原消息可能已经发送，结束重试不会撤回，请先核对记录。</p>
        <button class="btn btn--ghost" type="button" data-testid="chat-end-retry" @click="endRetry">
          结束重试，保留草稿
        </button>
      </template>
      <button
        v-if="sendStatus === 'unconfirmed'"
        class="btn btn--ghost"
        type="button"
        data-testid="chat-check-latest"
        :disabled="store.chatLoading"
        @click="store.loadChatLatest(projectId)"
      >
        {{ store.chatLoading ? '正在核对…' : '核对最新消息' }}
      </button>
      <div class="chat-composer__hint">
        消息保存在项目组内 · 发送后 5 分钟内可撤回 · @ 提及成员，# 引用资产或待办
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.chat-scroll {
  display: flex;
  width: 100%;
  max-width: var(--content-max);
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: var(--sp-4);
  overflow: auto;
  margin: 0 auto;
  padding: var(--sp-4) 0;
}
.chat-more {
  align-self: center;
}
.chat-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) var(--sp-5);
  color: var(--muted2);
  text-align: center;
}
.chat-state__title {
  margin: 0;
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.4 var(--font-sans);
}
.chat-state__title--danger {
  color: var(--danger-text);
}
.chat-state__desc {
  max-width: 44ch;
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
/* 日期分割线（原型 chat__day：两侧 line-weak 细线） */
.chat-day {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-100);
}
.chat-day::before,
.chat-day::after {
  content: '';
  flex: 1;
  height: 1px; /* 分割线线宽（1px 细线，同 D2.15 边框例外，不 token 化） */
  background: var(--line-weak);
}
.chat-unread {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--danger-text);
  font-size: var(--fs-100);
}
.chat-unread::before,
.chat-unread::after {
  content: '';
  flex: 1;
  height: 1px; /* 分割线线宽（1px 细线，同 D2.15 边框例外） */
  background: var(--danger-line);
}
/* 一条消息＝头像 + 正文列，整块靠一侧对齐（原型 .cmsg / .cmsg.me） */
.chat-msg {
  display: flex;
  max-width: 82%;
  align-self: flex-start;
  gap: var(--sp-3);
}
.chat-msg--me {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.chat-msg__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
  align-items: flex-start;
}
/* 本人一侧：抬头与气泡一并靠右，读起来是「我说的」 */
.chat-msg--me .chat-msg__body {
  align-items: flex-end;
}
.chat-msg__head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-meta);
}
.chat-msg__name {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: var(--fw-title);
}
.chat-msg__time {
  color: var(--muted);
  font-size: var(--fs-100);
}
/* 撤回入口平时隐身，行 hover / 键盘聚焦时现身——降低时间窗按钮的视觉噪音 */
.chat-msg__revoke {
  padding: 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-100);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.chat-msg:hover .chat-msg__revoke,
.chat-msg__revoke:focus-visible {
  opacity: 1;
}
.chat-msg__revoke:hover {
  color: var(--danger-text);
}
/* 气泡（原型 .cb）：他人面板底，本人强调底；撤回后退成虚线沉底占位 */
.chat-msg__bubble {
  width: fit-content;
  max-width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
  box-shadow: var(--sh-1);
}
.chat-msg--me .chat-msg__bubble {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.chat-msg__bubble.is-revoked {
  border-style: dashed;
  background: var(--sunken);
  box-shadow: none;
}
.chat-msg__text {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--fs-body);
  line-height: 1.6;
  /* 正文经受限 Markdown 渲染（feed-md）：软换行由 breaks:true 出 <br>，不再靠 pre-wrap，
     否则会与块级结构（段/表/围栏）叠加出多余空白。 */
}
.chat-msg__revoked {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
  font-style: italic;
}
.chat-msg__refs {
  display: flex;
  max-width: 100%;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
/* 引用芯片的形态与交互态归 ProjectRefChip（三处共用），这里只管排布 */
.chat-composer {
  flex: 0 0 auto;
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-3) 0 var(--sp-4);
}
.chat-composer__row {
  display: flex;
  /* 附了引用芯片后合成区会长高，发送按钮跟着贴底而不是浮在中间 */
  align-items: flex-end;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--panel);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.chat-composer__row:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.chat-composer__hint {
  margin-top: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-100);
}
</style>
