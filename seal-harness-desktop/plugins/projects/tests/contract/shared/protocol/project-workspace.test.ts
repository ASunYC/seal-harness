import { describe, expect, it } from 'vitest';

import {
  ProjectWorkspaceResultSchema,
  ProjectLinkedDirectoryListArgumentsSchema,
  ProjectLinkedDirectorySearchArgumentsSchema,
  ProjectLinkedDirectoryReadArgumentsSchema,
  ProjectLinkedDirectoryReadResultSchema,
} from '../../../../stratex/shared/protocol/project-workspace.js';

const snapshot = {
  status: 'bound' as const,
  collabProjectId: '11111111-1111-4111-8111-111111111111',
  localProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Alpha',
  binding: {
    bindingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revision: 7,
  },
};

describe('project workspace public protocol', () => {
  it('keeps model read arguments closed to injected authority and writable paths', () => {
    const refId = snapshot.localProjectId;
    expect(ProjectLinkedDirectoryListArgumentsSchema.safeParse({}).success).toBe(true);
    for (const extra of [
      { accountKey: 'account:b' },
      { workspaceRoot: 'C:\\private' },
      { isAuthorized: true },
      { cwd: '/private' },
    ]) {
      expect(
        ProjectLinkedDirectoryReadArgumentsSchema.safeParse({
          refId,
          relativePath: 'notes.txt',
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(
      ProjectLinkedDirectoryReadArgumentsSchema.safeParse({
        refId,
        relativePath: 'notes.txt',
        maxBytes: 32769,
      }).success,
    ).toBe(false);
    expect(ProjectLinkedDirectoryListArgumentsSchema.safeParse({ refId, limit: 101 }).success).toBe(
      false,
    );
    expect(
      ProjectLinkedDirectorySearchArgumentsSchema.safeParse({ refId, query: 'a'.repeat(501) })
        .success,
    ).toBe(false);
  });
  it('rejects absolute path entries and excess output records on the read result wire', () => {
    expect(
      ProjectLinkedDirectoryReadResultSchema.safeParse({
        ok: true,
        entries: [{ relativePath: 'C:\\private', kind: 'file' }],
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      ProjectLinkedDirectoryReadResultSchema.safeParse({
        ok: true,
        entries: Array.from({ length: 101 }, () => ({ relativePath: 'notes.txt', kind: 'file' })),
        truncated: true,
      }).success,
    ).toBe(false);
  });
  it('accepts only the safe project snapshot', () => {
    const parsed = ProjectWorkspaceResultSchema.parse({ ok: true, snapshot });

    expect(JSON.stringify(parsed)).not.toContain('C:\\private');
    expect(parsed).toEqual({ ok: true, snapshot });
  });

  it.each(['canonicalPath', 'absolutePath', 'path'])('rejects a leaked %s field', (field) => {
    expect(() =>
      ProjectWorkspaceResultSchema.parse({
        ok: true,
        snapshot: { ...snapshot, [field]: 'C:\\private\\alpha' },
      }),
    ).toThrow();
  });

  /*
   * CTX-04 判据1（Main 是唯一本机路径权威）：判据不是「Renderer 没显示路径」，而是
   * 「本机绝对路径根本进不了这条 Renderer 会收到的线」。快照 schema 是 strictObject——
   * 无论字段叫什么（rootPath / localPath / cwd / directory / workspaceRoot），只要多带一个
   * 不在白名单里的键就整条 parse 失败。Renderer 拿到的对象里因此不可能有本机路径这一维。
   * ⛔ 变异锚点：把 ProjectWorkspaceSnapshotSchema 的某个分支改成非 strictObject（passthrough），
   *    或给 bound 分支加一个 path 字段，这一组就会漏过——本用例随即变绿转红。
   */
  it.each(['rootPath', 'localPath', 'cwd', 'directory', 'workspaceRoot', 'realPath'])(
    'strictObject forbids any local-path-shaped field (%s) from riding the renderer wire',
    (field) => {
      expect(() =>
        ProjectWorkspaceResultSchema.parse({
          ok: true,
          snapshot: { ...snapshot, [field]: 'C:\\Users\\liumy\\projects\\alpha' },
        }),
      ).toThrow();
    },
  );

  it('a fully accepted bound result carries no absolute-path-shaped value anywhere', () => {
    const parsed = ProjectWorkspaceResultSchema.parse({ ok: true, snapshot });
    const serialized = JSON.stringify(parsed);
    // 白名单里的每个值都不是绝对路径：Windows 盘符、POSIX 根、UNC 前缀都不该出现。
    expect(serialized).not.toMatch(/[A-Za-z]:\\/u);
    expect(serialized).not.toMatch(/(^|")\/[A-Za-z]/u);
    expect(serialized).not.toContain('\\\\');
  });
});
