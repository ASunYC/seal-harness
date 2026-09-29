<script setup lang="ts">
import { computed } from 'vue';

import { isTodoWorkOrder } from '@shared/protocol/project-collab.js';
import type { Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import {
  TODO_DELETE_ACTION_LABEL,
  TODO_LOCKED_HINT,
  TODO_OPEN_EXECUTION_LABEL,
  TODO_STATUS_LABELS,
} from './project-format';
import { canClaimRequirement, decomposeTargetsFor } from './requirement-actions';
import {
  REQUIREMENT_DECOMPOSE_ACTION_LABEL,
  TASK_DECOMPOSE_ACTION_LABEL,
  TODO_DECOMPOSE_HINT,
} from './todo-decompose';
import { changeTodoStatus, todoStatusOptions } from './todo-status-flow';
import type { TodoScope } from './todo-hierarchy';
import { acceptanceProgressText } from './work-order';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 一条待办的**呈现件**——状态药丸（可改状态）＋ 工作单入口 ＋ 收窄说明。
 * 看板卡与表格行共用**同一份**，判据一改两处同步。
 *
 * ⚠️ 「编辑」不再是一个按钮：点行 / 点卡的空白承载区直接打开——需求进单屏详情（UX-02，
 * 编辑是详情里的动作），任务进编辑（命中区归属在调用方 ProjectTodoTable / ProjectBoardPane
 * 里判）。本组件只出**交互控件**——状态下拉、工作单按钮——它们各自吃掉自己的点击，
 * 所以点在它们身上不会误触打开。
 *
 * 状态从「操作列的一个下拉」升为**状态列里那枚药丸本身**：药丸即编辑入口
 * （原生 `<select>` 透明浮在药丸上，键盘与读屏走原生 combobox，鼠标点药丸即展开）。
 * 这样「状态」在表格里只出现一次——原先状态列显示、操作列又挂一个下拉的重复没了。
 *
 * `variant` 决定出哪几件（同一份组件按位置裁剪，不复制药丸/工作单两处 markup）：
 *  - `card`   看板卡：药丸 + 工作单 + 收窄说明（竖排在卡底）；
 *  - `status` 表格「状态」列：只出药丸；
 *  - `flow`   表格「操作」列：只出工作单 + 收窄说明（状态已在状态列，这里不重复）。
 *
 * 入口按对象级判定收窄（G-11）：成员对**他人名下**的单，药丸退化为只读、不出下拉，
 * 并给一行说明。⚠️ 这是**入口收窄不是权限**——服务端仍按令牌强判 403。
 */
type TodoRowActionsVariant = 'card' | 'status' | 'flow';

/**
 * `page` ＝这一行长在哪个页签上，决定拆解目标与认领/提测入口的收窄（FLOW-01 判据 2）：
 *  - `requirement` 需求池：只出「拆需求」（拆解目标＝子需求）＋ 无主需求出「认领」；
 *  - `task`        任务页：只出「拆任务」（拆解目标＝子任务）；「整需求提测」属测试线，见报告；
 *  - `all` / 省略（独立挂表）：保持两个拆解入口都在的旧行为，认领不出（无页签语境）。
 * ⚠️ 两页各自的行操作集合是**判据 2 的载体**：在这里按 `page` 收窄，别散到调用方模板里
 *    （散出去两个视图/两个页各筛各的，迟早漂移）。`page` 复用 `TodoScope`（`all` 等同省略）。
 */
const props = withDefaults(
  defineProps<{ todo: Todo; variant?: TodoRowActionsVariant; page?: TodoScope }>(),
  {
    variant: 'card',
  },
);
// 合并说明：main 侧此处还有 `edit`，本分支已把「编辑」改为点行/点卡直接触发（操作列不再
// 摆按钮），故 edit 有意不再向上冒；`openExecution` 是 main 新增的能力，照收。
const emit = defineEmits<{
  workOrder: [Todo];
  openExecution: [string];
  /**
   * 需求行上的「让助理拆解」。**只冒泡，不自己发**——发送要用项目助理面板里那个常驻会话框
   * （同一条链路），而它挂在项目页壳层上，行组件够不着也不该够着。
   */
  decompose: [Todo, TodoItemKind];
  /**
   * 「删除」。**只冒泡，不自己删**——确认框（级联条数、壳内确认态）与删除调用挂在
   * 项目页壳层上，行组件够不着；这里只在够格时出这个入口。
   */
  delete: [Todo];
  /**
   * 需求池上的「认领」（FLOW-01 / FLOW-02）。**只冒泡，不自己认领**——认领对话框
   * （填计划日期、抢输一方拿真实失败）挂在项目页壳层上，行组件够不着，也不该就地写。
   */
  claim: [Todo];
}>();

const store = useProjectCollabStore();

/** 能不能改这条：决定药丸是可编辑（带下拉）还是只读，以及收窄说明出不出。 */
const editable = computed(() => store.canEditTodo(props.todo));
/** 有写权限但改不动这一条（他人名下）＝要给一行说明，而不是留一块空白。 */
const locked = computed(() => store.canWrite && !editable.value);

/**
 * 「是不是工作单」由有没有验收清单派生（`isTodoWorkOrder`），⛔ 不看任何标记字段。
 * 有清单时显示工作单入口；无清单但处于待验收时也要能进入既有验收与打回流程。
 */
const isWorkOrder = computed(() => isTodoWorkOrder(props.todo));
const acceptance = computed(() => acceptanceProgressText(props.todo));

/**
 * 状态下拉的可选档由 `todoStatusOptions` 收窄——⛔ 别在模板里直接铺
 * `TODO_STATUS_ORDER`：有验收清单的单不能从这条路直跳「已完成」。
 */
const statusOptions = computed(() => todoStatusOptions(props.todo));

/** card / status 出药丸；card / flow 出工作单与收窄说明。 */
const showPill = computed(() => props.variant === 'card' || props.variant === 'status');
const showFlow = computed(() => props.variant === 'card' || props.variant === 'flow');

/**
 * 「让助理拆解」与「认领」的判据收在 `requirement-actions.ts`，**单屏需求详情共用同一份**——
 * ⛔ 别在这里或模板里再写一遍条件（两处各写，迟早「行上有、详情里没有」）。
 *  - 拆解按页签收窄（判据 2）：需求池只出「拆需求」、任务页只出「拆任务」，`page` 省略两个都在；
 *  - 认领只出在需求池的无主需求上，且写得动。
 * ⚠️ 入口收窄不是权限：抢认领的条件更新与失败判定在服务端（一条 SQL 一个事务）。
 */
const actionContext = computed(() => ({
  page: props.page,
  canWrite: store.canWrite,
  isArchived: store.isArchived,
}));
const decomposeTargets = computed(() => decomposeTargetsFor(props.todo, actionContext.value));
const showDecomposeRequirement = computed(() => decomposeTargets.value.includes('requirement'));
const showDecomposeTask = computed(() => decomposeTargets.value.includes('task'));
const canClaim = computed(() => canClaimRequirement(props.todo, actionContext.value));

/**
 * 「删除」只给 manager+（且项目未归档）——判据是项目级的 `canDeleteTodos`，不看这一条归谁。
 * 服务端 `ensure_role_at_least(role, "manager")` 同判；editor/viewer 看不到这个入口（不是点了报错）。
 */
const canDelete = computed(() => store.canDeleteTodos);
</script>

<template>
  <div class="trow-ops" :class="`trow-ops--${props.variant}`">
    <!-- 状态药丸：四态各有色（前置圆点即使底色对比弱也一眼分得出分布），默认态最弱但不至于
         与纯文本无异。可编辑时，一枚透明的原生 <select> 铺满药丸——鼠标点药丸即展开，
         键盘 Tab 落到它、方向键/回车原生选档，读屏念作 combobox。 -->
    <span
      v-if="showPill"
      class="todo-state"
      :class="{ 'todo-state--live': editable }"
      :data-status="props.todo.status"
    >
      <span class="todo-state__dot" aria-hidden="true"></span>
      <span class="todo-state__label">{{ TODO_STATUS_LABELS[props.todo.status] }}</span>
      <!-- 可选档走 statusOptions：有验收清单的单这里**没有**「已完成」，
           它只能经「提交待验收 → 派单人认可」那条路闭环 -->
      <select
        v-if="editable"
        class="todo-state__select"
        data-testid="todo-status-select"
        :value="props.todo.status"
        :aria-label="`流转「${props.todo.title}」的状态`"
        @change="changeTodoStatus(store, props.todo, $event)"
      >
        <option v-for="value in statusOptions" :key="value" :value="value">
          {{ TODO_STATUS_LABELS[value] }}
        </option>
      </select>
    </span>

    <template v-if="showFlow">
      <!--
        工作单入口**不受 canEditTodo 收窄**：验收是派单人的动作，而派单人未必是处理人——
        服务端的验收闸走的是另一套判定（派单人或拥有者，且不能是执行方），拿改单权限
        挡在门口会把「派给别人、自己验收」这条正常链路一并锁死。观察者也放行：
        里面是一份只读规格，动作按各自条件在弹层内再收窄。
      -->
      <button
        v-if="isWorkOrder || props.todo.status === 'inReview'"
        class="trow-ops__wo"
        type="button"
        data-testid="todo-work-order"
        :data-acceptance="`${acceptance.checked}/${acceptance.total}`"
        @click="emit('workOrder', props.todo)"
      >
        {{ isWorkOrder ? '工作单' : '验收' }}
        <span v-if="isWorkOrder" class="trow-ops__woCnt tnum">{{ acceptance.text }}</span>
      </button>
      <!--
        「查看执行」：打开这张单绑定的那个项目会话（设计方案 §4.2）。执行在主进程里跑，
        关掉窗口不中断，卡片上永远点得回来。
        ⛔ **只在真绑了会话时出现**——没绑就没有可打开的东西，摆一个点了什么也不发生的
           按钮比不摆更糟。绑定发生在助理开工那一刻（工具面由 Main 写入），不由用户手填。
      -->
      <button
        v-if="props.todo.sessionRef"
        class="trow-ops__exec"
        type="button"
        data-testid="todo-open-execution"
        @click="emit('openExecution', props.todo.sessionRef)"
      >
        {{ TODO_OPEN_EXECUTION_LABEL }}
      </button>
      <!--
        「让助理拆解」：快捷方式，不是主路——主路是项目助理面板里那个常驻会话框。点它＝把
        「拆这一条」这句话替用户说出去，走的是同一个框、同一条审批链。
        ⚠️ `data-todo-interactive` 不能省：表格行整行可点（点开＝详情或编辑），没有这个
        标记点它会同时打开那条，用户看到的是弹错了的那个。
      -->
      <!--
        「认领」：需求池的无主需求上的主动作（原型 renderResults 行尾那颗 claim）。
        点它开壳层的认领对话框（FLOW-02），⛔ 行组件不自己写。任务页不出（canClaim 已含 page 判据）。
        `data-todo-interactive` 不能省：表格整行可点（点开＝详情或编辑），少了它点认领会同时打开那条。
      -->
      <button
        v-if="canClaim"
        class="trow-ops__claim"
        type="button"
        data-todo-interactive
        data-testid="todo-claim"
        :aria-label="`认领需求：${props.todo.title}`"
        @click="emit('claim', props.todo)"
      >
        认领
      </button>
      <button
        v-if="showDecomposeRequirement"
        class="trow-ops__decompose"
        type="button"
        data-todo-interactive
        data-testid="todo-decompose-requirement"
        :aria-label="`${REQUIREMENT_DECOMPOSE_ACTION_LABEL}：${props.todo.title}`"
        :title="TODO_DECOMPOSE_HINT"
        @click="emit('decompose', props.todo, 'requirement')"
      >
        {{ REQUIREMENT_DECOMPOSE_ACTION_LABEL }}
      </button>
      <button
        v-if="showDecomposeTask"
        class="trow-ops__decompose"
        type="button"
        data-todo-interactive
        data-testid="todo-decompose-task"
        :aria-label="`${TASK_DECOMPOSE_ACTION_LABEL}：${props.todo.title}`"
        :title="TODO_DECOMPOSE_HINT"
        @click="emit('decompose', props.todo, 'task')"
      >
        {{ TASK_DECOMPOSE_ACTION_LABEL }}
      </button>
      <!-- 收窄说明与工作单**相互独立**（不用 v-else-if）：他人名下的工作单，成员既能做
           验收（工作单入口不受改单权限收窄），又需要被告知「这条你改不动」——两者都要在。 -->
      <span v-if="locked" class="trow-ops__locked" data-testid="todo-locked-hint">
        {{ TODO_LOCKED_HINT }}
      </span>
      <!--
        「删除」：manager+ 才出现（服务端同判）。删除级联整棵子树，确认框（说清条数、
        壳内确认态）在项目页壳层里，这里只冒泡 —— 行组件够不着那个弹层，也不该就地弹。
        `data-todo-interactive` 不能省：表格整行可点（点开＝详情或编辑），少了它点删除会同时打开那条。
      -->
      <button
        v-if="canDelete"
        class="trow-ops__delete"
        type="button"
        data-todo-interactive
        data-testid="todo-delete"
        :aria-label="`${TODO_DELETE_ACTION_LABEL}：${props.todo.title}`"
        @click="emit('delete', props.todo)"
      >
        {{ TODO_DELETE_ACTION_LABEL }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.trow-ops {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
/* 看板卡上竖排：药丸一行、工作单/说明一行，与卡内其余信息对齐 */
.trow-ops--card {
  flex-wrap: wrap;
}
/* 「查看执行」（main 合入）：与工作单同排的次级动作，静息描边淡、hover 才上强调色 */
.trow-ops__exec {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.trow-ops__exec:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.trow-ops__exec:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}

/* 「让助理拆解」：与「查看执行」同一档次级动作——虚线描边标出「这一下会去开会话」，
   与实线的「工作单」（就地开弹层）在材质上分得开 */
.trow-ops__decompose {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) dashed var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.trow-ops__decompose:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
.trow-ops__decompose:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}

/* 「认领」：需求池无主需求上的主动作——比其余次级动作重一档（实心强调底），
   一列扫下去认得出「这条可以领」。与「删除」（破坏性、静息弱色）在色相与权重上分得开。 */
.trow-ops__claim {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  font: inherit;
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.trow-ops__claim:hover {
  background: var(--accent-line);
}
.trow-ops__claim:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}

/* ── 状态药丸：四态各有色，前置圆点是底色之外的第二重信号 ── */
/* 合并说明：main 侧同处还有 .trow-ops__status 与 .trow-ops__edit——操作列里的状态下拉
   与编辑按钮。本分支已把状态收进状态列那枚药丸、编辑改为点行/点卡触发，两个控件都不
   存在了，故其样式不带过来；留着就是孤儿规则。 */
.todo-state {
  position: relative;
  display: inline-flex;
  height: var(--ctl-h-sm);
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-pill);
  /* 默认态（未开始，最常见）：用 --raised 而不是 --sunken——行 hover 时行底变 --sunken，
     药丸若也用 --sunken 就与行底同色而消失。--raised 在深色高于面、浅色等于白面，
     配上描边与圆点，任何底色下都认得出「这里有个状态」。 */
  color: var(--muted2);
  background: var(--raised);
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
  white-space: nowrap;
}
/* 圆点＝状态色的浓缩：扫一列圆点就读出分布，不必逐格读字 */
.todo-state__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: currentcolor;
}
.todo-state__label {
  position: relative;
}
.todo-state[data-status='inProgress'] {
  border-color: var(--accent-line);
  color: var(--accent-text);
  background: var(--accent-soft);
}
/* 待验收＝需要有人来验的注意态，落警示色（与拖不进「已完成」那条纪律相呼应） */
.todo-state[data-status='inReview'] {
  border-color: var(--warn-line);
  color: var(--warn-text);
  background: var(--warn-soft);
}
.todo-state[data-status='done'] {
  border-color: var(--ok-line);
  color: var(--ok-text);
  background: var(--ok-soft);
}
/* 已取消：虚线 + 透明底 + 弱色，降到背景里，但圆点仍在（四态都看得见） */
.todo-state[data-status='cancelled'] {
  border-style: dashed;
  color: var(--muted);
  background: transparent;
}
/* 可编辑：给出可点手感（悬停描边加重），并让透明下拉承接点击/键盘 */
.todo-state--live {
  cursor: pointer;
  transition: border-color var(--dur-1) var(--ease-out);
}
.todo-state--live:hover {
  border-color: var(--line-strong);
}
.todo-state__select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  /* 字号继承下来，原生下拉展开项才不至于突然变大 */
  font: inherit;
}
/* 焦点环画在药丸上（下拉本体是透明的，环得落在看得见的那层）。
   用 :focus-within 而不是 :has(:focus-visible)：不依赖 :has，键盘落焦即现环，
   鼠标点开也现环——对一枚下拉来说，点开时出焦点环是对的。 */
.todo-state--live:focus-within {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}

/* 工作单入口带上验收进度：一眼看得出这张单还差几条，不必点进去数 */
.trow-ops__wo {
  display: inline-flex;
  height: var(--ctl-h-sm);
  align-items: center;
  gap: var(--sp-1);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--accent-line);
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: var(--accent-soft);
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.trow-ops__wo:hover {
  background: var(--accent-line);
}
.trow-ops__wo:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.trow-ops__woCnt {
  color: var(--muted2);
}
.trow-ops__locked {
  color: var(--muted);
  font-size: var(--fs-100);
}
/* 「删除」：次级动作里唯一的破坏性动作——静息弱色描边，hover 才亮成危险色，
   与「工作单/查看执行/让助理拆解」在色相上分得开（点错代价最大的那个不抢眼但认得出）。 */
.trow-ops__delete {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-2);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-100);
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}
.trow-ops__delete:hover {
  border-color: var(--danger-line);
  color: var(--danger-text);
  background: var(--danger-soft);
}
.trow-ops__delete:focus-visible {
  border-color: var(--danger-line);
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
@media (prefers-reduced-motion: reduce) {
  .todo-state--live,
  .trow-ops__wo,
  .trow-ops__decompose,
  .trow-ops__claim,
  .trow-ops__delete {
    transition: none;
  }
}
</style>
