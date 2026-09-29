import { projectStorage } from '../../../../../src/ui/runtime';
import {
  DEFAULT_ITERATION_PLAN_VIEW,
  isIterationPlanView,
  type IterationPlanView,
} from './iteration-schedule-view';

/**
 * 迭代计划视图偏好（MIL-06）：**按业务目标**记住上次选的是看板 / 列表 / 甘特图。
 *
 * ⚠️ 键**同时含账号、项目、业务目标**三段（同 `project-views.ts` 的 `stratex.project.*:<账号>:<项目>`
 *    那套，再多一段目标——原型 `milestone-view28:${planScope27()}:${plan.id}` 就是按目标记的）。
 *    ⛔ 去掉任一段都会串味：去账号 ⇒ 换号看到别人的视图；去项目/目标 ⇒ 跨项目/跨目标串味。
 *    账号缺席时用 `anon` 占位（与任何真实账号天然隔离、键仍良构）。
 *
 * ⭐ 存储不可用 / 写抛异常 ⇒ `writeIterationPlanView` 回 `false`，调用方据此提示
 *    「视图偏好保存失败，原视图保留。」并**不切换**视图（原型 `stage-view28` 的 catch 分支）。
 */

const PREFERENCE_PREFIX = 'stratex.project.iteration-view';
const ANON_ACTOR = 'anon';

/** 视图偏好写失败的提示（逐字对齐原型）。 */
export const ITERATION_PLAN_VIEW_SAVE_FAILED_MESSAGE = '视图偏好保存失败，原视图保留。';

export interface IterationPlanPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function iterationPlanViewPreferenceKey(
  actor: string | null,
  projectId: string,
  milestoneId: string,
): string {
  return `${PREFERENCE_PREFIX}:${actor ?? ANON_ACTOR}:${projectId}:${milestoneId}`;
}

function resolveStorage(
  storage?: IterationPlanPreferenceStorage,
): IterationPlanPreferenceStorage | null {
  if (storage) return storage;
  try {
    return projectStorage() ?? null;
  } catch {
    return null;
  }
}

/** 读回偏好：不可用 / 没存过 / 坏值 ⇒ 默认列表（⛔ 不因脏值崩）。 */
export function readIterationPlanView(
  actor: string | null,
  projectId: string,
  milestoneId: string,
  storage?: IterationPlanPreferenceStorage,
): IterationPlanView {
  const store = resolveStorage(storage);
  if (!store) return DEFAULT_ITERATION_PLAN_VIEW;
  try {
    const raw = store.getItem(iterationPlanViewPreferenceKey(actor, projectId, milestoneId));
    if (raw === null) return DEFAULT_ITERATION_PLAN_VIEW;
    const parsed: unknown = JSON.parse(raw);
    const view = (parsed as { readonly view?: unknown } | null)?.view;
    return isIterationPlanView(view) ? view : DEFAULT_ITERATION_PLAN_VIEW;
  } catch {
    return DEFAULT_ITERATION_PLAN_VIEW;
  }
}

/** 写偏好：成功 `true`；存储不可用或写抛异常 `false`（调用方保留原视图并提示）。 */
export function writeIterationPlanView(
  actor: string | null,
  projectId: string,
  milestoneId: string,
  view: IterationPlanView,
  storage?: IterationPlanPreferenceStorage,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(
      iterationPlanViewPreferenceKey(actor, projectId, milestoneId),
      JSON.stringify({ view }),
    );
    return true;
  } catch {
    return false;
  }
}
