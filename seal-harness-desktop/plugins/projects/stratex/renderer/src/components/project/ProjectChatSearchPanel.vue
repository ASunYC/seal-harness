<script setup lang="ts">
import { computed } from 'vue';

import ProjectAvatar from './ProjectAvatar.vue';
import ProjectRefChip from './ProjectRefChip.vue';
import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import { formatProjectTimestamp } from './project-format';
import type { ProjectRefTarget } from './project-refs';
import { useProjectRefSources } from './useProjectRefSources';
import { useProjectChatSearch } from './useProjectChatSearch';
import { renderMarkdown } from '../../features/session/markdown';
import { useProjectCollabStore } from '../../stores/projectCollab';
import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: []; openRef: [ProjectRefTarget] }>();
const store = useProjectCollabStore();
const capabilities = useProjectServiceCapabilitiesStore();
const canRead = computed(() => store.detail?.id === props.projectId && store.mySubject !== null);
const {
  query,
  messages,
  nextCursor,
  loading,
  error,
  searched,
  newMessages,
  submit,
  loadMore,
  clear,
} = useProjectChatSearch({
  projectId: () => props.projectId,
  projectEpoch: () => store.projectEpoch,
  accountEpoch: () => store.accountEpoch,
  subject: () => store.mySubject,
  canRead: () => canRead.value,
  supported: () => capabilities.supportsChatSearch,
});
const { refSources } = useProjectRefSources(
  () => props.projectId,
  () => messages.value.flatMap((message) => (message.revoked ? [] : message.refs)),
);
</script>

<template>
  <section
    class="chat-search"
    aria-label="搜索群消息"
    data-testid="chat-search-panel"
    @keydown.esc="emit('close')"
  >
    <header class="chat-search__header">
      <h3>搜索消息</h3>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="chat-search-close"
        @click="emit('close')"
      >
        关闭搜索
      </button>
    </header>
    <form class="chat-search__form" @submit.prevent="submit">
      <input
        v-model="query"
        class="input"
        type="search"
        aria-label="搜索消息正文"
        placeholder="输入消息正文"
        maxlength="128"
        data-testid="chat-search-query"
        :disabled="!canRead || !capabilities.supportsChatSearch"
      />
      <button
        class="btn btn--secondary"
        type="submit"
        data-testid="chat-search-submit"
        :disabled="loading || !query.trim() || !canRead || !capabilities.supportsChatSearch"
      >
        搜索
      </button>
      <button
        class="btn btn--ghost"
        type="button"
        data-testid="chat-search-clear"
        :disabled="!query"
        @click="clear"
      >
        清空
      </button>
    </form>
    <p v-if="!capabilities.supportsChatSearch || !canRead" class="chat-search__hint" role="status">
      当前项目组暂不支持消息搜索，或你已失去访问权限。
    </p>
    <p v-if="newMessages" class="chat-search__hint" role="status">
      有新消息，重新搜索可查看最新结果。
    </p>
    <p v-if="loading" class="chat-search__hint" role="status">正在搜索…</p>
    <div v-if="error" class="chat-search__hint" role="alert">
      {{ error.message }}
      <ReferenceIdCopy v-if="error.referenceCode" :reference-id="error.referenceCode" />
    </div>
    <p
      v-else-if="searched && messages.length === 0 && !loading"
      class="chat-search__hint"
      role="status"
    >
      没有找到匹配的消息。
    </p>
    <p v-else-if="!searched && !loading" class="chat-search__hint">
      按正文搜索项目群消息，结果按最新优先排列。
    </p>
    <div class="chat-search__results">
      <article
        v-for="message in messages"
        :key="message.id"
        class="chat-search__message"
        data-testid="chat-search-result"
        :data-message-id="message.id"
      >
        <ProjectAvatar :name="message.authorDisplayName" />
        <div class="chat-search__body">
          <div class="chat-search__meta">
            <strong>{{ message.authorDisplayName || '成员' }}</strong>
            <time class="tnum" :datetime="message.createdAt">{{
              formatProjectTimestamp(message.createdAt, Date.now())
            }}</time>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- 复用普通讨论安全 Markdown：原始 HTML 转义，查询文本不参与 HTML 拼接。 -->
          <div class="feed-md" v-html="renderMarkdown(message.bodyMd, { copyButton: false })"></div>
          <div v-if="message.refs.length" class="chat-search__refs">
            <ProjectRefChip
              v-for="token in message.refs"
              :key="token"
              :token="token"
              :sources="refSources"
              @open="emit('openRef', $event)"
            />
          </div>
        </div>
      </article>
    </div>
    <button
      v-if="nextCursor"
      class="btn btn--ghost"
      type="button"
      data-testid="chat-search-more"
      :disabled="loading"
      @click="loadMore"
    >
      加载更多匹配消息
    </button>
  </section>
</template>

<style scoped>
.chat-search {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
}
.chat-search__header,
.chat-search__form,
.chat-search__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.chat-search__header {
  justify-content: space-between;
}
.chat-search__header h3 {
  margin: 0;
  font-size: var(--fs-200);
}
.chat-search__form {
  flex-wrap: wrap;
}
.chat-search__form input {
  flex: 1 1 12rem;
  min-width: 0;
}
.chat-search__hint {
  margin: 0;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.chat-search__results {
  display: flex;
  max-height: 26rem;
  flex-direction: column;
  gap: var(--sp-4);
  overflow: auto;
}
.chat-search__message {
  display: flex;
  gap: var(--sp-3);
  padding-block: var(--sp-2);
}
.chat-search__body {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
.chat-search__meta {
  flex-wrap: wrap;
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.chat-search__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
</style>
