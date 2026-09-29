import {
  PROJECT_ASSET_PREVIEW_MAX_BYTES,
  assetPreviewFallbackReasonFor,
  type ProjectAssetPreviewFallbackReason,
  type ProjectAssetVersionPreviewRequest,
  type ProjectAssetVersionPreviewResult,
  type ProjectAssetVersionResolution,
} from '../../../shared/protocol/project-collab-assets.js';
import {
  documentFormatForFileName,
  normalizeDocumentSelector,
  parseLocalDocument,
  type LocalDocumentParseResult,
  type LocalDocumentSelector,
} from '../localDocumentParser.js';
import type { CollabClientFailureCode, CollabClientOutcome } from './collabClient.js';

/**
 * 资产版本预览：**真的把字节取回来解析**，解析不了就给一条明说理由的下载降级。
 *
 * ⭐ 为什么不是「渲染 Office」：我们做的是**文本层预览**——DOCX 取段、PPTX 取页、
 *    PDF 取页、XLSX 取表，解析栈与助手读项目文件、资料库入库同一份
 *    （`localDocumentParser`，含 zip 炸弹与超时预算）。⛔ 不做版式保真渲染：那需要
 *    另一条渲染链，而在它到位之前**假装**能预览的代价是用户看到一片空白。保真那一路
 *    的答案是下载后用本机软件打开，这也正是降级分支存在的意义。
 *
 * ⛔ 三件事不做，每一件都是判据不是风格：
 *  ① **不落盘**。走 `downloadFileBytes` 把字节读进内存解析完即丢——预览不该在用户机器上
 *     留一份未受保护的项目材料副本（助手读文件那条路要落盘是因为它复用了下载那条通道）。
 *  ② **不回落到当前版本**。入参是冻结的版本 id；取不到就如实报，回落等于把冻结取消掉。
 *  ③ **不静默空白**。任何一条走不通的路都落到闭集里的一个降级理由上，包括「解析成功
 *     但一个字都没取到」（扫描件 PDF 是最常见的一种）——那一条尤其容易被写成
 *     `kind:'text', content:''`，那就是一片空白面板。
 *
 * 【红线】出参不含本机路径、不含令牌；正文只在预览结果里回给发起窗口，⛔ 不进任何埋点。
 */

/** 客户端网络面的结构性子集（测试可用对象字面量替身）。 */
export interface ProjectAssetPreviewClientPort {
  getAssetVersion(
    accessToken: string,
    input: { readonly versionId: string },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>>;
  downloadFileBytes(
    accessToken: string,
    input: { readonly fileId: string; readonly maxBytes: number },
  ): Promise<CollabClientOutcome<{ readonly bytes: Uint8Array }>>;
}

export interface ProjectAssetPreviewDependencies {
  readonly client: ProjectAssetPreviewClientPort;
  /** 文档解析栈（缺省即 `parseLocalDocument`；注入只为用例造异常与超时）。 */
  readonly parseDocument?: (input: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly selector?: LocalDocumentSelector;
  }) => Promise<LocalDocumentParseResult>;
  /** 取字节预算（缺省即协议里的预览上限；注入只为用例把阈值压小）。 */
  readonly maxBytes?: number;
}

/**
 * 成功侧与 `ProjectAssetVersionPreviewResultSchema` 的成功分支同形；失败侧只回
 * **失败码**，由 IPC 层套上固定文案与参考编号（签发点只有一个，见 `failureBody`）。
 */
export type ProjectAssetPreviewOutcome =
  | Extract<ProjectAssetVersionPreviewResult, { readonly ok: true }>
  | { readonly ok: false; readonly code: CollabClientFailureCode };

/**
 * 解析器错误码 → 降级理由。
 *
 * 与助手读文件那侧（`describeProjectReadFileFailure`）是**同一批错误码的两套投影**：
 * 那边要给模型一句可执行的英文，这边要给用户一个闭集理由。⛔ 不共用一张表——
 * 受众不同、可执行动作不同，硬合成一份只会得到一句谁都用不上的话。
 */
const FALLBACK_BY_PARSER_CODE: Readonly<Record<string, ProjectAssetPreviewFallbackReason>> = {
  DOCUMENT_FORMAT_MISMATCH: 'formatMismatch',
  DOCUMENT_MAGIC_MISMATCH: 'formatMismatch',
  DOCUMENT_BINARY_DISGUISE: 'formatMismatch',
  DOCUMENT_UNSUPPORTED: 'unsupportedFormat',
  DOCUMENT_PARSE_SIZE_LIMIT: 'oversize',
  DOCUMENT_STRUCTURED_PARSE_LIMIT: 'oversize',
  DOCUMENT_ZIP_ENTRIES_LIMIT: 'oversize',
  DOCUMENT_ZIP_ENTRY_LIMIT: 'oversize',
  DOCUMENT_ZIP_EXPANDED_LIMIT: 'oversize',
  DOCUMENT_ZIP_COMPRESSED_LIMIT: 'oversize',
  DOCUMENT_ZIP_RATIO_LIMIT: 'oversize',
};

/**
 * 定位参数问题**不是降级**：那是调用方给错了片号（如要第 99 页而文件只有 3 页），
 * 该回 `invalidRequest` 让界面把定位收回去，而不是说「这份文件不能预览」。
 */
const SELECTOR_PARSER_CODES: ReadonlySet<string> = new Set([
  'DOCUMENT_SELECTOR_MISMATCH',
  'DOCUMENT_SELECTOR_RANGE',
]);

/** 请求里可能带的定位键（与协议闭集同一份取值；剔除不适用者由解析栈负责）。 */
const LOCATOR_KEYS: readonly (keyof LocalDocumentSelector)[] = [
  'page',
  'slide',
  'sheet',
  'block',
  'startLine',
  'maxLines',
  'startChar',
];

export async function previewAssetVersion(
  dependencies: ProjectAssetPreviewDependencies,
  accessToken: string,
  request: ProjectAssetVersionPreviewRequest,
): Promise<ProjectAssetPreviewOutcome> {
  const resolved = await dependencies.client.getAssetVersion(accessToken, {
    versionId: request.versionId,
  });
  if (!resolved.ok) return { ok: false, code: resolved.code };
  const { asset, version } = resolved.value;
  const maxBytes = dependencies.maxBytes ?? PROJECT_ASSET_PREVIEW_MAX_BYTES;

  // 先按元数据判：字节已删 / 空文件 / 格式不支持 / 超上限都不必白跑一趟网络。
  // 判定函数与渲染层**共用同一个**（共享协议层），⛔ 不在这里重写一份。
  const metadataReason = assetPreviewFallbackReasonFor(version, { maxBytes });
  if (metadataReason !== null) return fallback(asset, version, metadataReason);

  const format = documentFormatForFileName(version.filename);
  // 走到这里 format 必非 null（扩展名闭集已在上一步判过）；仍然防御一次：
  // 两份清单若哪天漂移，宁可给下载降级，也不要把 null 喂进解析器。
  if (format === null) return fallback(asset, version, 'unsupportedFormat');
  const normalized = normalizeDocumentSelector(format, pickLocators(request));

  const downloaded = await dependencies.client.downloadFileBytes(accessToken, {
    fileId: version.fileId,
    maxBytes,
  });
  if (!downloaded.ok) {
    // 取字节时才发现超预算（元数据里的 bytes 与实际不符）仍然是**降级**而不是错误：
    // 用户要的下一步是下载，不是重试。其余失败码（权限/凭据/瞬时）原样上抛。
    if (downloaded.code === 'tooLarge') return fallback(asset, version, 'oversize');
    return { ok: false, code: downloaded.code };
  }
  const bytes = downloaded.value.bytes;
  // 元数据说有字节、实收 0：这是空文件而不是「解析失败」，说清楚它是空的。
  if (bytes.byteLength === 0) return fallback(asset, version, 'emptyContent');

  const parse = dependencies.parseDocument ?? parseLocalDocument;
  let document: LocalDocumentParseResult;
  try {
    document = await parse({
      fileName: version.filename,
      // ⚠️ 用**冻结在版本行上的** mime，不用按文件名重算的那一个：重算会把
      //    「声明类型与扩展名不符」这个信号抹掉（解析栈正是靠它 + 文件头魔数判伪装）。
      mimeType: version.mime,
      bytes,
      selector: normalized.selector,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (SELECTOR_PARSER_CODES.has(code)) return { ok: false, code: 'invalidRequest' };
    return fallback(asset, version, FALLBACK_BY_PARSER_CODE[code] ?? 'parseFailed');
  }

  // ⭐ 解析成功但一个字都没取到（扫描件 PDF / 纯图片幻灯）：**不是**可用的文本预览。
  //    这一条是「不能静默空白」的落点——写成 content:'' 的话界面就是一片空白面板。
  if (document.content.trim().length === 0) return fallback(asset, version, 'parseFailed');

  return {
    ok: true,
    asset,
    version,
    preview: {
      kind: 'text',
      format: document.format,
      content: document.content,
      selectedRange: document.selectedRange,
      // 服务端/解析器数出来的计数：⛔ 不设上界、不重算、不裁剪。
      locatorCoverage: document.locatorCoverage,
      truncated: document.truncated,
      nextSelector: document.nextSelector === null ? null : { ...document.nextSelector },
      // 复制一份而不是把解析栈那个只读数组直接交出去：出参要能过 schema（可变数组），
      // 而解析结果本身不该被下游改。
      ignoredSelectors: [...normalized.ignored],
    },
  };
}

function fallback(
  asset: ProjectAssetVersionResolution['asset'],
  version: ProjectAssetVersionResolution['version'],
  reason: ProjectAssetPreviewFallbackReason,
): ProjectAssetPreviewOutcome {
  return { ok: true, asset, version, preview: { kind: 'fallback', reason } };
}

/** 把请求里的定位键挑出来交给 `normalizeDocumentSelector`（它负责剔除不适用的键）。 */
function pickLocators(request: ProjectAssetVersionPreviewRequest): {
  readonly [K in keyof LocalDocumentSelector]?: number | undefined;
} {
  const locators: Record<string, number> = {};
  for (const key of LOCATOR_KEYS) {
    const value = request[key];
    if (value !== undefined) locators[key] = value;
  }
  return locators;
}
