<script setup lang="ts">
import { computed, ref } from 'vue';

import AppIcon from '../ui/AppIcon.vue';
import ProjectAgreementsPanel from './ProjectAgreementsPanel.vue';
import ProjectAvatar from './ProjectAvatar.vue';
import { PROJECT_MEMBER_STATE_LABELS, PROJECT_ROLE_LABELS } from './project-format';
import { PROJECT_MANAGE_ITEMS, type ProjectManageAction } from './project-manage-actions';
import { useProjectCollabStore } from '../../stores/projectCollab';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ invite: []; openAssets: []; manage: [ProjectManageAction] }>();

const store = useProjectCollabStore();

/*
 * 右侧上下文栏，对齐协作原型最后生效的一层（`renderAsideV3` + `agreementContent11`）：
 *   项目约定 → 成员 → 共享资料 → 项目管理。
 *
 * ⚠️ 「项目工作空间」块已被原型第 21 层移到页头，⛔ 不加回右栏。
 * ⚠️ 早先照另一份逐屏规格摆的五块「规划中」占位（共享智能助手/能力/连接器/资料/自动化）已按
 *    「项目组以协作原型为准」撤下；「共享资料」换成指向资产页的真实入口。
 * 名册管理（改角色 / 移出 / 转让）收进「成员与权限」弹层，归档与恢复收进「项目设置」弹层——
 * 右栏只留只读名单，窄栏里不再塞下拉与确认。
 *
 * 概览与助理共用侧栏，通过页签切换。「项目管理」三入口只发意图
 *    （`manage`），两个弹层归项目页——页头「⋯」菜单打开的是同一个实例；⛔ 别把弹层搬回本栏，
 *    本栏看不见的时候它们就又打不开了。
 */

/** 名册只呈现在组与受邀成员；已移出不占位（服务端仍留审计）。 */
const members = computed(
  () => store.detail?.members.filter((member) => member.state !== 'removed') ?? [],
);

const busy = ref(false);

/** 恢复不是破坏性操作：直接执行，不拦一道确认。 */
async function restoreProject(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.setProjectArchived(props.projectId, false);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <aside class="pj-aside" aria-label="项目配置">
    <div class="pj-aside__scroll">
      <section
        v-if="store.isArchived"
        class="pj-cfg pj-cfg--archived"
        data-testid="project-archived"
      >
        <header class="pj-cfg__head">
          <span class="pj-cfg__title">已归档</span>
        </header>
        <p class="pj-cfg__empty">本项目已归档，当前为只读；内容与历史全部保留。</p>
        <!-- ⚠️ 判据是裸 `isOwner`，**不能**用任何含 `!isArchived` 的具名能力：
             这个按钮只在归档态下出现，用带「未归档」条件的判据一挂，归档就再也解不开了。 -->
        <div v-if="store.isOwner" class="pj-cfg__editorActions">
          <button
            class="btn btn--secondary"
            type="button"
            :disabled="busy"
            data-testid="project-unarchive"
            @click="restoreProject"
          >
            恢复项目
          </button>
        </div>
      </section>

      <!-- 项目约定（CTX-01）：项目说明 + AI 录入规则折叠展示与全屏编辑，正文与页头抽屉共用。 -->
      <ProjectAgreementsPanel :project-id="projectId" />

      <section class="pj-cfg" data-testid="project-members">
        <header class="pj-cfg__head">
          <AppIcon name="users" :size="14" class="pj-cfg__headIcon" />
          <span class="pj-cfg__title">成员</span>
          <span class="pj-cfg__count tnum">{{ members.length }}</span>
        </header>
        <ul class="pj-cfg__rows">
          <li
            v-for="member in members"
            :key="member.subject"
            class="pj-cfg__row"
            :data-member="member.subject"
          >
            <ProjectAvatar :name="member.displayName" size="s" />
            <span class="pj-cfg__rowName"
              >{{ member.displayName || member.subject
              }}<template v-if="store.isSelf(member.subject)">（我）</template></span
            >
            <span class="pj-cfg__rowMeta">
              <span v-if="member.state !== 'active'" class="pj-cfg__state">{{
                PROJECT_MEMBER_STATE_LABELS[member.state]
              }}</span>
              {{ PROJECT_ROLE_LABELS[member.role] }}
            </span>
          </li>
        </ul>
        <button
          v-if="store.canManageMembers"
          class="pj-cfg__link"
          type="button"
          data-testid="project-members-invite"
          @click="emit('invite')"
        >
          邀请成员
        </button>
      </section>

      <!-- 共享资料：数量口径随资产页数据模型迁移尚未定，⛔ 不在这里编数，只给真实入口。 -->
      <section class="pj-cfg" data-testid="project-shared-materials">
        <header class="pj-cfg__head">
          <AppIcon name="library" :size="14" class="pj-cfg__headIcon" />
          <span class="pj-cfg__title">共享资料</span>
        </header>
        <p class="pj-cfg__empty">项目资产统一沉淀在资产页，交付物可关联需求。</p>
        <button
          class="pj-cfg__link"
          type="button"
          data-testid="project-open-assets"
          @click="emit('openAssets')"
        >
          打开项目资产
        </button>
      </section>

      <section class="pj-cfg" data-testid="project-management">
        <header class="pj-cfg__head">
          <AppIcon name="settings" :size="14" class="pj-cfg__headIcon" />
          <span class="pj-cfg__title">项目管理</span>
        </header>
        <!-- 与页头「⋯」菜单同一张表（`PROJECT_MANAGE_ITEMS`），两处不会一处有、一处没有。 -->
        <div class="pj-cfg__manage">
          <button
            v-for="item in PROJECT_MANAGE_ITEMS"
            :key="item.id"
            class="pj-cfg__manageBtn"
            type="button"
            aria-haspopup="dialog"
            :data-testid="`project-manage-${item.id}`"
            @click="emit('manage', item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.pj-aside {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: var(--bw) solid var(--line);
  background: var(--rail);
}
.pj-aside__scroll {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0;
  overflow: auto;
  padding: 0;
}
.pj-cfg {
  display: flex;
  flex-direction: column;
  gap: var(--px-10);
  padding: var(--px-16) var(--px-18);
  border-bottom: var(--bw) solid var(--line);
}
.pj-cfg:first-child {
  padding-top: var(--px-20);
}
.pj-cfg__head {
  display: flex;
  align-items: center;
  gap: var(--px-7);
  margin: 0;
}
.pj-cfg__title {
  color: var(--muted2);
  font-size: var(--fs-200);
  font-weight: var(--fw-620);
  letter-spacing: 0.04em;
}
.pj-cfg__count {
  color: var(--muted);
  font-size: var(--fs-100);
}
.pj-cfg__headIcon {
  color: var(--muted);
}
.pj-cfg__empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-200);
  line-height: var(--lh-1p7);
}
.pj-cfg__editorActions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.pj-cfg__rows {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--sp-1);
  list-style: none;
}
.pj-cfg__row {
  display: flex;
  /* 原型 .member 行（头像 + 名字 + 角色小字），内容 ≈24px；与头像同高不撑行 */
  min-height: var(--px-26);
  align-items: center;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: var(--fs-meta);
}
.pj-cfg__rowName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pj-cfg__rowMeta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted2);
  font-size: var(--fs-100);
}
.pj-cfg__state {
  color: var(--warn-text);
}
/* 分区尾部的文字钮（原型 .aside .textbtn：邀请成员 / 打开项目资产）：强调色文字，不抢分区标题。 */
.pj-cfg__link {
  align-self: flex-start;
  height: var(--px-26);
  padding: 0 var(--px-6);
  margin-left: calc(-1 * var(--px-6));
  border: 0;
  border-radius: var(--r-sm);
  color: var(--accent-text);
  background: transparent;
  font: inherit;
  font-size: var(--fs-200);
  font-weight: var(--fw-label);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.pj-cfg__link:hover {
  background: var(--accent-soft);
}
.pj-cfg__link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 项目管理三入口（原型 .aside button：成员与权限 / 消息与提醒 / 项目设置）：竖排整宽次级钮。 */
.pj-cfg__manage {
  display: flex;
  flex-direction: column;
  gap: var(--px-6);
}
.pj-cfg__manageBtn {
  display: flex;
  width: 100%;
  min-height: var(--px-30);
  align-items: center;
  padding: 0 var(--px-11);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
  color: var(--ink);
  background: var(--panel);
  font: inherit;
  font-size: var(--fs-200);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.pj-cfg__manageBtn:hover {
  border-color: var(--line-strong);
  background: var(--sunken);
}
.pj-cfg__manageBtn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring-flat);
}
/* 归档提示块：与普通配置块同形，只换描边/底色到警示档 */
.pj-cfg--archived {
  border-color: var(--warn-line);
}
.pj-cfg--archived .pj-cfg__title,
.pj-cfg--archived .pj-cfg__empty {
  color: var(--warn-text);
}
</style>
