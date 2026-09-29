import {
  buildProjectRef,
  PROJECT_MAX_REFS,
  PROJECT_REF_KIND_ASSET,
  PROJECT_REF_KIND_TODO,
  type ProjectFile,
  type ProjectMember,
  type Todo,
} from '@shared/protocol/project-collab.js';
import type { ProjectIterationRequirement } from '@shared/protocol/project-planning.js';
import {
  openablePlanningEvidenceLink,
  PLANNING_EVIDENCE_LINK_PREFIX,
  PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH,
  type ProjectPlanningLifecycleAction,
} from '@shared/protocol/project-planning-lifecycle.js';

import { PROJECT_REF_KIND_LABELS, resolveRefLabel } from './project-refs';

/**
 * 迭代计划「记录达成 / 重新打开」弹层与「阶段记录」的纯呈现逻辑（MIL-07）。
 *
 * ⭐ 文案逐字取自项目组原型 `index.html`：弹层 `milestoneTransition27`（:2657-2660）、行内勾选钮
 *    `milestoneRow28`（:2680）、详情 `stageDetail28`（:2694）。⛔ 改字之前先对原型。
 * ⚠️ 本模块不碰 store、不发请求：候选与标签由调用方把已载数据喂进来。
 */

/** 弹层标题 / 输入标签 / 确认按钮 / 成功回执，按动作取（原型 :2658 / :2660）。 */
export const PLANNING_LIFECYCLE_COPY: Readonly<
  Record<
    ProjectPlanningLifecycleAction,
    {
      readonly title: string;
      readonly reasonLabel: string;
      readonly submit: string;
      /** 行内勾选钮 aria-label 的动作词与详情工具条按钮（原型 :2680 / :2694）。 */
      readonly entry: string;
      readonly recordAction: string;
    }
  >
> = {
  complete: {
    title: '记录迭代计划达成',
    reasonLabel: '验收结果 / 交付依据',
    submit: '确认达成',
    entry: '记录达成',
    recordAction: '确认达成',
  },
  reopen: {
    title: '重新打开迭代计划',
    reasonLabel: '重新打开原因',
    submit: '确认重新打开',
    entry: '重新打开',
    recordAction: '重新打开',
  },
};

/** 原型 :2658 的说明句：这个动作只动阶段记录，不联动需求、子任务与测试结果。 */
export const PLANNING_LIFECYCLE_SCOPE_NOTE = '该操作只更新阶段记录，不改变需求、子任务或测试结果。';

/** 原型 :2658 的核对勾选。 */
export const PLANNING_LIFECYCLE_CONFIRM_LABEL = '已核对全部完成标准';

/** 证据引用一格的标签与说明（原型定稿层 `evidenceInnerG1`，2026-09-13）。 */
export const PLANNING_EVIDENCE_LABEL = '证据引用';
export const PLANNING_EVIDENCE_HINT = `至少引用一条；可引用需求、任务、资产或外部链接，最多 ${PROJECT_MAX_REFS} 条。`;

/** 「外部链接」输入行与就地错误提示（原型 `evidenceInnerG1` / `addEvidenceLinkG1`，逐字）。 */
export const PLANNING_EVIDENCE_LINK_COPY = {
  label: '外部链接',
  placeholder: '粘贴以 http:// 或 https:// 开头的链接',
  add: '添加',
  invalid: '请输入以 http:// 或 https:// 开头的链接',
  credentials: '链接里不能包含账号或密码',
  tooLong: `链接过长，最多 ${PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH} 个字符`,
  full: `最多引用 ${PROJECT_MAX_REFS} 条证据。`,
} as const;

/** 外部链接证据芯片的类别标签（原型 `evidenceTextG1`：「链接 · 域名/路径」）。 */
export const PLANNING_EVIDENCE_LINK_KIND_LABEL = '链接';

/** 读回的链接过不了渲染时的校验：不给打开入口，只显示这一句（原型 `evidenceTextG1`）。 */
export const PLANNING_EVIDENCE_UNAVAILABLE_TEXT = '引用已不可见';

/** 链接芯片上「域名/路径」的显示上限，含省略号（原型 `LINK_LABEL_MAX_G1`）。 */
export const PLANNING_EVIDENCE_LINK_LABEL_MAX = 40;

/** 解码后混进控制符 / 格式符（双向文本控制、零宽字符）的路径不解码显示：芯片文字不许与真实地址看起来不一样。 */
const CONTROL_OR_FORMAT_CHAR = /[\p{Cc}\p{Cf}]/u;

/** `http://` / `https://` 开头且解析得了的地址；其余一律 `null`（与原型 `addEvidenceLinkG1` 同口径）。 */
function parseHttpLink(raw: string): URL | null {
  if (!/^https?:\/\//iu.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** 芯片上的「域名/路径」：根路径不显示，路径按 `decodeURI` 还原中文，超过上限截断并补省略号。 */
function planningEvidenceLinkLabel(parsed: URL): string {
  const encoded = parsed.pathname === '/' ? '' : parsed.pathname;
  let path = encoded;
  try {
    path = decodeURI(encoded);
  } catch {
    // 解不开的百分号序列原样显示。
  }
  if (CONTROL_OR_FORMAT_CHAR.test(path)) path = encoded;
  const text = `${parsed.host}${path}`;
  return text.length > PLANNING_EVIDENCE_LINK_LABEL_MAX
    ? `${text.slice(0, PLANNING_EVIDENCE_LINK_LABEL_MAX - 1)}…`
    : text;
}

/**
 * 一条 `link:` 证据在**渲染时**的第三次校验（ADR-0036）：与主进程打开前同一份
 * `openablePlanningEvidenceLink`（共享文法 + 浏览器的解析器）。过得了 ⇒ 可交主进程打开的规范地址与
 * 芯片文案；过不了 ⇒ `null`，调用方只显示「引用已不可见」、⛔ 不给打开入口。
 */
export function planningEvidenceLink(
  token: string,
): { readonly href: string; readonly label: string } | null {
  if (!token.startsWith(PLANNING_EVIDENCE_LINK_PREFIX)) return null;
  const parsed = openablePlanningEvidenceLink(
    token.slice(PLANNING_EVIDENCE_LINK_PREFIX.length),
    (raw) => new URL(raw),
  );
  return parsed === null ? null : { href: parsed.href, label: planningEvidenceLinkLabel(parsed) };
}

export type PlanningEvidenceLinkAddition =
  | { readonly ok: true; readonly refs: readonly string[] }
  | { readonly ok: false; readonly text: string; readonly error: string };

/**
 * 「外部链接」输入框点「添加」/ 回车（原型 `addEvidenceLinkG1`，次序逐条照搬）：
 * 不是 http(s) 地址 → 带账号密码 → 整条 `link:<规范地址>` 超 256 → 已有同一链接（不出第二枚芯片，
 * 照常清空输入）→ 已满 16 条 → 追加。
 *
 * ⭐ 存的是**规范化**后的地址（`URL.href`：协议与主机转小写、补根路径、中文按百分号编码），所以
 *    主机大小写不同的同一链接判为重复。
 * ⚠️ 拒绝时回的 `text` 是去掉首尾空白的原文——输入框留着让人改，⛔ 不清。
 */
export function planningEvidenceLinkAddition(
  input: string,
  refs: readonly string[],
): PlanningEvidenceLinkAddition {
  const raw = input.trim();
  const refuse = (error: string): PlanningEvidenceLinkAddition => ({ ok: false, text: raw, error });
  const parsed = parseHttpLink(raw);
  if (parsed === null) return refuse(PLANNING_EVIDENCE_LINK_COPY.invalid);
  if (parsed.username !== '' || parsed.password !== '') {
    return refuse(PLANNING_EVIDENCE_LINK_COPY.credentials);
  }
  const token = `${PLANNING_EVIDENCE_LINK_PREFIX}${parsed.href}`;
  if (token.length > PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH) {
    return refuse(PLANNING_EVIDENCE_LINK_COPY.tooLong);
  }
  if (refs.includes(token)) return { ok: true, refs };
  if (refs.length >= PROJECT_MAX_REFS) return refuse(PLANNING_EVIDENCE_LINK_COPY.full);
  return { ok: true, refs: [...refs, token] };
}

/** 行内勾选钮的 aria-label：动作词 + 名称（原型 :2680 逐字拼接，无分隔）。 */
export function planningLifecycleEntryLabel(
  action: ProjectPlanningLifecycleAction,
  name: string,
): string {
  return `${PLANNING_LIFECYCLE_COPY[action].entry}${name}`;
}

export interface PlanningEvidenceOption {
  readonly token: string;
  readonly kindLabel: string;
  readonly name: string;
}

/**
 * 交付依据的候选：本轮关联需求在前（最常见的依据），其后是项目资产与已载待办。
 *
 * ⚠️ **不设条数上限**：`referenceCandidates` 是给输入框 `#` 浮层用的（封顶 8 条），而这里是
 *    一个自己会滚的选择列表——封顶就会让第九份以后的材料永远选不到。
 * ⛔ 已挂上的不再出现；同一 token 只出一次（关联需求与待办列表里的同一条需求去重）。
 */
export function planningEvidenceOptions(sources: {
  readonly linkedRequirements: readonly ProjectIterationRequirement[];
  readonly files: readonly ProjectFile[];
  readonly todos: readonly Todo[];
  readonly attached: readonly string[];
}): readonly PlanningEvidenceOption[] {
  const seen = new Set(sources.attached);
  const options: PlanningEvidenceOption[] = [];
  const push = (kind: string, id: string, name: string): void => {
    const token = buildProjectRef(kind, id);
    if (token === null || seen.has(token)) return;
    seen.add(token);
    options.push({ token, kindLabel: PROJECT_REF_KIND_LABELS[kind] ?? kind, name });
  };
  for (const item of sources.linkedRequirements) {
    push(PROJECT_REF_KIND_TODO, item.requirementId, item.title);
  }
  for (const file of sources.files) push(PROJECT_REF_KIND_ASSET, file.id, file.filename);
  for (const todo of sources.todos) push(PROJECT_REF_KIND_TODO, todo.id, todo.title);
  return options;
}

/**
 * 一枚证据引用的芯片文案。
 *
 * - **外部链接**（`link:` 且过得了渲染时校验，ADR-0036）⇒ 类别「链接」、正文是「域名/路径」，
 *   `href` 给出可交主进程打开的规范地址（悬停看完整地址也用它）；
 * - **过不了校验的 `link:`** ⇒「引用已不可见」纯文本（`kindLabel: null`、`href: null`），⛔ 不可点，
 *   也不回显原文——读回照收（读侧 schema 按服务端写入契约放宽），但认不出的一律不给打开入口；
 * - 本轮关联需求先按摘要里的标题认（那份摘要一定在手上）；认不出再交给通用的 `resolveRefLabel`
 *   （成员 / 资产 / 已载待办）。
 *
 * ⚠️ 顺序不是随意的：`resolveRefLabel` 对**没载入**的待办会显示「已删除」——所以关联需求不能
 *    指望待办列表已经取全，否则一条活着的需求会被说成已删除。
 */
export function planningEvidenceLabel(
  token: string,
  sources: {
    readonly linkedRequirements: readonly ProjectIterationRequirement[];
    readonly members: readonly ProjectMember[];
    readonly files: readonly ProjectFile[];
    readonly todos: readonly Todo[];
  },
): { readonly kindLabel: string | null; readonly name: string; readonly href: string | null } {
  if (token.startsWith(PLANNING_EVIDENCE_LINK_PREFIX)) {
    const link = planningEvidenceLink(token);
    return link === null
      ? { kindLabel: null, name: PLANNING_EVIDENCE_UNAVAILABLE_TEXT, href: null }
      : { kindLabel: PLANNING_EVIDENCE_LINK_KIND_LABEL, name: link.label, href: link.href };
  }
  const linked = sources.linkedRequirements.find(
    (item) => buildProjectRef(PROJECT_REF_KIND_TODO, item.requirementId) === token,
  );
  if (linked !== undefined) {
    return {
      kindLabel: PROJECT_REF_KIND_LABELS[PROJECT_REF_KIND_TODO] ?? null,
      name: linked.title,
      href: null,
    };
  }
  return { ...resolveRefLabel(token, sources), href: null };
}

/** 阶段记录一行的动作词：到「已达成」＝确认达成，回到「进行中」＝重新打开（原型 :2660）。 */
export function planningStageRecordAction(record: { readonly toStatus: string }): string {
  return record.toStatus === 'completed'
    ? PLANNING_LIFECYCLE_COPY.complete.recordAction
    : PLANNING_LIFECYCLE_COPY.reopen.recordAction;
}

/**
 * 阶段记录的时刻：本地时区 `YYYY-MM-DD HH:mm`；解析不了原样返回（展示层不替服务端修数据）。
 */
export function formatPlanningTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 「验收」那一行（原型 `milestoneChildren28`：已达成时显示「验收：记录 · 时刻」）：取**最近一次**
 * 确认达成的记录。只在记录取全（`items.length === total`）且当前确实已达成时才给——
 * 翻页没取全时最后一条未必是最近的，宁可不显示也不显示错。
 */
export function latestAcceptanceRecord<T extends { readonly toStatus: string }>(
  records: { readonly items: readonly T[]; readonly total: number },
  status: string,
): T | null {
  if (status !== 'completed' || records.items.length !== records.total) return null;
  const last = records.items[records.items.length - 1];
  return last !== undefined && last.toStatus === 'completed' ? last : null;
}
