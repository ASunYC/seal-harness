/**
 * 项目工具参数里「写出来的没有」→「不传」：执行器在交给共享协议 schema 校验**之前**做这一步。
 *
 * 现场（2026-09-14，托管对话模型）：该模型每次调用都把工具声明里的全部属性序列化出来，从不省略。
 * 建单工具表达「顶层需求 / 不指派 / 没有日期」却只能靠不传，于是它给 parentId 轮流填空串、
 * 占位词、伪 UUID，连续失败 20 次；「请省略该参数」这句指引对它根本做不到。工具声明因此改为
 * 可选属性一律收 null，这里负责把 null 落回「不传」。
 *
 * 三条映射，各自只在列出的字段上生效：
 *  - **null**：等于不传。
 *  - **空白串**：只在「空白串永远不可能是合法值」的字段上等于不传——id、成员主体、日期、枚举、
 *    文件名。建单没有「不变 vs 清空」之分，服务端对缺席一律落缺省（顶层 / 不指派 / 无日期 /
 *    shared / notStarted / medium），空白串不携带任何别的意思，归一不丢信息。描述与注意事项的
 *    空串本身就是合法的「空」，照原样传，不在此列。
 *  - **空数组**：建单标签、提交验收的产出与逐条自述、草案条目的验收清单、迭代计划草案的完成标准——
 *    缺省就是空表，`[]` 与缺席同义。
 *
 * ⛔ 非空占位值（"omit" / "none" / "top-level" / 伪 UUID）**不归一**：伪 UUID 与真 id 在形状上
 *    无从区分，词形占位本就过不了 id 校验。替它们猜意图，等于把「模型编了个值」静默改写成另一件事。
 * ⛔ **改单工具不走这里**：改单里 null＝清空、`[]`＝清空标签，与「不传＝不变」不同义。
 * ⚠️ 共享协议 schema 本体不动：它们同时服务 IPC 与界面，「null＝不传」只是模型通道的写法，
 *    不该渗进人走的那条路。⛔ 也不挪到模型桥做全局归一——理由同上一条。
 */

type AbsentTest = (value: unknown) => boolean;

/** 字段名 → 该字段上哪种写法算「没有」。用 Map 而不是对象字面量：键来自模型，不能撞上原型链。 */
export type AbsentFieldTests = ReadonlyMap<string, AbsentTest>;

const isNull: AbsentTest = (value) => value === null;
const isNullOrBlank: AbsentTest = (value) =>
  value === null || (typeof value === 'string' && value.trim().length === 0);
const isEmptyList: AbsentTest = (value) => Array.isArray(value) && value.length === 0;

export const LIST_MESSAGES_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['beforeSeq', isNull],
  ['limit', isNull],
  ['authorSubject', isNull],
  ['createdAfter', isNull],
  ['createdBefore', isNull],
]);

export const LIST_TODOS_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['cursor', isNull],
  ['limit', isNull],
]);

export const CREATE_TODO_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['parentId', isNullOrBlank],
  ['visibility', isNullOrBlank],
  ['status', isNullOrBlank],
  ['assigneeSubject', isNullOrBlank],
  ['priority', isNullOrBlank],
  ['labels', isEmptyList],
  ['startAt', isNullOrBlank],
  ['dueAt', isNullOrBlank],
  ['description', isNull],
]);

export const DRAFT_ITEM_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['description', isNull],
  ['constraintsText', isNull],
  ['acceptanceItems', isEmptyList],
  ['priority', isNullOrBlank],
]);

export const SUBMIT_WORK_ORDER_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['artifacts', isEmptyList],
  ['itemNotes', isEmptyList],
]);

export const LIST_FILES_ABSENT_FIELDS: AbsentFieldTests = new Map([['kind', isNullOrBlank]]);

export const READ_FILE_ABSENT_FIELDS: AbsentFieldTests = new Map(
  ['page', 'slide', 'sheet', 'block', 'startLine', 'startChar', 'maxLines'].map(
    (name) => [name, isNull] as const,
  ),
);

export const SAVE_ASSET_ABSENT_FIELDS: AbsentFieldTests = new Map([['filename', isNullOrBlank]]);

export const LIST_MILESTONES_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['page', isNull],
  ['includeArchived', isNull],
]);

export const LIST_ITERATIONS_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['page', isNull],
  ['includeArchived', isNull],
]);

/**
 * 里程碑草案：目标说明的空串本身就是合法的「没写」，只把 null 当不传；日期与负责人的空白串永远不合法，
 * 与 null 同义。
 */
export const DRAFT_MILESTONE_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['objective', isNull],
  ['startAt', isNullOrBlank],
  ['dueAt', isNullOrBlank],
  ['ownerSubject', isNullOrBlank],
]);

export const DRAFT_ITERATION_ABSENT_FIELDS: AbsentFieldTests = new Map([
  ['dueAt', isNullOrBlank],
  ['criteria', isEmptyList],
  ['ownerSubject', isNullOrBlank],
]);

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 返回删掉「写出来的没有」这些键的新对象；不是普通对象就原样交给后面的 schema 去拒。 */
export function withoutAbsentFields(tests: AbsentFieldTests): (input: unknown) => unknown {
  return (input) => {
    if (!isPlainRecord(input)) return input;
    return Object.fromEntries(
      Object.entries(input).filter(([key, value]) => !(tests.get(key)?.(value) ?? false)),
    );
  };
}

/** 草案条目住在 `items` 数组里：逐条去掉条目里的「没有」，顶层其余键原样。 */
export function withoutAbsentItemFields(tests: AbsentFieldTests): (input: unknown) => unknown {
  const stripItem = withoutAbsentFields(tests);
  return (input) => {
    if (!isPlainRecord(input) || !Array.isArray(input['items'])) return input;
    return { ...input, items: input['items'].map(stripItem) };
  };
}
