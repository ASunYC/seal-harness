import { isTodoAssignedToAssistant } from '@shared/protocol/project-collab.js';
import type {
  ProjectFileKind,
  ProjectMemberState,
  ProjectRole,
  Todo,
  TodoPriority,
  TodoSource,
  TodoStatus,
  TodoVisibility,
} from '@shared/protocol/project-collab.js';

/**
 * 角色中文名（原型口径：owner=拥有者 / manager=管理者 / editor=成员 / viewer=观察者）。
 *
 * ⚠️ `Record<ProjectRole, …>` 是**唯一**会在加角色时编译期炸掉的一处（实测：加
 * `manager` 只有这里报 TS2741，其余靠字符串比较的判定一处也没红）。⛔ 别把它松成
 * `Partial` 或 `string`——那样最后一个能拦住漏改的地方就没了。
 */
export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  owner: '拥有者',
  manager: '管理者',
  editor: '成员',
  viewer: '观察者',
};

export const PROJECT_MEMBER_STATE_LABELS: Readonly<Record<ProjectMemberState, string>> = {
  invited: '受邀',
  active: '在组',
  removed: '已移出',
};

export const TODO_STATUS_LABELS: Readonly<Record<TodoStatus, string>> = {
  notStarted: '未开始',
  inProgress: '进行中',
  inReview: '待验收',
  done: '已完成',
  cancelled: '已取消',
};

/**
 * 看板列的固定次序（与线协议闭集一致）。
 *
 * ⚠️ 这是**呈现次序**，不是「这条单能挑哪几档」。后者由 `todoStatusOptions` 收窄
 * （待验收永远不是普通改单的目标档；有验收清单的工作单没有「已完成」）——
 * ⛔ 别把这张表直接铺进状态下拉。
 */
export const TODO_STATUS_ORDER: readonly TodoStatus[] = [
  'notStarted',
  'inProgress',
  'inReview',
  'done',
  'cancelled',
];

export const TODO_PRIORITY_LABELS: Readonly<Record<TodoPriority, string>> = {
  high: '高',
  medium: '中',
  low: '低',
};

/**
 * 会话里那个执行者的称谓——**全产品只有这一个词**。
 *
 * ⚠️【白标】UI 里不出现任何内核概念，更不出现内核名。它就是这个产品里那个会干活的
 * 助手，用户不需要知道别的。
 *
 * ⚠️ 声明位置在 {@link TODO_SOURCE_LABELS} **之前**是必需的，不是排版偏好：来源表
 * 直接引用它以保证同词，而 `const` 无提升，写在后面会在模块求值时 TDZ 抛错。
 * ⛔ 别把它挪回下面「处理人」那一段去。
 */
export const TODO_ASSISTANT_ASSIGNEE_LABEL = '项目助理';

/**
 * 来源中文名。
 *
 * ⚠️【白标】`assistant` 一律叫「项目助理」——用户侧不存在「内核」这个概念，
 * 更不会出现任何第三方产品名。三档的语义：人在界面上建的 / 项目助理在会话里建的 /
 * 外部数据源同步来的。
 *
 * ⚠️ 这里必须与 {@link TODO_ASSISTANT_ASSIGNEE_LABEL} **同词**。来源（谁建的）与
 * 处理人（派给谁）是两个字段，但背后是**同一个角色**；一度这里叫「智能助手」、那里叫
 * 「项目助理」，于是同一张表相邻两列出现两个名字，读的人以为在说两件矛盾的事
 * （实测报障：「标题下写着智能助手，处理人却写未分配」——两个值其实都对）。
 * ⛔ 更不能叫回「智能助手」：那已经是**一级模块名**（专家目录里那些可挂载的助手），
 * 同屏三义。
 *
 * ⚠️ 它是**调用方声明值**（人与助理用同一个账号走同一个 API，服务端凭身份分不出
 * 来），所以只作展示，⛔ 不得参与任何权限或可见性判定。
 */
export const TODO_SOURCE_LABELS: Readonly<Record<TodoSource, string>> = {
  manual: '手动创建',
  assistant: TODO_ASSISTANT_ASSIGNEE_LABEL,
  external: '外部同步',
};

/** 来源在筛选/分组候选里的固定次序（与线协议闭集一致）。 */
export const TODO_SOURCE_ORDER: readonly TodoSource[] = ['manual', 'assistant', 'external'];

export const TODO_VISIBILITY_LABELS: Readonly<Record<TodoVisibility, string>> = {
  shared: '协同',
  personal: '个人',
};

export const TODO_VISIBILITY_ORDER: readonly TodoVisibility[] = ['shared', 'personal'];

/**
 * 个人条目徽标上的字。
 *
 * 不用字段名「个人」而用一句话：「个人」这两个字说不出**后果**，用户看不出这条
 * 别人到底能不能看见。徽标要一眼答完「谁看得见」，所以直接写结论。
 */
export const TODO_PERSONAL_BADGE_TEXT = '仅自己可见';

/** 新建/编辑弹层里对个人可见的完整交代（含「拥有者也看不见」这条最容易被误解的）。 */
export const TODO_PERSONAL_HINT = '只有你看得见这一条，项目拥有者也看不到。';

/** 可见性建单后不可改（契约刻意不放开翻转，见 ProjectTodoUpdateRequestSchema）。 */
export const TODO_VISIBILITY_LOCKED_HINT = '可见性在建单时确定，之后不再更改';

/** 任务必须挂在一个父项下——空项目先建立需求根项。 */
export const TODO_NO_REQUIREMENT_HINT = '还没有父项可挂靠，先建立一条需求。';

/** 待验收中的单不许改判据（服务端同判）：验收方正对着这份清单逐条核对。 */
export const TODO_ACCEPTANCE_FROZEN_HINT = '这张单正在待验收，验收判据暂时改不了。';

/**
 * 改判据的代价，说在动手之前而不是之后。
 *
 * 验收清单是整表替换：改它等于重定义「怎么算做完」，已勾的条目随之作废
 * （勾的是旧判据）。不说清楚，用户会以为只是改了个错别字。
 */
export const TODO_ACCEPTANCE_RESET_HINT = '改动验收清单会作废已勾选的条目——它们勾的是旧判据。';

/**
 * 入口收窄时给出的说明（G-11）。看板卡与表格行是同一句话——两个视图讲的是同一条
 * 规则，措辞分叉只会让人以为是两回事。
 */
export const TODO_LOCKED_HINT = '他人名下的待办由拥有者调整';

/**
 * 处理人称谓（0010）。助理那一档用 {@link TODO_ASSISTANT_ASSIGNEE_LABEL}，
 * 它连同白标要求一起声明在本文件靠前处（来源表要引用它，`const` 无提升）。
 */
export const TODO_UNASSIGNED_LABEL = '未分配';

/**
 * 派给助理时的一句话。
 *
 * ⚠️ 说的是**它是助手不是外包**（设计方案 §8「期望管理」）：派了单不等于全自动，
 * 得有人在会话里让它开工；执行过程完全可见、随时可打断。⛔ 不许写成
 * 「保存后自动开工」——那件事本轮没做，摆出来就是骗人。
 */
export const TODO_ASSISTANT_DISPATCH_HINT =
  '派给助理后，去项目会话里让它开工；执行过程可见、可随时插话纠偏。';

/** 待验收档下处理人被冻住的原因，写成一句用户读得懂的话。 */
export const TODO_ASSIGNEE_FROZEN_HINT = '待验收的工作单不能改处理人，请先验收或打回。';

/**
 * 编辑框里成员要把未认领的需求接到自己名下时的去处（判据见 `todoSelfAssignNeedsClaimEntry`）。
 * 入口会收起编辑框去开认领对话框：框里有未保存改动时入口置灰并换成 `…_BLOCKED_HINT` 那一句，
 * ⛔ 不放行后丢改动（主会话 2026-09-14 定）。
 */
export const TODO_ASSIGNEE_CLAIM_HINT = '要接到自己名下请认领：';
export const TODO_ASSIGNEE_CLAIM_BLOCKED_HINT = '请先保存或放弃当前修改，再认领。';
export const TODO_ASSIGNEE_CLAIM_ACTION_LABEL = '认领这条需求';

/**
 * 「未分配」是**合法状态**，不是没填完。
 *
 * 建需求的时候往往还不知道派给谁——不说这一句，处理人那一格看起来就像一个必填项，
 * 用户会随手先挂个人，而那个人并不知道自己被挂上了。⛔ 别把它写成「稍后可以再改」
 * 一类的安抚话：它答的是「现在这样交出去行不行」，答案是行。
 */
export const TODO_UNASSIGNED_OK_HINT = '未分配也可以先建——需求刚成形时还不知道派给谁很正常。';

/**
 * 「查看执行」入口的字。
 *
 * 说的是「回到执行现场」而不是「开始执行」——执行在主进程里跑，关掉窗口不中断，
 * 这个按钮只是把那个会话再打开。⛔ 别写成「运行」「启动」一类会让人以为点了才开始的词。
 */
export const TODO_OPEN_EXECUTION_LABEL = '查看执行';

/**
 * 行操作「删除」的字（manager+ 才出现；级联整棵子树，确认框说清条数）。
 * ⛔ 别写成「清除」「移除」——删除是软删但对用户即消失（再访问 404），措辞就用「删除」。
 */
export const TODO_DELETE_ACTION_LABEL = '删除';

/** 批量条上的「删除所选」。 */
export const TODO_DELETE_BATCH_LABEL = '删除所选';

/**
 * 「这张单归谁」的一句话——**档位与人一起看**。
 *
 * ⛔ 别在调用点写 `todo.assigneeDisplayName || '未分配'`：助理档下显示名恒为空，
 * 那样会把「派给了项目助理」说成「未分配」——字面正确、意思相反。
 * 判据只有这一份，看板卡 / 表格行 / 筛选分组共用。
 */
export function todoAssigneeLabel(
  todo: Pick<Todo, 'assigneeKind' | 'assigneeSubject' | 'assigneeDisplayName'>,
): string {
  if (isTodoAssignedToAssistant(todo)) return TODO_ASSISTANT_ASSIGNEE_LABEL;
  if (todo.assigneeSubject === null) return TODO_UNASSIGNED_LABEL;
  return todo.assigneeDisplayName || todo.assigneeSubject;
}

/**
 * 需求行进度徽标的悬浮说明。
 *
 * 说的是**分母是什么**：已取消的任务不在里面，所以「2/3」不等于「还有一条没做」，
 * 而是「还有一条没做完」。不写清楚，用户会拿它去对总任务数，然后觉得数错了。
 */
export const todoProgressHint = '这条需求下已完成的任务数 / 未取消的任务数';

/**
 * 关联面计数（G-10）：材料引用 + 关联会话各算一条。看板卡与表格行共用，
 * 免得两个视图对同一张单报出不同的数。
 */
export function todoRelationCount(todo: Pick<Todo, 'refs' | 'sessionRef'>): number {
  return todo.refs.length + (todo.sessionRef ? 1 : 0);
}

export const PROJECT_FILE_KIND_LABELS: Readonly<Record<ProjectFileKind, string>> = {
  asset: '资产',
  temp: '临时件',
};

/** 文件类型徽标的色调分桶（资产页原型 tbadge：PDF/表格/幻灯/文档各一族，其余归中性）。 */
export type FileBadgeTone = 'pdf' | 'sheet' | 'slides' | 'doc' | 'generic';

const FILE_BADGE_TONES: Readonly<Record<string, FileBadgeTone>> = {
  pdf: 'pdf',
  xls: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  doc: 'doc',
  docx: 'doc',
  txt: 'doc',
  md: 'doc',
};

/**
 * 文件名 → 类型徽标（原型 asset-row 的 tbadge）：从扩展名派生 ≤3 字标签与色调分桶。
 * 纯展示、无副作用——⛔ 不读盘、不猜 mime，只认文件名末段这一个真实信息。
 * 无扩展名（隐藏文件或纯名）落中性桶，标签用「·」占位而不是编一个假类型。
 */
export function fileTypeBadge(filename: string): { label: string; tone: FileBadgeTone } {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
  if (!ext) return { label: '·', tone: 'generic' };
  return { label: ext.toUpperCase().slice(0, 3), tone: FILE_BADGE_TONES[ext] ?? 'generic' };
}

/** 讨论消息可撤回窗口（服务端强判 ≤300s；此处只管按钮显隐）。 */
export const CHAT_REVOKE_WINDOW_MS = 5 * 60 * 1000;

export function isWithinRevokeWindow(createdAt: string, nowMs: number): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created <= CHAT_REVOKE_WINDOW_MS;
}

/**
 * 时间展示：服务端 ISO 串 → 本地「MM-DD HH:mm」。解析失败原样返回——
 * 展示层不替服务端修数据。
 */
export function formatProjectTime(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 动态 / 讨论的时间戳展示：**当天只出时分**（`14:32`），跨天补日期（`08-30 14:32`），
 * 跨年再补年份。同一天几十条记录逐行重复年月日是噪音——原型 feed/chat 当天只写时分。
 * 解析失败原样返回、空值给「—」，与 `formatProjectTime` / `formatProjectDate` 同一纪律。
 */
export function formatProjectTimestamp(value: string | null, nowMs: number): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const now = new Date(nowMs);
  const pad = (part: number): string => String(part).padStart(2, '0');
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return hm;
  const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}-${md}`;
}

/**
 * 相对时间（表格「更新」列）：距 `nowMs` 多久以前。
 *
 * 表格是扫读界面：「更新」答的是「多新」，一个相对量比一串精确到分的绝对时间戳
 * 扫得快得多，也与「截止」那种「哪一天」的绝对日期在口径上分了工——同一行里两种
 * 时间不再要人切换心智。超过 30 天退回绝对日期（那时「37 天前」已不如一个日期好记）。
 * 解析失败原样返回、空值给「—」，与 `formatProjectTime` / `formatProjectDate` 同一纪律。
 */
export function formatRelativeTime(value: string | null, nowMs: number): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const diff = nowMs - parsed;
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  // 未来（时钟偏差）与一分钟内都收敛成「刚刚」，不给出负数或「0 分钟前」。
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const date = new Date(parsed);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日期分割线标签（讨论页原型 chat__day）：今天 / 昨天 / M月D日（跨年补年份）。
 * 解析失败原样返回，与 formatProjectTime 同一纪律。
 */
export function formatProjectDayLabel(value: string, nowMs: number): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const now = new Date(nowMs);
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '昨天';
  const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return date.getFullYear() === now.getFullYear()
    ? monthDay
    : `${date.getFullYear()} 年 ${monthDay}`;
}

/** 引用 token 的展示切分（refcard 形态）：`kind:rest` → k 标 + 名。纯展示，不改数据。 */
export function splitRefToken(token: string): { kind: string | null; name: string } {
  const idx = token.indexOf(':');
  if (idx <= 0 || idx === token.length - 1) return { kind: null, name: token };
  return { kind: token.slice(0, idx), name: token.slice(idx + 1) };
}

/**
 * 短日期（看板卡截止一类窄位场景）：本地「MM-DD」。解析失败原样返回。
 */
export function formatProjectDate(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 截止临期判据（纯展示）：未闭环且距截止 ≤48h（含已逾期）→ 警示色。 */
export const TODO_DUE_SOON_MS = 48 * 60 * 60 * 1000;

export function isTodoDueSoon(dueAt: string | null, status: TodoStatus, nowMs: number): boolean {
  if (!dueAt || status === 'done' || status === 'cancelled') return false;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return false;
  return due - nowMs <= TODO_DUE_SOON_MS;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rendered = unitIndex === 0 ? String(value) : value.toFixed(1);
  return `${rendered} ${BYTE_UNITS[unitIndex]}`;
}

/** 头像字：显示名首字符；无名（system/assistant 条目可空）用「·」。 */
export function avatarText(displayName: string | null): string {
  const first = displayName?.trim().charAt(0);
  return first && first.length > 0 ? first : '·';
}

/** 头像色调分桶（1..4，映射到 token 组合），同名恒同色。 */
export function avatarTone(displayName: string | null): number {
  const name = displayName ?? '';
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 997;
  return (hash % 4) + 1;
}
