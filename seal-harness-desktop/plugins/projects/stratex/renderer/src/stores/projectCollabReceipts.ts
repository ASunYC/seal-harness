import { useToastStore } from './toasts';

/**
 * 项目组**成功回执的出口**。
 *
 * ## 判据只有一条：这条反馈有没有把球踢回给用户？
 *
 * ⛔ **不看成功还是失败**——「成功走 toast、失败走常驻」是个看起来顺手、实际会出错的
 * 分法：`该待办已被他人更新，已为你刷新到最新版本。` 是一条成功路径上的回执，但用户
 * 刚才那次编辑**没保存上**，他得回去照新版本重下一次决定；把它塞进 3 秒 toast，
 * 等于让一次没落地的写入自己消失。
 *
 * - **没踢球**（纯报告「已经做完了」，用户读不读都不影响接下来做什么）⇒ 本模块，
 *   3 秒自灭的 toast（`ToastStack` 统一渲染，不随路由蒸发）。
 * - **踢了球**（还要用户去做一件事：刷新后重试、把路径复制走、把没改成的几条重来）
 *   ⇒ 留在 `store.actionNotice` 的常驻条，让用户读完自己关。
 *
 * ⚠️ 失败回执（`projectCollabErrorNotice`）**一律不走这里**：它们带参考编号，用户要
 * 照着念给支持人员，3 秒不够抄。
 *
 * ## 为什么不塞进 `projectCollabErrors.ts`
 *
 * 那个模块是**纯文案**（可以被任何地方 import 而不引入副作用）；这里要碰 Pinia。
 * 混在一起会让「只想拿一句文案」的调用方顺带把 toast 队列拖进来。
 */

/**
 * 推一条项目组成功回执（info 档，D3.36 下 3 秒自灭）。
 *
 * ⚠️ 只传 `level` + `text`：D3.35 五字段里的 `code` 属失败态、`actions` 属需要用户
 * 再点一下的场景——两者都与「没踢球」互斥。⛔ 不新增第六个字段。
 */
export function pushProjectCollabReceipt(message: string): void {
  useToastStore().push({ level: 'info', text: message });
}
