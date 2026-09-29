import { describe, expect, it } from 'vitest';

import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';
import {
  ProjectAssetRestoreRequestSchema,
  ProjectAssetRestoreResultSchema,
  ProjectAssetTrashListRequestSchema,
  ProjectAssetTrashListResultSchema,
  ProjectAssetVersionRestoreRequestSchema,
  ProjectAssetVersionRestoreResultSchema,
  projectAssetRecoveryErrorText,
} from '../../../../stratex/shared/protocol/project-collab-assets.js';

/**
 * RPT-08 回收站与历史版本恢复三条通道的契约判据（ADR-0037）。
 *
 * 盯三件事：
 *  ① 入参 strictObject：塞不进账号、路径或「顺手」多带的字段；
 *  ② 回收站出参与目录**同形**且**不严于**服务端：`deletedAt` 非空与为空都照收
 *     （客户端多断言一句，服务端一次合法变更就能让整个回收站解析失败）；
 *  ③ 历史版本恢复的失败体**必须**带 `quota` 键，业务码文案按动作分表且每个已知码都有一句。
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';

const version = {
  id: VERSION_ID,
  assetId: ASSET_ID,
  versionNo: 3,
  fileId: FILE_ID,
  contentSha256: 'c'.repeat(64),
  bytes: 4096,
  filename: '交付清单.xlsx',
  mime: 'application/octet-stream',
  source: 'manual' as const,
  authorSubject: 'u-bob',
  authorDisplayName: '鲍勃',
  createdAt: '2026-09-12T08:00:00.000Z',
  contentDeletedAt: null,
};

const asset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  currentVersionId: VERSION_ID,
  versionCount: 3,
  createdBySubject: 'u-bob',
  createdAt: '2026-09-10T08:00:00.000Z',
  deletedAt: '2026-09-12T09:00:00.000Z',
};

const failureBody = {
  ok: false as const,
  code: 'conflict' as const,
  message: '资产版本已被他人更新，请刷新后重试。',
  referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
};

describe('入参 strictObject', () => {
  it('三条请求只收各自的 id，多一个字段一律拒', () => {
    expect(ProjectAssetTrashListRequestSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(
      true,
    );
    expect(
      ProjectAssetTrashListRequestSchema.safeParse({ projectId: PROJECT_ID, accountKey: 'x' })
        .success,
    ).toBe(false);
    expect(
      ProjectAssetRestoreRequestSchema.safeParse({ projectId: PROJECT_ID, assetId: ASSET_ID })
        .success,
    ).toBe(true);
    expect(ProjectAssetRestoreRequestSchema.safeParse({ assetId: ASSET_ID }).success).toBe(false);
    expect(
      ProjectAssetVersionRestoreRequestSchema.safeParse({
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }).success,
    ).toBe(true);
    // 拿文件 id 当版本 id 传不会被形状拦住（都是 uuid），但多带「回落当前版本」这类开关必拒。
    expect(
      ProjectAssetVersionRestoreRequestSchema.safeParse({
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        fallbackToCurrent: true,
      }).success,
    ).toBe(false);
  });
});

describe('回收站出参与目录同形、不严于服务端', () => {
  it('deletedAt 非空与为空的目录行都照收（⛔ 客户端不另断言 deletedAt 非空）', () => {
    const trashed = { ...asset, currentVersion: version };
    const alive = { ...asset, deletedAt: null, currentVersion: version };
    expect(
      ProjectAssetTrashListResultSchema.safeParse({ ok: true, assets: [trashed, alive] }).success,
    ).toBe(true);
  });

  it('目录行多带字段即整批拒（坏帧不进渲染层）', () => {
    const tampered = { ...asset, currentVersion: version, storageRelPath: '2026/09/a.bin' };
    expect(
      ProjectAssetTrashListResultSchema.safeParse({ ok: true, assets: [tampered] }).success,
    ).toBe(false);
  });

  it('回收站恢复的成功体是恢复后的目录行；失败体可带业务码', () => {
    expect(
      ProjectAssetRestoreResultSchema.safeParse({
        ok: true,
        asset: { ...asset, deletedAt: null, currentVersion: version },
      }).success,
    ).toBe(true);
    expect(
      ProjectAssetRestoreResultSchema.safeParse({
        ...failureBody,
        code: 'forbidden',
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.forbidden,
        serverCode: 'forbidden',
      }).success,
    ).toBe(true);
  });
});

describe('历史版本恢复结果', () => {
  it('成功体 = 血统 + 新版本行', () => {
    expect(
      ProjectAssetVersionRestoreResultSchema.safeParse({
        ok: true,
        asset: { ...asset, deletedAt: null },
        version,
      }).success,
    ).toBe(true);
  });

  it('⭐ 失败体必须带 quota 键（可为 null）：缺键即拒', () => {
    expect(
      ProjectAssetVersionRestoreResultSchema.safeParse({
        ...failureBody,
        serverCode: 'asset_deleted',
        quota: null,
      }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionRestoreResultSchema.safeParse({
        ...failureBody,
        serverCode: 'asset_deleted',
      }).success,
    ).toBe(false);
    expect(
      ProjectAssetVersionRestoreResultSchema.safeParse({
        ...failureBody,
        code: 'quotaExceeded',
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES.quotaExceeded,
        serverCode: 'project_file_quota_exceeded',
        quota: { limitBytes: 2048, usedBytes: 2048 },
      }).success,
    ).toBe(true);
  });
});

describe('projectAssetRecoveryErrorText', () => {
  const RESTORE_VERSION_CODES = [
    'forbidden',
    'asset_deleted',
    'asset_version_not_found',
    'asset_version_content_deleted',
    'asset_version_content_mismatch',
    'file_not_found',
    'file_too_large',
    'project_file_quota_exceeded',
  ] as const;

  it('历史版本恢复：每个已知业务码各有一句，且四种主要失败互不相同', () => {
    const texts = RESTORE_VERSION_CODES.map((code) =>
      projectAssetRecoveryErrorText('restoreVersion', code),
    );
    expect(texts.every((text) => typeof text === 'string' && text.length > 0)).toBe(true);
    // 已在回收站 / 指纹不符 / 字节缺失 / 配额已满：说法不能塌成同一句。
    const distinct = new Set([
      projectAssetRecoveryErrorText('restoreVersion', 'asset_deleted'),
      projectAssetRecoveryErrorText('restoreVersion', 'asset_version_content_mismatch'),
      projectAssetRecoveryErrorText('restoreVersion', 'file_not_found'),
      projectAssetRecoveryErrorText('restoreVersion', 'project_file_quota_exceeded'),
    ]);
    expect(distinct.size).toBe(4);
  });

  it('⭐ 血统已删：把人引回回收站', () => {
    expect(projectAssetRecoveryErrorText('restoreVersion', 'asset_deleted')).toContain('回收站');
  });

  it('forbidden 按动作分说法：回收站恢复讲「本人或拥有者」，历史版本恢复讲「编辑权限」', () => {
    expect(projectAssetRecoveryErrorText('restoreAsset', 'forbidden')).toContain('拥有者');
    expect(projectAssetRecoveryErrorText('restoreVersion', 'forbidden')).toContain('编辑权限');
  });

  it('回收站恢复：404 说清「已不在回收站」；只属于另一个动作的码不借用', () => {
    expect(projectAssetRecoveryErrorText('restoreAsset', 'asset_not_found')).toContain('回收站');
    expect(projectAssetRecoveryErrorText('restoreAsset', 'asset_version_content_mismatch')).toBe(
      null,
    );
  });

  it('两个动作共用的入组门与归档门都有说法', () => {
    for (const operation of ['restoreAsset', 'restoreVersion'] as const) {
      expect(projectAssetRecoveryErrorText(operation, 'not_a_member')).not.toBe(null);
      expect(projectAssetRecoveryErrorText(operation, 'project_archived')).not.toBe(null);
    }
  });

  it('认不出的码与缺席一律 null（调用方退回按 code 的通用句）', () => {
    expect(projectAssetRecoveryErrorText('restoreVersion', 'no_such_code')).toBe(null);
    expect(projectAssetRecoveryErrorText('restoreAsset', undefined)).toBe(null);
    expect(projectAssetRecoveryErrorText('restoreAsset', null)).toBe(null);
  });
});
