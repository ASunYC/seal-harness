import type { ProjectTodoUpdateRequest, Todo } from '../../../../../projects/stratex/shared/protocol/project-collab.js';

/**
 * 改单的**真实变更集**：模型给的字段里，相对当前事项确实变了的那部分。
 *
 * 现场（2026-09-14，托管对话模型）：该模型每次调用都把改单工具的全部属性抄回来——值取自
 * `project_list_todos`。改单语义是「不传＝不变，null＝清空」，照单全收就会：
 *  ① 把列表里只有前 {@link PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH} 字的描述预览写回去，服务端的描述被静默截断；
 *  ② 在审批卡上把每个字段都列一遍，人看不出到底改了什么；
 *  ③ 把抄回来的「进行中」当成开工、把抄回来的处理人送进服务端「待验收冻结处理人」那道闸（它按键拒，不看值）。
 *
 * 判定（逐字段，与当前值相同＝不变，既不写入也不上审批卡）：
 *  - 描述：与当前全文相同，或恰好等于当前全文的列表预览（全文长于预览时）⇒ 不变。
 *    ⚠️ 代价：真想把描述改成「恰好是原文前 300 字」的那一次也会被当成不变——与静默截断相比取前者。
 *    null（清空）而当前描述本来就空 ⇒ 不变。
 *  - 标签 / 关联材料：按顺序逐项相同 ⇒ 不变。
 *  - 模块 / 分类：旧服务端不回这两个键（三态里的「未知」）时比不出来，按「变了」照写照上卡。
 *  - 其余标量（父项、标题、状态、处理人档位与处理人、优先级、日期、注意事项）：严格相等 ⇒ 不变。
 *
 * ⛔ 「null＝清空」的既有契约不动：当前有值时 null 照样是一次清空。
 */

/** 待办描述在列表投影里的预览长度；全文经 `project_read_work_order` 取。 */
export const PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH = 300;

/** 列表投影里的描述预览。变更集判「抄回的是预览」用的也是这一份切法，⛔ 两处不许各切各的。 */
export function todoDescriptionPreview(description: string): string {
  return description.slice(0, PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH);
}

/** 改单里可变的字段（不含定位与乐观锁；会话关联由 Main 另行决定，不收模型给的）。 */
export type TodoUpdateFields = Omit<
  ProjectTodoUpdateRequest,
  'todoId' | 'expectedVersion' | 'sessionRef'
>;

type TodoUpdateField = keyof TodoUpdateFields;

export function todoUpdateChangeSet(requested: TodoUpdateFields, current: Todo): TodoUpdateFields {
  const changes: Partial<Record<TodoUpdateField, unknown>> = {};
  for (const [field, value] of Object.entries(requested) as [TodoUpdateField, unknown][]) {
    if (value !== undefined && fieldChanged(field, value, current)) changes[field] = value;
  }
  return changes as TodoUpdateFields;
}

function fieldChanged(field: TodoUpdateField, value: unknown, current: Todo): boolean {
  switch (field) {
    case 'description':
      return descriptionChanged(value as string | null, current.description);
    case 'labels':
      return !sameStrings(value as readonly string[], current.labels);
    case 'refs':
      return !sameStrings(value as readonly string[], current.refs);
    case 'moduleId':
    case 'categoryId':
      return current[field] === undefined || value !== current[field];
    default:
      return value !== current[field];
  }
}

function descriptionChanged(requested: string | null, current: string): boolean {
  if (requested === null) return current.length > 0;
  if (requested === current) return false;
  return !(
    current.length > PROJECT_TODO_DESCRIPTION_PREVIEW_LENGTH &&
    requested === todoDescriptionPreview(current)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
