<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  PROJECT_TODO_MAX_TITLE_LENGTH,
  isTodoAssignedToAssistant,
  isTodoWorkOrder,
  todoConstraints,
  todoParentId,
  todoSource,
  todoVisibility,
} from '@shared/protocol/project-collab.js';
import type {
  Todo,
  TodoAssigneeKind,
  TodoPriority,
  TodoStatus,
  TodoVisibility,
} from '@shared/protocol/project-collab.js';

import ProjectTodoParentFields from './ProjectTodoParentFields.vue';
import ProjectTodoPlanDatesFields from './ProjectTodoPlanDatesFields.vue';

import ReferenceIdCopy from '../ui/ReferenceIdCopy.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import ProjectTodoCollaboration from './ProjectTodoCollaboration.vue';
import { advanceTodoCollaborationDraftVersion } from './todo-collaboration-draft-version';
import ProjectTodoRelationsEditor from './ProjectTodoRelationsEditor.vue';
import ProjectTodoSpecificationFields from './ProjectTodoSpecificationFields.vue';
import ProjectTodoClassificationFields from './ProjectTodoClassificationFields.vue';
import ProjectRequirementIterationField from './ProjectRequirementIterationField.vue';
import { useRequirementIterationEditor } from './use-requirement-iteration-editor';
import {
  TODO_ASSIGNEE_CLAIM_ACTION_LABEL,
  TODO_ASSIGNEE_CLAIM_BLOCKED_HINT,
  TODO_ASSIGNEE_CLAIM_HINT,
  TODO_ASSIGNEE_FROZEN_HINT,
  TODO_ASSISTANT_ASSIGNEE_LABEL,
  TODO_ASSISTANT_DISPATCH_HINT,
  TODO_PERSONAL_HINT,
  TODO_PRIORITY_LABELS,
  TODO_SOURCE_LABELS,
  TODO_STATUS_LABELS,
  TODO_UNASSIGNED_LABEL,
  TODO_UNASSIGNED_OK_HINT,
  TODO_VISIBILITY_LABELS,
  TODO_VISIBILITY_LOCKED_HINT,
  TODO_VISIBILITY_ORDER,
} from './project-format';
import { appendRef, referenceCandidates, removeRef, resolveRefLabel } from './project-refs';
import type { ProjectRefTarget } from './project-refs';
import {
  todoAssigneeMemberOptions,
  todoAssigneeOffersAssistant,
  todoSelfAssignNeedsClaimEntry,
} from './todo-assignee';
import { useTodoParentSearch } from './useTodoParentSearch';
import { todoStatusOptions } from './todo-status-flow';
import { WORK_ORDER_NO_DIRECT_DONE_HINT } from './work-order';
import { requirementPlacementText } from './planning-form-view';
import TodoSpecAssistBar from './TodoSpecAssistBar.vue';
import {
  SPEC_ASSIST_LOADING_HINT,
  SPEC_ASSIST_REVIEW_FROZEN_HINT,
  SPEC_ASSIST_TITLE_REQUIRED_HINT,
  specAssistReadinessHint,
} from './todo-spec-assist';
import { useTodoSpecAssist } from './use-todo-spec-assist';
import { useTodoSpecAssistFill } from './use-todo-spec-assist-fill';
import { useProjectCollabStore } from '../../stores/projectCollab';

/** `todo === null` 为新建；非空为编辑（乐观锁版本取自该快照）。 */
const props = defineProps<{
  projectId: string;
  todo: Todo | null;
  /** 新建时预置的上级需求（从任务页/某条需求下发起时带上）。 */
  defaultParentId?: string | null;
  /** 新建时必须挂在某条需求下（任务页）——不给「作为需求」这个选项。 */
  requireParent?: boolean;
  /** 从文档入口预填的标题，允许用户修改。 */
  defaultTitle?: string;
  /** 从文档入口带来的资产引用，保存时一并提交。 */
  defaultRefs?: readonly string[];
}>();
const emit = defineEmits<{
  close: [];
  openRef: [ProjectRefTarget];
  openMilestones: [string | null];
  /**
   * 成员把未认领的需求接到自己名下（`todoSelfAssignNeedsClaimEntry`）。**只冒泡，不自己认领**——
   * 认领对话框（填计划日期、抢输一方拿真实失败）挂在看板壳层上；壳层收起本框再开它，两层模态不叠。
   */
  claim: [Todo];
}>();

const store = useProjectCollabStore();
const iterationEditor = useRequirementIterationEditor(props);
const savedContentFingerprint = ref<string | null>(null);
const partialSaveMessage = ref('');
const contentConflict = ref(false);
const dismissed = ref(false);
const openedIdentity = {
  projectId: props.projectId,
  todoId: props.todo?.id,
  epoch: store.projectEpoch,
  activeProjectId: store.activeProjectId,
  subject: store.mySubject,
};
const saveIdentityValid = (): boolean =>
  !dismissed.value &&
  props.projectId === openedIdentity.projectId &&
  props.todo?.id === openedIdentity.todoId &&
  store.projectEpoch === openedIdentity.epoch &&
  store.activeProjectId === openedIdentity.activeProjectId &&
  store.mySubject === openedIdentity.subject &&
  store.canWrite &&
  !store.isArchived;
async function refreshIteration(): Promise<void> {
  await iterationEditor.load(true);
}
const collaborationBusy = ref(false);
const editVersion = ref(props.todo?.version ?? 1);
function collaborationVersionChanged(change: { previousVersion: number; version: number }): void {
  editVersion.value = advanceTodoCollaborationDraftVersion(editVersion.value, change);
}

/** 当前排期来自服务端；选择只是草稿，保存成功前不伪装成权威关联。 */
const placementLookup = computed(() =>
  props.todo?.itemKind === 'requirement'
    ? (store.requirementPlacementLookups[props.todo.id] ?? null)
    : null,
);
const placementLine = computed(() => {
  const lookup = placementLookup.value;
  if (lookup?.error) return lookup.error.message;
  if (!lookup?.loaded) return '正在读取迭代信息…';
  return requirementPlacementText(lookup.placement);
});
if (props.todo?.itemKind === 'requirement') {
  void store.loadRequirementPlacementLookup(props.projectId, props.todo.id);
}
function openInMilestones(): void {
  if (busy.value || hasUnsavedChanges.value || iterationEditor.pending.value) return;
  emit('openMilestones', placementLookup.value?.placement?.milestoneId ?? null);
  emit('close');
}

const title = ref(props.todo?.title ?? props.defaultTitle ?? '');
const status = ref<TodoStatus>(props.todo?.status ?? 'notStarted');
/** 下拉值：空串为未分配，专用值为项目助理，其余为成员 subject。 */
const ASSISTANT_OPTION = '__assistant__';
/** 打开弹窗时的处理人取值：判「这次改没改处理人」的基线（没改就不发处理人字段）。 */
const initialAssignee =
  props.todo === null
    ? ''
    : isTodoAssignedToAssistant(props.todo)
      ? ASSISTANT_OPTION
      : (props.todo.assigneeSubject ?? '');
const assignee = ref(initialAssignee);

/** 下拉的一个取值 → 契约的两个字段。  */
function assigneeFields(value: string): {
  readonly assigneeKind: TodoAssigneeKind;
  readonly assigneeSubject: string | null;
} {
  if (value === ASSISTANT_OPTION) return { assigneeKind: 'assistant', assigneeSubject: null };
  return { assigneeKind: 'member', assigneeSubject: value || null };
}
const priority = ref<TodoPriority>(props.todo?.priority ?? 'medium');
const moduleId = ref(props.todo?.moduleId);
const categoryId = ref(props.todo?.categoryId);
const dictionariesReady = ref(false);
const dictionariesChanged = computed(
  () => moduleId.value !== props.todo?.moduleId || categoryId.value !== props.todo?.categoryId,
);
/** 打开时的起止日键（编辑时判「日期改没改」用；新建为空串）。 */
const originalStartDate = props.todo?.startAt ? props.todo.startAt.slice(0, 10) : '';
const originalDueDate = props.todo?.dueAt ? props.todo.dueAt.slice(0, 10) : '';
const startDate = ref(originalStartDate);
const dueDate = ref(originalDueDate);
const description = ref(props.todo?.description ?? '');
/**
 * 关联材料（G-10）：整数组替换语义，编辑期先在本地攒，保存时一次带上。
 * 新建时可由「从一份文档开始」预挂一份资产（`defaultRefs`）。
 */
const refs = ref<readonly string[]>(props.todo?.refs ?? props.defaultRefs ?? []);
/** 关联会话只读展示 + 可解绑：客户端这一侧没有「挑一个会话」的入口，不假装有。 */
const sessionRef = ref<string | null>(props.todo?.sessionRef ?? null);
const busy = ref(false);

/** 工作单面：注意事项（边界）+ 验收清单（怎么算做完）。  */
const constraintsText = ref(props.todo ? todoConstraints(props.todo) : '');
const acceptanceItems = ref<readonly string[]>([]);
/** 服务端那份判据正文的快照，用来判「这次改没改清单」（脏了才发那一次请求）。 */
const acceptanceBaseline = ref<readonly string[]>([]);
/** 编辑既有工作单时判据正文要现取——列表出参只带计数，正文只在 detail 里。 */
const acceptanceLoading = ref(false);

/**
 * 待验收中的单**不许改判据**（服务端同判）：验收方正对着这份清单逐条核对，
 * 中途换判据等于把已经交出去的活重新定义。
 */
const acceptanceFrozen = computed(() => props.todo?.status === 'inReview');

const trimmedAcceptance = computed(() =>
  acceptanceItems.value.map((text) => text.trim()).filter((text) => text.length > 0),
);

const acceptanceDirty = computed(
  () =>
    trimmedAcceptance.value.length !== acceptanceBaseline.value.length ||
    trimmedAcceptance.value.some((text, index) => text !== acceptanceBaseline.value[index]),
);

/** 这次保存之后它会不会是一张工作单——判据只有「清单里有没有写了字的条目」这一条。 */
const willBeWorkOrder = computed(() => trimmedAcceptance.value.length > 0);

/** 状态下拉的可选档跟着**清单当下的样子**走，不跟着服务端那份旧快照走： 用户刚在这张表单上加了第一条判据，「已完成」就该当场消失——等保存完再收窄， */
const statusOptions = computed(() =>
  todoStatusOptions({
    acceptanceTotal: willBeWorkOrder.value ? trimmedAcceptance.value.length : 0,
    status: status.value,
  }),
);

/**
 * `''` ＝根项；uuid ＝直接父项。业务种类由 itemKind 独立决定。
 */
const parentId = ref<string>(
  props.todo ? (todoParentId(props.todo) ?? '') : (props.defaultParentId ?? ''),
);

/**
 * 可见性只在**新建**时可选。契约刻意没放开翻转（谁有权把一条协同待办藏成个人的？
 * 未拍板不做半截），所以编辑态只读展示 + 一句交代。
 */
const visibility = ref<TodoVisibility>(props.todo ? todoVisibility(props.todo) : 'shared');

/**
 * 来源**恒不给用户选**：它答的是「这张单是谁建的」，由建单方声明，界面建的恒为
 * 「手动创建」（＝服务端缺省，请求里连键都不带）。做成下拉就等于让用户去伪造留痕。
 */
const sourceLabel = computed(
  () => TODO_SOURCE_LABELS[props.todo ? todoSource(props.todo) : 'manual'],
);

const itemKind = computed(
  () => props.todo?.itemKind ?? (props.requireParent ? 'task' : 'requirement'),
);

/**
 * 未认领的协同需求上「我」给不给：manager+ 照常给（服务端按认领落库，负责人 2026-09-14 拍板）；
 * 判不出是不是添加人的成员改给认领入口（判据与取舍见 `todoSelfAssignNeedsClaimEntry`）。
 */
const claimEntry = computed(() => todoSelfAssignNeedsClaimEntry(props.todo, store.canTransferTodo));

/**
 * 处理人下拉的成员候选：在册且成员及以上（观察者只读，服务端 400 `assignee_not_editor`）。
 * 当前处理人例外保留，旧行打开时才显示得出当前值（判据见 `todo-assignee.ts`）。
 */
const members = computed(() => {
  const options = todoAssigneeMemberOptions(
    store.detail?.members ?? [],
    props.todo?.assigneeSubject ?? null,
  );
  // 走认领入口的成员：「我」对非添加人必然 403，不摆这一项（派给别人照常）。
  return claimEntry.value
    ? options.filter((member) => member.subject !== store.mySubject)
    : options;
});

/**
 * 需求不给「项目助理」这一档（服务端 400 `requirement_assistant_forbidden`：需求不是规格，
 * 唯一出口是拆解）。存量「需求 + 助理档」旧行保留这一项，好让当前值显示得出来、能改回成员。
 */
const offersAssistant = computed(() =>
  todoAssigneeOffersAssistant(itemKind.value, props.todo?.assigneeKind ?? null),
);

/** 处理人这一格这次有没有动（编辑态据此决定发不发处理人字段）。 */
const assigneeChanged = computed(() => assignee.value !== initialAssignee);

function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

/** 编辑框里有没有**未保存的改动**（新建恒为 false：还没有「这条需求」可认领）。  */
const hasUnsavedChanges = computed(() => {
  const todo = props.todo;
  if (todo === null) return false;
  return (
    title.value.trim() !== todo.title.trim() ||
    status.value !== todo.status ||
    priority.value !== todo.priority ||
    dictionariesChanged.value ||
    parentId.value !== (todoParentId(todo) ?? '') ||
    assigneeChanged.value ||
    startDate.value !== originalStartDate ||
    dueDate.value !== originalDueDate ||
    description.value !== (todo.description ?? '') ||
    sessionRef.value !== (todo.sessionRef ?? null) ||
    !sameRefs(refs.value, todo.refs ?? []) ||
    constraintsText.value !== todoConstraints(todo) ||
    acceptanceDirty.value ||
    iterationEditor.dirty.value
  );
});

/**
 * 认领入口置灰（主会话 2026-09-14 定）：入口会收起编辑框去开认领对话框，框里有未保存改动时
 * 放行＝悄悄丢掉它们。⇒ 照样显示但置灰，旁边写「请先保存或放弃当前修改，再认领」；没有改动时可点。
 */
const claimBlocked = computed(() => claimEntry.value && hasUnsavedChanges.value);

function claimInstead(): void {
  // 置灰的按钮浏览器不派发点击；这里再挡一次，别让改动在任何路径上被悄悄丢掉。
  if (props.todo === null || claimBlocked.value) return;
  emit('claim', props.todo);
}

/** 父项候选按显式种类矩阵筛选，并排除自己与任意深度后代。 */
const parentSearch = useTodoParentSearch({
  projectId: () => props.projectId,
  itemKind: () => itemKind.value,
  todoId: () => props.todo?.id,
  parentId,
});
const parentOptions = parentSearch.candidates;
const authorizedTodos = computed(() =>
  store.activeProjectId === props.projectId || store.activeProjectId === null
    ? [...store.todosById.values()].filter(
        (item) => item.projectId === undefined || item.projectId === props.projectId,
      )
    : [],
);

/** 任务页新建但没有任何可用父项：说清下一步去哪做。 */
const parentMissing = computed(
  () =>
    props.todo === null &&
    props.requireParent === true &&
    !parentSearch.loading.value &&
    !parentSearch.error.value &&
    parentOptions.value.length === 0,
);

const dialogTitle = computed(
  () => `${props.todo ? '编辑' : '新建'}${itemKind.value === 'requirement' ? '需求' : '任务'}`,
);

const invalidDateRange = computed(() =>
  Boolean(startDate.value && dueDate.value && startDate.value > dueDate.value),
);

/** 起止成对（CORE-08，ADR-0042）：有开始没截止不能保存。与服务端同一条「只在改动时判」——新建一律判； 编辑只在开始或截止改过时判（按日键比，与服务端按 UTC 日比同一粒度），所以存量「只有开始」的条 */
const startWithoutDue = computed(() => {
  if (!startDate.value || dueDate.value) return false;
  if (props.todo === null) return true;
  return startDate.value !== originalStartDate || dueDate.value !== originalDueDate;
});

const canSave = computed(() => {
  if (contentConflict.value || !saveIdentityValid() || !iterationEditor.ready.value) return false;
  if (dictionariesChanged.value && !dictionariesReady.value) return false;
  if (
    busy.value ||
    collaborationBusy.value ||
    !title.value.trim() ||
    invalidDateRange.value ||
    startWithoutDue.value
  )
    return false;
  // 任务页建单必须落在某条需求下：留空会建出一条需求，而它不会出现在这一页上。
  if (props.todo === null && props.requireParent === true && parentId.value === '') return false;
  return true;
});

const refSources = computed(() => ({
  members: store.detail?.members ?? [],
  files: store.files,
  todos: authorizedTodos.value,
}));

/** 待验收中的单**不许改处理人与档位**（服务端同判，409）：验收方正对着一份规格 逐条核对，中途换执行方等于把已经交出去的活重新定义；它同时是「执行方不能自证 */
const assigneeFrozen = computed(() => props.todo?.status === 'inReview');

/** 可挂的关联材料候选：项目资产与其他待办，去掉已挂的与本条自己。 */
const refOptions = computed(() =>
  referenceCandidates(
    {
      files: store.files,
      todos: authorizedTodos.value.filter((item) => item.id !== props.todo?.id),
    },
    '',
  ).filter((candidate) => !refs.value.includes(candidate.token)),
);

const refChips = computed(() =>
  refs.value.map((token) => ({ token, ...resolveRefLabel(token, refSources.value) })),
);

// 资产列表未必取过（从看板页签直接打开时就没有）——挂材料要有候选可挑。
onMounted(() => {
  if (store.files.length === 0) void store.loadFiles(props.projectId);
  void loadAcceptanceItems();
});

/** 既有工作单的判据正文现取：列表出参只带**计数**（500 条待办 × 20 条判据的正文会 把响应打爆），正文只在 `project:todo-detail` 里。取不到就让编辑器空着并保持 */
async function loadAcceptanceItems(): Promise<void> {
  const todo = props.todo;
  if (todo === null || !isTodoWorkOrder(todo)) return;
  acceptanceLoading.value = true;
  try {
    const detail = await store.loadTodoDetail(todo.id);
    if (detail === null) return;
    const texts = detail.acceptanceItems.map((item) => item.text);
    acceptanceItems.value = texts;
    acceptanceBaseline.value = texts;
  } finally {
    acceptanceLoading.value = false;
  }
}

/** 清单一从空变成非空，这条就成了工作单——「已完成」当场从可选档里消失， 而下拉里可能正停在它上面。把它挪到「进行中」，别把一个必被服务端拒的值 */
watch(willBeWorkOrder, (isWorkOrderNow) => {
  if (isWorkOrderNow && status.value === 'done') status.value = 'inProgress';
});

function attachRef(token: string): void {
  if (token) refs.value = appendRef(refs.value, token);
}

async function save(): Promise<void> {
  const trimmedTitle = title.value.trim();
  if (!canSave.value) return;
  // 点了保存＝以表单当下的值为准：在途的补全结果不再回填（ADR-0043）。
  specAssist.cancel();
  busy.value = true;
  try {
    if (iterationEditor.pending.value) {
      if (await iterationEditor.save(editVersion.value)) {
        if (saveIdentityValid()) emit('close');
      }
      return;
    }
    if (props.todo === null) {
      const created = await store.createTodo({
        projectId: props.projectId,
        itemKind: itemKind.value,
        title: trimmedTitle,
        status: status.value,
        priority: priority.value,
        ...(moduleId.value ? { moduleId: moduleId.value } : {}),
        ...(categoryId.value ? { categoryId: categoryId.value } : {}),
        // 挂靠与可见性都是用户在这张表单上做的选择，所以显式带上。
        // ⛔ `source` 一个键都不带：界面建的恒为服务端缺省 manual，
        //    把它做成参数就等于让调用方（进而用户）去声明一条可伪造的留痕。
        ...(parentId.value ? { parentId: parentId.value } : {}),
        visibility: visibility.value,
        // 处理人：档位与人一起给（下拉的三档在这里拆回契约的两个字段）。
        // ⛔ 缺省 member + 未分配时一个键都不带——那与「没给」在服务端是同一件事。
        ...(assignee.value
          ? {
              assigneeKind: assigneeFields(assignee.value).assigneeKind,
              ...(assigneeFields(assignee.value).assigneeSubject !== null
                ? { assigneeSubject: assigneeFields(assignee.value).assigneeSubject as string }
                : {}),
            }
          : {}),
        ...(startDate.value ? { startAt: startDate.value } : {}),
        ...(dueDate.value ? { dueAt: dueDate.value } : {}),
        ...(description.value ? { description: description.value } : {}),
        ...(refs.value.length > 0 ? { refs: [...refs.value] } : {}),
        // 工作单面：给了判据这条就是工作单。⛔ 空数组不发——那与「没给」在服务端
        //    是同一件事，发一个空键只会让请求体多一行噪声。
        ...(constraintsText.value ? { constraintsText: constraintsText.value } : {}),
        ...(willBeWorkOrder.value ? { acceptanceItems: [...trimmedAcceptance.value] } : {}),
      });
      if (created && saveIdentityValid()) emit('close');
      return;
    }
    /** 编辑既有单：验收清单走**独立通道**（整表替换会作废已勾的条目，那是一次语义 明确的动作，不该混在一次普通改单里）。两次写入都带乐观锁，所以顺序是死的—— */
    let expectedVersion = editVersion.value;
    if (acceptanceDirty.value && !acceptanceFrozen.value) {
      const saved = await store.setAcceptanceItems({
        todoId: props.todo.id,
        expectedVersion,
        items: [...trimmedAcceptance.value],
      });
      if (!saveIdentityValid()) return;
      // 清单没换成就别接着改单：接着发会把「判据还是旧的」这件事藏在一次成功里。
      if (saved.outcome !== 'ok' || saved.todo === null) {
        if (saved.outcome === 'conflict') {
          contentConflict.value = true;
          partialSaveMessage.value =
            '验收清单已被他人修改；你的草稿仍保留。请先复制需要保留的内容，再取消并重新打开需求，核对最新内容后重新编辑。';
        }
        return;
      }
      editVersion.value = advanceTodoCollaborationDraftVersion(editVersion.value, {
        previousVersion: expectedVersion,
        version: saved.todo.version,
      });
      expectedVersion = saved.todo.version;
      acceptanceBaseline.value = [...trimmedAcceptance.value];
    }
    if (!saveIdentityValid()) return;
    const content = {
      todoId: props.todo.id,
      expectedVersion,
      // 父项只表达层级，清空时不改变显式业务种类。
      parentId: parentId.value || null,
      title: trimmedTitle,
      status: status.value,
      priority: priority.value,
      ...(moduleId.value !== props.todo.moduleId ? { moduleId: moduleId.value ?? null } : {}),
      ...(categoryId.value !== props.todo.categoryId
        ? { categoryId: categoryId.value ?? null }
        : {}),
      // 待验收或未修改时省略处理人；改派时档位与成员字段必须成对发送。
      ...(assigneeFrozen.value || !assigneeChanged.value ? {} : assigneeFields(assignee.value)),
      ...(startDate.value !== (props.todo.startAt?.slice(0, 10) ?? '')
        ? { startAt: startDate.value || null }
        : {}),
      ...(dueDate.value !== (props.todo.dueAt?.slice(0, 10) ?? '')
        ? { dueAt: dueDate.value || null }
        : {}),
      description: description.value,
      sessionRef: sessionRef.value,
      refs: [...refs.value],
      constraintsText: constraintsText.value,
      // ⛔ 没有 visibility / source：更新契约里就没有这两个键（strictObject 会拒）。
      // ⛔ 也没有 acceptanceItems：它有独立通道，上面已经发过了。
    };
    const fingerprint = JSON.stringify({ ...content, expectedVersion: undefined });
    if (savedContentFingerprint.value !== fingerprint) {
      const saved = await store.updateTodoDetailed(content);
      if (!saveIdentityValid()) return;
      if (saved.outcome !== 'ok') {
        contentConflict.value = saved.outcome === 'conflict';
        if (contentConflict.value)
          partialSaveMessage.value =
            '需求已被他人修改；你的草稿仍保留。请先复制需要保留的内容，再取消并重新打开需求，核对最新内容后重新编辑。';
        return;
      }
      editVersion.value = saved.todo.version;
      savedContentFingerprint.value = fingerprint;
    }
    if (!saveIdentityValid()) return;
    const arranged = await iterationEditor.save(editVersion.value);
    if (!saveIdentityValid() || iterationEditor.invalidated.value) return;
    if (arranged) emit('close');
    else
      partialSaveMessage.value =
        '需求内容已保存，迭代安排未保存。重试不会重复保存已确认的内容；取消仅放弃剩余安排。';
  } finally {
    busy.value = false;
  }
}

/** 「让助理补全」（测试提单 2541，ADR-0043）：助理按标题与已填内容生成目标、验收清单、注意事项 的建议，**只写回本表单的本地字段**；保存仍是上面那一次写请求，一行不改。 */
const specAssist = useTodoSpecAssist({
  // 迟到丢弃的判据：所在项目与登录主体（登出登入是原地换号，视图不卸载）。
  identity: () => ({ projectId: store.activeProjectId, subject: store.mySubject }),
});
const {
  readiness: specAssistReadiness,
  generating: specAssistGenerating,
  error: specAssistError,
} = specAssist;
const specAssistFill = useTodoSpecAssistFill({ description, acceptanceItems, constraintsText });
onMounted(() => {
  void specAssist.refreshReadiness();
});

/** 置灰的原因（null＝可点）。顺序即优先级：先说用户马上能做的那件事。 */
const specAssistBlockedHint = computed((): string | null => {
  if (!title.value.trim()) return SPEC_ASSIST_TITLE_REQUIRED_HINT;
  if (acceptanceFrozen.value) return SPEC_ASSIST_REVIEW_FROZEN_HINT;
  // 既有工作单的判据还没取回来就生成，会把「已有清单」当成空的回填，保存时覆盖服务端清单。
  if (acceptanceLoading.value) return SPEC_ASSIST_LOADING_HINT;
  return specAssistReadinessHint(specAssistReadiness.value);
});
const specAssistDisabled = computed(() => busy.value || specAssistBlockedHint.value !== null);

async function runSpecAssist(): Promise<void> {
  if (specAssistDisabled.value || specAssistGenerating.value) return;
  const parentTitle = parentId.value
    ? parentOptions.value.find((item) => item.id === parentId.value)?.title.trim()
    : undefined;
  const filledAcceptance = trimmedAcceptance.value;
  const suggestion = await specAssist.generate({
    projectId: props.projectId,
    itemKind: itemKind.value,
    title: title.value.trim(),
    ...(parentTitle ? { parentTitle } : {}),
    // 已填的才带（让助理在其基础上补全）；空的不带，与「没给」同义。
    ...(description.value.trim() ? { description: description.value } : {}),
    ...(filledAcceptance.length > 0 ? { acceptanceItems: [...filledAcceptance] } : {}),
    ...(constraintsText.value.trim() ? { constraintsText: constraintsText.value } : {}),
  });
  if (suggestion !== null) specAssistFill.apply(suggestion);
}

/** 关表单即取消在途补全（卸载时组合函数也会兜一次）。 */
function closeDialog(): void {
  if (dismissed.value) return;
  if ((busy.value || iterationEditor.pending.value) && !iterationEditor.invalidated.value) return;
  dismissed.value = true;
  specAssist.cancel();
  emit('close');
}
</script>

<template>
  <ProjectDialogShell :title="dialogTitle" @close="closeDialog">
    <p v-if="partialSaveMessage" role="status">{{ partialSaveMessage }}</p>
    <div class="todo-editor" :inert="busy || iterationEditor.pending.value">
      <section class="todo-editor__section" aria-labelledby="todo-basic-heading">
        <h4 id="todo-basic-heading" class="todo-editor__heading">基本信息</h4>
        <ReferenceIdCopy
          v-if="props.todo?.itemKind === 'requirement'"
          :key="props.todo.id"
          :reference-id="props.todo.id"
          label="需求 ID"
          @click.stop
          @keydown.stop
        />
        <label class="todo-field">
          <span class="todo-field__label">标题</span>
          <input
            v-model="title"
            class="todo-field__input"
            type="text"
            :maxlength="PROJECT_TODO_MAX_TITLE_LENGTH"
            placeholder="要做什么"
          />
        </label>

        <ProjectTodoParentFields
          v-model="parentId"
          v-model:keyword="parentSearch.keyword.value"
          v-model:kind="parentSearch.kind.value"
          :parent-search="parentSearch"
          :parent-options="parentOptions"
          :parent-missing="parentMissing"
          :item-kind="itemKind"
        />

        <div class="todo-grid">
          <label class="todo-field">
            <span class="todo-field__label">状态</span>
            <!-- 可选档跟着「这条是不是工作单」走：填了验收判据，「已完成」当场消失 -->
            <select v-model="status" class="todo-field__input" data-testid="todo-status">
              <option v-for="value in statusOptions" :key="value" :value="value">
                {{ TODO_STATUS_LABELS[value] }}
              </option>
            </select>
            <span
              v-if="willBeWorkOrder"
              class="todo-field__hint"
              data-testid="todo-no-direct-done"
              >{{ WORK_ORDER_NO_DIRECT_DONE_HINT }}</span
            >
          </label>
          <label class="todo-field">
            <span class="todo-field__label">处理人</span>
            <!-- 三档一个下拉：未分配 / 项目助理 / 某位成员。「这活谁去干」在用户脑子里
             就是一个问题，拆成两个控件只会让人先答一个他没想过的问题 -->
            <select
              v-model="assignee"
              class="todo-field__input"
              data-testid="todo-assignee"
              :disabled="assigneeFrozen"
            >
              <option value="">{{ TODO_UNASSIGNED_LABEL }}</option>
              <option v-if="offersAssistant" :value="ASSISTANT_OPTION">
                {{ TODO_ASSISTANT_ASSIGNEE_LABEL }}
              </option>
              <option v-for="member in members" :key="member.subject" :value="member.subject">
                {{ member.displayName || member.subject }}
              </option>
            </select>
            <span
              v-if="assigneeFrozen"
              class="todo-field__hint"
              data-testid="todo-assignee-frozen"
              >{{ TODO_ASSIGNEE_FROZEN_HINT }}</span
            >
            <span
              v-else-if="assignee === ASSISTANT_OPTION"
              class="todo-field__hint"
              data-testid="todo-assignee-assistant"
              >{{ TODO_ASSISTANT_DISPATCH_HINT }}</span
            >
            <!-- 建单时留空是合法的：说一句，免得这一格看起来像必填 -->
            <span
              v-else-if="todo === null && assignee === ''"
              class="todo-field__hint"
              data-testid="todo-assignee-unassigned-ok"
              >{{ TODO_UNASSIGNED_OK_HINT }}</span
            >
            <!-- 成员把未认领需求接到自己名下：给认领入口，不给判不出结果的「我」
             （判据与取舍见 todoSelfAssignNeedsClaimEntry）。按钮是 label 里的交互子元素，
             点它不激活下拉；prevent 兜底。 -->
            <span
              v-else-if="claimEntry"
              class="todo-field__hint"
              data-testid="todo-assignee-claim-hint"
              >{{ claimBlocked ? TODO_ASSIGNEE_CLAIM_BLOCKED_HINT : TODO_ASSIGNEE_CLAIM_HINT }}
              <button
                class="todo-field__link"
                type="button"
                data-testid="todo-assignee-claim"
                :disabled="claimBlocked"
                @click.prevent="claimInstead"
              >
                {{ TODO_ASSIGNEE_CLAIM_ACTION_LABEL }}
              </button></span
            >
          </label>
          <label class="todo-field">
            <span class="todo-field__label">优先级</span>
            <select v-model="priority" class="todo-field__input" data-testid="todo-priority">
              <option v-for="(label, value) in TODO_PRIORITY_LABELS" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </label>
          <div class="todo-field" data-testid="todo-visibility">
            <span class="todo-field__label">可见性</span>
            <!-- 新建时可选；编辑时只读——契约刻意没放开翻转（见 save 里的注释） -->
            <select
              v-if="todo === null"
              v-model="visibility"
              class="todo-field__input"
              data-testid="todo-visibility-select"
            >
              <option v-for="value in TODO_VISIBILITY_ORDER" :key="value" :value="value">
                {{ TODO_VISIBILITY_LABELS[value] }}
              </option>
            </select>
            <p v-else class="todo-field__static" data-testid="todo-visibility-static">
              {{ TODO_VISIBILITY_LABELS[visibility] }}
            </p>
            <span v-if="visibility === 'personal'" class="todo-field__hint">{{
              TODO_PERSONAL_HINT
            }}</span>
            <span v-else-if="todo !== null" class="todo-field__hint">{{
              TODO_VISIBILITY_LOCKED_HINT
            }}</span>
          </div>
          <div class="todo-field" data-testid="todo-source">
            <span class="todo-field__label">来源</span>
            <!-- 只读：来源是建单当时的留痕，可改就不是留痕了 -->
            <p class="todo-field__static">{{ sourceLabel }}</p>
          </div>
        </div>
        <ProjectTodoPlanDatesFields
          v-model:start-date="startDate"
          v-model:due-date="dueDate"
          :start-without-due="startWithoutDue"
          :invalid-date-range="invalidDateRange"
        />
      </section>
      <section class="todo-editor__section" aria-labelledby="todo-spec-heading">
        <h4 id="todo-spec-heading" class="todo-editor__heading">
          {{ itemKind === 'requirement' ? '需求说明与验收' : '任务说明与验收' }}
        </h4>
        <!-- 「让助理补全」（2541，ADR-0043）：建议只写回下面三段的本地字段，保存照旧 -->
        <TodoSpecAssistBar
          :disabled="specAssistDisabled"
          :hint="specAssistBlockedHint"
          :generating="specAssistGenerating"
          :error="specAssistError"
          @run="runSpecAssist"
          @cancel="specAssist.cancel()"
        />
        <ProjectTodoSpecificationFields
          v-model:description="description"
          v-model:constraints-text="constraintsText"
          v-model:acceptance-items="acceptanceItems"
          :acceptance-loading="acceptanceLoading"
          :acceptance-frozen="acceptanceFrozen"
          :show-acceptance-reset="acceptanceDirty && todo !== null && acceptanceBaseline.length > 0"
          :spec-assist-fill="specAssistFill"
        />
      </section>
      <ProjectTodoClassificationFields
        v-if="itemKind === 'requirement'"
        v-model:module-id="moduleId"
        v-model:category-id="categoryId"
        :project-id="projectId"
        :todo="todo"
        @ready="dictionariesReady = $event"
      >
        <ProjectRequirementIterationField
          :editor="iterationEditor"
          :is-new="todo === null"
          :busy="busy"
          :placement-line="placementLine"
          @open="openInMilestones"
          @refresh="refreshIteration"
          @select="iterationEditor.selection.value = $event"
        />
      </ProjectTodoClassificationFields>
      <ProjectTodoRelationsEditor
        :ref-chips="refChips"
        :ref-sources="refSources"
        :ref-options="refOptions"
        :ref-count="refs.length"
        :session-ref="sessionRef"
        :editing="todo !== null"
        @open-ref="emit('openRef', $event)"
        @attach="attachRef"
        @remove="refs = removeRef(refs, $event)"
        @unbind="sessionRef = null"
      />
    </div>

    <ProjectTodoCollaboration
      v-if="props.todo"
      :project-id="props.projectId"
      :todo="props.todo"
      @open-ref="emit('openRef', $event)"
      @version-changed="collaborationVersionChanged"
      @busy="collaborationBusy = $event"
    />

    <template #foot>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="(busy || iterationEditor.pending.value) && !iterationEditor.invalidated.value"
        @click="closeDialog"
      >
        取消
      </button>
      <button class="btn btn--primary" type="button" :disabled="!canSave" @click="save">
        保存
      </button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
