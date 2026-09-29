<script setup lang="ts">
import { onMounted } from 'vue';

import { useProjectServiceCapabilitiesStore } from '../../stores/projectCollabCapabilities';

/**
 * 服务能力升级提示（CORE-05 判据 1「显示升级提示」）。
 *
 * 自成一体：挂载时自行协商一次服务能力；对面为旧服务（缺 `requirement.dictionaries`）时
 * 显示一条静态提示条。⛔ 真正的「禁发新增写字段」由主进程写门强制，本条只负责告知用户。
 * ⛔ 不出现「内核」等白标禁词。
 */
const capabilities = useProjectServiceCapabilitiesStore();

onMounted(() => {
  void capabilities.load();
});
</script>

<template>
  <div
    v-if="capabilities.serviceUpgradeRequired"
    class="service-upgrade-notice"
    role="status"
    data-testid="project-service-upgrade-notice"
  >
    <span class="service-upgrade-notice__title">协作服务需要升级</span>
    <span class="service-upgrade-notice__body">
      当前连接的协作服务版本较旧，暂不支持需求的模块 /
      分类等新增字段。相关字段已停用以免丢失编辑，请联系管理员升级服务后再使用。
    </span>
  </div>
</template>

<style scoped>
.service-upgrade-notice {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--warn-line);
  border-radius: var(--r-md);
  background: var(--warn-soft);
}

.service-upgrade-notice__title {
  font-size: var(--fs-100);
  font-weight: var(--fw-label);
  color: var(--warn-text);
}

.service-upgrade-notice__body {
  font-size: var(--fs-meta);
  line-height: var(--lh-body);
  color: var(--muted);
}
</style>
