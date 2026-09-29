import type {
  ProjectSpecAssistErrorCode,
  ProjectSpecAssistReadinessState,
  TodoSpecSuggestion,
} from '@shared/protocol/project-spec-assist.js';

/**
 * 派单表单「让助理补全」的纯逻辑：回填规划与用户面文案（ADR-0043）。
 *
 * 回填规划逐字段独立判定，核心一条：**已填的不静默覆盖**——当前字段有内容且与建议不同，
 * 只把建议挂在字段下方由用户决定，⛔ 不替用户换掉。
 */

export type SpecAssistField = 'description' | 'acceptanceItems' | 'constraintsText';

export interface SpecAssistFormValues {
  readonly description: string;
  readonly acceptanceItems: readonly string[];
  readonly constraintsText: string;
}

export type SpecFieldPlan<T> =
  | { readonly kind: 'fill'; readonly value: T }
  | { readonly kind: 'suggest'; readonly value: T }
  | { readonly kind: 'none' };

export interface SpecAssistFillPlan {
  readonly description: SpecFieldPlan<string>;
  readonly acceptanceItems: SpecFieldPlan<readonly string[]>;
  readonly constraintsText: SpecFieldPlan<string>;
}

/** 验收清单的规范形：逐条去首尾空白、剔掉空行。 */
export function normalizedAcceptance(items: readonly string[]): readonly string[] {
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function sameAcceptance(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedAcceptance(left);
  const b = normalizedAcceptance(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function planText(current: string, suggested: string): SpecFieldPlan<string> {
  if (suggested.trim().length === 0) return { kind: 'none' };
  if (current.trim().length === 0) return { kind: 'fill', value: suggested };
  if (current.trim() === suggested.trim()) return { kind: 'none' };
  return { kind: 'suggest', value: suggested };
}

function planAcceptance(
  current: readonly string[],
  suggested: readonly string[],
): SpecFieldPlan<readonly string[]> {
  if (normalizedAcceptance(suggested).length === 0) return { kind: 'none' };
  if (normalizedAcceptance(current).length === 0) return { kind: 'fill', value: suggested };
  if (sameAcceptance(current, suggested)) return { kind: 'none' };
  return { kind: 'suggest', value: suggested };
}

export function planSpecAssistFill(
  current: SpecAssistFormValues,
  suggestion: TodoSpecSuggestion,
): SpecAssistFillPlan {
  return {
    description: planText(current.description, suggestion.description),
    acceptanceItems: planAcceptance(current.acceptanceItems, suggestion.acceptanceItems),
    constraintsText: planText(current.constraintsText, suggestion.constraintsText),
  };
}

/** 设置入口的实际叫法：设置 → 「模型配置」，其中那一格叫「新会话默认模型」。 */
const MODEL_SETTINGS_PATH = '可在设置的「模型配置」中';

export const SPEC_ASSIST_TITLE_REQUIRED_HINT = '先写一句标题，助理才知道要补全什么。';
export const SPEC_ASSIST_REVIEW_FROZEN_HINT = '待验收中的单不能补全：验收方正对着这份清单核对。';
export const SPEC_ASSIST_LOADING_HINT = '正在取这张单的验收判据…';

/** 失败码 → 表单里的一句话。⛔ 不回显主进程或模型文本，不出现实现层称谓。 */
export function specAssistErrorText(code: ProjectSpecAssistErrorCode): string {
  switch (code) {
    case 'unavailable':
      return '项目组能力未启用，暂时不能补全。';
    case 'authRequired':
      return '请先登录后再使用助理补全。';
    case 'invalidRequest':
      return '填写的内容不合法，请检查后重试。';
    case 'forbidden':
      return '没有这个项目的访问权限。';
    case 'credentialRejected':
      return '登录状态已失效，请重新登录。';
    case 'rateLimited':
      return '操作过于频繁，请稍后再试。';
    case 'transient':
      return '网络暂时不可用，请稍后重试。';
    case 'modelUnavailable':
      return `当前没有可用于补全的模型，${MODEL_SETTINGS_PATH}检查新会话默认模型。`;
    case 'modelNotSupported':
      return `当前的新会话默认模型不支持助理补全，${MODEL_SETTINGS_PATH}更换新会话默认模型。`;
    case 'modelTimeout':
      return '助理这次没能按时给出结果，请稍后再试。';
    case 'modelOutputInvalid':
      return '助理这次给出的内容不完整，请重试。';
    case 'modelFailed':
      return '模型服务暂时出错，请稍后再试。';
    case 'busy':
      return '上一次补全还没结束。';
    case 'cancelled':
      return '已取消补全。';
  }
}

export type SpecAssistReadiness = ProjectSpecAssistReadinessState | 'unknown';

/**
 * 就绪态 → 置灰时说的话；可用或尚未知道（查询失败、还没回来）时为 null——
 * 未知态不挡用户，判定在主进程，点了照样会得到准确的失败说明。
 */
export function specAssistReadinessHint(state: SpecAssistReadiness): string | null {
  if (state === 'modelNotSupported' || state === 'modelUnavailable') {
    return specAssistErrorText(state);
  }
  return null;
}
