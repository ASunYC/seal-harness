<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import {
  projectAssignableRolesFor,
  projectRoleOutranks,
  type ProjectAssignableRole,
  type ProjectMember,
} from '@shared/protocol/project-collab.js';

import ProjectAvatar from './ProjectAvatar.vue';
import ProjectDialogShell from './ProjectDialogShell.vue';
import { PROJECT_MEMBER_STATE_LABELS, PROJECT_ROLE_LABELS } from './project-format';
import { useProjectCollabStore } from '../../stores/projectCollab';

/**
 * 「成员与权限」弹层（右栏「项目管理」入口，对齐协作原型 `membersPanel`）。
 *
 * 名册管理（改角色 / 移出）与拥有者专属的「转让拥有者」都收在这里；右栏只留只读名单。
 * 入口按具名能力收窄——这只是「不给点了必错的按钮」，权限本身在服务端（按令牌强判 403 并落审计）。
 *
 * 破坏性操作的二次确认**在同一个弹层里换页**（原型的单弹层就是这么走的），⛔ 不再叠第二层模态：
 * 叠层会让「当前哪个是确认层」对键盘与读屏都含糊。⛔ 也不用原生 confirm（会夺走整页键盘焦点）。
 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    /** 从动态 / 讨论的 @ 引用打开时要定位的成员（测试提单 2552）：该行高亮并滚入视区。 */
    focusSubject?: string | null;
  }>(),
  { focusSubject: null },
);
const emit = defineEmits<{ close: []; invite: [] }>();

const store = useProjectCollabStore();

const rowsEl = ref<HTMLElement | null>(null);

/** 打开即把被引用的那个人滚进视区。按 dataset 逐个比，⛔ 不把 subject 拼进选择器。 */
onMounted(() => {
  const subject = props.focusSubject;
  if (subject === null) return;
  void nextTick(() => {
    const rows = rowsEl.value?.querySelectorAll<HTMLElement>('[data-member]') ?? [];
    [...rows]
      .find((row) => row.dataset['member'] === subject)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
});

/** 名册只呈现在组与受邀成员；已移出不占位（服务端仍留审计）。 */
const members = computed(
  () => store.detail?.members.filter((member) => member.state !== 'removed') ?? [],
);

function isSelf(member: ProjectMember): boolean {
  return store.isSelf(member.subject);
}

function memberLabel(member: ProjectMember): string {
  return member.displayName || member.subject;
}

/**
 * 可改角色 / 可移除的行：管理者及以上、不是自己、**且我的档位严格高于这一行**。
 * 最后那条是服务端 `ensure_role_grantable` 的同款收窄；拥有者不被任何人 outrank，易主只能走「转让」。
 */
function canActOnMember(member: ProjectMember): boolean {
  return (
    store.canManageMembers && !isSelf(member) && projectRoleOutranks(store.myRole, member.role)
  );
}

/**
 * 下拉里出现哪些档——`ensure_role_grantable` 的客户端同构件：闭集 ∩ 严格低于自己。
 * ⛔ 别写死 `<option>`：闭集加档时这里不会红，拥有者会看不到「管理者」这一档。
 */
const assignableRoles = computed(() => projectAssignableRolesFor(store.myRole));

/** 可转让的目标：在组、非本人（角色不限——观察者也能接手）。 */
const transferCandidates = computed(() =>
  members.value.filter((member) => member.state === 'active' && !isSelf(member)),
);

const busy = ref(false);
const roleBusySubject = ref<string | null>(null);
/** 转让目标的暂存选择（选人与确认分两步：先挑人，再确认这件事）。 */
const transferTarget = ref('');

async function changeRole(member: ProjectMember, event: Event): Promise<void> {
  const next = (event.target as HTMLSelectElement).value as ProjectAssignableRole;
  if (next === member.role || roleBusySubject.value !== null) return;
  roleBusySubject.value = member.subject;
  try {
    // 成功与否都以服务端回传的详情为准：失败时下拉会随详情复位回原角色。
    await store.updateMemberRole(props.projectId, member.subject, next);
  } finally {
    roleBusySubject.value = null;
  }
}

type PendingAction =
  | { kind: 'remove'; subject: string; displayName: string }
  | { kind: 'transfer'; subject: string; displayName: string };

const pending = ref<PendingAction | null>(null);

function askRemove(member: ProjectMember): void {
  pending.value = { kind: 'remove', subject: member.subject, displayName: memberLabel(member) };
}

function askTransfer(): void {
  const target = transferCandidates.value.find((member) => member.subject === transferTarget.value);
  if (!target) return;
  pending.value = { kind: 'transfer', subject: target.subject, displayName: memberLabel(target) };
}

function cancelPending(): void {
  if (busy.value) return;
  pending.value = null;
}

const confirmCopy = computed(() => {
  const action = pending.value;
  if (!action) return null;
  if (action.kind === 'remove') {
    return {
      title: '移出成员',
      body: `确定把「${action.displayName}」移出本项目？对方将立即失去访问权。`,
      // 连带语义照实说明，别让拥有者以为「移人＝清数据」。
      note: '其留下的留言、讨论、待办与文件都会保留；名下未完成的待办不会自动转给别人，需要你另行安排。',
      confirmLabel: '移出成员',
    };
  }
  return {
    title: '转让拥有者',
    body: `确定把本项目的拥有者转让给「${action.displayName}」？`,
    note: '转让后你在本项目降为「成员」，将不再能管理成员、编辑项目或归档项目。此操作需要新拥有者才能转回。',
    confirmLabel: '确认转让',
  };
});

async function confirmPending(): Promise<void> {
  const action = pending.value;
  if (!action || busy.value) return;
  busy.value = true;
  try {
    const done =
      action.kind === 'remove'
        ? await store.removeMember(props.projectId, action.subject)
        : await store.transferOwnership(props.projectId, action.subject);
    // 失败时停在确认页：用户能看到回执并决定重试还是返回。
    if (done) {
      pending.value = null;
      transferTarget.value = '';
    }
  } finally {
    busy.value = false;
  }
}

/** 关弹层：确认进行中不关，免得请求回来时落到一个已经消失的界面上。 */
function close(): void {
  if (busy.value) return;
  emit('close');
}
</script>

<template>
  <ProjectDialogShell :title="confirmCopy ? confirmCopy.title : '成员与权限'" @close="close">
    <div v-if="confirmCopy" class="pj-members__confirm" data-testid="member-admin-confirm-body">
      <p class="pj-members__body">{{ confirmCopy.body }}</p>
      <p class="pj-members__note">{{ confirmCopy.note }}</p>
    </div>

    <div v-else class="pj-members" data-testid="project-members-dialog">
      <p class="pj-members__note">成员身份来自加入项目的企业账号；角色决定在本项目里能做什么。</p>

      <ul ref="rowsEl" class="pj-members__rows">
        <li
          v-for="member in members"
          :key="member.subject"
          class="pj-members__row"
          :class="{ 'is-ref-focus': member.subject === props.focusSubject }"
          :data-member="member.subject"
          :data-ref-focus="member.subject === props.focusSubject ? 'true' : undefined"
        >
          <ProjectAvatar :name="member.displayName" size="s" />
          <span class="pj-members__name"
            >{{ memberLabel(member) }}<template v-if="isSelf(member)">（我）</template></span
          >
          <span v-if="member.state !== 'active'" class="pj-members__state">{{
            PROJECT_MEMBER_STATE_LABELS[member.state]
          }}</span>
          <select
            v-if="canActOnMember(member)"
            class="pj-members__role"
            :value="member.role"
            :disabled="roleBusySubject !== null"
            :aria-label="`${memberLabel(member)} 的角色`"
            :data-testid="`member-role-${member.subject}`"
            @change="changeRole(member, $event)"
          >
            <option v-for="role in assignableRoles" :key="role" :value="role">
              {{ PROJECT_ROLE_LABELS[role] }}
            </option>
          </select>
          <span v-else class="pj-members__roleText">{{ PROJECT_ROLE_LABELS[member.role] }}</span>
          <button
            v-if="canActOnMember(member)"
            class="pj-members__remove"
            type="button"
            :aria-label="`移出 ${memberLabel(member)}`"
            :title="`移出 ${memberLabel(member)}`"
            :data-testid="`member-remove-${member.subject}`"
            @click="askRemove(member)"
          >
            ✕
          </button>
        </li>
      </ul>

      <!-- 拥有者专属：转让（归档在「项目设置」里）。归档态下 canAdministerProject 为假，整块收起。 -->
      <div
        v-if="store.canAdministerProject"
        class="pj-members__admin"
        data-testid="project-member-admin"
      >
        <label class="pj-members__adminLabel" for="project-transfer-target">转让拥有者</label>
        <div class="pj-members__adminRow">
          <select
            id="project-transfer-target"
            v-model="transferTarget"
            class="pj-members__role pj-members__role--wide"
            :disabled="transferCandidates.length === 0"
            data-testid="transfer-target"
          >
            <option value="">选择接手的成员…</option>
            <option
              v-for="candidate in transferCandidates"
              :key="candidate.subject"
              :value="candidate.subject"
            >
              {{ memberLabel(candidate) }}
            </option>
          </select>
          <button
            class="btn btn--secondary"
            type="button"
            :disabled="!transferTarget || busy"
            data-testid="transfer-open"
            @click="askTransfer"
          >
            转让
          </button>
        </div>
        <p class="pj-members__note">
          项目始终保留一位拥有者：转让后你降为「成员」，需新拥有者才能转回。
        </p>
      </div>
    </div>

    <template #foot>
      <template v-if="confirmCopy">
        <button class="btn btn--ghost" type="button" :disabled="busy" @click="cancelPending">
          返回
        </button>
        <button
          class="btn btn--primary btn--danger"
          type="button"
          :disabled="busy"
          data-testid="member-admin-confirm"
          @click="confirmPending"
        >
          {{ confirmCopy.confirmLabel }}
        </button>
      </template>
      <template v-else>
        <button
          v-if="store.canManageMembers"
          class="btn btn--secondary"
          type="button"
          data-testid="project-members-dialog-invite"
          @click="emit('invite')"
        >
          邀请成员
        </button>
        <button class="btn btn--ghost" type="button" @click="close">关闭</button>
      </template>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.pj-members,
.pj-members__confirm {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.pj-members__body {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.pj-members__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-meta);
  line-height: var(--lh-1p7);
}
.pj-members__rows {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--sp-1);
  list-style: none;
}
.pj-members__row {
  display: flex;
  min-height: var(--px-30);
  align-items: center;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-meta);
}
/* 从 @ 引用打开时被点的那个人：强调底标出来（颜色之外还有 data-ref-focus） */
.pj-members__row.is-ref-focus {
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  /* 用阴影往外扩一圈同色底，不动行的盒子尺寸（不改排版、不挤右侧的角色下拉） */
  box-shadow: 0 0 0 var(--sp-1) var(--accent-soft);
}
.pj-members__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pj-members__state {
  color: var(--warn-text);
  font-size: var(--fs-100);
}
.pj-members__roleText {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.pj-members__role {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-1);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-sm);
  color: var(--ink);
  background: var(--sunken);
  font: inherit;
  font-size: var(--fs-100);
  cursor: pointer;
}
.pj-members__role--wide {
  flex: 1;
  min-width: 0;
  height: var(--ctl-h);
  padding: 0 var(--sp-2);
  font-size: var(--fs-meta);
}
.pj-members__role:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.pj-members__role:disabled {
  cursor: default;
  opacity: 0.6;
}
.pj-members__remove {
  display: grid;
  width: var(--px-24);
  height: var(--px-24);
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font-size: var(--fs-100);
  line-height: 1;
  cursor: pointer;
}
.pj-members__remove:hover {
  color: var(--danger-text);
  background: var(--danger-soft);
}
.pj-members__remove:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 拥有者专属管理块：与名册之间拉一条分隔线，视觉上明确是另一层能力 */
.pj-members__admin {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: var(--bw) solid var(--line);
}
.pj-members__adminLabel {
  color: var(--muted2);
  font-size: var(--fs-100);
}
.pj-members__adminRow {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
</style>
