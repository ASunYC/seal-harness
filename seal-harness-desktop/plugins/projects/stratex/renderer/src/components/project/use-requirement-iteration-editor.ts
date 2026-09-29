import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';

import type { Todo } from '@shared/protocol/project-collab.js';
import type { ProjectIterationListItem } from '@shared/protocol/project-planning.js';
import type { ProjectRequirementScheduleSaveRequest } from '@shared/protocol/project-planning-schedule.js';

import { useProjectCollabStore } from '../../stores/projectCollab';
import type { RequirementIterationEditorResult } from '../../stores/projectCollabRequirementSchedule';

type Candidate = Extract<RequirementIterationEditorResult, { ok: true }>['candidate'];

export interface RequirementIterationEditor {
  readonly selection: Ref<string>;
  readonly iterations: Ref<readonly ProjectIterationListItem[]>;
  readonly loading: Ref<boolean>;
  readonly message: Ref<string>;
  readonly pending: Ref<boolean>;
  readonly inFlight: Ref<boolean>;
  readonly invalidated: Ref<boolean>;
  readonly conflict: Ref<boolean>;
  readonly dirty: ComputedRef<boolean>;
  readonly editable: ComputedRef<boolean>;
  readonly ready: ComputedRef<boolean>;
  readonly candidate: Ref<Candidate | null>;
  readonly valid: () => boolean;
  readonly load: (confirm?: boolean) => Promise<void>;
  readonly save: (version: number) => Promise<boolean>;
}

/** 排期草稿与不确定请求只属于本次打开的编辑器，不能跨项目或对象复用。 */
export function useRequirementIterationEditor(props: {
  readonly projectId: string;
  readonly todo: Todo | null;
}): RequirementIterationEditor {
  const store = useProjectCollabStore();
  const identity = {
    projectId: props.projectId,
    todoId: props.todo?.id,
    epoch: store.projectEpoch,
    subject: store.mySubject,
  };
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const valid = (): boolean =>
    !disposed &&
    props.projectId === identity.projectId &&
    props.todo?.id === identity.todoId &&
    store.projectEpoch === identity.epoch &&
    store.mySubject === identity.subject &&
    store.activeProjectId === identity.projectId;
  const editable = computed(
    () => valid() && props.todo?.itemKind === 'requirement' && store.canManagePlanning,
  );
  const candidate = ref<Candidate | null>(null);
  const selection = ref('');
  const iterations = ref<readonly ProjectIterationListItem[]>([]);
  const loading = ref(false);
  const message = ref('');
  const conflict = ref(false);
  const pending = ref(false);
  const inFlight = ref(false);
  const invalidated = ref(false);
  let request: ProjectRequirementScheduleSaveRequest | null = null;
  let initialized = false;
  let confirmedScheduleVersion: number | null = null;
  const dirty = computed(
    () =>
      candidate.value !== null &&
      selection.value !== (candidate.value.placement?.iterationId ?? ''),
  );
  const ready = computed(
    () =>
      !invalidated.value &&
      !loading.value &&
      !conflict.value &&
      (!dirty.value || (editable.value && candidate.value !== null)),
  );

  async function load(confirm = false): Promise<void> {
    if (invalidated.value || !editable.value || !identity.todoId || pending.value || loading.value)
      return;
    loading.value = true;
    const result = await store.loadRequirementIterationEditor(identity.projectId, identity.todoId);
    if (!valid()) return;
    loading.value = false;
    if (!result.ok) {
      message.value = result.message;
      return;
    }
    candidate.value = result.candidate;
    iterations.value = result.iterations.filter((row) => row.archivedAt === null);
    if (!initialized) selection.value = result.candidate.placement?.iterationId ?? '';
    initialized = true;
    if (confirm) {
      if (conflict.value) confirmedScheduleVersion = result.candidate.version;
      conflict.value = false;
      request = null;
    }
    message.value = confirm ? '已读取最新安排，请核对保留的选择后再次保存。' : '';
  }

  async function save(version: number): Promise<boolean> {
    if (invalidated.value || inFlight.value) return false;
    if (!pending.value && !dirty.value) return true;
    if (!editable.value || !candidate.value || conflict.value) return false;
    if (!request) {
      const target = iterations.value.find((row) => row.id === selection.value);
      if (selection.value && !target) {
        message.value = '所选迭代不可用，请重新读取后选择。';
        return false;
      }
      request = {
        projectId: identity.projectId,
        milestoneId: target?.milestoneId ?? candidate.value.placement?.milestoneId ?? null,
        clientRequestId: crypto.randomUUID(),
        items: [
          {
            requirementId: candidate.value.requirementId,
            iterationId: selection.value || null,
            expectedRequirementVersion: Math.max(version, confirmedScheduleVersion ?? version),
            expectedIterationId: candidate.value.placement?.iterationId ?? null,
          },
        ],
      };
      // 目标是未挂里程碑的迭代时，不得回退到原里程碑。
      if (target) request = { ...request, milestoneId: target.milestoneId };
    }
    pending.value = true;
    inFlight.value = true;
    try {
      const result = await store.saveRequirementIterationEditor(request);
      if (!valid() || !editable.value || invalidated.value) return false;
      if (result.outcome === 'ok') {
        pending.value = false;
        request = null;
        return true;
      }
      message.value = result.notice?.message ?? '迭代安排未保存，请重试。';
      // 网络失败可能已经落库；保持原号、原负载，先解析本次结果再允许改草稿。
      if (result.outcomeUnknown) return false;
      pending.value = false;
      conflict.value = result.outcome === 'conflict';
      request = null;
      return false;
    } catch {
      if (valid() && !invalidated.value)
        message.value = '迭代安排结果尚未确认，请保存重试原请求；确认前不能修改草稿。';
      return false;
    } finally {
      inFlight.value = false;
    }
  }
  watch(
    editable,
    (value) => {
      if (!value && pending.value) {
        invalidated.value = true;
        message.value =
          '权限或项目状态已变化，不能继续保存。可退出并放弃本地剩余草稿；已发出的排期可能成功，退出不代表撤销，请恢复权限后核对实际安排。';
      }
      if (value && !initialized) void load();
    },
    { immediate: true, flush: 'sync' },
  );
  return {
    selection,
    iterations,
    loading,
    message,
    pending,
    inFlight,
    invalidated,
    conflict,
    dirty,
    editable,
    ready,
    candidate,
    valid,
    load,
    save,
  };
}
