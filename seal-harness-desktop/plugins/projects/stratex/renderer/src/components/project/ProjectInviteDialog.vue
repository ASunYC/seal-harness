<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  PROJECT_OPEN_INVITATION_DEFAULT_TTL_HOURS,
  PROJECT_OPEN_INVITATION_MAX_USES,
  PROJECT_OPEN_INVITATION_TTL_HOURS,
  buildProjectJoinLink,
  projectInvitationRolesFor,
} from '@shared/protocol/project-collab.js';
import type {
  ProjectInvitationKind,
  ProjectInvitationRole,
  ProjectOpenInvitation,
  ProjectOpenInvitationTtlHours,
} from '@shared/protocol/project-collab.js';

import ProjectDialogShell from './ProjectDialogShell.vue';
import { formatProjectTime, PROJECT_ROLE_LABELS } from './project-format';
import { copyText } from '../../sdk/clipboard';
import { projectOpenInvitationNotice, useProjectCollabStore } from '../../stores/projectCollab';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();

const store = useProjectCollabStore();

/**
 * 可签发的档位：闭集（刻意不含 owner）∩ **严格低于我自己**那几档——与服务端
 * `ensure_role_grantable` 的两闸同构。拥有者签得出管理者；管理者只签得出
 * 成员/观察者，造不出第二个管理者。⛔ 不摆出点了必然 403 的档位。
 */
const roleOptions = computed(() => projectInvitationRolesFor(store.myRole));

/** 默认落在 editor（成员）：邀请的常态是让人来干活，不是来看的；它对任一签发档位恒可选。 */
const role = ref<ProjectInvitationRole>('editor');
/**
 * 邀请方式：只有**成员（editor）**档能二选一（一次性授权码 / 限时开放邀请）；
 * 「开放邀请只签成员」——切到管理者/观察者时本段消失、方式回落一次性码。
 */
const method = ref<ProjectInvitationKind>('single');
/** 开放邀请有效期（默认 24 小时）。 */
const ttlHours = ref<ProjectOpenInvitationTtlHours>(PROJECT_OPEN_INVITATION_DEFAULT_TTL_HOURS);
/** 人数上限（可选，留空＝不限）。字符串态，生成时校验并转数字。 */
const maxUsesInput = ref('');
const maxUsesMax = PROJECT_OPEN_INVITATION_MAX_USES;
const ttlOptions = PROJECT_OPEN_INVITATION_TTL_HOURS;

const busy = ref(false);
const error = ref<string | null>(null);

/** 生成结果：邀请码/链接明文只活在本组件局部状态，一次性展示，关框即弃。 */
const issuedCode = ref<string | null>(null);
const issuedLink = ref<string | null>(null);
const issuedExpiresAt = ref<string | null>(null);
const issuedKind = ref<ProjectInvitationKind | null>(null);
const copiedCode = ref(false);
const copiedLink = ref(false);

/** 关闭一条开放邀请的**对话框内确认态**（照 draft 的 `discardingBatchId`；⛔ 不用原生 confirm）。 */
const revokingId = ref<string | null>(null);

/** 「邀请方式」二选一只在成员档出现。 */
const showMethodSwitch = computed(() => role.value === 'editor');
/** 实际签发形态：非成员档、或成员档但选了一次性码，一律 single。 */
const effectiveKind = computed<ProjectInvitationKind>(() =>
  role.value === 'editor' && method.value === 'open' ? 'open' : 'single',
);
/** 已生成的那条是不是开放邀请（决定单码 / 链接+码的展示）。 */
const issuedIsOpen = computed(() => issuedKind.value === 'open');

const generateLabel = computed(() => {
  if (effectiveKind.value === 'open') return '生成开放邀请';
  return issuedCode.value && !issuedIsOpen.value ? '生成新邀请码' : '生成邀请码';
});

function ttlLabel(hours: ProjectOpenInvitationTtlHours): string {
  if (hours === 1) return '1 小时';
  if (hours === 24) return '24 小时';
  return '7 天';
}

/** 切到管理者/观察者时邀请方式回落一次性码（本段随之消失，与设计 §5 一致）。 */
watch(role, (next) => {
  if (next !== 'editor') method.value = 'single';
});

onMounted(() => {
  // 打开对话框拉一次进行中的开放邀请。列表端点 manager+，与本弹框的开启条件同门；
  // 非 manager+ 不请求（不摆一个点了必 403 的调用）。
  if (store.canManageMembers) void store.loadOpenInvitations(props.projectId);
});

async function generate(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  copiedCode.value = false;
  copiedLink.value = false;
  try {
    const kind = effectiveKind.value;
    let maxUses: number | undefined;
    if (kind === 'open') {
      const raw = maxUsesInput.value.trim();
      if (raw !== '') {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > maxUsesMax) {
          error.value = `人数上限需填 1–${maxUsesMax} 的整数，或留空表示不限。`;
          return;
        }
        maxUses = value;
      }
    }
    // 留空＝不限：`maxUses` 只在填了才带（`exactOptionalPropertyTypes` 下不塞 undefined）。
    const options =
      kind === 'open'
        ? {
            kind: 'open' as const,
            ttlHours: ttlHours.value,
            ...(maxUses !== undefined ? { maxUses } : {}),
          }
        : undefined;
    const result = await store.createInvitation(props.projectId, role.value, options);
    if (!result.ok) {
      // 开放邀请业务码（如 open 选了非成员档 → 400 `open_invitation_role_not_allowed`）就地
      // 覆盖通用文案；无 serverCode 时回落通用失败文案。
      error.value = projectOpenInvitationNotice(result.serverCode)?.message ?? result.message;
      return;
    }
    issuedCode.value = result.code;
    issuedExpiresAt.value = result.expiresAt;
    issuedKind.value = result.kind;
    // 链接只为开放邀请出（企微里自定义协议链接不一定唤起，故与纯码并列兜底）。
    issuedLink.value = result.kind === 'open' ? buildProjectJoinLink(result.code) : null;
    // 新签的开放邀请要出现在「进行中」列表里：生成后重取。
    if (result.kind === 'open') void store.loadOpenInvitations(props.projectId);
  } finally {
    busy.value = false;
  }
}

async function copyValue(value: string | null, target: 'code' | 'link'): Promise<void> {
  if (!value) return;
  // 邀请码/链接是一次性敏感凭据：既不进日志也不进埋点，只在本函数内交给剪贴板工具。
  if (await copyText(value)) {
    if (target === 'code') copiedCode.value = true;
    else copiedLink.value = true;
    error.value = null;
    return;
  }
  error.value = '复制失败，请手动选中后复制。';
}

async function revoke(invitationId: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await store.revokeInvitation(invitationId);
    if (!result.ok) {
      // 关闭已被他人先关的邀请 → 410 `invitation_revoked`「该邀请已关闭」；无 serverCode 回落通用。
      error.value = projectOpenInvitationNotice(result.serverCode)?.message ?? result.message;
      return;
    }
    revokingId.value = null;
  } finally {
    busy.value = false;
  }
}

/** 「已用 N / 上限 M」；不限时只说「已用 N」。 */
function usageLabel(invitation: ProjectOpenInvitation): string {
  return invitation.maxUses === null
    ? `已用 ${invitation.usesCount}`
    : `已用 ${invitation.usesCount} / 上限 ${invitation.maxUses}`;
}
</script>

<template>
  <ProjectDialogShell title="邀请成员" @close="emit('close')">
    <div>
      <div class="invite__label">加入后的角色</div>
      <div class="invite__seg" role="radiogroup" aria-label="加入后的角色">
        <button
          v-for="option in roleOptions"
          :key="option"
          type="button"
          class="invite__segItem"
          :class="{ 'is-on': role === option }"
          role="radio"
          :aria-checked="role === option"
          @click="role = option"
        >
          {{ PROJECT_ROLE_LABELS[option] }}
        </button>
      </div>
    </div>

    <!-- 邀请方式：仅「成员」档出现；切到管理者/观察者时本段消失、方式回落一次性码。 -->
    <div v-if="showMethodSwitch" data-testid="invite-method">
      <div class="invite__label">邀请方式</div>
      <div class="invite__seg" role="radiogroup" aria-label="邀请方式">
        <button
          type="button"
          class="invite__segItem"
          :class="{ 'is-on': method === 'single' }"
          role="radio"
          :aria-checked="method === 'single'"
          @click="method = 'single'"
        >
          一次性授权码
        </button>
        <button
          type="button"
          class="invite__segItem"
          :class="{ 'is-on': method === 'open' }"
          role="radio"
          :aria-checked="method === 'open'"
          @click="method = 'open'"
        >
          限时开放邀请
        </button>
      </div>
    </div>

    <!-- 开放邀请参数：有效期三档 + 可选人数上限 -->
    <template v-if="effectiveKind === 'open'">
      <div>
        <div class="invite__label">有效期</div>
        <div class="invite__seg" role="radiogroup" aria-label="有效期">
          <button
            v-for="hours in ttlOptions"
            :key="hours"
            type="button"
            class="invite__segItem"
            :class="{ 'is-on': ttlHours === hours }"
            role="radio"
            :aria-checked="ttlHours === hours"
            @click="ttlHours = hours"
          >
            {{ ttlLabel(hours) }}
          </button>
        </div>
      </div>
      <div>
        <label class="invite__label" for="invite-max-uses">人数上限（可选，留空不限）</label>
        <!--
          ⚠️ `type="text"` + `inputmode="numeric"` 而非 `type="number"`：后者会让 v-model
          把值强转成 number（Vue 的 `castToNumber`），本组件按字符串校验（留空＝不限），
          强转会打乱「空串 / 非法 / 合法」三态。范围由生成时校验兜住。
        -->
        <input
          id="invite-max-uses"
          v-model="maxUsesInput"
          class="invite__num"
          type="text"
          inputmode="numeric"
          placeholder="不限"
          data-testid="invite-max-uses"
        />
      </div>
    </template>

    <!-- 生成结果 -->
    <div v-if="issuedCode">
      <template v-if="issuedIsOpen">
        <div v-if="issuedLink">
          <div class="invite__label">加入链接</div>
          <div class="invite__codebox">
            <code data-testid="invite-link">{{ issuedLink }}</code>
            <button class="btn btn--secondary" type="button" @click="copyValue(issuedLink, 'link')">
              {{ copiedLink ? '已复制' : '复制' }}
            </button>
          </div>
        </div>
        <div class="invite__stack">
          <div class="invite__label">邀请码</div>
          <div class="invite__codebox">
            <code data-testid="invite-code">{{ issuedCode }}</code>
            <button class="btn btn--secondary" type="button" @click="copyValue(issuedCode, 'code')">
              {{ copiedCode ? '已复制' : '复制' }}
            </button>
          </div>
        </div>
        <p class="invite__note">
          <template v-if="issuedExpiresAt"
            >有效期至 {{ formatProjectTime(issuedExpiresAt) }} ·
          </template>
          有效期内任何拿到它的企业账号都能以成员加入，到期或关闭后失效
        </p>
      </template>
      <template v-else>
        <div class="invite__label">邀请码</div>
        <div class="invite__codebox">
          <code data-testid="invite-code">{{ issuedCode }}</code>
          <button class="btn btn--secondary" type="button" @click="copyValue(issuedCode, 'code')">
            {{ copiedCode ? '已复制' : '复制' }}
          </button>
        </div>
        <p class="invite__note">
          {{ issuedExpiresAt ? `有效期至 ${formatProjectTime(issuedExpiresAt)}` : '24 小时内有效' }}
          · 仅可使用一次 · 明文仅此一次展示，关闭后不可再查看
        </p>
      </template>
    </div>
    <p v-else class="invite__note">
      生成后把邀请码发给同事，对方在「项目 → 加入项目」中输入即可以企业账号加入。
    </p>

    <p v-if="error" class="invite__error" role="alert">{{ error }}</p>

    <!-- 进行中的开放邀请（manager+）：到期 / 已用·上限 / 创建人，可提前关闭。 -->
    <section v-if="store.canManageMembers" class="invite__open" data-testid="open-invitations">
      <div class="invite__label">进行中的开放邀请</div>
      <p
        v-if="store.openInvitationsLoading && store.openInvitations.length === 0"
        class="invite__note"
        role="status"
      >
        正在加载…
      </p>
      <p v-else-if="store.openInvitationsError" class="invite__error" role="alert">
        {{ store.openInvitationsError.message }}
      </p>
      <p v-else-if="store.openInvitations.length === 0" class="invite__note">
        暂无进行中的开放邀请。
      </p>
      <ul v-else class="invite__openList">
        <li
          v-for="invitation in store.openInvitations"
          :key="invitation.id"
          class="invite__openItem"
          data-testid="open-invitation"
          :data-invitation-id="invitation.id"
        >
          <div class="invite__openMeta">
            <span class="tnum">到期 {{ formatProjectTime(invitation.expiresAt) }}</span>
            <span class="tnum" data-testid="open-invitation-usage">{{
              usageLabel(invitation)
            }}</span>
            <span class="invite__openBy">{{
              invitation.createdByDisplayName || invitation.createdBySubject
            }}</span>
          </div>
          <div class="invite__openOps">
            <template v-if="revokingId === invitation.id">
              <span class="invite__warn" data-testid="invite-revoke-warn"
                >关闭后此邀请立即失效，已加入的成员不受影响。</span
              >
              <button
                class="btn btn--primary btn--danger"
                type="button"
                data-testid="invite-revoke-confirm"
                :disabled="busy"
                @click="revoke(invitation.id)"
              >
                确认关闭
              </button>
              <button
                class="btn btn--ghost"
                type="button"
                data-testid="invite-revoke-cancel"
                :disabled="busy"
                @click="revokingId = null"
              >
                取消
              </button>
            </template>
            <button
              v-else
              class="btn btn--secondary"
              type="button"
              data-testid="invite-revoke-open"
              :disabled="busy"
              @click="revokingId = invitation.id"
            >
              关闭
            </button>
          </div>
        </li>
      </ul>
    </section>

    <template #foot>
      <button class="btn btn--ghost" type="button" :disabled="busy" @click="generate">
        {{ generateLabel }}
      </button>
      <button class="btn btn--primary" type="button" @click="emit('close')">完成</button>
    </template>
  </ProjectDialogShell>
</template>

<style scoped>
.invite__label {
  margin-bottom: var(--sp-2);
  color: var(--muted2);
  font-size: var(--fs-meta);
}
.invite__seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: var(--bw) solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--sunken);
}
.invite__segItem {
  height: var(--ctl-h-sm);
  padding: 0 var(--sp-3);
  border: 0;
  border-radius: var(--r-sm);
  color: var(--muted2);
  background: transparent;
  font-size: var(--fs-meta);
  font-weight: var(--fw-label);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.invite__segItem:hover:not(.is-on) {
  color: var(--ink);
}
.invite__segItem:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
.invite__segItem.is-on {
  color: var(--accent-text);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 var(--bw) var(--accent-line);
}
.invite__num {
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
.invite__num::placeholder {
  color: var(--muted);
}
.invite__num:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.invite__stack {
  margin-top: var(--sp-3);
}
.invite__codebox {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  background: var(--sunken);
}
.invite__codebox code {
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--ink);
  font: var(--fw-label) var(--fs-500) / 1.3 var(--font-mono);
  letter-spacing: 0.08em;
}
.invite__note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-100);
  line-height: 1.7;
}
.invite__error {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--fs-meta);
}
.invite__open {
  padding-top: var(--sp-4);
  border-top: var(--bw) solid var(--line);
}
.invite__openList {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.invite__openItem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: var(--bw) solid var(--line-weak);
  border-radius: var(--r-md);
  background: var(--panel);
}
.invite__openMeta {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  color: var(--muted2);
  font-size: var(--fs-100);
}
.invite__openBy {
  overflow-wrap: anywhere;
  color: var(--muted);
}
.invite__openOps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.invite__warn {
  color: var(--warn-text);
  font-size: var(--fs-100);
}
@media (prefers-reduced-motion: reduce) {
  .invite__segItem {
    transition: none;
  }
}
</style>
