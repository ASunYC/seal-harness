import {
  PROJECT_MAX_REFS,
  PROJECT_REF_KIND_ASSET,
  PROJECT_REF_KIND_MEMBER,
  PROJECT_REF_KIND_TODO,
  buildProjectRef,
} from '@shared/protocol/project-collab.js';
import type { ProjectFile, ProjectMember, Todo } from '@shared/protocol/project-collab.js';

import { splitRefToken } from './project-format';

/**
 * `@` 提及与 `#` 引用的纯逻辑（G-9）。
 *
 * 【红线 2 的落点】正文永远是纯文本，引用另走 `refs` 的**结构化 token**
 * （`member:<subject>` / `asset:<id>` / `todo:<id>`）。插进正文的只是给人看的可读文本，
 * 与 token 是两份东西——正文里的 `@张三` 三个字对服务端毫无意义，判「谁被叫了」
 * 只认 token（服务端 domain.py 的 `extract_mentions`）。
 *
 * ⛔ 不引入 Markdown 渲染器：本期正文照旧按纯文本显示。
 */

/** 触发符：`@` 选成员，`#` 选资产/待办。 */
export type ProjectRefTrigger = '@' | '#';

/** 触发词的最长查询长度——再长就不像在挑人，按「用户只是打了个 @」处理。 */
export const PROJECT_REF_QUERY_MAX_LENGTH = 32;

/** 浮层一次最多列几条候选（长名册也不铺满屏）。 */
export const PROJECT_REF_SUGGESTION_LIMIT = 8;

export interface ProjectRefCandidate {
  /** 进 `refs` 的结构化 token。 */
  readonly token: string;
  /** 类别中文标签（成员 / 资产 / 待办），芯片上的 k 标。 */
  readonly kindLabel: string;
  /** 显示名（成员显示名 / 文件名 / 待办标题）。 */
  readonly name: string;
  /** 插进正文的可读文本（不含尾随空格，由调用方补）。 */
  readonly insertText: string;
}

export const PROJECT_REF_KIND_LABELS: Readonly<Record<string, string>> = {
  [PROJECT_REF_KIND_MEMBER]: '成员',
  [PROJECT_REF_KIND_ASSET]: '资产',
  [PROJECT_REF_KIND_TODO]: '待办',
};

/** 未加载对象不能推断已删除，点击时重新授权查询。 */
export const PROJECT_REF_UNLOADED_LABEL = '查看需求或任务';

/** 候选来源快照（由调用方从 store 取，本模块不碰 store）。 */
export interface ProjectRefSources {
  readonly members: readonly ProjectMember[];
  readonly files: readonly ProjectFile[];
  readonly todos: readonly Todo[];
}

function matches(name: string, query: string): boolean {
  if (query.length === 0) return true;
  return name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/**
 * 触发词定位：从光标往回找最近的 `@` / `#`。
 *
 * 三个条件缺一不可——触发符前是行首或空白（`a@b` 不是提及）、触发符到光标之间
 * 不含空白、查询长度未超上界。任一不满足返回 null（＝浮层不开）。
 */
export function findRefTrigger(
  value: string,
  caret: number,
): { readonly trigger: ProjectRefTrigger; readonly start: number; readonly query: string } | null {
  const upto = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  for (let index = upto.length - 1; index >= 0; index -= 1) {
    const char = upto[index];
    if (char === undefined) return null;
    if (/\s/u.test(char)) return null;
    if (char !== '@' && char !== '#') continue;
    const previous = index > 0 ? upto[index - 1] : undefined;
    if (previous !== undefined && !/\s/u.test(previous)) return null;
    const query = upto.slice(index + 1);
    if (query.length > PROJECT_REF_QUERY_MAX_LENGTH) return null;
    return { trigger: char, start: index, query };
  }
  return null;
}

/** `@` 的候选：在组成员（已移出的不再可提及）。 */
export function memberCandidates(
  members: readonly ProjectMember[],
  query: string,
): readonly ProjectRefCandidate[] {
  const candidates: ProjectRefCandidate[] = [];
  for (const member of members) {
    if (member.state !== 'active') continue;
    const name = member.displayName || member.subject;
    if (!matches(name, query)) continue;
    const token = buildProjectRef(PROJECT_REF_KIND_MEMBER, member.subject);
    // token 组不出来（subject 含正则不认的字符）就不给这一条——发出去必被服务端拒。
    if (token === null) continue;
    candidates.push({
      token,
      kindLabel: PROJECT_REF_KIND_LABELS[PROJECT_REF_KIND_MEMBER] ?? PROJECT_REF_KIND_MEMBER,
      name,
      insertText: `@${name}`,
    });
    if (candidates.length >= PROJECT_REF_SUGGESTION_LIMIT) break;
  }
  return candidates;
}

/** `#` 的候选：项目资产在前、看板待办在后（都按已载列表，不额外发请求）。 */
export function referenceCandidates(
  sources: Pick<ProjectRefSources, 'files' | 'todos'>,
  query: string,
): readonly ProjectRefCandidate[] {
  const candidates: ProjectRefCandidate[] = [];
  const push = (kind: string, id: string, name: string): void => {
    if (candidates.length >= PROJECT_REF_SUGGESTION_LIMIT) return;
    if (!matches(name, query)) return;
    const token = buildProjectRef(kind, id);
    if (token === null) return;
    candidates.push({
      token,
      kindLabel: PROJECT_REF_KIND_LABELS[kind] ?? kind,
      name,
      insertText: `#${name}`,
    });
  };
  for (const file of sources.files) push(PROJECT_REF_KIND_ASSET, file.id, file.filename);
  for (const todo of sources.todos) push(PROJECT_REF_KIND_TODO, todo.id, todo.title);
  return candidates;
}

/** 按触发符挑候选来源——两个入口一处收口，浮层不各自 if。 */
export function refCandidates(
  trigger: ProjectRefTrigger,
  sources: ProjectRefSources,
  query: string,
): readonly ProjectRefCandidate[] {
  return trigger === '@'
    ? memberCandidates(sources.members, query)
    : referenceCandidates(sources, query);
}

/**
 * 落选：把触发词整段（含 `@`/`#`）换成候选的可读文本 + 一个空格。
 * 返回新正文与新光标位（调用方负责把光标写回 DOM）。
 */
export function applyRefSelection(
  value: string,
  start: number,
  caret: number,
  insertText: string,
): { readonly text: string; readonly caret: number } {
  const head = value.slice(0, start);
  const tail = value.slice(caret);
  const inserted = `${insertText} `;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

/** 追加一枚引用（去重 + 封顶）。已满或已在列表里就原样返回——不静默丢别的。 */
export function appendRef(refs: readonly string[], token: string): readonly string[] {
  if (refs.includes(token) || refs.length >= PROJECT_MAX_REFS) return refs;
  return [...refs, token];
}

export function removeRef(refs: readonly string[], token: string): readonly string[] {
  return refs.filter((item) => item !== token);
}

/**
 * 引用芯片的展示文案：能在已载数据里认出 id 就显示人话，认不出就退回原 token
 * 切分（`kind:rest`）——**展示层不替服务端编数据**，认不出就照实显示那串 id。
 */
export function resolveRefLabel(
  token: string,
  sources: ProjectRefSources,
): { readonly kindLabel: string | null; readonly name: string } {
  const { kind, name } = splitRefToken(token);
  if (kind === null) return { kindLabel: null, name };
  const label = PROJECT_REF_KIND_LABELS[kind] ?? kind;
  if (kind === PROJECT_REF_KIND_MEMBER) {
    const member = sources.members.find((item) => item.subject === name);
    return { kindLabel: label, name: member?.displayName || name };
  }
  if (kind === PROJECT_REF_KIND_ASSET) {
    const file = sources.files.find((item) => item.id === name);
    return { kindLabel: label, name: file?.filename ?? name };
  }
  if (kind === PROJECT_REF_KIND_TODO) {
    const todo = sources.todos.find((item) => item.id === name);
    // 分页快照缺少对象不能证明删除；点击时按 UUID 重新授权查询。
    return { kindLabel: label, name: todo?.title ?? PROJECT_REF_UNLOADED_LABEL };
  }
  return { kindLabel: label, name };
}

/** 引用芯片能跳去的三类原对象（测试提单 2552）。 */
export type ProjectRefTargetKind = 'todo' | 'asset' | 'member';

/** 芯片点下去交给项目页的结构化目标：只有类别与 id，⛔ 不带显示名（名字以展示层为准）。 */
export interface ProjectRefTarget {
  readonly kind: ProjectRefTargetKind;
  readonly id: string;
}

/**
 * 待办使用完整 UUID 发起授权查询，不要求出现在当前页；资产和成员沿用已载来源。
 * 这里仅产生导航意图，对象存在性和权限由页面导航入口核验。
 */
export function resolveRefTarget(
  token: string,
  sources: ProjectRefSources,
): ProjectRefTarget | null {
  const { kind, name: id } = splitRefToken(token);
  if (kind === null) return null;
  if (kind === PROJECT_REF_KIND_MEMBER) {
    const onRoster = sources.members.some(
      (member) => member.subject === id && member.state !== 'removed',
    );
    return onRoster ? { kind: 'member', id } : null;
  }
  if (kind === PROJECT_REF_KIND_ASSET) {
    return sources.files.some((file) => file.id === id) ? { kind: 'asset', id } : null;
  }
  if (kind === PROJECT_REF_KIND_TODO) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
      ? { kind: 'todo', id }
      : null;
  }
  return null;
}
