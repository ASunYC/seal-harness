import { defineStore } from 'pinia';

import type { ToastAction, ToastInput, ToastLevel } from '../components/ui/toastQueue';

/**
 * §3.7 通知唯一出口的**共享队列源**。
 *
 * 为什么要有这个 store：`ToastStack.vue` 是受控渲染组件、队列判定在 `toastQueue.ts` 的纯函数里，
 * 但「谁能往里推一条」此前只有壳层（`MainWindow` 的本地 `pushToast`）说了算——路由到的**视图**
 * （如智能助手目录）想报一条「已安装 / 公开失败」只能各自在页内自绘 notice 块，于是同一件事
 * 在不同页有不同出口、成功失败还常同色同槽。这个 store 给视图层一个**带级别**的推送入口，
 * 由壳层挂载的同一个 `ToastStack` 统一渲染，通知不再随路由蒸发（沉浸态状态栏隐藏也照常可见）。
 *
 * D3.35【铁律】：一条 Toast 只有 `{ id, level, text, code?, actions? }` 五个字段。
 * 本 store 的 `push` 入参不含 `id`（由此处生成），其余严格对齐五字段，**不新增第六个**。
 */

/** 视图层推送 Toast 的入参：不含 `id`（store 生成），其余同 D3.35 五字段口径。 */
export interface ToastPush {
  readonly level: ToastLevel;
  readonly text: string;
  /** 参考码（失败态照着念给支持人员用）；无则不传，不塞空串。 */
  readonly code?: string;
  readonly actions?: readonly ToastAction[];
}

/**
 * 保留上限：本 store 只是「待渲染队列的源」——同时可见/超出排队/自动消失都由 `ToastStack`
 * 的纯函数判定。这里的上限只防**历史项无界堆积**：已渲染过的项由 `ToastStack` 的 `seen`
 * 去重，从源里丢弃不会让它重播，故裁掉最旧的是安全的。
 */
const MAX_RETAINED = 24;

interface ToastStoreState {
  entries: ToastInput[];
  sequence: number;
}

export const useToastStore = defineStore('toasts', {
  state: (): ToastStoreState => ({ entries: [], sequence: 0 }),
  actions: {
    /** 推一条通知，返回其 id（调用方一般不需要，留给需要主动 dismiss 的场景）。 */
    push(input: ToastPush): string {
      this.sequence += 1;
      const id = `view-${this.sequence}`;
      const entry: ToastInput = {
        id,
        level: input.level,
        text: input.text,
        // exactOptionalPropertyTypes：可选字段缺省时不写键，绝不写 `undefined`。
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.actions !== undefined ? { actions: input.actions } : {}),
      };
      const next = [...this.entries, entry];
      this.entries = next.length > MAX_RETAINED ? next.slice(next.length - MAX_RETAINED) : next;
      return id;
    },
    dismiss(id: string): void {
      this.entries = this.entries.filter((entry) => entry.id !== id);
    },
    clear(): void {
      this.entries = [];
    },
  },
});
