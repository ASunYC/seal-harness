import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Todo } from '@shared/protocol/project-collab.js';
import type {
  ProjectTodoCollaborator,
  ProjectTodoComment,
  ProjectTodoCommentCreateRequest,
  ProjectTodoCollaboratorsReplaceRequest,
} from '@shared/protocol/project-todo-collaboration.js';
import { projectTodoCollaborationApi as api } from '../../sdk/projectTodoCollaboration';
import { projectCollabApi } from '../../sdk/projectCollab';
import { useProjectCollabStore } from '../../stores/projectCollab';

function accessLost(result: { code: string; serverCode?: string | undefined }): boolean {
  return (
    ['forbidden', 'authRequired', 'credentialRejected'].includes(result.code) ||
    result.serverCode === 'todo_not_found'
  );
}

/** 私有草稿不进入共享store；所有在途结果受账号、项目、对象与请求代次保护。 */
export function useTodoCollaboration(
  projectId: () => string,
  todo: () => Todo,
  onVersionChanged?: (change: { previousVersion: number; version: number }) => void,
) {
  const store = useProjectCollabStore();
  const collaborators = ref<ProjectTodoCollaborator[]>([]);
  const selectedSubjects = ref<string[]>([]);
  const version = ref(todo().version);
  const comments = ref<ProjectTodoComment[]>([]);
  const nextCursor = ref<string | null>(null);
  const bodyMd = ref('');
  const refs = ref<readonly string[]>([]);
  const collaboratorsLoading = ref(false);
  const commentsLoading = ref(false);
  const savingCollaborators = ref(false);
  const sending = ref(false);
  const collaboratorsError = ref<string | null>(null);
  const collaboratorSaveError = ref<string | null>(null);
  const commentsError = ref<string | null>(null);
  const submitError = ref<string | null>(null);
  let epoch = 0;
  let collaboratorRead = 0;
  let commentRead = 0;
  let commentAttempt: ProjectTodoCommentCreateRequest | null = null;
  let collaboratorAttempt: ProjectTodoCollaboratorsReplaceRequest | null = null;
  const scope = computed(() =>
    [store.accountEpoch, store.projectEpoch, projectId(), todo().id].join(':'),
  );
  const canComment = computed(() => store.canWrite && !store.isArchived);
  const canEditCollaborators = computed(
    () => todo().itemKind === 'task' && store.canEditTodo(todo()) && !store.isArchived,
  );
  const collaboratorsDirty = computed(
    () =>
      JSON.stringify(selectedSubjects.value) !==
      JSON.stringify(collaborators.value.map((item) => item.subject)),
  );

  async function loadCollaborators(): Promise<void> {
    if (todo().itemKind !== 'task') return;
    const current = epoch;
    const read = ++collaboratorRead;
    collaboratorsLoading.value = true;
    collaboratorsError.value = null;
    try {
      const result = await api.collaborators({ todoId: todo().id });
      if (current !== epoch || read !== collaboratorRead) return;
      if (!result.ok) {
        if (accessLost(result)) {
          collaborators.value = [];
          selectedSubjects.value = [];
        }
        collaboratorsError.value = result.message || '协助人读取失败，请重试。';
        return;
      }
      // 响应到达时再判草稿：集合与版本一起接纳，不能替未保存编辑推进基线。
      if (!collaboratorsDirty.value) {
        collaborators.value = result.collaborators;
        version.value = result.version;
        selectedSubjects.value = result.collaborators.map((item) => item.subject);
      }
    } catch {
      if (current === epoch && read === collaboratorRead)
        collaboratorsError.value = '协助人读取失败，请重试。';
    } finally {
      if (current === epoch && read === collaboratorRead) collaboratorsLoading.value = false;
    }
  }

  async function loadComments(more = false): Promise<void> {
    if (more && (commentsLoading.value || nextCursor.value === null)) return;
    const current = epoch;
    const read = ++commentRead;
    commentsLoading.value = true;
    commentsError.value = null;
    try {
      const result = await api.comments({
        todoId: todo().id,
        limit: 20,
        ...(more ? { beforeId: nextCursor.value } : {}),
      });
      if (current !== epoch || read !== commentRead) return;
      if (!result.ok) {
        if (accessLost(result)) {
          comments.value = [];
          nextCursor.value = null;
        }
        commentsError.value = result.message || '评论读取失败，请重试。';
        return;
      }
      const all = more ? [...comments.value, ...result.comments] : result.comments;
      comments.value = [...new Map(all.map((item) => [item.id, item])).values()];
      nextCursor.value = result.nextCursor;
    } catch {
      if (current === epoch && read === commentRead) commentsError.value = '评论读取失败，请重试。';
    } finally {
      if (current === epoch && read === commentRead) commentsLoading.value = false;
    }
  }

  async function saveCollaborators(): Promise<void> {
    if (
      !canEditCollaborators.value ||
      savingCollaborators.value ||
      collaboratorsLoading.value ||
      collaboratorsError.value
    )
      return;
    const subjects = [...new Set(selectedSubjects.value)];
    if (subjects.length > 20) {
      collaboratorSaveError.value = '协助人最多20人。';
      return;
    }
    const current = epoch;
    const payload = { todoId: todo().id, expectedVersion: version.value, subjects };
    if (
      !collaboratorAttempt ||
      JSON.stringify({ ...collaboratorAttempt, clientRequestId: undefined }) !==
        JSON.stringify(payload)
    ) {
      collaboratorAttempt = { ...payload, clientRequestId: crypto.randomUUID() };
    }
    savingCollaborators.value = true;
    collaboratorSaveError.value = null;
    const attempt = collaboratorAttempt;
    try {
      const result = await api.replaceCollaborators(attempt);
      if (current !== epoch) return;
      if (!result.ok) {
        if (result.serverCode === 'version_conflict' || result.currentVersion !== null) {
          collaboratorAttempt = null;
          selectedSubjects.value = collaborators.value.map((item) => item.subject);
          await loadCollaborators();
          if (current !== epoch) return;
        }
        collaboratorSaveError.value = result.message || '协助人保存失败，请核对后重试。';
        return;
      }
      collaborators.value = result.collaborators;
      collaboratorRead += 1;
      collaboratorsLoading.value = false;
      selectedSubjects.value = result.collaborators.map((item) => item.subject);
      version.value = result.version;
      collaboratorAttempt = null;
      collaboratorsError.value = null;
      onVersionChanged?.({ previousVersion: attempt.expectedVersion, version: result.version });
    } catch {
      if (current === epoch) collaboratorSaveError.value = '协助人保存失败，请重试。';
    } finally {
      if (current === epoch) savingCollaborators.value = false;
    }
  }

  async function sendComment(): Promise<void> {
    if (
      !canComment.value ||
      sending.value ||
      !bodyMd.value.trim() ||
      [...bodyMd.value].length > 20_000
    )
      return;
    const current = epoch;
    const payload = { todoId: todo().id, bodyMd: bodyMd.value, refs: [...refs.value] };
    if (
      !commentAttempt ||
      JSON.stringify({ ...commentAttempt, clientRequestId: undefined }) !== JSON.stringify(payload)
    ) {
      commentAttempt = { ...payload, clientRequestId: crypto.randomUUID() };
    }
    sending.value = true;
    submitError.value = null;
    try {
      const result = await api.createComment(commentAttempt);
      if (current !== epoch) return;
      if (!result.ok) {
        submitError.value = result.message || '评论发送失败，草稿已保留。';
        return;
      }
      bodyMd.value = '';
      refs.value = [];
      commentAttempt = null;
      await loadComments();
    } catch {
      if (current === epoch) submitError.value = '评论发送失败，草稿已保留。';
    } finally {
      if (current === epoch) sending.value = false;
    }
  }

  watch(
    scope,
    () => {
      epoch += 1;
      collaboratorRead += 1;
      commentRead += 1;
      collaborators.value = [];
      selectedSubjects.value = [];
      comments.value = [];
      nextCursor.value = null;
      bodyMd.value = '';
      refs.value = [];
      version.value = todo().version;
      commentAttempt = null;
      collaboratorAttempt = null;
      collaboratorsError.value =
        collaboratorSaveError.value =
        commentsError.value =
        submitError.value =
          null;
      savingCollaborators.value = sending.value = false;
      void loadCollaborators();
      void loadComments();
    },
    { immediate: true, flush: 'sync' },
  );

  const unsubscribe = projectCollabApi.onEvent((event) => {
    if (event.kind !== 'todo.changed' || event.projectId !== projectId()) return;
    const payload = event.payload;
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload.todo_id !== todo().id
    )
      return;
    void loadCollaborators();
    void loadComments();
  });
  onBeforeUnmount(() => {
    epoch += 1;
    unsubscribe?.();
  });

  return {
    collaborators,
    selectedSubjects,
    version,
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
  };
}
