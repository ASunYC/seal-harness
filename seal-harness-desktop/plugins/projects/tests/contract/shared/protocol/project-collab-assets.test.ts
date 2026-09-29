import { describe, expect, it } from 'vitest';

import {
  ProjectAssetVersionChainSchema,
  ProjectAssetVersionSchema,
  ProjectFileAssetSchema,
  isAssetVersionContentAvailable,
} from '../../../../stratex/shared/protocol/project-collab-assets.js';

/**
 * 资产版本契约的结构性判据。
 *
 * 这里断言的是**schema 本身的形状**，不是某次映射的结果：契约层的约束一旦被人顺手放宽
 * （多带一个字段、给服务端计数加上界），映射层用例照样能全绿，只有这一组会红。
 */

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const version = {
  id: VERSION_ID,
  assetId: ASSET_ID,
  versionNo: 1,
  fileId: FILE_ID,
  contentSha256: 'a'.repeat(64),
  bytes: 1024,
  filename: '方案.docx',
  mime: 'application/octet-stream',
  source: 'manual' as const,
  authorSubject: 'u-bob',
  authorDisplayName: '鲍勃',
  createdAt: '2026-09-11T10:00:00.000Z',
  contentDeletedAt: null,
};

const asset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  currentVersionId: VERSION_ID,
  versionCount: 1,
  createdBySubject: 'u-bob',
  createdAt: '2026-09-11T10:00:00.000Z',
  deletedAt: null,
};

describe('ProjectAssetVersionSchema', () => {
  it('⭐ versionNo 没有上界：任意大的服务端计数都过', () => {
    // 变异锚点：给 versionNo 加任何 `.max(N)`，这一条在 N+1 处转红。
    for (const versionNo of [1, 500, 501, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(ProjectAssetVersionSchema.safeParse({ ...version, versionNo }).success).toBe(true);
    }
  });

  it('versionNo 仍是正整数闭集（0 / 负 / 小数一律拒）', () => {
    for (const versionNo of [0, -1, 1.5, Number.NaN, '1']) {
      expect(ProjectAssetVersionSchema.safeParse({ ...version, versionNo }).success).toBe(false);
    }
  });

  it('⛔ strictObject：多带一个字段就不过（账号/路径连表达都表达不出来）', () => {
    for (const extra of [{ accountKey: 'leak' }, { storageRelPath: 'ab/cd' }, { isLatest: true }]) {
      expect(ProjectAssetVersionSchema.safeParse({ ...version, ...extra }).success).toBe(false);
    }
  });

  it('contentSha256 是 64 位小写十六进制闭集', () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), '']) {
      expect(ProjectAssetVersionSchema.safeParse({ ...version, contentSha256: bad }).success).toBe(
        false,
      );
    }
  });

  it('contentDeletedAt 必须显式给出（null 或时间串），缺席不过', () => {
    const withoutKey: Record<string, unknown> = { ...version };
    delete withoutKey.contentDeletedAt;
    expect(ProjectAssetVersionSchema.safeParse(withoutKey).success).toBe(false);
    expect(
      ProjectAssetVersionSchema.safeParse({
        ...version,
        contentDeletedAt: '2026-09-11T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('ProjectFileAssetSchema', () => {
  it('⭐ versionCount 没有上界', () => {
    for (const versionCount of [0, 500, 501, 250_000]) {
      expect(ProjectFileAssetSchema.safeParse({ ...asset, versionCount }).success).toBe(true);
    }
  });

  it('currentVersionId 可空（血统还没有版本），但必须是 uuid 或 null', () => {
    expect(ProjectFileAssetSchema.safeParse({ ...asset, currentVersionId: null }).success).toBe(
      true,
    );
    expect(ProjectFileAssetSchema.safeParse({ ...asset, currentVersionId: 'latest' }).success).toBe(
      false,
    );
  });
});

describe('ProjectAssetVersionChainSchema', () => {
  it('⭐ 版本链数组没有上界（越界会让一份已提交报告的附件解析不出来）', () => {
    // 变异锚点：给 versions 加 `.max(N)`，这一条在 N+1 处转红。
    const versions = Array.from({ length: 1200 }, (_unused, index) => ({
      ...version,
      id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
      versionNo: index + 1,
    }));
    const parsed = ProjectAssetVersionChainSchema.safeParse({
      asset: { ...asset, versionCount: versions.length },
      versions,
    });
    expect(parsed.success).toBe(true);
  });

  it('空链是合法形状（血统刚建好）', () => {
    expect(
      ProjectAssetVersionChainSchema.safeParse({
        asset: { ...asset, currentVersionId: null, versionCount: 0 },
        versions: [],
      }).success,
    ).toBe(true);
  });
});

describe('isAssetVersionContentAvailable', () => {
  it('只按 contentDeletedAt 判，一处出处', () => {
    expect(isAssetVersionContentAvailable({ contentDeletedAt: null })).toBe(true);
    expect(isAssetVersionContentAvailable({ contentDeletedAt: '2026-09-11T12:00:00.000Z' })).toBe(
      false,
    );
  });
});
