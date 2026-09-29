import { z } from 'zod';

/**
 * ⚠️⚠️ **只能 `import type`，不能运行时 import** —— 否则模块图成环且**必炸**。
 *
 * 三条边（都已逐行核过）：
 *   1. `project-collab.ts`              → `project-collab-dictionaries.ts`（就是这一行）
 *   2. `project-collab-dictionaries.ts` → `project-planning.ts`（`ProjectIterationSchema`
 *      的 `.pick()`，是「迭代定义只有一份」的结构性载体，拆不掉）
 *   3. `project-planning.ts`            → `project-collab.ts`（失败信封三个 schema）
 *
 * 成环之后无论从哪个模块进入都会有一侧读到未初始化的 const：从本文件进入时是
 * `ProjectDictionaryBindingSchema` 为 undefined，从字典模块进入时是规划域读不到
 * `ProjectCollabErrorCodeSchema`。症状是 `Cannot read properties of undefined`，
 * ⛔ 不是「补个 `z.lazy` 就好」——那只会把同一个错挪到另一条边上。
 *
 * ⇒ 于是本文件把三个只读投影 schema 在下面**就地声明一遍**，而两处一致由
 *   `project-collab.test.ts` 的等价性用例钉住（键集相等 + 边界值逐个对照）。
 *   这与仓库既有的「同一条判据的两个载体、两侧各有用例钉住」同款
 *   （`TODO_VISIBILITY_SQL_PREDICATE` ↔ `todo_is_visible_to`）。
 *   ⛔ 别把它改回运行时 import 来「消掉重复」：那一改会让整套协议用例在 import 期就炸。
 */
import type {
  ProjectDictionaryEntryRef,
  ProjectIterationRef,
} from './project-collab-dictionaries.js';
// 只依赖 zod 的叶子模块：运行时 import 不会成环（与上面三条边无关）。
import { projectPlanWindowShape, refineProjectPlanWindow } from './project-collab-plan-dates.js';

/**
 * 项目组多人协作（`project:*`）的两端契约。
 *
 * 通道全集（28 请求 + 2 事件）见 `src/shared/ipc/channels.ts` 的 `PROJECT_*` 段。
 * 桌面系统通知那一组（notification-settings-read/write、notification-navigate）的
 * 契约在 `project-notifications.ts`，本文件只管与服务端说话的那一半：
 *  - 项目：availability / list / create / detail / update / invite / redeem-invitation
 *  - 成员管理（改角色/移除 manager+；转让/归档 owner-only）：
 *    member-update / member-remove / transfer / archive
 *  - 动态：feed-list / feed-post / comment-post
 *  - 讨论：chat-history / chat-send / chat-revoke / read-cursor
 *  - 待办：todo-list / todo-create / todo-update
 *  - 工作单：todo-detail / todo-acceptance-set / todo-submit-review / todo-review
 *  - 拆解草案闸：todo-draft-list / todo-draft-create / todo-draft-drop / todo-draft-resolve
 *  - 文件：file-list / file-upload / file-download / file-promote / file-delete
 *  - 事件单通道：`project:event`（连接状态帧 + 服务端域事件帧）
 *  - 另一条推送通道 `project:notification-navigate` 属通知域，见 `project-notifications.ts`
 *
 * ⚠️ 三条**红线由本文件的 schema 结构性承载**，不是口头约定：
 *
 *  1. 【账号】请求契约里**没有** accountKey 或任何账号字段。账号一律由 Main 从
 *     会话态推导（照 `DiagnosticsLookupRequest` 的防线）：项目 id / 成员 subject
 *     都是可猜的短串，允许调用方指定账号＝冒充他人读写别人项目的最短路径。
 *     **不可表达的东西不需要在运行时校验**。
 *
 *  2. 【埋点红线】请求契约里**没有**任何助手会话正文字段（prompt / answer /
 *     命令参数 / 查询词 / 文件内容）。文件上传**连路径都不传**（仓库纪律
 *     「路径绝不跨 IPC」，见 channels.ts 的 LOCAL_SESSION_ATTACHMENT_PICK）：
 *     渲染层只表达「为哪个项目、传哪类」，Main 弹系统选择框拿路径、读盘、
 *     以裸字节体直发服务端。唯一允许的自由正文是用户**亲笔**
 *     写下的字：留言/评论正文、讨论消息正文、待办标题与描述、项目名与项目
 *     说明——那都是用户自己敲的字，不是会话产物。`refs` 是结构化引用 token
 *     （正则收口），塞不进自由文本。
 *
 *  3. 【白标】本文件的标识符、注释与错误文案一律不含内核品牌词根。能力用中性词
 *     （项目组 / 协作 / 服务端）表述。
 */

/**
 * 项目名的字符上限。
 * ⚠️ **比服务端 DDL 更严**：`0001_core.sql` 的 `projects.name` 是
 * `length(name) BETWEEN 1 AND 128`，这里取 120 是客户端侧更紧的一道闸——
 * 客户端拒绝的服务端必拒，反向不成立。改这个数前先确认没把它放宽过 128。
 */
export const PROJECT_MAX_NAME_LENGTH = 120;

/** 项目说明（instructions）的字符上限。 */
export const PROJECT_MAX_INSTRUCTIONS_LENGTH = 20_000;

/**
 * 「AI 录入规则」正文的字符上限（CTX-01）。
 *
 * ⚠️ 与项目说明**分开的一道闸**：说明走 {@link PROJECT_MAX_INSTRUCTIONS_LENGTH}
 * （`instructionsText`，随 `project:update`），规则走本常量（`aiEntryRules`，随
 * `project:conventions-*`）。两份内容、两个上限、两条保存路径——⛔ 不合成一个字段
 * （产品契约 product-contracts.md：`GET/PATCH /projects/{id}/conventions` 的
 * `ai_entry_rules` 文本 20k）。现取同值 20k，但**刻意独立成常量**：调它不牵动说明那道闸。
 */
export const PROJECT_MAX_AI_ENTRY_RULES_LENGTH = 20_000;

/** 单条讨论消息正文的字符上限（线协议同界）。 */
export const CHAT_MAX_BODY_LENGTH = 8_000;

/** 单条动态/评论正文的字符上限（线协议同界）。 */
export const FEED_MAX_BODY_LENGTH = 20_000;

/** 单个项目文件的字节上限（1 GiB，线协议唯一客户端常量）。 */
export const PROJECT_FILE_MAX_BYTES = 1_073_741_824;

/** 列表/分页单次拉取条数上限（线协议 `limit ≤ 200` 同界）。 */
export const PROJECT_LIST_MAX_LIMIT = 200;

/** 单项目成员数组的防御性上界。 */
export const PROJECT_MAX_MEMBERS = 200;

/**
 * 项目卡上最多露几个成员头像。
 *
 * ⛔ **列表投影里没有全量名册**：服务端只回前 3 位（SQL 的 LIMIT），
 * 卡片上的「+N」由 `projectExtraMemberCount` 拿 `memberCount` 减出来。
 * 这个数是 UI 线定的，服务端 `domain.PROJECT_SUMMARY_PREVIEW_MEMBERS` 与它同值——
 * 两端各有用例钉住（服务端 tests/test_api_project_cards.py，客户端 project-collab.test.ts）。
 */
export const PROJECT_SUMMARY_PREVIEW_MEMBERS = 3;

/** 项目卡描述行的字数上界（服务端已折空白并截到这个数，客户端只是复检）。 */
export const PROJECT_SUMMARY_MAX_LENGTH = 160;

/** 单条动态下评论数组的防御性上界。 */
export const PROJECT_FEED_MAX_COMMENTS = 200;

/** 文件列表一次返回的防御性上界。 */
export const PROJECT_FILE_MAX_ENTRIES = 500;

/** 待办标题的字符上限。 */
export const PROJECT_TODO_MAX_TITLE_LENGTH = 240;

/** 待办描述的字符上限（与动态正文同界）。 */
export const PROJECT_TODO_MAX_DESCRIPTION_LENGTH = 20_000;

/** 单条待办标签数上限与单个标签字符上限。 */
export const PROJECT_TODO_MAX_LABELS = 16;
export const PROJECT_TODO_LABEL_MAX_LENGTH = 64;

/**
 * 工作单面（服务端迁移 0009）的上界，逐个与线协议 DDL 同界。
 *
 * 「注意事项」取 4000 而不是照抄描述的 20000：服务端 `todos.constraints_text` 的
 * CHECK 就是 4000，客户端拒绝的服务端必拒、反向不成立——放宽会得到一个本地过、
 * 服务端 422 的请求。
 */
export const PROJECT_TODO_MAX_CONSTRAINTS_LENGTH = 4_000;
/** 验收清单条数上限：再多就不是一份能逐条勾完的清单了。 */
export const PROJECT_TODO_MAX_ACCEPTANCE_ITEMS = 20;
/** 单条验收判据的字符上限。 */
export const PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH = 500;
/** 执行方对单条判据的自述（「这条我是怎么满足的」）字符上限。 */
export const PROJECT_TODO_ACCEPTANCE_NOTE_MAX_LENGTH = 2_000;
/** 完成记录正文（做了什么 / 打回理由）的字符上限。 */
export const PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH = 4_000;
/** 单条完成记录可带的产出引用条数上限。 */
export const PROJECT_TODO_MAX_COMPLETION_ARTIFACTS = 16;
/** 单条待办的完成记录条数上界（防无界读取；服务端无分页）。 */
export const PROJECT_TODO_MAX_COMPLETION_RECORDS = 200;
/** 一批拆解草案的条数上限，与一次列出多少批。 */
export const PROJECT_MAX_DRAFTS_PER_BATCH = 50;
export const PROJECT_MAX_DRAFT_BATCHES = 50;

/** 单条留言/讨论消息/待办可携带的结构化引用条数上限。 */
export const PROJECT_MAX_REFS = 16;

/**
 * 结构化引用 token 的字符闭集：不含空白、不含中文——**塞不进自由文本**，
 * 红线 2 的结构性载体之一（`projectRefSchema` 与 `buildProjectRef` 共用这一份）。
 */
export const PROJECT_REF_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/u;

/**
 * 引用 token 的类别前缀（`<kind>:<id>`）。
 *
 * ⚠️ **跨线契约**：服务端 `server/domain.py` 的 `MENTION_REF_PREFIX` 与本文件的
 * `PROJECT_REF_KIND_MEMBER` 是同一条约定的两个端点——服务端按 `member:` 前缀从
 * `refs` 里提出被 @ 的成员 subject 放进事件负载的 `mentions`，客户端
 * `projectNotificationRules.ts` 据此判「是不是在叫我」。改任一端必须同改另一端；
 * 两侧各有用例钉死前缀字面量（服务端 tests/test_api_feed_chat.py，
 * 客户端 project-collab.test.ts）。
 */
export const PROJECT_REF_KIND_MEMBER = 'member';
/** 引用项目资产（文件 id）。 */
export const PROJECT_REF_KIND_ASSET = 'asset';
/** 引用看板待办（待办 id）。 */
export const PROJECT_REF_KIND_TODO = 'todo';

/** 可被 `#` 引用选择器产出的类别闭集（成员由 `@` 产出，不在这里）。 */
export const PROJECT_REF_PICKABLE_KINDS = [PROJECT_REF_KIND_ASSET, PROJECT_REF_KIND_TODO] as const;

/**
 * 组装一枚引用 token。id 里若含 token 正则不认的字符（空白、中文等），返回 null
 * ——**宁可不引用，也不产出一个服务端必拒的请求**（正文永远塞不进 refs）。
 */
export function buildProjectRef(kind: string, id: string): string | null {
  const token = `${kind}:${id}`;
  return PROJECT_REF_TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * 项目成员角色（服务端 CHECK 闭集同款）。**按权限从高到低排**，读的人不用另找梯子。
 *
 * `manager`「管理者」是拥有者与成员之间的一档：它的存在理由是**转交**——服务端
 * `todo_patch_decision` 里「改他人名下的待办」那一支此前只放行 owner。其余能力
 * 逐处判、不默认继承拥有者。
 */
export const ProjectRoleSchema = z.enum(['owner', 'manager', 'editor', 'viewer']);

/**
 * 角色档位阶梯，与服务端 `domain.py ROLE_RANK` 同构（那侧 `.get(role, -1)`，未知角色
 * 低于一切 ⇒ 403）。这里同样把**未知角色**判为 -1：判不出档位就当最低，fail-closed。
 *
 * ⛔ 别在调用点写 `myRole === 'owner'`——那是「谁能做这件事」和「谁是拥有者」两件事
 * 挤在一个表达式里。加一档角色时，字符串比较**编译器一处也拦不住**（本次实测：
 * 加 `manager` 只炸出 1 处 `Record<ProjectRole, …>`，其余全静默通过），
 * 而阶梯只需改这张表。
 */
const PROJECT_ROLE_RANK: Readonly<Record<ProjectRole, number>> = {
  viewer: 0,
  editor: 1,
  manager: 2,
  owner: 3,
};

/** 查一个角色的档位；未知角色与「没角色」（null）一律 -1，与服务端 `.get(role, -1)` 同款。 */
function projectRoleRank(role: ProjectRole | null): number {
  if (role === null) return -1;
  return PROJECT_ROLE_RANK[role] ?? -1;
}

/** 「档位至少是」：未知角色恒 false。 */
export function projectRoleAtLeast(role: ProjectRole | null, minimum: ProjectRole): boolean {
  return projectRoleRank(role) >= PROJECT_ROLE_RANK[minimum];
}

/**
 * 「档位**严格高于**」——与服务端 `domain.py role_outranks` 同一条判据。
 * 成员管理面的两个半边共用它：一半管「能动谁」（`ensure_target_outranked`），
 * 一半管「能给什么档」（`ensure_role_grantable` 的第二闸）。
 *
 * ⚠️ 它不是「管理者不能踢拥有者」「管理者不能造第二个管理者」「平级不能互踢」三条
 * 规则，而是**一条**：`rank(a) > rank(b)`，三种情形都是它的推论。
 * ⛔ 别松成 `>=`（那是上面的 `projectRoleAtLeast`）：一个字符同时打开那三条路。
 * ⛔ 也别只用其中一个半边——只判「能动谁」的话，管理者能把一个成员**直接改成**
 *    管理者绕过去，「造不出第二个管理者」当场失效。
 *
 * ⇒ 管理者动得了成员与观察者，动不了拥有者，也动不了另一个管理者（含自己）。
 * 「管理者造不出管理者、只能由拥有者任命」由此是 `PROJECT_ROLE_RANK` 的**自然推论**，
 * 不是一条要单独记住的特例。⛔ 别写成 `role !== 'owner'` 那种枚举式排除：那种写法
 * 每加一档角色就要回来补一次，而且漏了不会有任何东西红。
 *
 * 未知角色（含 null）按 -1：它**管不了任何人**（fail-closed），同时**任何人都能管它**
 * ——将来若名册里出现一行本版本读不懂的角色，拥有者仍得能把它摘掉，
 * 否则那一行就成了谁也动不了的钉子。这条不对称与服务端逐字一致。
 *
 * ⚠️ 两侧参数都可空：`grantableRolesFor` 与成员行判据都可能拿到判不出的角色，
 * 收在这一处比让每个调用点各自兜底安全。
 */
export function projectRoleOutranks(role: ProjectRole | null, other: ProjectRole | null): boolean {
  return projectRoleRank(role) > projectRoleRank(other);
}

/**
 * **入站**角色：未知取值降级为最小权限（`viewer`），而不是让整条响应不可信。
 *
 * ⚠️ 这是对本层「strictObject + 任一不过即拒」纪律的**一处针对性例外**，理由是那条
 * 纪律防的是**形状漂移**，而角色是一个**预期会增长的闭集**——两者该有不同处置：
 *
 *  - 严格拒的后果不是报错，是 `collabWireMapping` 把整条响应判为不可信 ⇒ 上层当
 *    transient ⇒ 用户看到一句**永远好不了的「项目组暂时连不上，请稍后重试」**。
 *  - 而且 `members` 数组**不做部分采信**：项目里只要有一个人是新角色，
 *    **这个项目的所有人**（包括拥有者）都会撞上那句假网络错误。
 *  - 它长得像网络故障，所以没人会去查真因——比直接报错更难被发现。
 *
 * 降级方向是**最小权限**：认不出的角色只当观察者，宁可少给，不会多给。
 *
 * ⚠️ 这**救不了已装机的旧版本**（它们没有这段代码）。本次上 `manager` 仍然要靠
 * 部署纪律：新版铺完再在服务端放开。容错保的是**下一次**加角色。
 */
export const InboundProjectRoleSchema = ProjectRoleSchema.catch('viewer');

/**
 * 邀请可签发的角色（与服务端 `domain.py GRANTABLE_ROLES` 同款闭集）。
 *
 * ⛔ **刻意不含 owner**——第二位拥有者只能经 `project:transfer` 产生（服务端在同一
 * 事务里升一降一，owner 净数守恒），邀请码造不出来（结构性挡住，不靠服务端复检兜底）。
 *
 * ⚠️ 闭集只答「这个词合不合法」，**不答「你能不能签」**：具体某个人能签哪几档由
 * `projectInvitationRolesFor()` 按 `projectRoleOutranks` 再收一次窄——两者与服务端
 * `ensure_role_grantable` 的两闸（闭集 / 严格低于自己）一一对应。
 */
export const ProjectInvitationRoleSchema = z.enum(['manager', 'editor', 'viewer']);

/**
 * 可直接指派给成员的角色。同样**刻意不含 owner**，理由与上面同一条：
 * 「项目恒有且仅有一位拥有者」在契约层就不可表达。
 *
 * ⚠️ 同样只答「合不合法」。谁能指派出哪几档看 `projectAssignableRolesFor()`。
 */
export const ProjectAssignableRoleSchema = z.enum(['manager', 'editor', 'viewer']);

/**
 * 签发面两个闭集共用的收窄：只留**严格低于** actor 的档位。
 *
 * 这是服务端 `ensure_role_grantable` 第二闸在客户端的同构件，作用是**不摆出点了
 * 必然 403 的选项**：拥有者能任命管理者；管理者只签得出成员/观察者，
 * 造不出第二个管理者，更签不出拥有者（没有任何档位高于 owner）。
 */
function grantableRolesFor<Role extends ProjectRole>(
  roles: readonly Role[],
  actorRole: ProjectRole | null,
): Role[] {
  return roles.filter((role) => projectRoleOutranks(actorRole, role));
}

/** 当前角色经邀请码能签发的档位（高→低）。判不出档位（null/未知）时一个都不给。 */
export function projectInvitationRolesFor(actorRole: ProjectRole | null): ProjectInvitationRole[] {
  return grantableRolesFor(ProjectInvitationRoleSchema.options, actorRole);
}

/** 当前角色能指派给某个成员的档位（高→低）。同上，fail-closed。 */
export function projectAssignableRolesFor(actorRole: ProjectRole | null): ProjectAssignableRole[] {
  return grantableRolesFor(ProjectAssignableRoleSchema.options, actorRole);
}

/** 成员状态（服务端 CHECK 闭集同款：受邀/在组/已移出）。 */
export const ProjectMemberStateSchema = z.enum(['invited', 'active', 'removed']);

/**
 * 待办状态（值与线协议逐字一致）。
 *
 * `inReview`「待验收」由工作单机制引入（服务端迁移 0009）：它是**执行方说完了**与
 * **派单方认可完了**之间的缓冲区。没有这一档，谁干完谁自己标「已完成」，
 * 工作单就退化成自说自话。
 *
 * ⚠️ 能不能迁到某一档由**服务端**判（推不进待验收——那要同时交完成记录；
 * 待验收中只能由派单方验收或打回；有验收清单的工作单不能直跳已完成）。
 * 客户端这份闭集答的是「这个词合不合法」，不是「你能不能这么改」。
 */
export const TodoStatusSchema = z.enum([
  'notStarted',
  'inProgress',
  'inReview',
  'done',
  'cancelled',
]);

/** 待办优先级（值与线协议逐字一致）。 */
export const TodoPrioritySchema = z.enum(['high', 'medium', 'low']);

/**
 * 待办来源（值与线协议逐字一致）：人在界面上建的 / 智能助手在会话里建的 /
 * 外部数据源同步来的（外部源已定只对接 GitLab，本轮不实现同步，取值先留出来）。
 *
 * ⚠️ **调用方声明值，不是服务端权威**：人与助手用同一个账号走同一个 API，服务端
 * 凭身份区分不出来。它答的是「调用方自称这条是谁建的」，不答「事实上是谁建的」。
 * 服务端能做的只有把声明如实落进审计（键名 `declared_source`）。
 */
export const TodoSourceSchema = z.enum(['manual', 'assistant', 'external']);

/**
 * 处理人档位（值与线协议逐字一致，服务端迁移 0010）：派给**成员** / 派给**项目助理**。
 *
 * ⛔ **助理不是一个成员账号**——项目成员表里没有它，也不会有。它是这一个字段上的
 * 取值，与「派给某位成员」并列。做成账号就得给它发凭据、算配额、判成员资格，
 * 那是一整套没人要的身份体系。
 *
 * ⚠️ 助理档下 `assigneeSubject` / `assigneeDisplayName` **恒为 null**（服务端
 * CHECK 钉死）：「这单派给了助理」由本字段**独自**承载。⛔ 别在调用点拿
 * `assigneeSubject === null` 当「无人认领」——那会把派给助理的单一并算进去。
 */
export const TodoAssigneeKindSchema = z.enum(['member', 'assistant']);

/**
 * 待办可见性（值与线协议逐字一致）：协同（全体在册成员可见）/ 个人（只有创建者
 * 可见可改，项目拥有者也看不见）。
 *
 * ⚠️ 缺省是 **shared**，与「默认私密」相反，是有意的取舍：这些条目活在团队项目组里，
 * 建了一条别人看不见的待办是协作事故，不是隐私保护。
 */
export const TodoVisibilitySchema = z.enum(['shared', 'personal']);
/** 工作项业务类型；与 parentId 正交。 */
export const TodoItemKindSchema = z.enum(['requirement', 'task']);

/** 动态条目类别（值与线协议逐字一致；system 由服务端自动生成）。 */
export const FeedEntryKindSchema = z.enum(['member_post', 'system', 'assistant']);

/** 项目文件形态：正式资产 / 会过期的临时件。 */
export const ProjectFileKindSchema = z.enum(['asset', 'temp']);

/**
 * 域事件种类全集（不含 `connection`），与服务端 `events.EVENT_TYPES` 一一对应。
 *
 * ⛔ 主进程流客户端的线上帧白名单**必须从这里取**，不得再抄一份：2026-09-04 实测
 * `todo.draft` 在服务端与这里都加了、流客户端那份没加，帧在 Main 被当坏帧静默丢弃，
 * 拆解草案的自动弹窗要切一次会话（组件重挂载重取）才出现。
 */
export const PROJECT_DOMAIN_EVENT_KINDS = [
  'feed.created',
  'feed.commented',
  'chat.message',
  'chat.revoked',
  'todo.changed',
  'testing.changed',
  'member.changed',
  'file.changed',
  'project.changed',
  // 一批拆解草案落下来了。**定向投递**：服务端给每个可见者各写一行
  // （至多两个人：拆解发起方 + 派单方），所以这不是广播——第三个人一行都读不到。
  'todo.draft',
  // 规划域：业务目标与迭代轮次的新建/修改/归档（项目级对象，广播给在册成员）。
  // ⛔ 负载只有 id / 枚举 / 版本 / 身份标识——目标名称、目标说明、达成标准一个字
  //    都不进事件面；渲染层收到后按 kind 走对应通道重取权威数据。
  'milestone.updated',
  'iteration.updated',
  // 迭代 ↔ 需求的排期变动（关联 / 切轮次 / 移出）。
  // ⚠️ **可能是定向投递**：负载带着 requirementId，而那条需求可能是个人条目 ⇒ 服务端
  //    按同一道受众函数只投给创建者（只挡 REST 不挡事件流等于没挡）。所以收不到这类帧
  //    **不代表**没发生排期变动，只代表那条需求跟你无关。
  // ⚠️ `reason: 'moved'` 时**有两个轮次**的摘要变了（payload 带 previousIterationId），
  //    ⛔ 只刷当前那一轮会留下一张过期的卡。
  // ⛔ 负载只有 id / 枚举 / 版本：需求标题与轮次名称一个字都不进。
  'iteration.requirements_changed',
] as const;

/**
 * `project:event` 的事件类别：全部服务端域事件（值与服务端 SSE `type` 逐字一致）
 * + 客户端本地的连接状态帧 `connection`（Main 自产，不来自服务端）。
 *
 * ⭐ 域事件那一半**从 `PROJECT_DOMAIN_EVENT_KINDS` 展开**，不再抄第二份。
 * 之前这里是一份手写清单，与那份并列存在——2026-09-12 加两个规划域事件时，
 * 只改一处会得到「Main 收得到、store 的 switch 编译不过」这种一半生效的状态。
 * 一份闭集只该有一个出处。
 */
export const ProjectEventKindSchema = z.enum([...PROJECT_DOMAIN_EVENT_KINDS, 'connection']);

/** 事件流连接状态：在线 / 降级（定时拉兜底中）/ 离线。 */
export const ProjectConnectionStateSchema = z.enum(['online', 'degraded', 'offline']);

/** 服务端资源 id（uuid）。 */
const projectIdSchema = z.string().uuid();
const entityIdSchema = z.string().uuid();

/** 成员身份主体与显示名快照（服务端不存 accountKey，客户端契约同样不表达）。 */
const subjectSchema = z.string().min(1).max(256);
const displayNameSchema = z.string().max(256);

/** ISO8601 时间串（服务端原样，展示用；客户端不解析成时钟）。 */
const timestampSchema = z.string().max(64);

/**
 * 需求上一列字典绑定的取值（`module_id` / `category_id` / 只读的 `iteration_id`）。
 *
 * `null` ＝ **未分类 / 未排期**，一个有意的常态而不是脏数据（服务端那两列可空且无缺省，
 * 也没有「未分类」哨兵字典行）。判三态走 `projectDictionaryBindingState`。
 *
 * ⚠️ 与 `project-collab-dictionaries.ts` 的 `ProjectDictionaryBindingSchema` **同一件事的
 * 第二个载体**（不能运行时 import，理由见文件头那段）。两处一致由
 * `project-collab.test.ts` 的等价性用例钉住。
 */
const dictionaryBindingSchema = entityIdSchema.nullable();

/**
 * 字典条目名称的字符上限。与服务端 DDL 的 `length(name) BETWEEN 1 AND 200`、
 * `PROJECT_DICTIONARY_MAX_NAME_LENGTH` 三处同界。
 *
 * ⚠️ 这个**数字**是本文件里唯一一处真的被抄过来的常量。等价性用例按边界值逐个对照
 * （200 收、201 拒，两个 schema 各验一遍），所以改一处会立刻红。
 */
const DICTIONARY_REF_MAX_NAME_LENGTH = 200;
const dictionaryRefNameSchema = z.string().min(1).max(DICTIONARY_REF_MAX_NAME_LENGTH);

/**
 * 挂在需求上的字典**引用摘要**（`module` / `category`）。
 *
 * 类型侧由 `ProjectDictionaryEntryRef` 钉住（`import type` 不成环），所以少一个键或
 * 键名写错在**编译期**就红；运行时的上界与格式由等价性用例钉住。
 */
const dictionaryRefSchema: z.ZodType<ProjectDictionaryEntryRef> = z.strictObject({
  id: entityIdSchema,
  name: dictionaryRefNameSchema,
  /** 非空 ＝ 已归档。历史需求绑的可能正是一条已归档条目，界面要标出来而不是藏掉。 */
  archivedAt: timestampSchema.nullable(),
});

/**
 * 挂在需求上的迭代**只读**引用摘要。
 *
 * ⚠️ **没有 `startAt`**：V2 之后 `start_at` 属业务目标（`project_milestones`），单轮迭代
 * 表上只有 `due_at`。旧版接口契约（`api-contracts.md` §2）把它写成
 * `{id,name,start_at,due_at,archived_at}` —— 那是 V2 之前的口径，照它写会得到一个
 * 服务端永远不回的字段。
 */
const iterationRefSchema: z.ZodType<ProjectIterationRef> = z.strictObject({
  id: entityIdSchema,
  name: dictionaryRefNameSchema,
  dueAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});

/**
 * 结构化引用 token（文件 id / 待办 id / 会话编号一类）。正则收口成不含空白的
 * 短 token——**塞不进自由文本**，红线 2 的结构性载体之一。
 */
const projectRefSchema = z.string().regex(PROJECT_REF_TOKEN_PATTERN, 'invalid reference token');

const projectRefsSchema = z.array(projectRefSchema).max(PROJECT_MAX_REFS);

/** 用户亲笔正文（留言/评论/讨论/待办文本）。允许换行；只拒 NUL（同 feedback 口径）。 */
const userAuthoredBody = (maxLength: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => !value.includes('\0'), 'NUL is forbidden');

const chatBodySchema = userAuthoredBody(CHAT_MAX_BODY_LENGTH);
const feedBodySchema = userAuthoredBody(FEED_MAX_BODY_LENGTH);
const projectNameSchema = userAuthoredBody(PROJECT_MAX_NAME_LENGTH);
const todoTitleSchema = userAuthoredBody(PROJECT_TODO_MAX_TITLE_LENGTH);

/** 项目说明允许空串（清空说明是合法编辑）。 */
const instructionsTextSchema = z
  .string()
  .max(PROJECT_MAX_INSTRUCTIONS_LENGTH)
  .refine((value) => !value.includes('\0'), 'NUL is forbidden');

/** 待办描述允许空串；`null` 由 update 请求表达「清空」。 */
const todoDescriptionSchema = z
  .string()
  .max(PROJECT_TODO_MAX_DESCRIPTION_LENGTH)
  .refine((value) => !value.includes('\0'), 'NUL is forbidden');

const todoLabelsSchema = z
  .array(z.string().min(1).max(PROJECT_TODO_LABEL_MAX_LENGTH))
  .max(PROJECT_TODO_MAX_LABELS);

/** 注意事项允许空串（清空边界说明是合法编辑）。 */
const todoConstraintsSchema = z
  .string()
  .max(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH)
  .refine((value) => !value.includes('\0'), 'NUL is forbidden');

/**
 * 验收清单的正文数组。**每条都必须写点什么**（`trim` 后非空）——一条空判据会把
 * 整份清单拉低成走过场，而验收清单的全部价值就在于每条都可核对。
 */
const todoAcceptanceTextsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH)
      .refine((value) => value.trim().length > 0, 'acceptance item must not be blank'),
  )
  .max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS);

/**
 * 公开失败码（客户端固定文案，不回显服务端文本）。状态分档与 feedback 客户端
 * 已实证的映射一致：
 *  - `unavailable`        项目组能力未装配（无服务地址 / 离线构建 / 渠道关断）。
 *  - `authRequired`       未登录（账号由 Main 推导，无账号即拒）。
 *  - `invalidRequest`     请求非法（预加载已收敛一轮，此处纵深防御）。
 *  - `tooLarge`           413——正文或文件超界，服务端复检拒。
 *  - `rateLimited`        429。
 *  - `conflict`           409——待办版本冲突时结果另带 `currentVersion`。
 *  - `quotaExceeded`      409——项目临时文件配额触顶，结果另带 `quota`（上限/已用）。
 *  - `credentialRejected` 401——凭据被拒（令牌过期/失效）。
 *  - `forbidden`          403——角色不足、已被移出项目或撤回超时。
 *  - `rejected`           其余 4xx。
 *  - `transient`          ≥500 / 网络不可达 / 超时——可重试。
 *  - `writeFailed`        仅下载：服务端响应正常但本地落盘失败。
 */
export const ProjectCollabErrorCodeSchema = z.enum([
  'unavailable',
  'authRequired',
  'invalidRequest',
  'tooLarge',
  'rateLimited',
  'conflict',
  'quotaExceeded',
  'credentialRejected',
  'forbidden',
  'rejected',
  'transient',
  'writeFailed',
]);

/**
 * 失败码 → 参考编号（`STRX-COLLAB-0xx`）。**唯一登记处**：签发方（Main 的
 * `failureBody`）与展示方（渲染层报错条）都从这里取，两边不各自造串。
 *
 * 编号是**静态**的（一码一号，不逐次生成）——它标的是「哪一类失败」，用户报障时
 * 报出来即可定位到分档，与 `STRX-AAV-xxx` / `STRX-OFFICE-xxx` 同族。逐次现场用的是
 * 安全日志的 `LC-` / `AP-` 动态编号，两套不混。
 *
 * ⛔ 已发出的号不得改写含义、不得回收复用：用户截图里的旧号必须仍指向同一类失败。
 * 新增失败码时在末尾续号。
 */
export const PROJECT_COLLAB_REFERENCE_CODES = {
  unavailable: 'STRX-COLLAB-001',
  authRequired: 'STRX-COLLAB-002',
  invalidRequest: 'STRX-COLLAB-003',
  tooLarge: 'STRX-COLLAB-004',
  rateLimited: 'STRX-COLLAB-005',
  conflict: 'STRX-COLLAB-006',
  credentialRejected: 'STRX-COLLAB-007',
  forbidden: 'STRX-COLLAB-008',
  rejected: 'STRX-COLLAB-009',
  transient: 'STRX-COLLAB-010',
  writeFailed: 'STRX-COLLAB-011',
  // 新增失败码在末尾续号（已发出的号不得改写含义、不得回收复用）。
  quotaExceeded: 'STRX-COLLAB-012',
} as const satisfies Record<z.infer<typeof ProjectCollabErrorCodeSchema>, string>;

export const ProjectCollabReferenceCodeSchema = z.string().regex(/^STRX-COLLAB-\d{3}$/u);

/**
 * 服务端业务码（HTTP 体里的 `error` 串）：小写起头的 snake_case 短标识符。
 *
 * 失败信封**可选**透传它——只在 4xx 且响应体形如 `{ "error": "<code>", ... }` 时出现，
 * 供渲染层区分同一通用 `code` 下的不同业务原因（如「邀请已关闭」`invitation_revoked`
 * vs「已达人数上限」`invitation_exhausted`，见 `projectOpenInvitationErrorText`）。
 *
 * ⛔ 只透传这一个短标识符：不放 `detail` 文案、不放请求体、不放任何用户内容——
 *    正则闭集（首字符小写字母 + 小写字母/数字/下划线，≤64）结构性挡住自由文本混入。
 * ⚠️ 它与失败分档 `code` 正交：`code` 是客户端固定的语义档（网络面判的），`serverCode`
 *    是服务端原样的业务码；两者都在时以 `serverCode` 命中的文案优先，未命中回落通用文案。
 */
export const ProjectCollabServerCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u);

const projectCollabErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  /**
   * 参考编号：报错条展示、用户报障时抄的那一串。放在**信封层**而不是各通道各自
   * 加，是为了「有失败必有编号」在结构上成立——漏填的通道过不了 schema。
   */
  referenceCode: ProjectCollabReferenceCodeSchema,
  /**
   * 服务端业务码原样透传（**可选**）：仅 4xx 且响应体形如 `{ "error": "<code>" }` 时出现，
   * 供渲染层就地覆盖通用文案（`projectOpenInvitationErrorText`）。缺席＝服务端没给可用业务码，
   * 渲染层回落 `message`。⛔ 不含用户内容（正则闭集见 `ProjectCollabServerCodeSchema`）。
   */
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

/**
 * 项目卡上的成员短投影：**只有头像要用的两个字段**。
 *
 * ⛔ 刻意没有角色/状态/入组时间：卡片不呈现它们，多带一格就是一次白送的名册字段。
 * 要完整名册走 `project:detail`（那里才是 `ProjectMemberSchema`）。
 */
export const ProjectMemberPreviewSchema = z.strictObject({
  subject: subjectSchema,
  displayName: displayNameSchema,
});

/** 项目摘要（列表投影）。`lastActivityAt` 为 null＝尚无任何动态。 */
export const ProjectSummarySchema = z.strictObject({
  id: projectIdSchema,
  name: z.string().min(1).max(PROJECT_MAX_NAME_LENGTH),
  /**
   * 卡片描述行：项目说明的一行摘要（服务端折空白并截到 160 字）。
   * 空串 ＝ 拥有者还没写项目说明。⛔ 它不是另一个可编辑字段——写它的入口只有
   * 项目配置里的「项目指令」，客户端不给第二个。
   */
  summary: z.string().max(PROJECT_SUMMARY_MAX_LENGTH),
  myRole: InboundProjectRoleSchema,
  /** 非空＝已归档（只读、默认不进列表；要看得见须显式 `includeArchived`）。 */
  archivedAt: timestampSchema.nullable(),
  memberCount: z.number().int().safe().nonnegative(),
  /**
   * 前 N 位在组成员（服务端 LIMIT 截断）。
   *
   * ⭐ `.max(PROJECT_SUMMARY_PREVIEW_MEMBERS)` 是**客户端这一侧的结构性闸**：
   * 服务端哪天回了全量名册，这条列表就整体解析失败（不做部分采信），
   * 而不是让项目列表随成员数悄悄膨胀。
   */
  memberPreview: z.array(ProjectMemberPreviewSchema).max(PROJECT_SUMMARY_PREVIEW_MEMBERS),
  unreadCount: z.number().int().safe().nonnegative(),
  lastActivityAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

/**
 * 卡片上「+N」里的那个 N ＝ 总数 − 已露头像数。
 *
 * 判据只有这一份：⛔ 别在调用点写 `memberCount - 3`——露几个由服务端决定
 * （成员不足 3 人时只有 1 或 2 个），写死 3 会在两人项目上算出负数。
 */
export function projectExtraMemberCount(
  project: Pick<ProjectSummary, 'memberCount' | 'memberPreview'>,
): number {
  return Math.max(0, project.memberCount - project.memberPreview.length);
}

/** 项目成员（subject + 显示名快照；**无 accountKey**）。`joinedAt` 受邀未入组时为 null。 */
export const ProjectMemberSchema = z.strictObject({
  subject: subjectSchema,
  displayName: displayNameSchema,
  role: InboundProjectRoleSchema,
  state: ProjectMemberStateSchema,
  joinedAt: timestampSchema.nullable(),
});

/** 项目详情（含成员名册）。 */
export const ProjectDetailSchema = z.strictObject({
  id: projectIdSchema,
  name: z.string().min(1).max(PROJECT_MAX_NAME_LENGTH),
  instructionsText: z.string().max(PROJECT_MAX_INSTRUCTIONS_LENGTH),
  myRole: InboundProjectRoleSchema,
  /** 非空＝已归档：渲染层据此收起全部写入口并给拥有者留「恢复」。读不受影响。 */
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  members: z.array(ProjectMemberSchema).max(PROJECT_MAX_MEMBERS),
});

/**
 * 动态评论（append-only 投影）。
 *
 * `refs` 是评论级 @ 提及的载体（服务端迁移 0011），与动态/讨论**同形态同上界**：
 * 被 @ 的成员落成 `member:<subject>`。⛔ 正文里那几个「@某某」只是给人看的字，
 * 判「谁被叫了」只认 token（服务端 `domain.extract_mentions`）。
 */
export const FeedCommentSchema = z.strictObject({
  id: entityIdSchema,
  authorSubject: subjectSchema,
  authorDisplayName: displayNameSchema,
  bodyMd: z.string().max(FEED_MAX_BODY_LENGTH),
  refs: projectRefsSchema,
  createdAt: timestampSchema,
});

/** 动态条目。system/assistant 条目由服务端生成，作者可为空。 */
export const FeedEntrySchema = z.strictObject({
  id: entityIdSchema,
  kind: FeedEntryKindSchema,
  authorSubject: subjectSchema.nullable(),
  authorDisplayName: displayNameSchema.nullable(),
  bodyMd: z.string().max(FEED_MAX_BODY_LENGTH),
  refs: projectRefsSchema,
  comments: z.array(FeedCommentSchema).max(PROJECT_FEED_MAX_COMMENTS),
  createdAt: timestampSchema,
});

/** 讨论消息。`seq` 项目内连续递增；撤回后 `revoked=true` 且正文已被服务端置空。 */
export const ChatMessageSchema = z.strictObject({
  id: entityIdSchema,
  seq: z.number().int().safe().nonnegative(),
  authorSubject: subjectSchema,
  authorDisplayName: displayNameSchema,
  bodyMd: z.string().max(CHAT_MAX_BODY_LENGTH),
  refs: projectRefsSchema,
  revoked: z.boolean(),
  createdAt: timestampSchema,
});

/**
 * 待办（乐观锁 `version`；PATCH 必带 expectedVersion，冲突 409）。
 *
 * `itemKind` 是需求/任务的唯一业务口径，`parentId` 只表达直接父项；两者正交。
 * 需求可包含需求/任务，任务可继续包含任务，深度不设产品上限。
 *
 * `sessionRef` / `refs` 是**关联面**（G-10，服务端迁移 0006）：前者是产出这张单的
 * 执行会话编号，后者是相关材料（资产 / 其他待办）的引用 token 列表。两者都只是
 * 结构化短 token——正文一个字都进不来（红线 2）。
 */
export const TodoSchema = z.strictObject({
  projectId: projectIdSchema.optional(),
  id: entityIdSchema,
  itemKind: TodoItemKindSchema,
  /**
   * null ＝根项；非 null ＝直接父项。不得用它推断 itemKind。
   *
   * ⚠️ 三个字段**必填**（界面接线这一轮由可选收紧，还掉方案增量 §3.2c 欠账 1）：
   * 服务端恒回、`mapTodo` 恒填（历史行缺席时按缺省投影），所以经协议解析出来的
   * 待办永远带着它们——「可能没有」这件事在契约层就不可表达，下游不必也不该
   * 各写各的 `?? ...` 兜底。判「是需求还是任务」走 `isTodoRequirement`。
   */
  parentId: entityIdSchema.nullable(),
  source: TodoSourceSchema,
  visibility: TodoVisibilitySchema,
  title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
  status: TodoStatusSchema,
  /**
   * 处理人档位（0010）。**必填**：服务端恒回、`mapTodo` 恒填（历史行按 `member`
   * 投影），所以经协议解析出来的待办永远带着它——⛔ 别在调用点写 `?? 'member'`。
   * 助理档下下面两个字段恒为 null。判「是不是派给了助理」走 `isTodoAssignedToAssistant`。
   */
  assigneeKind: TodoAssigneeKindSchema,
  assigneeSubject: subjectSchema.nullable(),
  assigneeDisplayName: displayNameSchema.nullable(),
  /** 只读创建人；旧服务端缺键保持未知，不能用处理人代填。 */
  creatorSubject: subjectSchema.nullable().optional(),
  creatorDisplayName: displayNameSchema.nullable().optional(),
  priority: TodoPrioritySchema,
  labels: todoLabelsSchema,
  // 兼容升级前响应：缺失计划开始日期规范化为空，内部模型保持必填。
  startAt: timestampSchema.nullable().default(null),
  dueAt: timestampSchema.nullable(),
  description: z.string().max(PROJECT_TODO_MAX_DESCRIPTION_LENGTH),
  sessionRef: projectRefSchema.nullable(),
  refs: projectRefsSchema,
  /**
   * 注意事项：边界与坑（不许动什么、必须遵守什么）。空串 ＝ 没写。
   *
   * ⚠️ 工作单三字段（本项与下面两项计数）**必填**（界面接线这一轮由可选收紧，
   * 还掉方案增量 §3.2c 欠账 1，与 `parentId` / `source` / `visibility` 同一条路）：
   * 服务端恒回、`mapTodo` 恒填（历史行缺席时按缺省投影 `'' / 0 / 0`），所以经协议
   * 解析出来的待办永远带着它们——「可能没有」在契约层就不可表达。
   * ⛔ 别在调用点写 `?? 0` / `?? ''`：缺省已经下沉到写入侧，读取侧不该再兜一遍。
   */
  constraintsText: z.string().max(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH),
  /**
   * 验收清单的**计数**（总条数 / 已勾条数）。
   *
   * ⛔ 清单正文不在列表出参里：500 条待办 × 20 条判据的正文会把响应打爆。
   * 要逐条内容走 `project:todo-detail`。
   */
  acceptanceTotal: z.number().int().safe().nonnegative().max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  acceptanceChecked: z.number().int().safe().nonnegative().max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  /**
   * 进度汇总（这条工作项的全部可见后代）：总数 / 已完成。
   *
   * ⚠️⚠️ **由服务端按看的人算**：别人的个人任务不进这两个数。要是渲染层拿
   * `store.todos` 自己数，需求页只拉顶层时会数出 0/0，拉全量时又会漏掉服务端
   * 已经挡掉的那些——两种错法都会让同一条需求在两个人眼里显示不同的分母，
   * 而那个差值等于把「这下面有一条你看不见的任务」说出去。
   * ⛔ 别在调用点自己数子任务，读 `todoChildProgress`。
   *
   * ⛔ **这两个数不设上界**，别再给它安一个「够用的」常量。服务端不限制一个
   * 项目能建多少条待办，子树规模由拆解深度决定，任何客户端单方面定的数字都
   * 只是下一堵墙。而越界的代价远不止这一条：列表投影是一条坏全批坏
   * （`mapArray` 见 null 即整页返回 null），所以顶层需求的子树一旦越界，
   * 表现不是「少显示几条」，是整个看板取不回来。
   */
  childTotal: z.number().int().safe().nonnegative(),
  childDone: z.number().int().safe().nonnegative(),
  /**
   * 需求专属子任务统计：这条需求名下、**最近 requirement 祖先落在它身上**的未删可见
   * task 有几条（子需求名下的 task 归子需求，不重计到父需求头上）。
   *
   * ⚠️ 与 childTotal 是两件事：childTotal 数全部可见后代（含子需求及其 task），本字段
   * 只沿 task 边下降、碰到子需求即停。服务端由列表读路径按看的人算出（别人的个人 task
   * 不进这个数）。
   *
   * ⚠️⚠️ **可选，与 childTotal「必填」相反**——这是刻意的：服务端只在**列表读路径**补它，
   * detail / 写路径的出参不带它，旧服务端更没有。缺席（`undefined`）＝「这条投影没算
   * 这个数」，与 `0`（需求下确实没有 task）是两种含义。⛔ 下游不许 `?? 0` 把缺席折成
   * 0——那等于替非列表路径宣布「无子任务」。task 行同样不带这个键（需求专属）。
   *
   * ⛔ **不设上界**：服务端计数、子树规模由拆解深度决定，客户端封顶只会是下一堵墙；
   * 且越界会让 `mapArray` 一条坏全批坏（与 childTotal 同一条理由）。
   */
  requirementTaskTotal: z.number().int().safe().nonnegative().optional(),
  /**
   * 归类面（服务端迁移 0021）：模块 / 分类各一个 id + 一份引用摘要。
   *
   * ⚠️⚠️ **这四个键刻意保持可选，与 `parentId` / `assigneeKind` / 工作单三字段那条
   * 「由可选收紧为必填」的路线相反**，理由是这里要表达的不是两态而是**三态**：
   *
   *  | 取值        | 含义                                      |
   *  | ----------- | ----------------------------------------- |
   *  | `undefined` | 服务端**根本没回这个键**（0021 之前的旧服务端） |
   *  | `null`      | 回了，是空 —— **未分类**（一个有意的常态）   |
   *  | uuid        | 绑着某条字典条目                            |
   *
   * 收紧成必填（缺席时兜个 `null`）就是替旧服务端宣布「这条没归类」，而界面据此会
   * 把一个未知说成一个事实。判三态走 `projectDictionaryBindingState`，
   * ⛔ 调用点别自己写 `if (!moduleId)`：那一条在 null 与 undefined 上同时成立，
   * 恰好把两个方向一起做错。
   *
   * ⭐ `module` / `category` 是**引用摘要**（`{id, name, archivedAt}`），带着
   *    `archivedAt` 是有意的：历史需求绑的可能正是一条已归档的条目，界面要把它标出来
   *    而不是当成脏数据藏掉。⛔ 不要用它替代字典维护面的完整条目（那里还有版本号）。
   */
  moduleId: dictionaryBindingSchema.optional(),
  module: dictionaryRefSchema.nullable().optional(),
  categoryId: dictionaryBindingSchema.optional(),
  category: dictionaryRefSchema.nullable().optional(),
  /**
   * 排期面：**只读投影**，本阶段服务端恒回 null（`todos` 上一列迭代字段都没有，
   * 迭代↔需求的关联属规划域那条线的唯一写口）。
   *
   * ⛔ **写入面刻意没有这两个键**（`ProjectTodoCreateFieldsSchema` /
   *    `ProjectTodoUpdateRequestSchema` 都是 `strictObject`）——于是「在需求上直接设
   *    迭代」这件事在客户端契约里**连表达都表达不出来**。服务端另有一道显式拒绝
   *    （422 `iteration_write_unsupported`），两道不是重复：这一道让渲染层写不出那个
   *    请求，那一道挡住任何绕过客户端契约的调用方。
   *
   * ⚠️ 三态与上面两组同理（缺席 ＝ 旧服务端没回 / null ＝ 未排期 / uuid ＝ 已排期），
   *    判定复用同一个 `projectDictionaryBindingState`——同一件事不立第二个判据。
   */
  iterationId: dictionaryBindingSchema.optional(),
  iteration: iterationRefSchema.nullable().optional(),
  /**
   * 时间事实面（服务端迁移 0023）：**只读**，由服务端的状态事务维护。
   *
   *  | 字段               | 含义                                     |
   *  | ------------------ | ---------------------------------------- |
   *  | `statusChangedAt`  | 状态最近一次**真的变了**是什么时候         |
   *  | `actualCompletedAt`| **当前**这一次通过是什么时候               |
   *
   * ⚠️⚠️ 两个 `null` 各有含义，⛔ 别把它们读成同一件事：
   *  - `statusChangedAt === null`   ＝ 这条需求早于 0023（**未知**，服务端刻意不猜，
   *    也不从 `updatedAt` 推——那一列任何一次改标题都会动，它答的是另一个问题）；
   *  - `actualCompletedAt === null` ＝ **当前**没有通过（从未通过，或通过后被重开）。
   *    ⛔ 「历史上什么时候通过过」不在这一列，走 `GET /todos/{id}/status-events`
   *    （`ProjectTodoStatusEventSchema`）——重开会把这一列清空，而那条历史一行不少。
   *
   * ⚠️ 三态与上面几组同理（缺席 ＝ 旧服务端没回这个键 / null 见上 / 时刻 ＝ 有值），
   *    所以两个键都是 `.optional()`。⛔ 别收紧成必填再兜 `?? null`：那就是替旧服务端
   *    宣布「这条从没通过过」，而界面据此会把一个未知说成一个事实。
   *
   * ⛔ **写入面刻意没有这两个键**（`ProjectTodoCreateFieldsSchema` /
   *    `ProjectTodoUpdateRequestSchema` 都是 `strictObject`）——于是「直接设置完成时间」
   *    这件事在客户端契约里**连表达都表达不出来**。服务端另有一道显式拒绝
   *    （422 `status_timeline_write_unsupported`），两道不是重复：这一道让渲染层写不出
   *    那个请求，那一道挡住任何绕过客户端契约的调用方（含智能助手）。
   *
   * ⚠️⚠️ **`mapTodo` 目前还没有投影这两个键**（`src/main/services/collab/` 不在 CORE-03
   *    的 change_scope 里）。⇒ 现阶段它们在客户端恒为 `undefined`，而那与「旧服务端没回」
   *    **长得一模一样**。接线那一轮要在 `collabWireMapping.mapTodo` 里加
   *    `statusChangedAt: record.status_changed_at` / `actualCompletedAt:
   *    record.actual_completed_at`（⛔ 不写 `?? null`，理由见那个函数里归类六键那一段）。
   */
  statusChangedAt: timestampSchema.nullable().optional(),
  actualCompletedAt: timestampSchema.nullable().optional(),
  version: z.number().int().safe().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * 验收清单的一条判据。`checkedBySubject` / `checkedAt` 与 `checked` 同生同灭
 * （服务端 CHECK 约束钉死），所以这里不必也不该出现「勾了但不知道谁勾的」。
 */
export const TodoAcceptanceItemSchema = z.strictObject({
  ordinal: z.number().int().safe().positive().max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  text: z.string().min(1).max(PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH),
  checked: z.boolean(),
  checkedBySubject: subjectSchema.nullable(),
  checkedAt: timestampSchema.nullable(),
  /** 执行方对该条的自述：「这条我是怎么满足的、证据是什么」。 */
  executorNote: z.string().max(PROJECT_TODO_ACCEPTANCE_NOTE_MAX_LENGTH),
});

/** 完成记录条目类别：执行方的「做了什么」/ 派单方的打回理由。 */
export const TodoCompletionEntryKindSchema = z.enum(['completion', 'rejection']);

/**
 * 完成记录的一条（append-only：服务端触发器挡住改写）。
 *
 * 两类条目共用一条时间线，因为它们本来就是同一段往复：提交 → 打回 → 再提交 → 通过。
 */
export const TodoCompletionRecordSchema = z.strictObject({
  id: entityIdSchema,
  entryKind: TodoCompletionEntryKindSchema,
  authorSubject: subjectSchema,
  authorDisplayName: displayNameSchema,
  summary: z.string().min(1).max(PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH),
  artifacts: z.array(projectRefSchema).max(PROJECT_TODO_MAX_COMPLETION_ARTIFACTS),
  createdAt: timestampSchema,
});

/**
 * 状态转换留证的一条（append-only：服务端触发器挡住改写；迁移 0023）。
 *
 * ⭐ 这条时间线存在的**全部理由**是「重开清空当前值**留历史**」：`Todo.actualCompletedAt`
 * 在重开时被清空，所以「上一次什么时候通过的」只能从这里查（取 `toStatus === 'done'`
 * 的那些条目）。⛔ 没有它时，「清空」与「从来没通过过」在数据上不可区分。
 *
 * ⚠️ `fromStatus` **不可空**：这张表只记**转换**。建单那一刻的初始状态由
 *    `Todo.status` + `createdAt` + `statusChangedAt` 说全了，所以时间线的第一条的
 *    `fromStatus` 就是建单时的状态。⛔ 别指望这里有一条「创建事件」。
 *
 * ⚠️ `reason` 是用户**亲笔**写的转换理由（现有唯一来源是验收打回的理由），它只经本
 *    读路径出来。⛔ 一个字都不进任何 SSE 事件负载（`PROJECT_DOMAIN_EVENT_KINDS` 那一族
 *    的负载只有 id / 枚举 / 版本）——两个面的纪律不同，别把这里的字搬过去。
 *
 * ⚠️ `submissionId`：整需求提测（TST-02）把需求推进待验收的那一条带着**轮次 id**（与轮次列表里的
 *    `id` 同一个值，可喂给单轮详情）；其余转换（含原流程工作单提交进待验收）恒为 null。
 */
export const ProjectTodoStatusEventSchema = z.strictObject({
  id: entityIdSchema,
  todoId: entityIdSchema,
  fromStatus: TodoStatusSchema,
  toStatus: TodoStatusSchema,
  actorSubject: subjectSchema,
  reason: z.string().max(PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH),
  submissionId: entityIdSchema.nullable(),
  occurredAt: timestampSchema,
});

export type ProjectTodoStatusEvent = z.infer<typeof ProjectTodoStatusEventSchema>;

/**
 * 状态时间线的一页（升序：最早 → 最晚，与完成记录时间线同定序）。
 *
 * ⛔ **条数不设客户端上界**，与 `childTotal` / `acceptanceTotal` 那条纪律同源：一条需求
 * 来回提测多少轮由业务决定，客户端单方面定的数字只是下一堵墙，而越界的代价是
 * `mapArray` 一条坏全批坏——表现不是「少显示几条」，是整条时间线取不回来。
 * 页大小由服务端的 `limit` 上界（50）管，那是服务端的截断，不是客户端的判据。
 */
export const ProjectTodoStatusEventPageSchema = z
  .strictObject({
    statusEvents: z.array(ProjectTodoStatusEventSchema),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(1_024).nullable(),
  })
  .superRefine((value, context) => {
    // 与待办列表页逐字同一条：游标与 hasMore 必须同生同灭，否则「还有下一页但没给游标」
    // 会让调用方停在半途而不报错。
    if (value.hasMore !== (value.nextCursor !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextCursor'],
        message: 'nextCursor must be present exactly when hasMore is true',
      });
    }
  });

/** 草案批次状态：审阅中 / 已确认成单 / 已整批丢弃。 */
export const TodoDraftBatchStateSchema = z.enum(['open', 'confirmed', 'discarded']);
/** 单条草案状态：待审 / 已成单 / 被剔除。 */
export const TodoDraftStateSchema = z.enum(['pending', 'accepted', 'dropped']);

/**
 * 一条草案的**依据从哪来**：`input` ＝ 输入里就有的，`assumed` ＝ 助手自己补的假设。
 *
 * 判据不是「输入长短」而是**产出里有多少是输入里没有的**：十个零散功能点拆成十条
 * 任务，一条对一条，那是整理，正当；一句话拆出十五条任务里有十四条是发明出来的。
 * 两者输入都薄，性质完全不同。
 *
 * 为什么要区分：草案确认后就成单进团队看板，别人会照着干。审阅的人对自己写过的
 * 那部分有把握、对补出来的那部分没有——他需要一眼看出该重点看哪几条。
 */
export const TodoDraftBasisSchema = z.enum(['input', 'assumed']);

/**
 * 一条拆解草案——**还不是待办**。
 *
 * 它落在服务端独立的两张表里，正式清单的任何查询都看不到它；「草案不占正式清单」
 * 因此是结构性的，不靠每处查询记得排除。`todoId` 仅在这条已成单且那条待办还在时非空。
 */
export const TodoDraftSchema = z.strictObject({
  id: entityIdSchema,
  ordinal: z.number().int().safe().positive().max(PROJECT_MAX_DRAFTS_PER_BATCH),
  title: z.string().min(1).max(PROJECT_TODO_MAX_TITLE_LENGTH),
  description: z.string().max(PROJECT_TODO_MAX_DESCRIPTION_LENGTH),
  constraintsText: z.string().max(PROJECT_TODO_MAX_CONSTRAINTS_LENGTH),
  acceptanceItems: z
    .array(z.string().min(1).max(PROJECT_TODO_ACCEPTANCE_TEXT_MAX_LENGTH))
    .max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  priority: TodoPrioritySchema,
  /** 依据在输入里还是助手补的；老服务端不返回时按 `input` 兜底（见 `mapTodoDraft`）。 */
  basis: TodoDraftBasisSchema,
  state: TodoDraftStateSchema,
  todoId: entityIdSchema.nullable(),
  droppedAt: timestampSchema.nullable(),
  droppedBySubject: subjectSchema.nullable(),
});

/**
 * 一批拆解草案。
 *
 * ⚠️ **可见集合至多两个人**：拆解发起方（`createdBySubject`）与派单方
 * （`dispatcherSubject`，即源需求的建单人）。比个人条目还窄一档——项目拥有者
 * 也看不见。草案是半成品；半成品对全组可见就等于它已经成了既成事实，
 * 而这道闸存在的全部理由就是不让它成为既成事实。看不见的批次对外是 404
 * （与「不存在」不可区分），不是 403。
 */
export const TodoDraftBatchSchema = z.strictObject({
  id: entityIdSchema,
  projectId: projectIdSchema,
  sourceTodoId: entityIdSchema.nullable(),
  /** 确认后生成的工作项类型；整批一致。 */
  targetItemKind: TodoItemKindSchema,
  /** 确认后挂载的父项；由服务端校验为当前 source。 */
  parentId: entityIdSchema.nullable(),
  createdBySubject: subjectSchema,
  dispatcherSubject: subjectSchema.nullable(),
  state: TodoDraftBatchStateSchema,
  confirmedAt: timestampSchema.nullable(),
  /** 丢弃留痕：谁在什么时候丢的。丢弃**不删行**。 */
  discardedAt: timestampSchema.nullable(),
  discardedBySubject: subjectSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  drafts: z.array(TodoDraftSchema).max(PROJECT_MAX_DRAFTS_PER_BATCH),
});

/**
 * 待办父项 / 来源 / 可见性的**语义取值**。
 *
 * 三个字段收紧为必填之后，这里不再是「缺省兜底」而是**取值口径**：调用点读的是
 * 「这条的直接父项 / 谁建的 / 谁看得见」这三个概念，而不是三个字段名。
 * 缺省仍只有一处，但它已经下沉到写入侧（服务端 `serialize_todo` 的历史行兜底与
 * `mapTodo` 的缺席投影，都是同一组：顶层 / manual / shared）。
 */
export function todoParentId(todo: Pick<Todo, 'parentId'>): string | null {
  return todo.parentId;
}

/**
 * `true` ＝需求；`false` ＝任务。判据只读显式 itemKind。
 */
export function isTodoRequirement(todo: Pick<Todo, 'itemKind'>): boolean {
  return todo.itemKind === 'requirement';
}

export function todoSource(todo: Pick<Todo, 'source'>): TodoSource {
  return todo.source;
}

export function todoVisibility(todo: Pick<Todo, 'visibility'>): TodoVisibility {
  return todo.visibility;
}

/**
 * `true` ＝这张单派给了**项目助理**；`false` ＝派给成员（或还没人认领）。
 *
 * 判据只有这一份：⛔ 别在调用点写 `todo.assigneeKind === 'assistant'`，更 ⛔ 别拿
 * `assigneeSubject === null` 近似它——空处理人在两个档位下都会出现
 * （member 档的「无人认领」与助理档），拿它当判据会把两件事混成一件。
 * 服务端同名判据在 `domain.todo_assignee_kind`。
 */
export function isTodoAssignedToAssistant(todo: Pick<Todo, 'assigneeKind'>): boolean {
  return todo.assigneeKind === 'assistant';
}

/**
 * `true` ＝这张单**还没人认领**（成员档且没有处理人）。
 *
 * 与上一条成对：两者都为 false 才是「派给了某位成员」。
 */
export function isTodoUnassigned(todo: Pick<Todo, 'assigneeKind' | 'assigneeSubject'>): boolean {
  return !isTodoAssignedToAssistant(todo) && todo.assigneeSubject === null;
}

/**
 * `true` ＝这条是**工作单**（有验收判据）；`false` ＝普通待办。
 *
 * 「是不是工作单」**不设字段**，由有没有验收清单派生——结构上不可能出现「标着
 * 工作单却没有验收判据」这种自相矛盾的行。判据只有这一份：⛔ 别在调用点写
 * `todo.acceptanceTotal > 0`。服务端同名判据在 `domain.todo_is_work_order`。
 *
 * 它同时是**向后兼容的载体**：存量待办验收清单为空 ⇒ 恒非工作单 ⇒ 状态机与
 * 迁移 0009 之前逐字一致。
 */
export function isTodoWorkOrder(todo: Pick<Todo, 'acceptanceTotal'>): boolean {
  return todo.acceptanceTotal > 0;
}

/**
 * 注意事项的取值口径。
 *
 * 三个工作单字段收紧为必填之后，这里不再是「缺省兜底」而是**取值口径**：调用点读的是
 * 「这张单的边界说明」这个概念，而不是字段名。缺省已经下沉到写入侧
 * （服务端 `serialize_todo` 的历史行兜底与 `mapTodo` 的缺席投影，同一组：`'' / 0 / 0`）。
 */
export function todoConstraints(todo: Pick<Todo, 'constraintsText'>): string {
  return todo.constraintsText;
}

/**
 * 进度汇总的取值口径（这条需求下的任务：总数 / 已完成）。
 *
 * 判据只有这一份：⛔ 别在调用点写 `todos.filter(t => t.parentId === id)` 再自己数
 * ——渲染层手里的那份列表不等于服务端按你算出来的那份（别人的个人任务本就不在
 * 里面，需求页还可能只拉了顶层）。服务端同名口径在 `domain.count_child_progress`。
 */
export function todoChildProgress(todo: Pick<Todo, 'childTotal' | 'childDone'>): {
  readonly total: number;
  readonly done: number;
} {
  return { total: todo.childTotal, done: todo.childDone };
}

/** `true` ＝这条需求下有可计入进度的任务（0 条时不摆一个「0/0」的空进度）。 */
export function hasTodoChildProgress(todo: Pick<Todo, 'childTotal'>): boolean {
  return todo.childTotal > 0;
}

/** 验收进度的取值口径（总条数 / 已勾条数）。 */
export function todoAcceptanceProgress(todo: Pick<Todo, 'acceptanceTotal' | 'acceptanceChecked'>): {
  readonly total: number;
  readonly checked: number;
} {
  return { total: todo.acceptanceTotal, checked: todo.acceptanceChecked };
}

/** 项目文件元数据（字节不过 IPC；此处只有描述）。`expiresAt` 仅 temp 件非空。 */
export const ProjectFileSchema = z.strictObject({
  id: entityIdSchema,
  kind: ProjectFileKindSchema,
  /**
   * 这个文件**自称**是谁传的（与 `Todo.source` 同一套取值、同一条纪律）。
   *
   * ⚠️ 它是一次**声明**，不是服务端查证过的事实：助手与人用同一个账号走同一条 API，
   * 服务端分辨不出，所以 `uploaderDisplayName` 两种情况下都是登录人的名字。这一列
   * 答的是「这条通道自称是谁存的」，不答「事实上是谁存的」——资产页据此出徽标。
   *
   * 缺省 `'manual'`：老服务端不回这个键时，一份没有声明来源的文件就是成员上传的，
   * 与本列上线之前的呈现逐字一致（`mapProjectFile` 处补默认，不在这里放宽为可选，
   * 免得客户端内部也有一处「有时有有时没有」）。
   */
  source: TodoSourceSchema,
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(128),
  bytes: z.number().int().safe().nonnegative().max(PROJECT_FILE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u, 'invalid sha256'),
  uploaderSubject: subjectSchema,
  uploaderDisplayName: displayNameSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

/* ------------------------------------------------------------------ */
/* 各通道 Request/Result（请求一律 strictObject；⚠️ 逐字段审阅：        */
/* 只有 id、枚举与用户亲笔字段，绝无账号、绝无助手会话正文）。          */
/* ------------------------------------------------------------------ */

/** `project:availability`：能力探测。无入参（空 strictObject 防夹带）。 */
export const ProjectAvailabilityRequestSchema = z.strictObject({});

/**
 * 能力探测结果：项目组多人能力是否已装配（构建期注入了服务地址且非离线构建）。
 * `false` ⇒ UI 整个不渲染项目组入口。
 *
 * `mySubject` = 当前登录账号在协作服务端的身份主体（成员 `subject` 同一量纲），
 * 供渲染层做「本人消息可撤回 / 本人文件可删除」的**按钮显隐判据**——纯 UI 提示，
 * 服务端仍按令牌强判 403，藏不住也冒充不了。`enabled:false` 时恒 null
 * （refine 结构性钉死）；`enabled:true` 而主体暂不可得时也可为 null（UI 收起按钮）。
 * 这是唯一带身份投影的结果——请求侧仍然**没有**任何账号字段（红线 1 不动）。
 */
export const ProjectCollabAvailabilitySchema = z
  .strictObject({
    enabled: z.boolean(),
    mySubject: z.string().min(1).max(256).nullable(),
  })
  .refine((value) => value.enabled || value.mySubject === null, {
    message: 'mySubject must be null when disabled',
  });

/**
 * `project:list`：我的项目列表。`includeArchived` 缺省＝false（归档项目默认不进
 * 列表）；拥有者要找回归档项目时才显式带 true。
 */
export const ProjectListRequestSchema = z.strictObject({
  includeArchived: z.boolean().optional(),
});

export const ProjectListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    projects: z.array(ProjectSummarySchema).max(PROJECT_LIST_MAX_LIMIT),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:create`：建组（创建者即 owner）。`name` 是用户亲笔。 */
export const ProjectCreateRequestSchema = z.strictObject({
  name: projectNameSchema,
});

export const ProjectCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), project: ProjectDetailSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:detail`：项目详情。 */
export const ProjectDetailRequestSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const ProjectDetailResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), project: ProjectDetailSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:update`：改名/改说明。至少带一项变更。
 *
 * ⚠️ **两个字段的档位不同**（服务端 `project_patch_minimum_role`）：`instructionsText`
 * 是 manager+（「这个项目怎么干」属日常调度），`name` 是 **owner-only**（项目名是这个
 * 项目对外的身份，出现在每个人的列表与每一条通知里）。两个字段同时给时按**更高**
 * 那一档要，不做部分成功。⛔ 界面上把两者并成一个入口的话，收窄判据要按 owner 走。
 */
export const ProjectUpdateRequestSchema = z
  .strictObject({
    projectId: projectIdSchema,
    name: projectNameSchema.optional(),
    instructionsText: instructionsTextSchema.optional(),
  })
  .refine((request) => request.name !== undefined || request.instructionsText !== undefined, {
    message: 'at least one field to update',
  });

export const ProjectUpdateResultSchema = ProjectDetailResultSchema;

/* --------------------------- 项目约定 · AI 录入规则（CTX-01） --------------------------- */

/** AI 录入规则正文：允许空串（清空规则是合法编辑）；只拒 NUL（同 instructions 口径）。 */
const aiEntryRulesSchema = z
  .string()
  .max(PROJECT_MAX_AI_ENTRY_RULES_LENGTH)
  .refine((value) => !value.includes('\0'), 'NUL is forbidden');

/**
 * 项目约定 · AI 录入规则投影（`project:conventions-*`）。
 *
 * `ruleVersion` 是**已发布版本号**（服务端每次发布 +1；0 = 尚无任何发布，走内置默认建议稿）。
 * 发布只递增本版本、只改本对象——历史轮次快照按其提交时冻结的版本读取，不随新发布改写
 * （acceptance「发布规则不改历史记录」的数据侧收口）。
 *
 * ⛔ 本对象**不含**提交测试门槛（`submission_gate` / gate_version）：那属 CTX-02，
 *    与 AI 文本分开版本化——本包不建它的字段（也不碰迁移/服务端）。
 */
export const ProjectConventionsSchema = z.strictObject({
  aiEntryRules: z.string().max(PROJECT_MAX_AI_ENTRY_RULES_LENGTH),
  ruleVersion: z.number().int().safe().nonnegative(),
  /** 最近一次发布时间；null = 尚无任何发布（默认建议稿）。 */
  publishedAt: timestampSchema.nullable(),
});

/** `project:conventions-get`：读取项目约定（AI 录入规则）。 */
export const ProjectConventionsRequestSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const ProjectConventionsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), conventions: ProjectConventionsSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:conventions-update`：发布新一版 AI 录入规则（manager+）。
 *
 * `expectedVersion` 是乐观锁：与服务端当前 `ruleVersion` 不一致时 409（`conflict`），
 * 零写入——渲染层据此保留草稿并提示刷新（⛔ 不吞长文）。发布成功服务端把
 * `ruleVersion` +1 并回权威投影。⛔ 与说明是**两条保存路径**：说明走 `project:update`
 * 的 `instructionsText`，规则走这里的 `aiEntryRules`，不合并、不互相覆写。
 */
export const ProjectConventionsUpdateRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  aiEntryRules: aiEntryRulesSchema,
  expectedVersion: z.number().int().safe().nonnegative(),
});

export const ProjectConventionsUpdateResultSchema = ProjectConventionsResultSchema;

/**
 * 邀请形态闭集（服务端 `InvitationKind` 同款）：一次性授权码 / 限时开放邀请。
 *
 * ⚠️「开放邀请只签成员」（open ⇒ role=editor）由 `ProjectInviteRequestSchema` 的
 *    `.refine` 结构性挡住——那是**收窄入口**（不摆点了必错的表单）。服务端表级
 *    CHECK + 业务码 400 `open_invitation_role_not_allowed` 才是权威门。
 */
export const ProjectInvitationKindSchema = z.enum(['single', 'open']);

/**
 * 开放邀请有效期闭集（小时）：1 小时 / 24 小时 / 7 天，默认 24。与服务端
 * `OpenInvitationTtlHours` 同款；一次性码不带（缺省沿用服务端配置）。
 */
export const PROJECT_OPEN_INVITATION_TTL_HOURS = [1, 24, 168] as const;
export const PROJECT_OPEN_INVITATION_DEFAULT_TTL_HOURS = 24;
export const ProjectOpenInvitationTtlHoursSchema = z.union([
  z.literal(1),
  z.literal(24),
  z.literal(168),
]);

/** 开放邀请人数上限的区间上界（NULL/缺省 ＝ 不限）；与服务端 `MAX_OPEN_INVITATION_USES` 同界。 */
export const PROJECT_OPEN_INVITATION_MAX_USES = 500;

/** 单项目进行中开放邀请数组的防御性上界（服务端只列未撤销未过期的）。 */
export const PROJECT_MAX_OPEN_INVITATIONS = 200;

/**
 * 邀请码形状（`token_urlsafe` 字母表）——与服务端 `_INVITE_CODE_RE` **逐字一致**。
 *
 * ⚠️ 跨线契约：加入深链解析（`parseProjectJoinLink` / 主进程严格解析）与加入表单
 * 的抽码都认这一份正则；改一端必须同改另一端。
 */
export const PROJECT_INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

/**
 * `project:invite`：签发邀请（manager+，且只签得出严格低于自己的档）。
 *
 * 两种形态（服务端迁移 0016）：
 *  - `single`（缺省）：一次性授权码，行为逐字不变；⛔ 不带 `ttlHours` / `maxUses`。
 *  - `open`：限时开放邀请（成员档多人可用）。`ttlHours` **必填**（闭集三档）；
 *    `maxUses` 可选（缺省不限）；`role` 恒为 `editor`——「开放邀请只签成员」。
 *
 * 三条约束都做成 `.refine` 结构性闸：点得出的表单才发得出，不摆点了必错的入口。
 */
export const ProjectInviteRequestSchema = z
  .strictObject({
    projectId: projectIdSchema,
    role: ProjectInvitationRoleSchema,
    // 缺省即一次性码（`kind` 保持**可选**：不设 `.default`，否则推导出的
    // `ProjectInviteRequest.kind` 会变必填，把现有只传 `{projectId, role}` 的调用点打红）。
    // 下面 refine 里 `kind !== 'open'` 把「缺省 / single」两种一并当非开放邀请处理。
    kind: ProjectInvitationKindSchema.optional(),
    ttlHours: ProjectOpenInvitationTtlHoursSchema.optional(),
    maxUses: z.number().int().min(1).max(PROJECT_OPEN_INVITATION_MAX_USES).optional(),
  })
  .refine((request) => request.kind !== 'open' || request.role === 'editor', {
    message: 'open invitations can only grant editor',
  })
  .refine((request) => request.kind !== 'open' || request.ttlHours !== undefined, {
    message: 'ttlHours is required for open invitations',
    path: ['ttlHours'],
  })
  // 服务端对 single 携带 ttl_hours / max_uses 一律 422，故两条按字段各自收窄（逐字段
  // 报错路径），不合成一条——与服务端 06e74a39 定稿契约逐条同构。
  .refine((request) => request.kind === 'open' || request.ttlHours === undefined, {
    message: 'single invitations take no ttlHours',
    path: ['ttlHours'],
  })
  .refine((request) => request.kind === 'open' || request.maxUses === undefined, {
    message: 'single invitations take no maxUses',
    path: ['maxUses'],
  });

/**
 * 邀请码明文**仅此一次**出现（服务端只存 HMAC 摘要）：渲染层展示后即弃，
 * 不落库、不进日志、不进埋点。`invitationId` 供开放邀请列表/撤销引用（一次性码也回）。
 */
export const ProjectInviteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    code: z.string().min(1).max(128),
    expiresAt: timestampSchema,
    invitationId: entityIdSchema,
    kind: ProjectInvitationKindSchema,
    /** 开放邀请的人数上限；不限或一次性码为 null。 */
    maxUses: z.number().int().positive().max(PROJECT_OPEN_INVITATION_MAX_USES).nullable(),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:redeem-invitation`：兑换邀请码入组。 */
export const ProjectRedeemInvitationRequestSchema = z.strictObject({
  code: z.string().min(1).max(128),
});

export const ProjectRedeemInvitationResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    projectId: projectIdSchema,
    role: InboundProjectRoleSchema,
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** 一条进行中的开放邀请（列表投影）。⛔ **不含 code**——库里也没有。 */
export const ProjectOpenInvitationSchema = z.strictObject({
  id: entityIdSchema,
  /** 恒为 editor（开放邀请只签成员）；入站走容错档，未知角色降级观察者。 */
  role: InboundProjectRoleSchema,
  expiresAt: timestampSchema,
  /** 人数上限；不限为 null。 */
  maxUses: z.number().int().positive().max(PROJECT_OPEN_INVITATION_MAX_USES).nullable(),
  usesCount: z.number().int().safe().nonnegative(),
  createdBySubject: subjectSchema,
  /** 创建人显示名快照（已退组则服务端兜底空串）。 */
  createdByDisplayName: displayNameSchema,
  createdAt: timestampSchema,
});

/** `project:list-open-invitations`：列出本项目进行中的开放邀请（manager+）。 */
export const ProjectOpenInvitationListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const ProjectOpenInvitationListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    invitations: z.array(ProjectOpenInvitationSchema).max(PROJECT_MAX_OPEN_INVITATIONS),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:revoke-invitation`：提前关闭一条邀请（manager+，同项目；幂等）。 */
export const ProjectInvitationRevokeRequestSchema = z.strictObject({
  invitationId: entityIdSchema,
});

export const ProjectInvitationRevokeResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    projectId: projectIdSchema,
    invitationId: entityIdSchema,
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:join-link`：主进程从深链（`stratex://project/join?code=…`）解析出邀请码后
 * 定向推给主窗，供加入表单**预填**。⛔ 主进程不自动兑换，由人点「加入」。
 *
 * `code` 仍是明文邀请码——只活在这一帧与加入表单的局部态，⛔ 不进 store/日志/埋点。
 */
export const ProjectJoinLinkEventSchema = z.strictObject({
  code: z.string().regex(PROJECT_INVITE_CODE_PATTERN, 'invalid invite code'),
});

/** 加入深链的协议前缀（企微里自定义协议链接不一定唤起，故同时保留纯码兜底）。 */
export const PROJECT_JOIN_LINK_SCHEME = 'stratex://project/join';

/** 由邀请码组装加入深链；code 形状不合规返回 null（不产一个必然解析失败的链接）。 */
export function buildProjectJoinLink(code: string): string | null {
  if (!PROJECT_INVITE_CODE_PATTERN.test(code)) return null;
  return `${PROJECT_JOIN_LINK_SCHEME}?code=${code}`;
}

/**
 * 从「整条深链」或「纯邀请码」里抽出邀请码；抽不出 / 形状不合规返回 null。
 *
 * ⚠️ 这是**加入表单**用的宽松解析（粘贴整条链接或纯码都认）；主进程深链分发另有
 * 一份**严格**解析（`desktopProjectJoinLink.ts`：协议 / host / path 精确、只认 code
 * 一个参数）。两者的 code 正则同一条（`PROJECT_INVITE_CODE_PATTERN`）。
 */
export function parseProjectJoinLink(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // 纯码：直接命中正则即认。
  if (PROJECT_INVITE_CODE_PATTERN.test(trimmed)) return trimmed;
  // 整条链接：抽出 `code=` 查询参数（不用 URL——共享层 lib 不含它）。code 字母表不含
  // `&`/`#`/`=`，捕获组天然在参数边界停下；再过一遍完整正则（含 8–128 长度）。
  const match = /[?&]code=([A-Za-z0-9_-]+)/u.exec(trimmed);
  const candidate = match?.[1] ?? null;
  if (candidate === null || !PROJECT_INVITE_CODE_PATTERN.test(candidate)) return null;
  return candidate;
}

/**
 * 开放邀请特有的**服务端业务码** → 用户可读中文（渲染层报错条据此就地覆盖通用文案）。
 *
 * ⚠️ 这几个码是服务端 HTTP 体里的 `error` 串，不是客户端失败分档
 * （`ProjectCollabErrorCode`）——网络面把它们折进了 400/409/410 的通用桶，渲染层要
 * 说清「关闭了」还是「满了」才需要这张表。⛔ 文案不含内核品牌词根。
 */
export const PROJECT_OPEN_INVITATION_ERROR_CODES = [
  'open_invitation_role_not_allowed',
  'invitation_revoked',
  'invitation_exhausted',
] as const;

export function projectOpenInvitationErrorText(code: string): string | null {
  switch (code) {
    case 'open_invitation_role_not_allowed':
      return '开放邀请只能签发「成员」。';
    case 'invitation_revoked':
      return '该邀请已关闭。';
    case 'invitation_exhausted':
      return '该邀请已达人数上限。';
    default:
      return null;
  }
}

/**
 * 需求 / 任务写路径（建单、改单、提交验收）的**服务端业务码** → 用户可读中文。
 *
 * 与开放邀请那张表同一条纪律：文案收口在共享层，⛔ 业务码不露给用户；认不出的码与缺席
 * 一律 `null`，调用方退回按失败分档 `code` 取的通用句。服务端判定在
 * `scripts/collab-service/server/domain_todo_writes.py`，契约登记在产品契约 V2。
 *
 * ⚠️ 只收写路径守卫与认领的业务码。`forbidden` 这类通用码**不进表**：它在建单路径上意味着
 *    「观察者不能建」，在改单路径上意味着「不是负责人」，一句话说不对两件事。
 * ⚠️ `requirement_already_claimed`：认领端点与改单认领（负责人 2026-09-14 拍板，改单把无主协同
 *    需求设成本人按认领落库）输了的那一方，两处同一句。
 * ⚠️ `claim_required`：新服务端已不再发（改单自设无主需求改为认领），**保留**只为兼容尚未升级的
 *    服务端——客户端恢复了下拉里的「我」，连到旧服务端时这一句仍说得对；删了只会退回通用句。
 * ⭐ TST-02 起多两枚 **409**（服务端 `domain_capabilities.py`）：新测试模式项目里的需求走旧工作单提交
 *    （`requirement_test_mode_required`）、在测需求走旧验收 / 打回或直接改成已取消（`test_round_in_progress`）。
 *    它们与版本冲突同是 409，但**不是**「已被他人更新」——调用方先查本表，⛔ 别把它们当冲突去自愈重取。
 */
export function projectTodoWriteServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'assignee_unchanged':
      return '新处理人与当前处理人相同，无需转交。';
    case 'assignee_not_editor':
      return '观察者只读，不能承接需求或任务。';
    case 'requirement_already_claimed':
      return '该需求已被他人认领，请刷新后重新选择。';
    case 'claim_required':
      return '这条需求还没有人认领，请使用「认领」。';
    case 'requirement_assistant_forbidden':
      return '需求不能直接派给项目助理，请先拆成任务再派。';
    case 'assistant_submit_forbidden':
      return '派给项目助理的工作单只能由派单人或项目管理者提交验收。';
    case 'requirement_test_mode_required':
      return '该项目的需求已改为整体提测，请在需求详情里提交需求测试。';
    case 'test_round_in_progress':
      return '该需求正在整体测试中，不能走原验收流程或直接取消。';
    default:
      return null;
  }
}

/* -------------------------- 成员管理（manager+ / owner） -------------------------- */
/*
 * 改角色与移除是 **manager+**；转让与归档是 **owner-only**（明确不给管理者：转让是
 * 「这个项目此后归谁」的一次性交接，归档是把全项目变只读，都不是日常调度）。
 * 服务端在事务内按令牌强判并落审计——渲染层按 `myRole` 收窄入口只是「不给点了必错的
 * 按钮」，**不是**权限本身。四条硬约束在服务端：
 * ⛔ 不能对自己动手、⛔ 只能管**严格低于**自己的档位、⛔ 最后一位拥有者不可降级或
 * 移除、⛔ 归档后写操作一律拒绝。
 */

/** `project:member-update`：改成员角色。角色闭集不含 owner（见上）。 */
export const ProjectMemberUpdateRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  subject: subjectSchema,
  role: ProjectAssignableRoleSchema,
});

/**
 * `project:member-remove`：把成员移出项目。
 *
 * 连带语义（服务端定义，客户端照此呈现）：**不删该成员已产生的内容**——留言、
 * 消息、待办、文件全部保留（作者与处理人显示名快照已落在各行上），仅撤销访问权；
 * 其名下未完成待办**不自动转移**，卡片上仍是原处理人，由拥有者另行处置。
 */
export const ProjectMemberRemoveRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  subject: subjectSchema,
});

/** `project:transfer`：把拥有者转让给另一位在组成员（服务端单事务，原拥有者降为成员）。 */
export const ProjectTransferOwnershipRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  subject: subjectSchema,
});

/** `project:archive`：归档（`archived:true`）与恢复（`false`）。归档后只读。 */
export const ProjectArchiveRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  archived: z.boolean(),
});

/** 四条成员管理通道同形回权威项目详情（成员名册与归档态就地刷新）。 */
export const ProjectMemberAdminResultSchema = ProjectDetailResultSchema;

/** `project:feed-list`：动态分页（新→旧；`beforeId` 取更旧一页）。 */
export const ProjectFeedListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  beforeId: entityIdSchema.optional(),
  limit: z.number().int().min(1).max(PROJECT_LIST_MAX_LIMIT).optional(),
});

export const ProjectFeedListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    entries: z.array(FeedEntrySchema).max(PROJECT_LIST_MAX_LIMIT),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:feed-post`：发动态（editor+）。`bodyMd` 是用户亲笔；`refs` 是引用 token
 * （@ 成员落 `member:<subject>`、引用资产/待办落 `asset:<id>` / `todo:<id>`）——
 * 与讨论消息**同形态同上界**（G-9）。
 */
export const ProjectFeedPostRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  bodyMd: feedBodySchema,
  refs: projectRefsSchema.optional(),
});

export const ProjectFeedPostResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), entry: FeedEntrySchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:comment-post`：评论动态（editor+）。`bodyMd` 是用户亲笔；
 * `refs` 是 @ 提及的结构化 token（`member:<subject>`），与动态**同形态同上界**。
 */
export const ProjectCommentPostRequestSchema = z.strictObject({
  entryId: entityIdSchema,
  bodyMd: feedBodySchema,
  refs: projectRefsSchema.optional(),
});

export const ProjectCommentPostResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), comment: FeedCommentSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** 搜索页和普通历史分别保存；稀疏命中不代表连续历史覆盖。 */
export const ProjectChatSearchDataSchema = z
  .strictObject({
    messages: z.array(ChatMessageSchema).max(50),
    searchPage: z.strictObject({ nextCursor: z.string().min(1).max(2048).nullable() }),
  })
  .refine(
    ({ messages, searchPage }) =>
      (searchPage.nextCursor === null || messages.length > 0) &&
      messages.every(
        (message, index) =>
          !message.revoked && (index === 0 || message.seq < (messages[index - 1]?.seq ?? 0)),
      ) &&
      new Set(messages.map((message) => message.id)).size === messages.length,
    { message: 'search messages must be active, unique and descending by seq' },
  );

/** `project:chat-history`：普通历史按 seq 翻页；正文搜索使用独立游标。 */
export const ProjectChatHistoryRequestSchema = z
  .strictObject({
    projectId: projectIdSchema,
    afterSeq: z.number().int().safe().nonnegative().optional(),
    beforeSeq: z.number().int().safe().positive().optional(),
    limit: z.number().int().min(1).max(PROJECT_LIST_MAX_LIMIT).optional(),
    authorSubject: subjectSchema.optional(),
    createdAfter: z.string().max(64).datetime({ offset: true }).optional(),
    createdBefore: z.string().max(64).datetime({ offset: true }).optional(),
    search: z
      .strictObject({
        query: z.string().trim().min(1).max(128),
        cursor: z.string().min(1).max(2048).optional(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.search !== undefined &&
      (value.afterSeq !== undefined || value.beforeSeq !== undefined || (value.limit ?? 20) > 50)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['search'],
        message: 'search uses its own cursor and a maximum limit of 50',
      });
    }
    if (
      value.createdAfter !== undefined &&
      value.createdBefore !== undefined &&
      Date.parse(value.createdAfter) >= Date.parse(value.createdBefore)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['createdBefore'],
        message: 'createdBefore must be later than createdAfter',
      });
    }
  });

export const ProjectChatHistoryResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      messages: z.array(ChatMessageSchema).max(PROJECT_LIST_MAX_LIMIT),
      searchPage: ProjectChatSearchDataSchema.shape.searchPage.optional(),
    })
    .refine(
      (value) =>
        value.searchPage === undefined ||
        ProjectChatSearchDataSchema.safeParse({
          messages: value.messages,
          searchPage: value.searchPage,
        }).success,
      { message: 'invalid search page' },
    ),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:chat-send`：发讨论消息（editor+）。`bodyMd` 是用户亲笔；`refs` 是引用 token。 */
export const ProjectChatSendRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  bodyMd: chatBodySchema,
  refs: projectRefsSchema.optional(),
  clientMessageId: z.string().uuid().optional(),
});

export const ProjectChatSendResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), message: ChatMessageSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:chat-revoke`：撤回本人消息（时限内）；超时/他人 → `forbidden`。 */
export const ProjectChatRevokeRequestSchema = z.strictObject({
  messageId: entityIdSchema,
});

/** 撤回成功回软删后的这条消息（`revoked=true`、正文已置空），渲染层就地替换。 */
export const ProjectChatRevokeResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), message: ChatMessageSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:read-cursor`：读游标上报（服务端幂等 max()，重放无害）。 */
export const ProjectReadCursorRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  lastReadSeq: z.number().int().safe().nonnegative(),
});

export const ProjectReadCursorResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-list`：项目待办稳定游标分页（默认 30、最大 50）。
 *
 * 三个过滤字段全是**可选增量**：一个都不带时行为与两级化之前逐字一致。
 * `parentId` 三态要分清：
 *  - 缺席（`undefined`）＝ 不过滤，需求与任务一起回；
 *  - `null`            ＝ **只要顶层**（只回需求）；
 *  - uuid              ＝ 只回挂在那条需求下的任务。
 *
 * ⚠️ 过滤是**收窄**不是开关：显式 `visibility: 'personal'` 也只拿得到自己建的那些，
 * 别人的个人条目在任何一档下都取不到（判定在服务端，客户端参数改不动它）。
 */
export const ProjectTodoListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  parentId: entityIdSchema.nullable().optional(),
  source: TodoSourceSchema.optional(),
  visibility: TodoVisibilitySchema.optional(),
  cursor: z.string().min(1).max(1_024).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const ProjectTodoListResultSchema = z.discriminatedUnion('ok', [
  z
    .strictObject({
      ok: z.literal(true),
      todos: z.array(TodoSchema).max(50),
      hasMore: z.boolean(),
      nextCursor: z.string().min(1).max(1_024).nullable(),
    })
    .superRefine((value, context) => {
      if (value.hasMore !== (value.nextCursor !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextCursor'],
          message: 'nextCursor must be present exactly when hasMore is true',
        });
      }
    }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * 需求页码查询（CORE-07，`project:requirement-page`）——与游标端点 `project:todo-list`
 * **并存、互不替代**（旧游标端点不删、语义不改，取数系统仍逐页扫全量）。
 *
 * 这条给界面「跳到第 N 页」：服务端在一致快照里先按项目+可见性授权、再过滤、再
 * COUNT 与 LIMIT/OFFSET，回 `items/total/page/pageSize/queryRevision`。
 *
 * ⚠️ 每页条数只能是 5 / 10 / 20（design §4 逐字）；非法页码/条数由服务端回 400
 * （客户端契约里 `pageSize` 就是这三值的字面量联合，别的值连表达都表达不出来）。
 * ⚠️ `keyword` 只搜标题；过滤是**收窄**：显式 `assigneeSubject` 也拿不到别人的个人需求。
 * ⭐ `planFrom` / `planTo`（CORE-08，ADR-0042）：计划起止与时间段交叠（含左不含右、按 UTC 日展开，
 *    只有截止按截止当天算，截止为空不进结果），与其余筛选 AND 叠加、在分页之前；日历与时间轴按
 *    可见的那一段逐页取全。两端都给时要求起点早于终点。
 */
export const ProjectRequirementPageRequestSchema = z
  .strictObject({
    projectId: projectIdSchema,
    page: z.number().int().min(1),
    pageSize: z.union([z.literal(5), z.literal(10), z.literal(20)]),
    /** 缺席＝需求池（服务端默认 requirement）；显式给 task 则查任务。 */
    itemKind: TodoItemKindSchema.optional(),
    view: z.literal('claimed').optional(),
    sortBy: z.enum(['priority', 'dueAt', 'createdAt', 'title', 'status']).optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
    assigneeSubject: subjectSchema.optional(),
    creatorSubject: subjectSchema.optional(),
    /** 关键字（标题子串）；空串不传（省略＝不筛）。上界与服务端同界（超长服务端 400）。 */
    keyword: z.string().min(1).max(200).optional(),
    status: TodoStatusSchema.optional(),
    iterationId: entityIdSchema.optional(),
    moduleId: entityIdSchema.optional(),
    categoryId: entityIdSchema.optional(),
    ...projectPlanWindowShape,
  })
  .superRefine(refineProjectPlanWindow)
  .superRefine((value, context) => {
    if (
      value.view === 'claimed' &&
      (value.itemKind !== undefined || value.assigneeSubject !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['view'],
        message: 'claimed view fixes the current member and root kinds',
      });
    }
    if (value.sortDirection !== undefined && value.sortBy === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sortBy'],
        message: 'sort direction requires a field',
      });
    }
  });

export const ProjectRequirementPageResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    /** 本页需求（至多 pageSize≤20 条）；每条形状与看板列表逐字一致（含只读派生字段）。 */
    items: z.array(TodoSchema).max(20),
    /** 命中总数：与 items 同一次快照、同一道权限门算出（⛔ 不是两次查）。 */
    total: z.number().int().safe().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.union([z.literal(5), z.literal(10), z.literal(20)]),
    /**
     * 项目业务修订号（不透明串，渲染层只做等值比较）：翻页途中它变了＝数据变了、提示刷新。
     * ⛔ 不含隐藏记录数量（服务端按可见集算）。
     */
    queryRevision: z.string().min(1).max(128),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-create`：建待办（editor+）。标题/描述是用户亲笔。
 *
 * `itemKind` 显式决定需求/任务；`parentId` 只表达直接父项，两者不得互相推导。
 * `source` / `visibility` 缺省 `manual` / `shared`（缺省 shared 的理由见 TodoVisibilitySchema）。
 */
/**
 * 「派给助理」与「派给某位成员」**不能同时说**——跨字段判据，两端共用这一份。
 *
 * 助理不是成员账号（见 `TodoAssigneeKindSchema`），两处都写就会造出一条
 * 「档位说是助理、处理人却写着某个人」的请求，而服务端的验收闸恰恰要读这两处。
 * ⛔ 别在调用点各写各的：它同时挂在建单与改单两个契约上。
 */
export function assigneeDispatchIsConsistent(input: {
  readonly assigneeKind?: TodoAssigneeKind | undefined;
  readonly assigneeSubject?: string | null | undefined;
}): boolean {
  return input.assigneeKind !== 'assistant' || (input.assigneeSubject ?? null) === null;
}

export const ASSIGNEE_DISPATCH_CONFLICT_MESSAGE = 'assistant assignee takes no member subject';

/**
 * 建待办的**字段集**（未挂跨字段判据）。
 *
 * 单独导出只为一件事：zod 的 `.omit()` 不能作用在带 refinement 的对象上，而
 * Main 的工具面要从这里裁掉 `projectId` / `source`（模型不能自选项目、不能自称
 * 是人建的）。⚠️ 从它派生的每一处**都必须自己挂上** `assigneeDispatchIsConsistent`
 * ——判据只有一份，但要记得用。
 */
export const ProjectTodoCreateFieldsSchema = z.strictObject({
  projectId: projectIdSchema,
  itemKind: TodoItemKindSchema,
  parentId: entityIdSchema.optional(),
  source: TodoSourceSchema.optional(),
  visibility: TodoVisibilitySchema.optional(),
  title: todoTitleSchema,
  status: TodoStatusSchema.optional(),
  /**
   * 处理人档位（0010）：缺省 `member`。给 `assistant` ＝派给项目助理，
   * 此时**不许**再带 `assigneeSubject`（下面的 refine 与服务端 CHECK 各拒一次）。
   */
  assigneeKind: TodoAssigneeKindSchema.optional(),
  assigneeSubject: subjectSchema.optional(),
  priority: TodoPrioritySchema.optional(),
  labels: todoLabelsSchema.optional(),
  startAt: timestampSchema.optional(),
  dueAt: timestampSchema.optional(),
  description: todoDescriptionSchema.optional(),
  sessionRef: projectRefSchema.optional(),
  refs: projectRefsSchema.optional(),
  /**
   * 工作单面：注意事项 + 验收清单。
   *
   * **给了验收清单这条就是工作单**——随之落入服务端的验收闸（有判据的单不能直跳
   * 「已完成」，必须提交验收再由派单人认可）。不给就是一条普通待办，行为不变。
   */
  constraintsText: todoConstraintsSchema.optional(),
  acceptanceItems: todoAcceptanceTextsSchema.optional(),
  /**
   * 归类面（0021）：同项目的模块/分类字典条目 id。缺席 ＝「未分类」。
   *
   * ⚠️ 建单这一侧**只有 `.optional()` 没有 `.nullable()`**（与 `dueAt` 同款）：建单时
   * 「不给」与「给 null」是同一件事，多一种写法就多一处两端要各自处理的分支。
   * 「清空」那个语义只在改单时有意义，所以 `null` 只出现在更新契约里。
   *
   * ⛔ **没有 `iterationId`**：本契约是 `strictObject`，所以「建单时直接排期」在客户端
   *    连表达都表达不出来（服务端另有 422 显式拒绝，见 `TodoSchema.iterationId`）。
   */
  moduleId: entityIdSchema.optional(),
  categoryId: entityIdSchema.optional(),
});

export const ProjectTodoCreateRequestSchema = ProjectTodoCreateFieldsSchema.refine(
  assigneeDispatchIsConsistent,
  { message: ASSIGNEE_DISPATCH_CONFLICT_MESSAGE },
);

export const ProjectTodoCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), todo: TodoSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-update`：部分更新（乐观锁）。缺席＝不改；`null`＝清空
 * （处理人/截止时间/描述可清）。至少带一项变更；跨成员转交由服务端按角色裁决。
 *
 * ⛔ **刻意没有** `source` 与 `visibility`：
 *  - `source` 是建单当时的来源留痕，可改就不是留痕了；
 *  - `visibility` 翻转是产品决策（谁有权把一条协同待办藏成个人的？）——未拍板不做半截，
 *    只放开一半（个人→协同）反而会留下一个说不清的中间态。
 */
export const ProjectTodoUpdateRequestSchema = z
  .strictObject({
    todoId: entityIdSchema,
    expectedVersion: z.number().int().safe().positive(),
    /** 改挂靠：uuid ＝挂到那条需求下；`null` ＝摘出来变回顶层需求；缺席 ＝不动。 */
    parentId: entityIdSchema.nullable().optional(),
    title: todoTitleSchema.optional(),
    status: TodoStatusSchema.optional(),
    /**
     * 改派档位（0010）：`assistant` ＝改派给项目助理（服务端随之清空处理人两列）；
     * `member` ＝改回成员档。缺席＝不改档位。
     *
     * ⚠️ **待验收档下服务端一律拒改处理人与档位**（409 `conflict`）：验收进行中换
     * 执行方 ＝ 把已经交出去的活重新定义，也是「执行方不能自证验收」那道闸的
     * 洗白路径。客户端这一侧只负责不摆那个入口，判定在服务端。
     */
    assigneeKind: TodoAssigneeKindSchema.optional(),
    assigneeSubject: subjectSchema.nullable().optional(),
    priority: TodoPrioritySchema.optional(),
    labels: todoLabelsSchema.optional(),
    startAt: timestampSchema.nullable().optional(),
    dueAt: timestampSchema.nullable().optional(),
    description: todoDescriptionSchema.nullable().optional(),
    /** `null`＝解绑执行会话（缺席＝不改）。 */
    sessionRef: projectRefSchema.nullable().optional(),
    /** 整数组替换（缺席＝不改；`[]`＝清空全部关联材料）。 */
    refs: projectRefsSchema.optional(),
    /**
     * 注意事项可改（它是边界说明，改了仍是当下的边界）。
     *
     * ⛔ **验收清单不在这里**：它有独立通道 `project:todo-acceptance-set`。
     * 改判据会作废已勾的条目——那是一次语义明确的动作，不该混在一次普通改单里，
     * 混进来就会出现「顺手改了个标题，勾好的验收全没了」。
     */
    constraintsText: todoConstraintsSchema.optional(),
    /**
     * 归类面（0021）：`uuid` ＝改成那条字典条目；`null` ＝**清空**（回到「未分类」）；
     * 缺席 ＝**不改**。三态与读取侧同构，服务端按 `fields_set` 区分后两者。
     *
     * ⚠️ 「缺席＝不改」这一半不是客户端的自觉：Main 的写请求**按 undefined 省略键**
     *    （`collabClient.updateTodo`），服务端再按「请求里有没有这个键」判。⛔ 谁也
     *    不要在中途补一个 `?? null`——补了就把「不改」变成「清空」，表现是「顺手改了
     *    个标题，归类没了」。
     *
     * ⛔ **没有 `iterationId`**（本契约是 `strictObject`）：理由见
     *    `TodoSchema.iterationId`。改单这一侧尤其不能开——一旦能改，「排期历史」
     *    这件事就有了第二个写口，而它不落历史。
     */
    moduleId: entityIdSchema.nullable().optional(),
    categoryId: entityIdSchema.nullable().optional(),
  })
  .refine(
    (request) =>
      request.parentId !== undefined ||
      request.title !== undefined ||
      request.status !== undefined ||
      request.assigneeKind !== undefined ||
      request.assigneeSubject !== undefined ||
      request.priority !== undefined ||
      request.labels !== undefined ||
      request.startAt !== undefined ||
      request.dueAt !== undefined ||
      request.description !== undefined ||
      request.sessionRef !== undefined ||
      request.refs !== undefined ||
      request.constraintsText !== undefined ||
      // ⚠️ 判据是 `!== undefined` 而不是真值：显式 `null`（清空归类）**是**一次变更，
      // 「只把模块清掉」必须算作一次合法的改单。
      request.moduleId !== undefined ||
      request.categoryId !== undefined,
    { message: 'at least one field to update' },
  )
  // 与建单同一条跨字段判据：改派给助理时不许再指名一位成员处理人。
  .refine(assigneeDispatchIsConsistent, { message: ASSIGNEE_DISPATCH_CONFLICT_MESSAGE });

/**
 * 待办更新结果。失败分支的 `currentVersion` **仅** `code === 'conflict'` 时非空
 * （服务端 409 带回的当前版本，UI 据此提示刷新后重试），其余失败码恒为 null。
 */
export const ProjectTodoUpdateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), todo: TodoSchema }),
  z.strictObject({
    ok: z.literal(false),
    ...projectCollabErrorShape,
    currentVersion: z.number().int().safe().positive().nullable(),
  }),
]);

/**
 * 认领一条无主需求（FLOW-02）：把处理人两列从无主改成本人，并写入计划日期
 * （复用 `startAt`/`dueAt`，不新增字段）。与改单 `project:todo-update` **刻意分开**：
 * 改单走转交语义，认领只对无主生效、由服务端一条条件更新判定。
 *
 * `startAt`/`dueAt`：给时间戳＝写入；`null`＝写空；缺席＝不送（服务端同样写空）。
 * ⛔ 没有 `expectedVersion`：认领的并发判据是「是否已有主」而非版本号——条件更新的
 *    影响行数已把赛跑判干净，再叠版本号只会把「已被认领」错报成「版本冲突」。
 */
export const ProjectRequirementClaimRequestSchema = z.strictObject({
  todoId: entityIdSchema,
  startAt: timestampSchema.nullable().optional(),
  dueAt: timestampSchema.nullable().optional(),
});

/**
 * 认领结果。失败**恰如其实**：已被他人认领回 `conflict`（服务端 409
 * `requirement_already_claimed`，经 `serverCode` 透传），⛔ 绝不伪成功——调用方据此
 * 保留一条真实失败提示，而不是显示成功再被下次刷新默默纠正。
 */
export const ProjectRequirementClaimResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), todo: TodoSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-delete` 一次可提交的**根 id** 条数上界。
 *
 * ⚠️ 这是**根 id** 的上界，与服务端 delete-batch 的 422 边界逐字对齐（1–100 个根，
 * 不放宽也不收紧）。⛔ **不是级联子树的上界**——一棵需求树删下来可能远超 100 条，
 * 那条总数**不设上界**（`deletedIds` 刻意不封顶，见下）。两者别混：给子树/结果封顶
 * 正是本分支刚出过的「整页取不回」那类故障的成因。
 */
export const PROJECT_TODO_DELETE_MAX_ROOTS = 100;

/**
 * `project:todo-delete`：软删一条或多条需求/任务及其**整棵子树**（manager+，服务端强判）。
 *
 * `ids` 是**根 id** 列表（1–100，uuid；与服务端 delete-batch 的 422 边界对齐）；单条删除
 * 即 `ids` 只含一个元素。`projectId` 供批量端点定位项目；单条端点由服务端从待办自身推
 * 项目、不读它，但契约统一带上——主进程按 `ids` 条数选端点（1 条走单条，多条走批量）。
 *
 * ⛔ 没有 expectedVersion：删除不是乐观锁写（整棵子树一起软删，没有「基于某版本」的语义）。
 */
export const ProjectTodoDeleteRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  ids: z.array(entityIdSchema).min(1).max(PROJECT_TODO_DELETE_MAX_ROOTS),
});

/**
 * 删除结果。成功带回**整棵子树**被删的 id 全集与条数（服务端按 `(created_at,id)` 升序、
 * 各根子树并集去重）。
 *
 * ⛔ `deletedIds` **刻意不封顶**：级联总数不受根上界约束，给它加 `.max()` 会在删一棵大树时
 * 把一次本该成功的响应判成不可信。响应体本身的大小另由 `collabClient` 的 `readBoundedJson`
 * 兜底，不需要这里再设条数上界。
 *
 * 失败沿用统一信封（含可选 `serverCode`）：403 `forbidden`、404 `todo_not_found`（已删/
 * 不存在/跨项目/别人的个人条目）、403 `project_archived`、409 `draft_source_deleted` 都经
 * `serverCode` 透传给渲染层；其中 `todo_not_found` 让上层**静默**把它从看板移除而非弹错。
 *
 * ⚠️ 单条与批量端点的失败语义**不对称**，渲染层据此分流：单条删除（`ids` 恰一个根，主进程
 * 走 `DELETE /todos/{id}`）幂等，`todo_not_found` 即「它确已不在」，静默摘掉该行成立；批量
 * （多个根，走 `delete-batch`）是**整批事务**——任一根不属该项目 → 404 且**一条都没删**
 * （服务端回滚）。故对**多根**请求收到 `todo_not_found` **不可**据以摘掉已选行（否则与服务端
 * 脱同步），应改为重取列表对齐。`deletedIds`/`count` 只在 `ok:true` 时可信。
 * ⛔ 无 currentVersion（删除非乐观锁写）。
 */
export const ProjectTodoDeleteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    deletedIds: z.array(entityIdSchema),
    count: z.number().int().safe().nonnegative(),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/* ------------------------------------------------------------------ */
/* 工作单：单条读取 / 验收清单 / 提交验收 / 验收与打回 / 拆解草案闸      */
/* ------------------------------------------------------------------ */

/**
 * `project:todo-detail`：单条工作单的完整规格。
 *
 * 列表通道只回验收**计数**；逐条判据与完成记录时间线只在这里给。
 */
export const ProjectTodoDetailRequestSchema = z.strictObject({
  todoId: entityIdSchema,
});

const todoDetailShape = {
  todo: TodoSchema,
  acceptanceItems: z.array(TodoAcceptanceItemSchema).max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  completionRecords: z.array(TodoCompletionRecordSchema).max(PROJECT_TODO_MAX_COMPLETION_RECORDS),
};

export const ProjectTodoDetailResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), ...todoDetailShape }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-acceptance-set`：**整表替换**验收清单（乐观锁）。
 *
 * 整表替换而不是逐条增删：验收清单是一份规格，改它等于重定义「怎么算做完」，
 * 已勾的条目随之作废（勾的是旧判据）。逐条增删会留下「一半按旧判据勾过、
 * 一半按新判据没勾」的混合态——那时谁也说不清这单到底验的是什么。
 *
 * `items` 给 `[]` ＝ 这条不再是工作单（退回普通待办）。
 */
export const ProjectTodoAcceptanceSetRequestSchema = z.strictObject({
  todoId: entityIdSchema,
  expectedVersion: z.number().int().safe().positive(),
  items: todoAcceptanceTextsSchema,
});

export const ProjectTodoAcceptanceSetResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    todo: TodoSchema,
    acceptanceItems: z.array(TodoAcceptanceItemSchema).max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectCollabErrorShape,
    currentVersion: z.number().int().safe().positive().nullable(),
  }),
]);

/**
 * `project:todo-submit-review`：执行方推到「待验收」并写完成记录。
 *
 * ⚠️ 这是进入「待验收」的**唯一**入口——普通改单推不进那一档（服务端判定）。
 * 因此「待验收」必然伴随一条完成记录，验收方永远知道该看什么。
 * `summary`（做了什么）必填；`artifacts` 是产出关联的引用 token，⛔ 正文进不来。
 */
export const ProjectTodoSubmitReviewRequestSchema = z.strictObject({
  todoId: entityIdSchema,
  expectedVersion: z.number().int().safe().positive(),
  summary: userAuthoredBody(PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH),
  artifacts: z.array(projectRefSchema).max(PROJECT_TODO_MAX_COMPLETION_ARTIFACTS).optional(),
  /** 逐条验收自述（序号 → 「这条我是怎么满足的」）。 */
  itemNotes: z
    .array(
      z.strictObject({
        ordinal: z.number().int().safe().positive().max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS),
        note: userAuthoredBody(PROJECT_TODO_ACCEPTANCE_NOTE_MAX_LENGTH),
      }),
    )
    .max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS)
    .optional(),
});

const todoReviewSuccessShape = {
  todo: TodoSchema,
  /** 通过时为 null（通过不写记录，写的是验收动作本身）；提交与打回时非空。 */
  completionRecord: TodoCompletionRecordSchema.nullable(),
};

export const ProjectTodoSubmitReviewResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), ...todoReviewSuccessShape }),
  z.strictObject({
    ok: z.literal(false),
    ...projectCollabErrorShape,
    currentVersion: z.number().int().safe().positive().nullable(),
  }),
]);

/** 验收结论：通过 / 打回。 */
export const TodoReviewDecisionSchema = z.enum(['accept', 'reject']);

/**
 * `project:todo-review`：派单方验收（→已完成）或打回（→进行中）。
 *
 * ⚠️ **打回理由必填**——不写理由的打回等于让执行方猜。契约层用 refine 钉死，
 * 不是在调用点写个 if：调用点可以有第二个，契约只有一份。
 *
 * `checkedOrdinals` 是「通过时顺手勾上的判据序号」。通过要求清单**全部勾选**，
 * 所以它既是一次勾选也是一次提交——分成两个通道会出现「勾了但没提交」的中间态，
 * 而那个中间态在界面上与「已通过」长得一样。
 */
export const ProjectTodoReviewRequestSchema = z
  .strictObject({
    todoId: entityIdSchema,
    expectedVersion: z.number().int().safe().positive(),
    decision: TodoReviewDecisionSchema,
    reason: userAuthoredBody(PROJECT_TODO_COMPLETION_SUMMARY_MAX_LENGTH).optional(),
    checkedOrdinals: z
      .array(z.number().int().safe().positive().max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS))
      .max(PROJECT_TODO_MAX_ACCEPTANCE_ITEMS)
      .optional(),
  })
  .refine(
    (request) =>
      request.decision === 'accept'
        ? request.reason === undefined
        : (request.reason ?? '').trim().length > 0,
    { message: 'reject requires a reason; accept must not carry one' },
  );

export const ProjectTodoReviewResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), ...todoReviewSuccessShape }),
  z.strictObject({
    ok: z.literal(false),
    ...projectCollabErrorShape,
    currentVersion: z.number().int().safe().positive().nullable(),
  }),
]);

/** `project:todo-draft-list`：我看得见的草案批次（我发起的，或派给我的）。 */
export const ProjectTodoDraftListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
});

export const ProjectTodoDraftListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    batches: z.array(TodoDraftBatchSchema).max(PROJECT_MAX_DRAFT_BATCHES),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-draft-create`：落一批拆解草案（editor+）。
 *
 * ⛔ 草案**不是待办**：服务端把它落在独立的两张表里，正式清单的任何查询都看不见。
 * 「不占正式清单」因此是结构性的，不靠每处查询记得排除。
 */
export const ProjectTodoDraftCreateRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  /** 当前拆解源。Main 两个明确工具均必填，服务端确认事务内重新读取。 */
  sourceTodoId: entityIdSchema,
  targetItemKind: TodoItemKindSchema,
  parentId: entityIdSchema,
  items: z
    .array(
      z.strictObject({
        title: todoTitleSchema,
        description: todoDescriptionSchema.optional(),
        constraintsText: todoConstraintsSchema.optional(),
        acceptanceItems: todoAcceptanceTextsSchema.optional(),
        priority: TodoPrioritySchema.optional(),
        /**
         * 这一条的依据在输入里吗？缺席按 `input` 处理。
         *
         * ⛔ 缺省不能倒过来设成 `assumed`：那会把每一条都染成可疑，审阅的人反而
         *    分不清哪几条真该重点看——区分不出来就等于没有区分。
         */
        basis: TodoDraftBasisSchema.optional(),
      }),
    )
    .min(1)
    .max(PROJECT_MAX_DRAFTS_PER_BATCH),
});

export const ProjectTodoDraftCreateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), batch: TodoDraftBatchSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:todo-draft-drop`：逐条剔除一条草案（留痕：谁、什么时候）。 */
export const ProjectTodoDraftDropRequestSchema = z.strictObject({
  draftId: entityIdSchema,
});

export const ProjectTodoDraftDropResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), batch: TodoDraftBatchSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:todo-draft-resolve`：整批确认成单 / 整批丢弃。
 *
 * 确认时只把还是 `pending` 的草案落成待办——被逐条剔除的那些已经是终态。
 */
export const ProjectTodoDraftResolveRequestSchema = z.strictObject({
  batchId: entityIdSchema,
  decision: z.enum(['confirm', 'discard']),
});

export const ProjectTodoDraftResolveResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    batch: TodoDraftBatchSchema,
    /** 确认时新生成的任务；丢弃时恒为空数组。 */
    todos: z.array(TodoSchema).max(PROJECT_MAX_DRAFTS_PER_BATCH),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * 整批处理拆解草案的**服务端业务码** → 报错条文案（就地覆盖通用文案）。
 *
 * 与 `projectRequirementScheduleServerCodeText` 同一条纪律：文案收口在共享层，⛔ 业务码不露给
 * 用户；认不出的码与缺席一律 `null`，调用方退回按 `code` 取的通用句。
 * ⚠️ 这几种都是 409，塌缩成通用 `conflict` 就只剩「数据已被他人更新，请刷新后重试」——认领门、
 *    来源已删、批次已处理，没有一种是刷新重试能好的。
 * 批次级终态闸的码是 `draft_batch_closed`；`draft_already_resolved` 只出在逐条剔除端点。
 */
export function projectTodoDraftResolveServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    // 「所属需求」而非「这条需求」：批次父项可能是一条任务，被判的是它往上最近的那条需求。
    case 'requirement_not_claimed':
      return '请先认领所属需求，再确认任务草案。';
    case 'draft_source_deleted':
      return '拆解来源已删除，这批草案不能再确认。';
    case 'draft_source_not_found':
      return '拆解来源已不存在，这批草案不能再确认。';
    case 'draft_batch_closed':
      return '这批草案已经处理过，请刷新后查看。';
    default:
      return null;
  }
}

/**
 * 逐条剔除拆解草案的**服务端业务码** → 报错条文案（FLOW-12，与整批处理同一条纪律）。
 *
 * 404 两种：这一条 / 这一批已不存在（看不见与不存在对外同码）；409 两种都不是「被他人更新」：
 * 这一条已经剔除 / 成单过，或整批已经确认 / 丢弃过。认不出的码与缺席一律 `null`，调用方
 * 退回按 `code` 取的通用句。
 */
export function projectTodoDraftDropServerCodeText(
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'draft_not_found':
      return '这条草案已不存在，请刷新后查看。';
    case 'draft_batch_not_found':
      return '这批草案已不存在，请刷新后查看。';
    case 'draft_already_resolved':
      return '这条草案已经处理过，请刷新后查看。';
    case 'draft_batch_closed':
      return '这批草案已经处理过，请刷新后查看。';
    default:
      return null;
  }
}

/** `project:file-list`：文件列表（可按 kind 过滤）。 */
export const ProjectFileListRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  kind: ProjectFileKindSchema.optional(),
});

export const ProjectFileListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    files: z.array(ProjectFileSchema).max(PROJECT_FILE_MAX_ENTRIES),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/**
 * `project:file-upload`：上传（editor+）。**请求里既没有字节也没有路径**——
 * 仓库纪律「路径绝不跨 IPC」（见 channels.ts 的 LOCAL_SESSION_ATTACHMENT_PICK）：
 * 渲染层只表达「为哪个项目、传哪类」，Main 弹系统文件选择框拿路径、自行读盘、
 * 以裸字节体直发服务端；渲染层从不读 fs、从不见路径。
 * 大小上限（1 GiB）由 Main stat 后校验并由服务端复检，不在此处以字段表达。
 */
export const ProjectFileUploadRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  kind: ProjectFileKindSchema,
  operationId: z.string().uuid(),
});

/** `project:file-upload-cancel`：只持有不透明操作号，路径始终留在 Main。 */
export const ProjectFileUploadCancelRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
});

export const ProjectFileUploadCancelResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** Main → Renderer 的上传快照；严格不含本机路径、令牌或服务端正文。 */
export const ProjectFileUploadProgressSchema = z
  .strictObject({
    operationId: z.string().uuid(),
    name: z.string().min(1).max(512),
    size: z.number().int().safe().positive().max(PROJECT_FILE_MAX_BYTES),
    progress: z.number().int().safe().nonnegative().max(PROJECT_FILE_MAX_BYTES),
    phase: z.enum(['uploading', 'finalizing', 'completed', 'cancelled', 'failed']),
    error: ProjectCollabErrorCodeSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.progress > value.size) {
      context.addIssue({ code: 'custom', path: ['progress'], message: 'progress exceeds size' });
    }
    if (value.phase === 'completed' && value.progress !== value.size) {
      context.addIssue({
        code: 'custom',
        path: ['progress'],
        message: 'completed progress mismatch',
      });
    }
    if ((value.phase === 'failed') !== (value.error !== null)) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'error/phase mismatch' });
    }
  });

/**
 * 临时文件配额触顶时随失败体带回的两个数。
 *
 * ⚠️ 它存在的**全部理由**是「触顶要说得出上限多少、现在用了多少」——一句通用的
 * 「上传失败」等于让用户去猜是文件太大、网断了、还是没权限。两个数都是字节，
 * 由渲染层按人读的单位格式化（服务端不回文案，客户端不回显服务端文本）。
 */
export const ProjectFileQuotaSchema = z.strictObject({
  limitBytes: z.number().int().safe().nonnegative(),
  usedBytes: z.number().int().safe().nonnegative(),
});

/**
 * 上传结果三分支：完成（带 `file`）/ 用户在系统选择框里取消（`cancelled`，
 * 不是错误，UI 静默收起）/ 失败。成功侧 `file` 与 `cancelled` 二选一。
 *
 * 失败侧的 `quota` **仅** `code === 'quotaExceeded'` 时非空（形态照待办 PATCH 的
 * `currentVersion` 先例），其余失败码恒为 null。
 */
export const ProjectFileUploadResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), file: ProjectFileSchema }),
  z.strictObject({ ok: z.literal(true), cancelled: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    ...projectCollabErrorShape,
    quota: ProjectFileQuotaSchema.nullable(),
  }),
]);

/** `project:file-download`：下载。Main 写到会话下载目录后只回落盘绝对路径。 */
export const ProjectFileDownloadRequestSchema = z.strictObject({
  fileId: entityIdSchema,
});

export const ProjectFileDownloadResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    savedPath: z.string().min(1).max(4_096),
    downloadUrl: z.string().optional(),
  }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:file-promote`：temp→asset 转存（editor+；产生 system 动态）。 */
export const ProjectFilePromoteRequestSchema = z.strictObject({
  fileId: entityIdSchema,
});

export const ProjectFilePromoteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), file: ProjectFileSchema }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

/** `project:file-delete`：删除（本人或 owner；服务端软删）。 */
export const ProjectFileDeleteRequestSchema = z.strictObject({
  fileId: entityIdSchema,
});

export const ProjectFileDeleteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), ...projectCollabErrorShape }),
]);

const projectDomainEventKindSchema = z.enum(PROJECT_DOMAIN_EVENT_KINDS);

/**
 * `project:event` 的载荷（Main → 渲染层单通道多路复用）：
 *  - 域事件帧：来自服务端事件流，带 `projectId`；`payload` 是服务端事件负载的
 *    **不透明透传**（有界 JSON）——渲染层把它当「有事发生」的提示，按 kind 走
 *    对应请求通道重取权威数据，**不直接信任其内部结构**（服务端负载形状归线
 *    协议管，不在客户端契约里二次锁死）。
 *  - 连接状态帧：`kind='connection'`，Main 自产，不带 `projectId`；
 *    `payload = {state}` 表达事件流在线/降级/离线。
 */
export const ProjectEventSchema = z.union([
  z.strictObject({
    kind: projectDomainEventKindSchema,
    projectId: projectIdSchema,
    payload: z.json(),
  }),
  z.strictObject({
    kind: z.literal('connection'),
    payload: z.strictObject({ state: ProjectConnectionStateSchema }),
  }),
]);

export type ProjectRole = z.infer<typeof ProjectRoleSchema>;
export type ProjectInvitationRole = z.infer<typeof ProjectInvitationRoleSchema>;
export type ProjectMemberState = z.infer<typeof ProjectMemberStateSchema>;
export type TodoStatus = z.infer<typeof TodoStatusSchema>;
export type TodoPriority = z.infer<typeof TodoPrioritySchema>;
export type TodoSource = z.infer<typeof TodoSourceSchema>;
export type TodoVisibility = z.infer<typeof TodoVisibilitySchema>;
export type TodoItemKind = z.infer<typeof TodoItemKindSchema>;
export type TodoAssigneeKind = z.infer<typeof TodoAssigneeKindSchema>;
export type FeedEntryKind = z.infer<typeof FeedEntryKindSchema>;
export type ProjectFileKind = z.infer<typeof ProjectFileKindSchema>;
export type ProjectEventKind = z.infer<typeof ProjectEventKindSchema>;
export type ProjectConnectionState = z.infer<typeof ProjectConnectionStateSchema>;
export type ProjectCollabErrorCode = z.infer<typeof ProjectCollabErrorCodeSchema>;
export type ProjectCollabServerCode = z.infer<typeof ProjectCollabServerCodeSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectMemberPreview = z.infer<typeof ProjectMemberPreviewSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type ProjectFileQuota = z.infer<typeof ProjectFileQuotaSchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type FeedComment = z.infer<typeof FeedCommentSchema>;
export type FeedEntry = z.infer<typeof FeedEntrySchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type Todo = z.infer<typeof TodoSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type ProjectCollabAvailability = z.infer<typeof ProjectCollabAvailabilitySchema>;
export type ProjectAvailabilityRequest = z.infer<typeof ProjectAvailabilityRequestSchema>;
export type ProjectListRequest = z.infer<typeof ProjectListRequestSchema>;
export type ProjectListResult = z.infer<typeof ProjectListResultSchema>;
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;
export type ProjectCreateResult = z.infer<typeof ProjectCreateResultSchema>;
export type ProjectDetailRequest = z.infer<typeof ProjectDetailRequestSchema>;
export type ProjectDetailResult = z.infer<typeof ProjectDetailResultSchema>;
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequestSchema>;
export type ProjectUpdateResult = z.infer<typeof ProjectUpdateResultSchema>;
export type ProjectConventions = z.infer<typeof ProjectConventionsSchema>;
export type ProjectConventionsRequest = z.infer<typeof ProjectConventionsRequestSchema>;
export type ProjectConventionsResult = z.infer<typeof ProjectConventionsResultSchema>;
export type ProjectConventionsUpdateRequest = z.infer<typeof ProjectConventionsUpdateRequestSchema>;
export type ProjectConventionsUpdateResult = z.infer<typeof ProjectConventionsUpdateResultSchema>;
export type ProjectInvitationKind = z.infer<typeof ProjectInvitationKindSchema>;
export type ProjectOpenInvitationTtlHours = z.infer<typeof ProjectOpenInvitationTtlHoursSchema>;
export type ProjectInviteRequest = z.infer<typeof ProjectInviteRequestSchema>;
export type ProjectInviteResult = z.infer<typeof ProjectInviteResultSchema>;
export type ProjectRedeemInvitationRequest = z.infer<typeof ProjectRedeemInvitationRequestSchema>;
export type ProjectRedeemInvitationResult = z.infer<typeof ProjectRedeemInvitationResultSchema>;
export type ProjectOpenInvitation = z.infer<typeof ProjectOpenInvitationSchema>;
export type ProjectOpenInvitationListRequest = z.infer<
  typeof ProjectOpenInvitationListRequestSchema
>;
export type ProjectOpenInvitationListResult = z.infer<typeof ProjectOpenInvitationListResultSchema>;
export type ProjectInvitationRevokeRequest = z.infer<typeof ProjectInvitationRevokeRequestSchema>;
export type ProjectInvitationRevokeResult = z.infer<typeof ProjectInvitationRevokeResultSchema>;
export type ProjectJoinLinkEvent = z.infer<typeof ProjectJoinLinkEventSchema>;
export type ProjectAssignableRole = z.infer<typeof ProjectAssignableRoleSchema>;
export type ProjectMemberUpdateRequest = z.infer<typeof ProjectMemberUpdateRequestSchema>;
export type ProjectMemberRemoveRequest = z.infer<typeof ProjectMemberRemoveRequestSchema>;
export type ProjectTransferOwnershipRequest = z.infer<typeof ProjectTransferOwnershipRequestSchema>;
export type ProjectArchiveRequest = z.infer<typeof ProjectArchiveRequestSchema>;
export type ProjectMemberAdminResult = z.infer<typeof ProjectMemberAdminResultSchema>;
export type ProjectFeedListRequest = z.infer<typeof ProjectFeedListRequestSchema>;
export type ProjectFeedListResult = z.infer<typeof ProjectFeedListResultSchema>;
export type ProjectFeedPostRequest = z.infer<typeof ProjectFeedPostRequestSchema>;
export type ProjectFeedPostResult = z.infer<typeof ProjectFeedPostResultSchema>;
export type ProjectCommentPostRequest = z.infer<typeof ProjectCommentPostRequestSchema>;
export type ProjectCommentPostResult = z.infer<typeof ProjectCommentPostResultSchema>;
export type ProjectChatHistoryRequest = z.infer<typeof ProjectChatHistoryRequestSchema>;
export type ProjectChatHistoryResult = z.infer<typeof ProjectChatHistoryResultSchema>;
export type ProjectChatSearchData = z.infer<typeof ProjectChatSearchDataSchema>;
export type ProjectChatSendRequest = z.infer<typeof ProjectChatSendRequestSchema>;
export type ProjectChatSendResult = z.infer<typeof ProjectChatSendResultSchema>;
export type ProjectChatRevokeRequest = z.infer<typeof ProjectChatRevokeRequestSchema>;
export type ProjectChatRevokeResult = z.infer<typeof ProjectChatRevokeResultSchema>;
export type ProjectReadCursorRequest = z.infer<typeof ProjectReadCursorRequestSchema>;
export type ProjectReadCursorResult = z.infer<typeof ProjectReadCursorResultSchema>;
export type ProjectTodoListRequest = z.infer<typeof ProjectTodoListRequestSchema>;
export type ProjectTodoListResult = z.infer<typeof ProjectTodoListResultSchema>;
export type ProjectRequirementPageRequest = z.infer<typeof ProjectRequirementPageRequestSchema>;
export type ProjectRequirementPageResult = z.infer<typeof ProjectRequirementPageResultSchema>;
export type ProjectTodoCreateRequest = z.infer<typeof ProjectTodoCreateRequestSchema>;
export type ProjectTodoCreateResult = z.infer<typeof ProjectTodoCreateResultSchema>;
export type ProjectTodoUpdateRequest = z.infer<typeof ProjectTodoUpdateRequestSchema>;
export type ProjectTodoUpdateResult = z.infer<typeof ProjectTodoUpdateResultSchema>;
export type ProjectRequirementClaimRequest = z.infer<typeof ProjectRequirementClaimRequestSchema>;
export type ProjectRequirementClaimResult = z.infer<typeof ProjectRequirementClaimResultSchema>;
export type ProjectTodoDeleteRequest = z.infer<typeof ProjectTodoDeleteRequestSchema>;
export type ProjectTodoDeleteResult = z.infer<typeof ProjectTodoDeleteResultSchema>;
export type TodoAcceptanceItem = z.infer<typeof TodoAcceptanceItemSchema>;
export type TodoCompletionEntryKind = z.infer<typeof TodoCompletionEntryKindSchema>;
export type TodoCompletionRecord = z.infer<typeof TodoCompletionRecordSchema>;
export type TodoDraft = z.infer<typeof TodoDraftSchema>;
export type TodoDraftBatch = z.infer<typeof TodoDraftBatchSchema>;
export type TodoDraftState = z.infer<typeof TodoDraftStateSchema>;
export type TodoDraftBasis = z.infer<typeof TodoDraftBasisSchema>;
export type TodoDraftBatchState = z.infer<typeof TodoDraftBatchStateSchema>;
export type TodoReviewDecision = z.infer<typeof TodoReviewDecisionSchema>;
export type ProjectTodoDetailRequest = z.infer<typeof ProjectTodoDetailRequestSchema>;
export type ProjectTodoDetailResult = z.infer<typeof ProjectTodoDetailResultSchema>;
export type ProjectTodoAcceptanceSetRequest = z.infer<typeof ProjectTodoAcceptanceSetRequestSchema>;
export type ProjectTodoAcceptanceSetResult = z.infer<typeof ProjectTodoAcceptanceSetResultSchema>;
export type ProjectTodoSubmitReviewRequest = z.infer<typeof ProjectTodoSubmitReviewRequestSchema>;
export type ProjectTodoSubmitReviewResult = z.infer<typeof ProjectTodoSubmitReviewResultSchema>;
export type ProjectTodoReviewRequest = z.infer<typeof ProjectTodoReviewRequestSchema>;
export type ProjectTodoReviewResult = z.infer<typeof ProjectTodoReviewResultSchema>;
export type ProjectTodoDraftListRequest = z.infer<typeof ProjectTodoDraftListRequestSchema>;
export type ProjectTodoDraftListResult = z.infer<typeof ProjectTodoDraftListResultSchema>;
export type ProjectTodoDraftCreateRequest = z.infer<typeof ProjectTodoDraftCreateRequestSchema>;
export type ProjectTodoDraftCreateResult = z.infer<typeof ProjectTodoDraftCreateResultSchema>;
export type ProjectTodoDraftDropRequest = z.infer<typeof ProjectTodoDraftDropRequestSchema>;
export type ProjectTodoDraftDropResult = z.infer<typeof ProjectTodoDraftDropResultSchema>;
export type ProjectTodoDraftResolveRequest = z.infer<typeof ProjectTodoDraftResolveRequestSchema>;
export type ProjectTodoDraftResolveResult = z.infer<typeof ProjectTodoDraftResolveResultSchema>;
export type ProjectFileListRequest = z.infer<typeof ProjectFileListRequestSchema>;
export type ProjectFileListResult = z.infer<typeof ProjectFileListResultSchema>;
export type ProjectFileUploadRequest = z.infer<typeof ProjectFileUploadRequestSchema>;
export type ProjectFileUploadResult = z.infer<typeof ProjectFileUploadResultSchema>;
export type ProjectFileUploadCancelRequest = z.infer<typeof ProjectFileUploadCancelRequestSchema>;
export type ProjectFileUploadCancelResult = z.infer<typeof ProjectFileUploadCancelResultSchema>;
export type ProjectFileUploadProgress = z.infer<typeof ProjectFileUploadProgressSchema>;
export type ProjectFileDownloadRequest = z.infer<typeof ProjectFileDownloadRequestSchema>;
export type ProjectFileDownloadResult = z.infer<typeof ProjectFileDownloadResultSchema>;
export type ProjectFilePromoteRequest = z.infer<typeof ProjectFilePromoteRequestSchema>;
export type ProjectFilePromoteResult = z.infer<typeof ProjectFilePromoteResultSchema>;
export type ProjectFileDeleteRequest = z.infer<typeof ProjectFileDeleteRequestSchema>;
export type ProjectFileDeleteResult = z.infer<typeof ProjectFileDeleteResultSchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
