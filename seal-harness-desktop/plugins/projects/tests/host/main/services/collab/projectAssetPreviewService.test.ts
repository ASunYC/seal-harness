import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  PROJECT_ASSET_PREVIEWABLE_EXTENSIONS,
  PROJECT_ASSET_PREVIEW_MAX_BYTES,
  ProjectAssetPreviewFormatSchema,
  ProjectAssetVersionPreviewResultSchema,
  type ProjectAssetVersionPreviewRequest,
} from '../../../../../stratex/shared/protocol/project-collab-assets.js';
import {
  documentFormatForFileName,
  projectDocumentMimeType,
  type LocalDocumentParseResult,
} from '../../../../../stratex/main/services/localDocumentParser.js';
import {
  previewAssetVersion,
  type ProjectAssetPreviewDependencies,
} from '../../../../../stratex/main/services/collab/projectAssetPreviewService.js';

/**
 * 资产版本预览的判据。
 *
 * 三条重点：① 每一条走不通的路都落到**闭集里的降级理由**上（⛔ 没有静默空白）；
 * ② 冻结引用按版本 id 取，取不到**不回落当前版本**；③ 定位参数越界是调用方问题
 * （`invalidRequest`），不是「这份文件不能预览」。
 */

const TOKEN = 'test-access-token';
const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const asset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  currentVersionId: VERSION_ID,
  versionCount: 2,
  createdBySubject: 'u-bob',
  createdAt: '2026-09-12T10:00:00.000Z',
  deletedAt: null,
} as const;

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    assetId: ASSET_ID,
    versionNo: 2,
    fileId: FILE_ID,
    contentSha256: 'a'.repeat(64),
    bytes: 4096,
    filename: '本周工作总结.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    source: 'manual' as const,
    authorSubject: 'u-bob',
    authorDisplayName: '鲍勃',
    createdAt: '2026-09-12T10:00:00.000Z',
    contentDeletedAt: null,
    ...overrides,
  };
}

function parseResult(overrides: Partial<LocalDocumentParseResult> = {}): LocalDocumentParseResult {
  return {
    text: '一、本周完成',
    content: '一、本周完成\n已完成需求认领的数据归属同步。',
    format: 'docx',
    engine: 'native',
    warnings: [],
    locatorCoverage: { block: 12 },
    selectedRange: 'block 1',
    truncated: false,
    nextSelector: null,
    ...overrides,
  };
}

function dependencies(
  options: {
    readonly versionOverrides?: Record<string, unknown>;
    readonly resolveFailure?: 'forbidden' | 'transient' | 'rejected';
    readonly downloadFailure?: 'tooLarge' | 'forbidden' | 'transient';
    readonly bytes?: Uint8Array;
    readonly parseThrows?: string;
    readonly parseResult?: Partial<LocalDocumentParseResult>;
    readonly maxBytes?: number;
  } = {},
): {
  readonly deps: ProjectAssetPreviewDependencies;
  readonly downloadCalls: Array<{ readonly fileId: string; readonly maxBytes: number }>;
  readonly parseCalls: Array<{ readonly fileName: string; readonly mimeType: string }>;
} {
  const downloadCalls: Array<{ readonly fileId: string; readonly maxBytes: number }> = [];
  const parseCalls: Array<{ readonly fileName: string; readonly mimeType: string }> = [];
  const deps: ProjectAssetPreviewDependencies = {
    client: {
      getAssetVersion: async (_token, input) => {
        expect(input.versionId).toBe(VERSION_ID);
        if (options.resolveFailure) return { ok: false, code: options.resolveFailure };
        return { ok: true, value: { asset, version: version(options.versionOverrides) } };
      },
      downloadFileBytes: async (_token, input) => {
        downloadCalls.push(input);
        if (options.downloadFailure) return { ok: false, code: options.downloadFailure };
        return { ok: true, value: { bytes: options.bytes ?? new Uint8Array([0x50, 0x4b, 3, 4]) } };
      },
    },
    parseDocument: async (input) => {
      parseCalls.push({ fileName: input.fileName, mimeType: input.mimeType });
      // ⚠️ 判 `!== undefined` 而不是真值：空串（`new Error('')`）本身就是一个被测输入，
      //    用真值判会让那一条静默走成功路径——夹具假绿，而不是实现有问题。
      if (options.parseThrows !== undefined) throw new Error(options.parseThrows);
      return parseResult(options.parseResult);
    },
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  };
  return { deps, downloadCalls, parseCalls };
}

const request = (overrides: Partial<ProjectAssetVersionPreviewRequest> = {}) =>
  ({ versionId: VERSION_ID, ...overrides }) as ProjectAssetVersionPreviewRequest;

describe('previewAssetVersion 成功路径', () => {
  it('真的取字节、真的解析，回文本层预览（带定位覆盖与截断标记）', async () => {
    const { deps, downloadCalls, parseCalls } = dependencies();
    const outcome = await previewAssetVersion(deps, TOKEN, request({ block: 1 }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.kind).toBe('text');
    if (outcome.preview.kind !== 'text') return;
    expect(outcome.preview.format).toBe('docx');
    expect(outcome.preview.content).toContain('本周完成');
    expect(outcome.preview.locatorCoverage).toEqual({ block: 12 });
    expect(outcome.preview.truncated).toBe(false);
    expect(downloadCalls).toEqual([{ fileId: FILE_ID, maxBytes: PROJECT_ASSET_PREVIEW_MAX_BYTES }]);
    // ⚠️ 用冻结在版本行上的 mime，不是按文件名重算的那一个。
    expect(parseCalls[0]?.mimeType).toBe(version().mime);
    expect(ProjectAssetVersionPreviewResultSchema.safeParse(outcome).success).toBe(true);
  });

  it('截断时带 nextSelector，让调用方接着读下一片（⛔ 不静默截断）', async () => {
    const { deps } = dependencies({
      parseResult: { truncated: true, nextSelector: { block: 4 }, selectedRange: 'block 1-3' },
    });
    const outcome = await previewAssetVersion(deps, TOKEN, request());
    expect(outcome.ok && outcome.preview.kind === 'text' && outcome.preview.nextSelector).toEqual({
      block: 4,
    });
  });

  it('对该格式没有意义的定位键被剔除并回报，不整次拒掉', async () => {
    const { deps } = dependencies();
    const outcome = await previewAssetVersion(deps, TOKEN, request({ slide: 2, block: 1 }));
    // .docx 认 block，不认 slide。
    expect(
      outcome.ok && outcome.preview.kind === 'text' && outcome.preview.ignoredSelectors,
    ).toEqual(['slide']);
  });
});

describe('previewAssetVersion 的降级（每一条都有理由，⛔ 没有空白）', () => {
  it('字节已删 ⇒ contentDeleted，且**不发起**取字节请求', async () => {
    const { deps, downloadCalls } = dependencies({
      versionOverrides: { contentDeletedAt: '2026-09-12T11:00:00.000Z' },
    });
    const outcome = await previewAssetVersion(deps, TOKEN, request());
    expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'contentDeleted' });
    expect(downloadCalls).toEqual([]);
  });

  it('元数据超预览上限 ⇒ oversize，且不白跑一趟网络', async () => {
    const { deps, downloadCalls } = dependencies({
      versionOverrides: { bytes: PROJECT_ASSET_PREVIEW_MAX_BYTES + 1 },
    });
    const outcome = await previewAssetVersion(deps, TOKEN, request());
    expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'oversize' });
    expect(downloadCalls).toEqual([]);
  });

  it('取字节时才发现超预算（tooLarge）仍归 oversize 降级，不报成网络错误', async () => {
    const { deps } = dependencies({ downloadFailure: 'tooLarge' });
    const outcome = await previewAssetVersion(deps, TOKEN, request());
    expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'oversize' });
  });

  it('扩展名不在闭集 ⇒ unsupportedFormat（.doc / .ppt 这一类老格式）', async () => {
    for (const filename of ['旧版方案.doc', '汇报.ppt', '数据.xls', '素材.zip']) {
      const { deps, downloadCalls } = dependencies({ versionOverrides: { filename } });
      const outcome = await previewAssetVersion(deps, TOKEN, request());
      expect(outcome.ok && outcome.preview).toEqual({
        kind: 'fallback',
        reason: 'unsupportedFormat',
      });
      expect(downloadCalls).toEqual([]);
    }
  });

  it('零字节 ⇒ emptyContent（元数据说 0，或实收 0 字节）', async () => {
    const byMetadata = dependencies({ versionOverrides: { bytes: 0 } });
    expect(
      (await previewAssetVersion(byMetadata.deps, TOKEN, request())).ok &&
        (await previewAssetVersion(byMetadata.deps, TOKEN, request())),
    ).toMatchObject({ preview: { kind: 'fallback', reason: 'emptyContent' } });

    const byBody = dependencies({ bytes: new Uint8Array(0) });
    const outcome = await previewAssetVersion(byBody.deps, TOKEN, request());
    expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'emptyContent' });
  });

  it('解析器的格式/魔数/伪装三码 ⇒ formatMismatch', async () => {
    for (const code of [
      'DOCUMENT_FORMAT_MISMATCH',
      'DOCUMENT_MAGIC_MISMATCH',
      'DOCUMENT_BINARY_DISGUISE',
    ]) {
      const { deps } = dependencies({ parseThrows: code });
      const outcome = await previewAssetVersion(deps, TOKEN, request());
      expect(outcome.ok && outcome.preview).toEqual({
        kind: 'fallback',
        reason: 'formatMismatch',
      });
    }
  });

  it('解析预算类错误（含 zip 炸弹防护那一组）⇒ oversize', async () => {
    for (const code of [
      'DOCUMENT_PARSE_SIZE_LIMIT',
      'DOCUMENT_STRUCTURED_PARSE_LIMIT',
      'DOCUMENT_ZIP_ENTRIES_LIMIT',
      'DOCUMENT_ZIP_ENTRY_LIMIT',
      'DOCUMENT_ZIP_EXPANDED_LIMIT',
      'DOCUMENT_ZIP_COMPRESSED_LIMIT',
      'DOCUMENT_ZIP_RATIO_LIMIT',
    ]) {
      const { deps } = dependencies({ parseThrows: code });
      const outcome = await previewAssetVersion(deps, TOKEN, request());
      expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'oversize' });
    }
  });

  it('超时 / worker 失败 / 认不出的码 ⇒ parseFailed（兜底也落在闭集里）', async () => {
    for (const code of [
      'DOCUMENT_PARSE_TIMEOUT',
      'DOCUMENT_PARSE_WORKER_FAILED',
      'DOCUMENT_INVALID',
      'something-new-from-upstream',
      '',
    ]) {
      const { deps } = dependencies({ parseThrows: code });
      const outcome = await previewAssetVersion(deps, TOKEN, request());
      expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'parseFailed' });
    }
  });

  it('⭐ 解析成功但正文是空白（扫描件 PDF）⇒ parseFailed，⛔ 不回一个空文本预览', async () => {
    for (const content of ['', '   ', '\n\n\t']) {
      const { deps } = dependencies({ parseResult: { content } });
      const outcome = await previewAssetVersion(deps, TOKEN, request());
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.preview).toEqual({ kind: 'fallback', reason: 'parseFailed' });
    }
  });
});

describe('previewAssetVersion 的失败（不是降级）', () => {
  it('解析冻结引用失败按失败码上抛，⛔ 不回落到当前版本', async () => {
    for (const code of ['forbidden', 'transient', 'rejected'] as const) {
      const { deps, downloadCalls } = dependencies({ resolveFailure: code });
      expect(await previewAssetVersion(deps, TOKEN, request())).toEqual({ ok: false, code });
      expect(downloadCalls).toEqual([]);
    }
  });

  it('取字节的权限/瞬时失败原样上抛（这些重试有意义，不该说成「不能预览」）', async () => {
    for (const code of ['forbidden', 'transient'] as const) {
      const { deps } = dependencies({ downloadFailure: code });
      expect(await previewAssetVersion(deps, TOKEN, request())).toEqual({ ok: false, code });
    }
  });

  it('定位参数越界/不适用 ⇒ invalidRequest（调用方收回定位，不是文件不能预览）', async () => {
    for (const code of ['DOCUMENT_SELECTOR_RANGE', 'DOCUMENT_SELECTOR_MISMATCH']) {
      const { deps } = dependencies({ parseThrows: code });
      expect(await previewAssetVersion(deps, TOKEN, request({ block: 99 }))).toEqual({
        ok: false,
        code: 'invalidRequest',
      });
    }
  });
});

describe('可预览扩展名闭集与解析栈对齐', () => {
  it('⭐ 共享层声明的每个扩展名，解析栈都认得（两份清单不许漂移）', () => {
    for (const extension of PROJECT_ASSET_PREVIEWABLE_EXTENSIONS) {
      expect(documentFormatForFileName(`sample${extension}`)).not.toBeNull();
    }
  });

  it('一组已知反例两侧都说不认（不是只测了正向）', () => {
    for (const extension of ['.doc', '.ppt', '.xls', '.zip', '.png', '.exe', '.rtf', '']) {
      expect(documentFormatForFileName(`sample${extension}`)).toBeNull();
      expect(PROJECT_ASSET_PREVIEWABLE_EXTENSIONS).not.toContain(extension);
    }
  });

  it('契约里的 format 闭集覆盖解析栈能回的每一种格式', () => {
    const fromParser = new Set(
      [...PROJECT_ASSET_PREVIEWABLE_EXTENSIONS].map((extension) =>
        documentFormatForFileName(`sample${extension}`),
      ),
    );
    for (const format of fromParser) {
      expect(ProjectAssetPreviewFormatSchema.options).toContain(format);
    }
  });
});

describe('默认解析栈就是仓内那一份（⛔ 不自带第二个解析器）', () => {
  it('不注入 parseDocument 时走 parseLocalDocument：假 docx 字节落到 formatMismatch', async () => {
    const client = {
      getAssetVersion: vi.fn(async () => ({
        ok: true as const,
        value: { asset, version: version() },
      })),
      downloadFileBytes: vi.fn(async () => ({
        // 不是 PK\x03\x04 开头 ⇒ 真实解析栈按魔数判伪装。
        ok: true as const,
        value: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
      })),
    };
    const outcome = await previewAssetVersion({ client }, TOKEN, request());
    expect(outcome.ok && outcome.preview).toEqual({ kind: 'fallback', reason: 'formatMismatch' });
  });
});

describe('E1 默认解析器真实文件字节（文本层，非排版渲染）', () => {
  async function realFileClient(fileName: string) {
    const bytes = await readFile(new URL(`../__fixtures__/documents/${fileName}`, import.meta.url));
    const frozen = version({
      filename: fileName,
      mime: projectDocumentMimeType(fileName),
      bytes: bytes.length,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    return {
      getAssetVersion: vi.fn(async () => ({
        ok: true as const,
        value: { asset, version: frozen },
      })),
      downloadFileBytes: vi.fn(async () => ({ ok: true as const, value: { bytes } })),
    };
  }

  it.each([
    ['sample.docx', 'docx', 'DOCX Fixture'],
    ['sample.pptx', 'pptx', 'PPTX Fixture Slide'],
    ['sample.pdf', 'pdf', 'Compressed PDF first page'],
  ] as const)(
    '%s 原始字节经默认解析器返回可读文本及冻结版本身份',
    async (fileName, format, content) => {
      const client = await realFileClient(fileName);
      const outcome = await previewAssetVersion({ client }, TOKEN, request());
      expect(outcome).toMatchObject({
        ok: true,
        asset: { id: ASSET_ID },
        version: { id: VERSION_ID, fileId: FILE_ID },
        preview: { kind: 'text', format, content: expect.stringContaining(content) },
      });
      expect(ProjectAssetVersionPreviewResultSchema.safeParse(outcome).success).toBe(true);
      expect(client.getAssetVersion).toHaveBeenCalledWith(TOKEN, { versionId: VERSION_ID });
      expect(client.downloadFileBytes).toHaveBeenCalledWith(TOKEN, {
        fileId: FILE_ID,
        maxBytes: PROJECT_ASSET_PREVIEW_MAX_BYTES,
      });
    },
  );

  it.each([
    ['sample.docx', 'block', 'Openable document body'],
    ['sample.pdf', 'page', 'ToUnicode PDF second page'],
  ] as const)(
    '%s 下一片仍读取同一冻结版，包含真实第二片正文',
    async (fileName, locator, content) => {
      const client = await realFileClient(fileName);
      const first = await previewAssetVersion({ client }, TOKEN, request());
      expect(first.ok && first.preview.kind).toBe('text');
      if (!first.ok || first.preview.kind !== 'text') throw new Error('expected readable text');
      expect(first.preview.nextSelector).toEqual({ [locator]: 2 });
      const second = await previewAssetVersion(
        { client },
        TOKEN,
        request({ ...first.preview.nextSelector }),
      );
      expect(second).toMatchObject({
        ok: true,
        version: { id: VERSION_ID },
        preview: { kind: 'text', content: expect.stringContaining(content), nextSelector: null },
      });
      expect(client.getAssetVersion).toHaveBeenNthCalledWith(2, TOKEN, { versionId: VERSION_ID });
      expect(client.downloadFileBytes).toHaveBeenNthCalledWith(2, TOKEN, {
        fileId: FILE_ID,
        maxBytes: PROJECT_ASSET_PREVIEW_MAX_BYTES,
      });
    },
  );

  it('真实 PDF 元数据超预算时明确降级且不下载字节', async () => {
    const client = await realFileClient('sample.pdf');
    const outcome = await previewAssetVersion({ client, maxBytes: 1 }, TOKEN, request());
    expect(outcome).toMatchObject({ ok: true, preview: { kind: 'fallback', reason: 'oversize' } });
    expect(client.downloadFileBytes).not.toHaveBeenCalled();
  });

  it('真实 PDF 文件请求越界页返回定位错误，不冒充格式降级', async () => {
    const client = await realFileClient('sample.pdf');
    expect(await previewAssetVersion({ client }, TOKEN, request({ page: 99 }))).toEqual({
      ok: false,
      code: 'invalidRequest',
    });
  });
});
