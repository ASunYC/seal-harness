import { describe, expect, it } from 'vitest';

import {
  PROJECT_ASSET_PREVIEW_MAX_BYTES,
  ProjectAssetAttachmentSelectabilitySchema,
  ProjectAssetCatalogueEntrySchema,
  ProjectAssetListResultSchema,
  ProjectAssetPreviewFallbackReasonSchema,
  ProjectAssetVersionPreviewRequestSchema,
  ProjectAssetVersionPreviewResultSchema,
  ProjectAssetVersionUploadRequestSchema,
  ProjectAssetVersionUploadResultSchema,
  assetAttachmentSelectability,
  assetPreviewFallbackReasonFor,
  isAssetPreviewDownloadable,
  projectAssetPreviewFallbackText,
  projectAssetServerCodeText,
} from '../../../../stratex/shared/protocol/project-collab-assets.js';

/**
 * RPT-02（资产预览 / 上传失败恢复 / 关联选择）的契约层判据。
 *
 * 这一组断言的是**契约与判定函数本身**，不是某一次调用的结果：判定一旦被人挪进组件里
 * 重写一份（预览降级理由、已添加禁选、降级文案），服务层与 IPC 层的用例照样全绿，
 * 只有这一组会红。
 */

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';

function version(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VERSION_ID,
    assetId: ASSET_ID,
    versionNo: 1,
    fileId: FILE_ID,
    contentSha256: 'a'.repeat(64),
    bytes: 1024,
    filename: '本周工作总结.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    source: 'manual',
    authorSubject: 'u-bob',
    authorDisplayName: '鲍勃',
    createdAt: '2026-09-12T10:00:00.000Z',
    contentDeletedAt: null,
    ...overrides,
  };
}

function asset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ASSET_ID,
    projectId: PROJECT_ID,
    currentVersionId: VERSION_ID,
    versionCount: 2,
    createdBySubject: 'u-bob',
    createdAt: '2026-09-12T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('ProjectAssetListResultSchema', () => {
  it('⭐ 目录条数没有上界：资产数是服务端计数，越界会让整页资产取不回来', () => {
    // 变异锚点：给 assets 加任何 `.max(N)`，这一条在 N+1 处转红。
    const assets = Array.from({ length: 900 }, (_unused, index) => ({
      ...asset({
        id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
        currentVersionId: null,
        versionCount: 0,
      }),
      currentVersion: null,
    }));
    expect(ProjectAssetListResultSchema.safeParse({ ok: true, assets }).success).toBe(true);
  });

  it('失败信封带参考编号闭集，缺编号不过', () => {
    expect(
      ProjectAssetListResultSchema.safeParse({
        ok: false,
        code: 'forbidden',
        message: '没有执行该操作的权限。',
        referenceCode: 'STRX-COLLAB-008',
      }).success,
    ).toBe(true);
    expect(
      ProjectAssetListResultSchema.safeParse({
        ok: false,
        code: 'forbidden',
        message: '没有执行该操作的权限。',
      }).success,
    ).toBe(false);
  });
});

describe('ProjectAssetVersionUploadRequestSchema', () => {
  it('⛔ 请求里结构性没有本机路径与字节（路径永不跨 IPC）', () => {
    const base = { projectId: PROJECT_ID, operationId: OPERATION_ID };
    expect(ProjectAssetVersionUploadRequestSchema.safeParse(base).success).toBe(true);
    // assetId 缺席 ＝ 新建血统；给了 ＝ 追加为该血统的下一版（替换语义）。
    expect(
      ProjectAssetVersionUploadRequestSchema.safeParse({ ...base, assetId: ASSET_ID }).success,
    ).toBe(true);
    for (const leak of [
      { filePath: 'C:/Users/bob/a.docx' },
      { bytes: new Uint8Array([1]) },
      { accountKey: 'leak' },
    ]) {
      expect(ProjectAssetVersionUploadRequestSchema.safeParse({ ...base, ...leak }).success).toBe(
        false,
      );
    }
  });
});

describe('ProjectAssetVersionUploadResultSchema', () => {
  it('完成分支带血统与版本，并显式声明这一次是新落库还是收敛到已有版本', () => {
    for (const reused of [false, true]) {
      expect(
        ProjectAssetVersionUploadResultSchema.safeParse({
          ok: true,
          asset: asset(),
          version: version(),
          reused,
        }).success,
      ).toBe(true);
    }
  });

  it('用户在系统选择框里取消是成功分支（不是错误），且不带版本', () => {
    expect(
      ProjectAssetVersionUploadResultSchema.safeParse({ ok: true, cancelled: true }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionUploadResultSchema.safeParse({
        ok: true,
        cancelled: true,
        version: version(),
      }).success,
    ).toBe(false);
  });

  it('⭐ 失败分支必须同时给出可续传描述（null ＝ 这次失败没有可续的断点）', () => {
    const failure = {
      ok: false,
      code: 'transient',
      message: '网络暂时不可用，请稍后重试。',
      referenceCode: 'STRX-COLLAB-010',
      quota: null,
    };
    // 缺 resume 键 ⇒ 不过：断点有没有是失败体的一部分，不能靠调用方猜。
    expect(ProjectAssetVersionUploadResultSchema.safeParse(failure).success).toBe(false);
    expect(
      ProjectAssetVersionUploadResultSchema.safeParse({ ...failure, resume: null }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionUploadResultSchema.safeParse({
        ...failure,
        resume: {
          operationId: OPERATION_ID,
          stage: 'register',
          filename: '本周工作总结.docx',
          bytes: 1024,
          assetId: null,
        },
      }).success,
    ).toBe(true);
  });

  it('⛔ 断点描述里不得出现本机路径：加一个 filePath 键就不过', () => {
    expect(
      ProjectAssetVersionUploadResultSchema.safeParse({
        ok: false,
        code: 'transient',
        message: '网络暂时不可用，请稍后重试。',
        referenceCode: 'STRX-COLLAB-010',
        quota: null,
        resume: {
          operationId: OPERATION_ID,
          stage: 'upload',
          filename: '本周工作总结.docx',
          bytes: null,
          assetId: null,
          filePath: 'C:/Users/bob/a.docx',
        },
      }).success,
    ).toBe(false);
  });

  it('续传阶段是闭集：只有「重传字节」与「只补登记」两档', () => {
    const shape = (stage: string) => ({
      ok: false,
      code: 'transient',
      message: '网络暂时不可用，请稍后重试。',
      referenceCode: 'STRX-COLLAB-010',
      quota: null,
      resume: {
        operationId: OPERATION_ID,
        stage,
        filename: 'a.docx',
        bytes: null,
        assetId: null,
      },
    });
    expect(ProjectAssetVersionUploadResultSchema.safeParse(shape('upload')).success).toBe(true);
    expect(ProjectAssetVersionUploadResultSchema.safeParse(shape('register')).success).toBe(true);
    for (const stage of ['done', 'preview', 'retry', '']) {
      expect(ProjectAssetVersionUploadResultSchema.safeParse(shape(stage)).success).toBe(false);
    }
  });
});

describe('ProjectAssetVersionPreviewRequestSchema', () => {
  it('按冻结版本 id 取预览，定位键可选', () => {
    expect(
      ProjectAssetVersionPreviewRequestSchema.safeParse({ versionId: VERSION_ID }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionPreviewRequestSchema.safeParse({ versionId: VERSION_ID, page: 2 }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionPreviewRequestSchema.safeParse({ versionId: VERSION_ID, slide: 3 })
        .success,
    ).toBe(true);
    // ⛔ 不接受「顺手回落到当前版本」的开关：那等于把冻结悄悄取消掉。
    expect(
      ProjectAssetVersionPreviewRequestSchema.safeParse({
        versionId: VERSION_ID,
        fallbackToCurrent: true,
      }).success,
    ).toBe(false);
  });
});

describe('ProjectAssetVersionPreviewResultSchema', () => {
  const textPreview = {
    ok: true,
    asset: asset(),
    version: version(),
    preview: {
      kind: 'text',
      format: 'docx',
      content: '一、本周完成\n已完成需求认领的数据归属同步。',
      selectedRange: 'block 1',
      locatorCoverage: { block: 12 },
      truncated: false,
      nextSelector: null,
      ignoredSelectors: [],
    },
  };

  it('文本预览分支带定位覆盖与截断标记（⛔ 没有「静默截断」这一档）', () => {
    expect(ProjectAssetVersionPreviewResultSchema.safeParse(textPreview).success).toBe(true);
    const truncated = {
      ...textPreview,
      preview: { ...textPreview.preview, truncated: true, nextSelector: { block: 4 } },
    };
    expect(ProjectAssetVersionPreviewResultSchema.safeParse(truncated).success).toBe(true);
  });

  it('⭐ 降级分支必须带闭集理由，且不许夹带正文（不能静默空白）', () => {
    expect(
      ProjectAssetVersionPreviewResultSchema.safeParse({
        ok: true,
        asset: asset(),
        version: version({ bytes: PROJECT_ASSET_PREVIEW_MAX_BYTES + 1 }),
        preview: { kind: 'fallback', reason: 'oversize' },
      }).success,
    ).toBe(true);
    expect(
      ProjectAssetVersionPreviewResultSchema.safeParse({
        ok: true,
        asset: asset(),
        version: version(),
        preview: { kind: 'fallback', reason: 'oversize', content: '偷偷塞一段正文' },
      }).success,
    ).toBe(false);
    expect(
      ProjectAssetVersionPreviewResultSchema.safeParse({
        ok: true,
        asset: asset(),
        version: version(),
        preview: { kind: 'fallback', reason: 'looks-weird' },
      }).success,
    ).toBe(false);
  });

  it('⛔ 没有「既不是文本也不是降级」的第三态：preview 键缺席不过', () => {
    expect(
      ProjectAssetVersionPreviewResultSchema.safeParse({
        ok: true,
        asset: asset(),
        version: version(),
      }).success,
    ).toBe(false);
  });
});

describe('isAssetPreviewDownloadable', () => {
  it('只有「字节已删」不给下载；其余降级理由都给下载', () => {
    expect(isAssetPreviewDownloadable('contentDeleted')).toBe(false);
    for (const reason of ProjectAssetPreviewFallbackReasonSchema.options) {
      if (reason === 'contentDeleted') continue;
      expect(isAssetPreviewDownloadable(reason)).toBe(true);
    }
  });
});

describe('projectAssetPreviewFallbackText', () => {
  it('⭐ 降级理由闭集逐条有句子：组件层零默认文案的前提就是这张表是全的', () => {
    // 变异锚点：往闭集里加一个理由而不补文案，这一条转红（D7.17 的机器载体）。
    for (const reason of ProjectAssetPreviewFallbackReasonSchema.options) {
      const text = projectAssetPreviewFallbackText(reason);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/undefined|失败了|出错/u);
    }
  });

  it('措辞按理由分说，不同理由不共用一句话', () => {
    const sentences = ProjectAssetPreviewFallbackReasonSchema.options.map((reason) =>
      projectAssetPreviewFallbackText(reason),
    );
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('assetPreviewFallbackReasonFor', () => {
  it('字节已删优先于其它一切判定（连下载都不该给）', () => {
    expect(
      assetPreviewFallbackReasonFor({
        filename: '汇报.pptx',
        bytes: PROJECT_ASSET_PREVIEW_MAX_BYTES + 1,
        contentDeletedAt: '2026-09-12T11:00:00.000Z',
      }),
    ).toBe('contentDeleted');
  });

  it('超预览上限 ⇒ oversize（上限本身是命名常量，不是散落的数字）', () => {
    expect(
      assetPreviewFallbackReasonFor({
        filename: '汇报.pptx',
        bytes: PROJECT_ASSET_PREVIEW_MAX_BYTES + 1,
        contentDeletedAt: null,
      }),
    ).toBe('oversize');
    expect(
      assetPreviewFallbackReasonFor({
        filename: '汇报.pptx',
        bytes: PROJECT_ASSET_PREVIEW_MAX_BYTES,
        contentDeletedAt: null,
      }),
    ).toBeNull();
  });

  it('可解析闭集内的扩展名放行；闭集外 ⇒ unsupportedFormat', () => {
    for (const filename of [
      'a.pdf',
      'b.docx',
      'c.pptx',
      'd.xlsx',
      'e.txt',
      'f.md',
      'g.csv',
      'h.json',
    ]) {
      expect(
        assetPreviewFallbackReasonFor({ filename, bytes: 2048, contentDeletedAt: null }),
      ).toBeNull();
    }
    for (const filename of ['old.doc', 'deck.ppt', 'book.xls', 'pack.zip', 'shot.png', 'run.exe']) {
      expect(assetPreviewFallbackReasonFor({ filename, bytes: 2048, contentDeletedAt: null })).toBe(
        'unsupportedFormat',
      );
    }
  });

  it('大写扩展名与无扩展名都判得出来（不靠调用方先归一化）', () => {
    expect(
      assetPreviewFallbackReasonFor({ filename: '报告.DOCX', bytes: 2048, contentDeletedAt: null }),
    ).toBeNull();
    expect(
      assetPreviewFallbackReasonFor({ filename: 'README', bytes: 2048, contentDeletedAt: null }),
    ).toBe('unsupportedFormat');
  });

  it('零字节文件不当可预览（解析器也会拒），归 parseFailed 之前先说清楚', () => {
    expect(
      assetPreviewFallbackReasonFor({ filename: 'a.docx', bytes: 0, contentDeletedAt: null }),
    ).toBe('emptyContent');
  });
});

describe('assetAttachmentSelectability', () => {
  /** 经契约解析再传入：既得到带类型的目录行，也顺手证明这份夹具是合法形状。 */
  const entry = (
    assetOverrides: Record<string, unknown> = {},
    versionOverrides: Record<string, unknown> | null = {},
  ) =>
    ProjectAssetCatalogueEntrySchema.parse({
      ...asset(assetOverrides),
      currentVersion: versionOverrides === null ? null : version(versionOverrides),
    });
  const selectable = entry();

  it('可选：未删血统 + 有当前版本 + 字节在', () => {
    expect(assetAttachmentSelectability(selectable, { selectedVersionIds: [] })).toBe('selectable');
    expect(ProjectAssetAttachmentSelectabilitySchema.options).toContain('selectable');
  });

  it('⭐ 已添加优先于其它判定：同一版本不能重复添加（替换走替换那条路）', () => {
    expect(assetAttachmentSelectability(selectable, { selectedVersionIds: [VERSION_ID] })).toBe(
      'alreadySelected',
    );
  });

  it('血统已删 / 尚无版本 / 字节已删各有自己的档，不塌缩成一句「不可用」', () => {
    expect(
      assetAttachmentSelectability(entry({ deletedAt: '2026-09-12T11:00:00.000Z' }), {
        selectedVersionIds: [],
      }),
    ).toBe('assetDeleted');
    expect(
      assetAttachmentSelectability(entry({ currentVersionId: null, versionCount: 0 }, null), {
        selectedVersionIds: [],
      }),
    ).toBe('noVersion');
    expect(
      assetAttachmentSelectability(entry({}, { contentDeletedAt: '2026-09-12T11:00:00.000Z' }), {
        selectedVersionIds: [],
      }),
    ).toBe('contentDeleted');
  });

  it('替换时把被替换的那一件排除在「已添加」之外（否则替换成自己永远不允许）', () => {
    expect(
      assetAttachmentSelectability(selectable, {
        selectedVersionIds: [VERSION_ID],
        replacingVersionId: VERSION_ID,
      }),
    ).toBe('selectable');
  });
});

describe('projectAssetServerCodeText', () => {
  it('资产域业务码逐条有句子，认不出的一律 null（调用方退回通用文案）', () => {
    expect(projectAssetServerCodeText('file_already_versioned')).toMatch(/版本/u);
    expect(projectAssetServerCodeText('asset_deleted')).toMatch(/删除/u);
    expect(projectAssetServerCodeText('asset_not_found')).not.toBeNull();
    expect(projectAssetServerCodeText('asset_version_not_found')).not.toBeNull();
    expect(projectAssetServerCodeText('some_other_code')).toBeNull();
    expect(projectAssetServerCodeText(undefined)).toBeNull();
  });
});
