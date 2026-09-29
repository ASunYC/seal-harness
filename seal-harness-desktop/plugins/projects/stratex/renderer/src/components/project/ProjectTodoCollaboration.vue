<script setup lang="ts">
import { computed, watch } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import ProjectRefComposer from './ProjectRefComposer.vue';
import ProjectRefChip from './ProjectRefChip.vue';
import TodoRefPicker from './TodoRefPicker.vue';
import type { ProjectRefSources, ProjectRefTarget } from './project-refs';
import { useTodoCollaboration } from './useTodoCollaboration';
import { useProjectCollabStore } from '../../stores/projectCollab';

const props = defineProps<{ projectId: string; todo: Todo }>();
const emit = defineEmits<{
  openRef: [ProjectRefTarget];
  versionChanged: [change: { previousVersion: number; version: number }];
  busy: [value: boolean];
}>();
const store = useProjectCollabStore();
const {
  collaborators,
  selectedSubjects,
  comments,
  nextCursor,
  bodyMd,
  refs,
  collaboratorsLoading,
  commentsLoading,
  savingCollaborators,
  sending,
  collaboratorsError,
  collaboratorSaveError,
  commentsError,
  submitError,
  canComment,
  canEditCollaborators,
  collaboratorsDirty,
  loadCollaborators,
  loadComments,
  saveCollaborators,
  sendComment,
} = useTodoCollaboration(
  () => props.projectId,
  () => props.todo,
  (change) => emit('versionChanged', change),
);
watch(savingCollaborators, (value) => emit('busy', value), { flush: 'sync' });
const sources = computed<ProjectRefSources>(() => ({
  members: store.detail?.members ?? [],
  files: store.files,
  todos: [...store.todosById.values()].filter(
    (item) =>
      store.activeProjectId === props.projectId &&
      (item.projectId === undefined || item.projectId === props.projectId) &&
      (props.todo.visibility === 'personal' || item.visibility !== 'personal'),
  ),
}));
const selected = computed(() =>
  selectedSubjects.value.map((subject) => {
    const member = store.detail?.members.find(
      (item) => item.subject === subject && item.state === 'active',
    );
    const prior = collaborators.value.find((item) => item.subject === subject);
    return {
      subject,
      displayName: member?.displayName ?? prior?.displayName ?? subject,
      removed: !member && (store.detail !== null || prior?.state === 'removed'),
    };
  }),
);
const collaboratorOptions = computed(() =>
  (store.detail?.members ?? [])
    .filter(
      (member) => member.state === 'active' && !selectedSubjects.value.includes(member.subject),
    )
    .map((member) => ({ token: member.subject, name: member.displayName, kindLabel: '成员' })),
);
const draftTooLong = computed(() => [...bodyMd.value].length > 20_000);
function addCollaborator(subject: string): void {
  if (
    !canEditCollaborators.value ||
    selectedSubjects.value.length >= 20 ||
    selectedSubjects.value.includes(subject)
  )
    return;
  selectedSubjects.value = [...selectedSubjects.value, subject];
}
function removeCollaborator(subject: string): void {
  selectedSubjects.value = selectedSubjects.value.filter((item) => item !== subject);
}
function ensureCandidates(): void {
  if (store.files.length === 0) void store.loadFiles(props.projectId);
}
</script>

<template>
  <section class="todo-collaboration" aria-label="任务协作" data-testid="todo-collaboration">
    <section
      v-if="todo.itemKind === 'task'"
      class="todo-collaboration__section"
      aria-label="协助人"
    >
      <h4>
        协助人 <small>{{ selectedSubjects.length }}/20</small>
      </h4>
      <p v-if="collaboratorsLoading" role="status">正在读取协助人…</p>
      <ul v-else class="todo-collaboration__members">
        <li v-for="member in selected" :key="member.subject">
          <span>{{ member.displayName }}<small v-if="member.removed">（已离组）</small></span>
          <button
            v-if="canEditCollaborators"
            type="button"
            :disabled="savingCollaborators"
            :aria-label="`移除协助人 ${member.displayName}`"
            @click="removeCollaborator(member.subject)"
          >
            移除
          </button>
        </li>
        <li v-if="selected.length === 0">暂无协助人</li>
      </ul>
      <p v-if="collaboratorsError" role="alert">
        {{ collaboratorsError }} <button type="button" @click="loadCollaborators">重新读取</button>
      </p>
      <div v-if="canEditCollaborators" class="todo-collaboration__controls">
        <TodoRefPicker
          :options="collaboratorOptions"
          :disabled="
            savingCollaborators ||
            collaboratorsLoading ||
            !!collaboratorsError ||
            selectedSubjects.length >= 20
          "
          placeholder="添加协助人…"
          test-id="todo-collaborator-add"
          @select="addCollaborator"
        />
        <button
          type="button"
          class="btn btn--ghost"
          data-testid="todo-collaborators-save"
          :disabled="
            savingCollaborators ||
            collaboratorsLoading ||
            !!collaboratorsError ||
            !collaboratorsDirty
          "
          @click="saveCollaborators"
        >
          {{ savingCollaborators ? '保存中…' : '保存协助人' }}
        </button>
      </div>
      <p v-if="collaboratorSaveError" role="alert">{{ collaboratorSaveError }}</p>
    </section>

    <section class="todo-collaboration__section" aria-label="业务评论">
      <h4>业务评论</h4>
      <p v-if="commentsLoading && comments.length === 0" role="status">正在读取评论…</p>
      <p v-else-if="comments.length === 0 && !commentsError">暂无评论</p>
      <ol class="todo-collaboration__comments">
        <li v-for="comment in comments" :key="comment.id" data-testid="todo-business-comment">
          <div class="todo-collaboration__author">
            <b>{{ comment.authorDisplayName }}</b
            ><time :datetime="comment.createdAt">{{
              new Date(comment.createdAt).toLocaleString()
            }}</time>
          </div>
          <p class="todo-collaboration__body">{{ comment.bodyMd }}</p>
          <div class="todo-collaboration__refs">
            <ProjectRefChip
              v-for="token in comment.refs"
              :key="token"
              :token="token"
              :sources="sources"
              size="sm"
              @open="emit('openRef', $event)"
            />
          </div>
        </li>
      </ol>
      <p v-if="commentsError" role="alert">
        {{ commentsError }}
        <button type="button" :disabled="commentsLoading" @click="loadComments()">重新读取</button>
      </p>
      <button
        v-if="nextCursor"
        type="button"
        class="btn btn--ghost"
        :disabled="commentsLoading"
        data-testid="todo-comments-more"
        @click="loadComments(true)"
      >
        {{ commentsLoading ? '读取中…' : '加载更早评论' }}
      </button>
      <div v-if="canComment" class="todo-collaboration__composer">
        <ProjectRefComposer
          v-model="bodyMd"
          v-model:refs="refs"
          :sources="sources"
          :maxlength="40_000"
          :rows="3"
          :disabled="sending"
          aria-label="业务评论正文"
          placeholder="补充说明，@ 提及成员，# 引用材料"
          @need-candidates="ensureCandidates"
        />
        <p v-if="draftTooLong" role="alert">评论最多20000字。</p>
        <p v-if="submitError" role="alert">{{ submitError }}</p>
        <button
          type="button"
          class="btn btn--ghost"
          data-testid="todo-comment-send"
          :disabled="sending || !bodyMd.trim() || draftTooLong"
          @click="sendComment"
        >
          {{ sending ? '发送中…' : '发送评论' }}
        </button>
      </div>
      <p v-else class="todo-collaboration__readonly">当前为只读状态。</p>
    </section>
  </section>
</template>

<style scoped>
.todo-collaboration {
  display: grid;
  gap: var(--sp-4);
  padding-block: var(--sp-3);
}
.todo-collaboration__section {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
}
h4,
p {
  margin: 0;
}
h4 {
  font-size: var(--fs-body);
}
small,
.todo-collaboration__readonly,
time {
  color: var(--muted);
  font-size: var(--fs-meta);
}
.todo-collaboration__members,
.todo-collaboration__comments {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.todo-collaboration__members li,
.todo-collaboration__author,
.todo-collaboration__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.todo-collaboration__comments li {
  display: grid;
  gap: var(--sp-2);
  border-bottom: var(--bw) solid var(--line);
  padding-bottom: var(--sp-3);
}
.todo-collaboration__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.todo-collaboration__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.todo-collaboration__composer {
  display: grid;
  gap: var(--sp-3);
}
[role='alert'] {
  color: var(--danger-text);
}
</style>
