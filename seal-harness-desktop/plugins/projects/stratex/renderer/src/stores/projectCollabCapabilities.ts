import { defineStore } from 'pinia';

import {
  SERVICE_CAPABILITY,
  hasCapability,
  type ServiceCapabilities,
} from '@shared/protocol/project-collab-capabilities.js';

import { projectCollabApi } from '../sdk/projectCollab';

/**
 * 服务能力协商（CORE-05）——独立 Pinia 仓，⛔ 不挂进 projectCollab 大仓的 host 体系，
 * 以免与并发编辑（UX-03）撞同一批文件。
 *
 * 用途：进入项目详情时协商一次对面服务能力；渲染层据此在**旧服务**（缺
 * `requirement.dictionaries`）时显示升级提示。真正的「禁发新增写字段」由主进程写门
 * （collabClient）强制，本仓只承载「显示升级提示」这一侧。
 */
interface State {
  capabilities: ServiceCapabilities | null;
  loaded: boolean;
  loading: boolean;
}

export const useProjectServiceCapabilitiesStore = defineStore('project-service-capabilities', {
  state: (): State => ({ capabilities: null, loaded: false, loading: false }),
  getters: {
    supportsChatSearch(state): boolean {
      return state.loaded && hasCapability(state.capabilities, SERVICE_CAPABILITY.chatSearch);
    },
    /** 未确认服务端支持幂等时，不创建可重试发送请求。 */
    supportsChatIdempotency(state): boolean {
      return state.loaded && hasCapability(state.capabilities, SERVICE_CAPABILITY.chatIdempotency);
    },
    /** 对面是否支持归类写字段（module_id / category_id）。未协商到＝按不支持保守处理前先看 loaded。 */
    supportsRequirementDictionaries(state): boolean {
      return hasCapability(state.capabilities, SERVICE_CAPABILITY.requirementDictionaries);
    },
    /**
     * 是否应显示升级提示：**已协商成功**且对面缺归类写能力（＝旧服务）。
     * ⚠️ 未协商（loaded=false）不提示——避免协商前的空窗误报。
     */
    serviceUpgradeRequired(): boolean {
      return this.loaded && !this.supportsRequirementDictionaries;
    },
    /**
     * 对面是否支持整需求提测与轮次读取（TST-02，`requirement.test_mode`）。
     *
     * ⚠️ 与 `serviceUpgradeRequired` 的保守方向**相反**：那条「判不出就不提示」，这条「判不出就不支持」——
     *    未加载、加载失败、旧服务一律 false，提测入口与「测试记录」不出现、也不发轮次请求。新客户端连旧
     *    服务端（没有轮次端点）时由此不摆必错的入口、不报错。
     */
    supportsRequirementTestMode(state): boolean {
      return (
        state.loaded && hasCapability(state.capabilities, SERVICE_CAPABILITY.requirementTestMode)
      );
    },
    /**
     * 对面是否支持测试轮次的用例（TST-04，`requirement.test_cases`）。与上一条同方向：判不出就不支持——
     * 轮次卡不出「进入测试」、不取各轮条数，新客户端连旧服务端时不摆必错的入口。
     */
    supportsRequirementTestCases(state): boolean {
      return (
        state.loaded && hasCapability(state.capabilities, SERVICE_CAPABILITY.requirementTestCases)
      );
    },
  },
  actions: {
    /**
     * 协商一次服务能力（幂等：失败不写 loaded，可重试）。
     * 旧服务端 404 由主进程折成 legacy 空能力集（成功态），因此这里成功但能力清单为空。
     */
    async load(): Promise<void> {
      if (this.loading) return;
      this.loading = true;
      try {
        const result = await projectCollabApi.serviceCapabilities();
        if (result.ok) {
          this.capabilities = result.capabilities;
          this.loaded = true;
        }
      } catch {
        /* 协商失败不打扰用户；下次进入或手动刷新会再协商。loaded 保持 false，不误报升级。 */
      } finally {
        this.loading = false;
      }
    },
    /** 切项目/账号时清空，避免把上一处的协商结果带过去。 */
    reset(): void {
      this.capabilities = null;
      this.loaded = false;
      this.loading = false;
    },
  },
});
