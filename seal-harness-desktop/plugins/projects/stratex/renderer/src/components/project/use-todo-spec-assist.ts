import { computed, onBeforeUnmount, shallowRef, type ComputedRef, type ShallowRef } from 'vue';

import type {
  ProjectSpecAssistRequest,
  ProjectSpecAssistResult,
  TodoSpecSuggestion,
} from '@shared/protocol/project-spec-assist.js';

import { projectSpecAssistApi } from '../../sdk/projectSpecAssist';
import { specAssistErrorText, type SpecAssistReadiness } from './todo-spec-assist';

/**
 * 派单表单「让助理补全」的请求生命周期（ADR-0043）：就绪查询、单次在途、取消、迟到丢弃。
 *
 * 迟到丢弃在渲染层再判一次（主进程已判过账号）：结果回来时，请求号、所在项目、登录主体
 * 任一与发起时不同就丢——登出登入是**原地换号**，视图不卸载，只看卸载拦不住。
 */

export interface TodoSpecAssistError {
  readonly message: string;
  readonly referenceCode: string | null;
}

export interface TodoSpecAssistIdentity {
  readonly projectId: string | null;
  readonly subject: string | null;
}

interface PendingRequest extends TodoSpecAssistIdentity {
  readonly requestId: string;
}

export interface TodoSpecAssistHandle {
  readonly readiness: ShallowRef<SpecAssistReadiness>;
  readonly generating: ComputedRef<boolean>;
  readonly error: ShallowRef<TodoSpecAssistError | null>;
  refreshReadiness(): Promise<void>;
  generate(
    request: Omit<ProjectSpecAssistRequest, 'requestId'>,
  ): Promise<TodoSpecSuggestion | null>;
  cancel(): void;
  clearError(): void;
}

export function useTodoSpecAssist(options: {
  readonly identity: () => TodoSpecAssistIdentity;
}): TodoSpecAssistHandle {
  const readiness = shallowRef<SpecAssistReadiness>('unknown');
  const pending = shallowRef<PendingRequest | null>(null);
  const error = shallowRef<TodoSpecAssistError | null>(null);
  let disposed = false;

  async function refreshReadiness(): Promise<void> {
    try {
      const result = await projectSpecAssistApi.readiness();
      if (!disposed && result.ok) readiness.value = result.state;
    } catch {
      // 查询失败不挡用户：保持未知态，判定在主进程，点了照样得到准确说明。
    }
  }

  async function generate(
    request: Omit<ProjectSpecAssistRequest, 'requestId'>,
  ): Promise<TodoSpecSuggestion | null> {
    if (pending.value !== null) return null;
    const token: PendingRequest = {
      requestId: globalThis.crypto.randomUUID(),
      ...options.identity(),
    };
    pending.value = token;
    error.value = null;
    let result: ProjectSpecAssistResult | null;
    try {
      result = await projectSpecAssistApi.generate({ ...request, requestId: token.requestId });
    } catch {
      result = null;
    }
    // 已取消（或已被别的请求取代）：迟到的结果一律丢弃。
    if (disposed || pending.value !== token) return null;
    pending.value = null;
    const current = options.identity();
    if (current.projectId !== token.projectId || current.subject !== token.subject) return null;
    if (result === null) {
      error.value = { message: specAssistErrorText('transient'), referenceCode: null };
      return null;
    }
    if (!result.ok) {
      if (result.code === 'cancelled') return null;
      if (result.code === 'modelNotSupported' || result.code === 'modelUnavailable') {
        readiness.value = result.code;
      }
      error.value = {
        message: specAssistErrorText(result.code),
        referenceCode: result.referenceCode,
      };
      return null;
    }
    return result.requestId === token.requestId ? result.suggestion : null;
  }

  function cancel(): void {
    const token = pending.value;
    if (token === null) return;
    pending.value = null;
    try {
      // 同步发出：卸载路径上组件马上就没了，放到微任务里可能来不及。
      void Promise.resolve(projectSpecAssistApi.cancel(token.requestId)).catch(() => undefined);
    } catch {
      // 桥不可用时主进程侧仍有总时限与窗口销毁释放兜底；这里不再抛。
    }
  }

  onBeforeUnmount(() => {
    cancel();
    disposed = true;
  });

  return {
    readiness,
    generating: computed(() => pending.value !== null),
    error,
    refreshReadiness,
    generate,
    cancel,
    clearError: () => {
      error.value = null;
    },
  };
}
