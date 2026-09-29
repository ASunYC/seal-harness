import { describe, expect, it } from 'vitest';

import * as dictionaries from '../../../../stratex/shared/protocol/project-collab-dictionaries.js';
import {
  PROJECT_DICTIONARY_MAX_NAME_LENGTH,
  ProjectDictionaryBindingSchema,
  ProjectDictionaryEntryRefSchema,
  ProjectDictionaryEntrySchema,
  ProjectIterationRefSchema,
  canProjectDictionaryEntryAcceptNewBinding,
  isProjectDictionaryEntryArchived,
  projectDictionaryBindingState,
} from '../../../../stratex/shared/protocol/project-collab-dictionaries.js';
import { ProjectIterationSchema } from '../../../../stratex/shared/protocol/project-planning.js';

const MODULE_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const ITERATION_ID = '22222222-2222-4222-8222-222222222222';

const entry = {
  id: MODULE_ID,
  name: '成员与权限',
  archivedAt: null,
  version: 1,
  creatorSubject: 'u-alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('project dictionary contract', () => {
  it('parses a full dictionary entry and its reference projection', () => {
    expect(ProjectDictionaryEntrySchema.parse(entry).id).toBe(MODULE_ID);
    expect(
      ProjectDictionaryEntryRefSchema.parse({
        id: MODULE_ID,
        name: '成员与权限',
        archivedAt: null,
      }),
    ).toEqual({ id: MODULE_ID, name: '成员与权限', archivedAt: null });
  });

  it('rejects unknown fields at both boundaries', () => {
    // strictObject：服务端多回一个字段时要红，而不是静默丢掉。
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, projectId: MODULE_ID })).toThrow();
    expect(() =>
      ProjectDictionaryEntryRefSchema.parse({
        id: MODULE_ID,
        name: '成员与权限',
        archivedAt: null,
        version: 1,
      }),
    ).toThrow();
  });

  // ── 判据 1：稳定 UUID，名称/日期都不是键 ───────────────────────────────
  it('keys a dictionary entry on a uuid, never on its name or a date', () => {
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, id: '成员与权限' })).toThrow();
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, id: '2026-09-01' })).toThrow();
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, id: 'module-1' })).toThrow();
    expect(() => ProjectDictionaryBindingSchema.parse('成员与权限')).toThrow();
    expect(() => ProjectDictionaryBindingSchema.parse('2026Q3')).toThrow();
  });

  it('lets two dictionary entries share one name because the name can be edited', () => {
    const first = ProjectDictionaryEntrySchema.parse(entry);
    const renamed = ProjectDictionaryEntrySchema.parse({ ...entry, name: '成员与权限（鉴权）' });
    const twin = ProjectDictionaryEntrySchema.parse({ ...entry, id: CATEGORY_ID });
    expect(renamed.id).toBe(first.id);
    expect(twin.name).toBe(first.name);
    expect(twin.id).not.toBe(first.id);
  });

  it('bounds the entry name at the same number the database check uses', () => {
    expect(PROJECT_DICTIONARY_MAX_NAME_LENGTH).toBe(200);
    expect(() =>
      ProjectDictionaryEntrySchema.parse({
        ...entry,
        name: 'x'.repeat(PROJECT_DICTIONARY_MAX_NAME_LENGTH + 1),
      }),
    ).toThrow();
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, name: '' })).toThrow();
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, name: 'a\0b' })).toThrow();
  });

  it('never puts a client-side ceiling on the server-side version counter', () => {
    // ⛔ 越界的代价是「整份字典取不回来」（mapArray 一条坏全批坏），不是少一行。
    expect(
      ProjectDictionaryEntrySchema.parse({ ...entry, version: 9_007_199_254_740_991 }).version,
    ).toBe(9_007_199_254_740_991);
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, version: 0 })).toThrow();
  });

  // ── 判据 1 后半：迭代只引用，不建第二套定义 ─────────────────────────────
  it('derives the iteration reference from the planning schema instead of re-declaring it', () => {
    // ⭐ 同一批 Zod 实例 ⇒ 结构上不可能长出第二套迭代字段定义、也不可能漂移。
    expect(ProjectIterationRefSchema.shape.id).toBe(ProjectIterationSchema.shape.id);
    expect(ProjectIterationRefSchema.shape.name).toBe(ProjectIterationSchema.shape.name);
    expect(ProjectIterationRefSchema.shape.dueAt).toBe(ProjectIterationSchema.shape.dueAt);
    expect(ProjectIterationRefSchema.shape.archivedAt).toBe(
      ProjectIterationSchema.shape.archivedAt,
    );
    // 引用面是全量字段的真子集，且不含任何写入侧字段。
    const referenceKeys = Object.keys(ProjectIterationRefSchema.shape);
    const fullKeys = Object.keys(ProjectIterationSchema.shape);
    expect(referenceKeys).toEqual(['id', 'name', 'dueAt', 'archivedAt']);
    expect(referenceKeys.every((key) => fullKeys.includes(key))).toBe(true);
    expect(referenceKeys.length).toBeLessThan(fullKeys.length);
  });

  it('parses a read-only iteration reference and refuses extra fields', () => {
    const reference = {
      id: ITERATION_ID,
      name: '第一轮：成员列表与角色改派',
      dueAt: '2026-09-20T00:00:00Z',
      archivedAt: null,
    };
    expect(ProjectIterationRefSchema.parse(reference).id).toBe(ITERATION_ID);
    // ⚠️ 旧稿 api-contracts.md §2 把引用写成带 start_at；V2 之后 start_at 属业务目标，
    //    单轮迭代表上没有这一列。照旧稿写会得到一个服务端永远不回的字段。
    expect(() => ProjectIterationRefSchema.parse({ ...reference, startAt: null })).toThrow();
    expect(() => ProjectIterationRefSchema.parse({ ...reference, milestoneId: null })).toThrow();
  });

  // ── 判据 2 前半：归档保留历史引用，新增绑定拒绝 ─────────────────────────
  it('still parses a reference to an archived entry so history stays readable', () => {
    const archived = {
      id: MODULE_ID,
      name: '旧的登录模块',
      archivedAt: '2026-09-10T00:00:00Z',
    };
    expect(ProjectDictionaryEntryRefSchema.parse(archived).archivedAt).toBe('2026-09-10T00:00:00Z');
    expect(isProjectDictionaryEntryArchived(archived)).toBe(true);
    // ⭐ 可读 ≠ 可绑：同一条引用读得回来，但不接受新绑定。
    expect(canProjectDictionaryEntryAcceptNewBinding(archived)).toBe(false);
  });

  it('lets an open entry accept a new binding', () => {
    expect(isProjectDictionaryEntryArchived(entry)).toBe(false);
    expect(canProjectDictionaryEntryAcceptNewBinding(entry)).toBe(true);
  });

  it('has no soft-delete field: archiving is the only lifecycle flag', () => {
    // 服务端那两张表刻意没有 deleted_at；契约层同样不表达，否则会长出第二个「没了」。
    expect(Object.keys(ProjectDictionaryEntrySchema.shape)).toEqual([
      'id',
      'name',
      'archivedAt',
      'version',
      'creatorSubject',
      'createdAt',
      'updatedAt',
    ]);
    expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, deletedAt: null })).toThrow();
  });

  // ── 判据 2：空值＝未分类，且与字段缺失可区分 ───────────────────────────
  it('separates an absent field from an explicitly uncategorized one', () => {
    expect(projectDictionaryBindingState(undefined)).toBe('absent');
    expect(projectDictionaryBindingState(null)).toBe('uncategorized');
    expect(projectDictionaryBindingState(MODULE_ID)).toBe('bound');
    // ⛔ 这三个在 `!value` 下会塌成同一件事——这正是不许在调用点自己判的理由。
    expect(
      new Set([
        projectDictionaryBindingState(undefined),
        projectDictionaryBindingState(null),
        projectDictionaryBindingState(MODULE_ID),
      ]).size,
    ).toBe(3);
  });

  it('keeps the empty string out of the parsed value space', () => {
    // 空串永远到不了 projectDictionaryBindingState：协议解析这一层就拒了。
    expect(() => ProjectDictionaryBindingSchema.parse('')).toThrow();
    expect(ProjectDictionaryBindingSchema.parse(null)).toBeNull();
    expect(ProjectDictionaryBindingSchema.parse(MODULE_ID)).toBe(MODULE_ID);
    expect(() => ProjectDictionaryBindingSchema.parse(undefined)).toThrow();
  });

  // ── 判据 2 后半：不从 labels / 日期 / 季度串推断任何业务归属 ─────────────
  it('exposes exactly this surface and nothing that infers a binding', () => {
    // ⭐【判据 2 后半的结构性载体】导出面逐个枚举：任何新增导出都会让这条红，
    //    于是「顺手加一个 moduleFromLabels()」没法静默混进来。
    expect(Object.keys(dictionaries).sort()).toEqual([
      'PROJECT_DICTIONARY_MAX_NAME_LENGTH',
      'ProjectDictionaryBindingSchema',
      'ProjectDictionaryEntryRefSchema',
      'ProjectDictionaryEntrySchema',
      'ProjectIterationRefSchema',
      'canProjectDictionaryEntryAcceptNewBinding',
      'isProjectDictionaryEntryArchived',
      'projectDictionaryBindingState',
    ]);
    // 第二道：按词根拒绝，连带挡住「改了枚举列表就放行」的懒改法。
    const forbidden = /label|infer|guess|derive|sprint|quarter|month|季度|月份/i;
    for (const name of Object.keys(dictionaries)) {
      expect(name).not.toMatch(forbidden);
    }
  });

  it('carries no free-text body and no account field', () => {
    // 红线 1/2：契约里唯一的自由正文是用户亲笔的条目名称。
    for (const forbidden of ['accountKey', 'prompt', 'labels', 'description', 'projectId']) {
      expect(() => ProjectDictionaryEntrySchema.parse({ ...entry, [forbidden]: 'x' })).toThrow();
    }
  });
});
