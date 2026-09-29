import { z } from 'zod';

import { ProjectIterationSchema } from './project-planning.js';

/**
 * 项目级**模块字典 / 分类字典**的客户端契约，外加迭代的**只读引用**形状。
 *
 * 本文件只描述服务端迁移 `0021_project_module_category_dictionaries.sql` 建出来的两张表
 * 在客户端一侧的形状，以及需求上那两列绑定的三种取值语义：
 *  - `project_modules`    模块字典（例：成员与权限 / 需求看板）
 *  - `project_categories` 分类字典（例：功能 / 缺陷 / 技术债）
 *
 * ⭐ 存在的理由只有一条：**模块与分类是正式字段，不是 `labels` 的换皮**。
 *    `labels` 是谁都能随手加的自由标签——没有项目级名册、没有归档、没有乐观锁，
 *    也没有任何东西挡得住两个人写出两个拼法。正式字段要的恰恰是那几样。
 *    ⛔ 所以这个模块里**不存在**、也永远不该出现任何「从 labels 推模块」
 *    「从日期/季度串推归属」的函数。那条禁令有机器载体：
 *    `project-collab-dictionaries.test.ts` 把本模块的导出面**逐个枚举**并断言相等，
 *    同时按词根拒绝 infer / guess / label / sprint / quarter 一类的新导出。
 *
 * ⛔ **本文件刻意还没有** 请求/响应契约与 IPC 通道：字典的增删改查、需求上的
 *    `moduleId` / `categoryId` 投影与写入，属「模块分类写入贯通」那一项。在这里先写出
 *    一份没有通道、没有实现、没有用例的接口，只会得到一份被人当成真相源的假契约
 *    （`project-planning.ts` / `project-collab-assets.ts` 同一条纪律）。
 *
 * 字段命名口径与 `project-collab.ts` 逐条一致：服务端 HTTP 与 DDL 是 `snake_case`，
 * 客户端契约是 `camelCase`，投影发生在 `src/main/services/collab/collabWireMapping.ts`。
 * 逐字段对应关系写在下面每个 schema 的注释里，映射层照它实现即可。
 *
 * ⚠️ 三条红线由 schema 结构性承载（与 `project-collab.ts` 同一份纪律）：
 *  1. 【账号】没有 accountKey 或任何账号字段；`strictObject` 让「多带一个字段」连表达
 *     都表达不出来。
 *  2. 【埋点红线】没有任何助手会话正文字段。唯一的自由正文是用户**亲笔**写下的字典
 *     条目名称。
 *  3. 【白标】标识符与注释不含内核品牌词根。
 */

/**
 * 字典条目名称的字符上限。
 *
 * 与服务端 DDL 的 `length(name) BETWEEN 1 AND 200` **同界**，也与规划域的
 * `project_milestones.name` 同界——同一族「项目级具名对象」不设两个数。
 * 改小是允许的（客户端拒绝的服务端必拒），改大会得到一个本地过、服务端 422 的请求。
 */
export const PROJECT_DICTIONARY_MAX_NAME_LENGTH = 200;

/** 服务端资源 id（uuid）。 */
const entityIdSchema = z.string().uuid();

/** 成员身份主体（服务端不存 accountKey，客户端契约同样不表达）。 */
const subjectSchema = z.string().min(1).max(256);

/** ISO8601 时间串（服务端原样，展示用；客户端不解析成时钟）。 */
const timestampSchema = z.string().max(64);

/**
 * 一条字典条目（`project_modules` 或 `project_categories` 的一行）。
 *
 * 线协议字段逐条对应：`id` / `name` / `archived_at` / `version` / `creator_subject` /
 * `created_at` / `updated_at`。
 *
 * ⭐ **模块与分类共用这一个形状，而不是各写一份**：两张表逐字同形态，抄成两份只会
 *    得到两套会各自漂移的上界与归档语义。「这是哪本字典」由读它的字段/路由决定，
 *    而**串号的判定在库层**：两根复合外键分别指向两张表，把一个分类 id 填进
 *    `module_id` 会直接外键失配。客户端这边再补一层名义类型，挡不住任何真实错法
 *    （两侧都是裸 uuid 串）。
 *
 * ⚠️ `projectId` **不在**这里：字典恒在某个项目的上下文里被读出来，把它再塞进每一行
 * 只会多出一个可以与请求上下文矛盾的字段。服务端的 project 归属由 `project_id` 列与
 * 复合外键保证，客户端不需要也不该拿它做二次判断（`project-planning.ts` 同一条）。
 */
export const ProjectDictionaryEntrySchema = z.strictObject({
  /**
   * ⭐ 稳定 UUID。**名称不是键**：字典条目是要改名的（「登录」改成「登录与鉴权」），
   * 改名之后已绑定的需求一条都不该跟着变。服务端侧的同一条纪律是两张表都没有
   * `UNIQUE(name)`，也没有任何把日期列纳进去的唯一约束。
   */
  id: entityIdSchema,
  name: z
    .string()
    .min(1)
    .max(PROJECT_DICTIONARY_MAX_NAME_LENGTH)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden'),
  /**
   * ⭐ 归档时刻。null ＝ 未归档。
   *
   * 归档是**打标记**而不是删除：归档后**已有的历史引用一条不少**，旧需求照旧读得到
   * 这个名字，只是默认下拉不再列它、也不再接受新绑定。判「还能不能绑」走
   * `canProjectDictionaryEntryAcceptNewBinding`。
   *
   * 所以这个契约里没有、也不会有 `deletedAt`：服务端那两张表刻意没有这一列，
   * 而已被引用的条目连物理删除都被外键挡着（缺省 NO ACTION）。
   */
  archivedAt: timestampSchema.nullable(),
  /**
   * 乐观并发的版本号。
   *
   * ⛔ **不设上界**，别给它安一个「够用的」常量。这是服务端单调递增的计数，客户端
   * 单方面定的任何数字都只是下一堵墙；而越界的代价远不止这一条：列表投影一条坏
   * 全批坏（`mapArray` 见 null 即整页返回 null），所以一旦越界，表现不是「少显示
   * 一行」，是整份字典取不回来。同一条纪律适用于所有来自服务端的计数字段。
   */
  version: z.number().int().safe().positive(),
  creatorSubject: subjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * 挂在需求上的字典**引用摘要**（接口契约里的 `module` / `category` 嵌套对象）。
 *
 * ⭐ 由 `ProjectDictionaryEntrySchema` **派生**而不是另写一份：再抄一遍 `name` 的上界
 *    就等于给同一件事立第二个出处，而两个出处迟早会差一个数字。
 *
 * ⭐ 带着 `archivedAt` 是有意的：历史需求绑的可能正是一条**已归档**的条目，界面要能
 *    把它标出来（而不是当成脏数据藏掉）。这也是「归档保留历史引用」在客户端一侧的
 *    落点——解析一条 archivedAt 非空的引用**必须成功**。
 */
export const ProjectDictionaryEntryRefSchema = ProjectDictionaryEntrySchema.pick({
  id: true,
  name: true,
  archivedAt: true,
});

/**
 * 迭代的**只读引用**形状。
 *
 * ⭐⭐ 由规划域已有的 `ProjectIterationSchema` **派生**（`.pick()`，同一批 Zod 实例），
 *     这就是「迭代实体只由规划域那条线创建、这里只引用」的结构性载体：
 *     ⛔ 本文件一个迭代字段都没有自己声明，所以**不可能**长出第二套迭代定义，
 *     也不可能与那边漂移——用例直接断言两处的字段实例**是同一个对象**。
 *
 * ⛔ 本项对迭代**只读**：需求上的 `iterationId` 投影与排期写入归迭代关联那条线
 *    （唯一写口），这里不声明绑定字段、不提供任何写请求形状。
 *
 * ⚠️ 与旧版接口契约（`api-contracts.md` §2）的一处不一致，以现状为准：那里把引用写成
 *    `{id,name,start_at,due_at,archived_at}`，但 V2 之后 `start_at` 属**业务目标**
 *    （`project_milestones`），单轮迭代表上只有 `due_at`。照旧稿写会得到一个服务端
 *    永远不回的字段。
 */
export const ProjectIterationRefSchema = ProjectIterationSchema.pick({
  id: true,
  name: true,
  dueAt: true,
  archivedAt: true,
});

/**
 * 需求上一列字典绑定的取值（`module_id` / `category_id`）。
 *
 * null ＝ **未分类**，一个有意的常态而不是脏数据：服务端那两列可空且无缺省，
 * 也**没有**「未分类」哨兵字典行（造它就得给所有存量项目回填，而回填就是在猜）。
 */
export const ProjectDictionaryBindingSchema = entityIdSchema.nullable();

/**
 * 一列字典绑定的三种状态。
 *
 * ⚠️ 三态而不是两态：`absent`（字段根本没出现）与 `uncategorized`（出现了，是空）
 * 是**两件不同的事**，合成一件会同时做错两个方向——
 *  - 读：旧服务不回这两列，把 absent 当成 uncategorized 就是替服务端宣布「这条没归类」；
 *  - 写：PATCH 省略该字段是「不改」，传 null 是「清空」，合成一件就再也表达不出「清空」。
 */
export type ProjectDictionaryBindingState = 'absent' | 'uncategorized' | 'bound';

/**
 * 判一列字典绑定处在哪一态。
 *
 * ⛔ 调用点**不要**自己写 `if (!value)`：那一条在 `null`、`undefined` 和空串上同时成立，
 * 恰好把上面那两个方向一起做错。判定收口成这一个函数，就只有一处可以写错。
 *
 * ⚠️ 空串不在合法取值里（`ProjectDictionaryBindingSchema` 在解析时就拒了），所以经协议
 * 解析出来的值只可能是 uuid / null / 缺席三者之一。
 */
export function projectDictionaryBindingState(
  value: string | null | undefined,
): ProjectDictionaryBindingState {
  if (value === undefined) {
    return 'absent';
  }
  if (value === null) {
    return 'uncategorized';
  }
  return 'bound';
}

/** 这条字典条目是否已归档（归档后仍可读，历史引用保留）。 */
export function isProjectDictionaryEntryArchived(entry: { archivedAt: string | null }): boolean {
  return entry.archivedAt !== null;
}

/**
 * 这条字典条目还能不能接受**新的**绑定。
 *
 * 「归档」的全部含义就落在这一个问句上：已归档 ⇒ 新绑定拒绝，而**存量绑定照旧**
 * （改标题、改状态都不受影响）。服务端侧的同一条纪律是那个只在绑定列**发生变化**时
 * 才起臂的触发器——少了「发生变化」这个前提，归档会把一批需求冻死。
 */
export function canProjectDictionaryEntryAcceptNewBinding(entry: {
  archivedAt: string | null;
}): boolean {
  return !isProjectDictionaryEntryArchived(entry);
}

export type ProjectDictionaryEntry = z.infer<typeof ProjectDictionaryEntrySchema>;
export type ProjectDictionaryEntryRef = z.infer<typeof ProjectDictionaryEntryRefSchema>;
export type ProjectIterationRef = z.infer<typeof ProjectIterationRefSchema>;
export type ProjectDictionaryBinding = z.infer<typeof ProjectDictionaryBindingSchema>;
