import { readonly, ref, type Ref } from 'vue';

/**
 * 加入深链（`stratex://project/join?code=…`）落到渲染层后的**瞬时投递格**。
 *
 * 为什么需要它：深链订阅必须**早**布防（App 根，冷启动才不漏），而消费方
 * 「加入项目」表单（ProjectsView）多半此刻还没挂载——两者之间要一个只存一份、
 * 后到覆盖、取走即清的传递格，与主进程「登录前暂存、登录后投递、只存一份」同一形状。
 *
 * ⚠️ 明文纪律：邀请码只在这里活一瞬（订阅回调 stash → 表单 take 即清），
 * ⛔ 不是 pinia store、不落库、不进日志、不进埋点；换账号（`resetForAccountChange`）
 * 主动清空，避免上一个账号未消费的码被下一个账号的表单读走。
 */
const pendingJoinCode = ref<string | null>(null);

/** 深链订阅收到邀请码时暂存一份（后到覆盖前一份）。 */
export function stashPendingJoinCode(code: string): void {
  pendingJoinCode.value = code;
}

/** 取走待预填的邀请码并**立即清空**（一次性消费，避免重复预填）。 */
export function takePendingJoinCode(): string | null {
  const code = pendingJoinCode.value;
  pendingJoinCode.value = null;
  return code;
}

/** 换账号 / 登出时清空未消费的暂存码。 */
export function clearPendingJoinCode(): void {
  pendingJoinCode.value = null;
}

/** 只读信号：供已挂载的表单 `watch` 到「热态」深链到达（值非空即有新码待取）。 */
export function pendingJoinCodeSignal(): Readonly<Ref<string | null>> {
  return readonly(pendingJoinCode);
}
