<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { projectNotificationsApi } from '../../sdk/projectNotifications';

/**
 * 项目组桌面系统通知开关（G-6「用户可关」）。形态照 `ErrorReportingSettings`：
 * 乐观切换 + 失败回滚 + 只读提示，不引第二套设置控件。
 *
 * ⚠️ 说明文案要如实交代**只弹两类**与**不带内容**——用户能预期到弹什么，
 * 才不会因为「怕吵」直接关掉。
 */

const enabled = ref(true);
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    enabled.value = (await projectNotificationsApi.readSettings()).desktopNotifications;
  } catch {
    error.value = '设置读取失败，请稍后重试。';
  } finally {
    loading.value = false;
  }
});

async function update(event: Event): Promise<void> {
  const next = (event.currentTarget as HTMLInputElement).checked;
  const previous = enabled.value;
  enabled.value = next;
  saving.value = true;
  error.value = null;
  try {
    enabled.value = (
      await projectNotificationsApi.writeSettings({ desktopNotifications: next })
    ).desktopNotifications;
  } catch {
    enabled.value = previous;
    error.value = '设置保存失败，请重试。';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="project-notification-settings">
    <h2 class="project-notification-settings__heading">项目组通知</h2>
    <div class="project-notification-settings__row">
      <div class="project-notification-settings__copy">
        <label class="project-notification-settings__label" for="project-desktop-notifications">
          桌面通知
        </label>
        <p class="project-notification-settings__description">
          应用不在前台时，收到
          @提及、待办指派给你或你派发的待办等待验收，弹一条系统通知并在任务栏提示。
          其余动态只在应用内计未读，不打扰。
        </p>
        <p class="project-notification-settings__description">
          通知只说发生了哪类事，不含消息内容、项目名与人名。
        </p>
      </div>
      <label class="project-notification-settings__switch">
        <input
          id="project-desktop-notifications"
          type="checkbox"
          role="switch"
          :checked="enabled"
          :disabled="loading || saving"
          @change="update"
        />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <p v-if="error" class="project-notification-settings__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.project-notification-settings__heading {
  margin: 0 0 var(--sp-5);
  color: var(--ink);
  font: var(--fw-title) var(--fs-500) / 1.3 var(--font-sans);
}
.project-notification-settings__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-5);
  padding: var(--sp-4) 0;
  border-top: var(--bw) solid var(--line);
}
.project-notification-settings__copy {
  flex: 1;
  min-width: 0;
}
.project-notification-settings__label {
  color: var(--ink);
  font: var(--fw-label) var(--fs-body) / 1.4 var(--font-sans);
}
.project-notification-settings__description,
.project-notification-settings__error {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
}
.project-notification-settings__description {
  color: var(--muted2);
}
.project-notification-settings__error {
  color: var(--danger, #b3261e);
}
.project-notification-settings__switch {
  position: relative;
  flex: 0 0 auto;
  width: 2.75rem;
  height: 1.5rem;
}
.project-notification-settings__switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.project-notification-settings__switch span {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--sunken);
  border: var(--bw) solid var(--line);
  border-radius: 999px;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.project-notification-settings__switch span::after {
  display: block;
  width: 1rem;
  height: 1rem;
  margin: calc(0.25rem - var(--bw));
  background: var(--muted);
  border-radius: 50%;
  content: '';
  transition: transform var(--dur-1) var(--ease-out);
}
.project-notification-settings__switch input:checked + span {
  background: var(--accent);
  border-color: var(--accent);
}
.project-notification-settings__switch input:checked + span::after {
  background: #fff; /* 开关拨钮：白钮压 accent 轨道（非 accent 上的文本，不受 V4a 约束） */
  transform: translateX(1.25rem);
}
.project-notification-settings__switch input:focus-visible + span {
  box-shadow: var(--focus-ring-flat);
}
.project-notification-settings__switch input:disabled + span {
  cursor: wait;
  opacity: 0.55;
}
</style>
