import { open, readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Worker } from 'node:worker_threads';

import * as unzipper from 'unzipper';

export type LocalDocumentEngine = 'native';
// html 是纯文本类：解析链只做「去标签取正文」，无页/块/行定位（读整篇，见 stripHtml）。
export type LocalDocumentFormat =
  'pdf' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'md' | 'csv' | 'json' | 'html';

export interface LocalDocumentParseInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /**
   * 与文件入口 `parseLocalDocumentFile` 同义的可选**定位选择器**（不带＝默认从头读）。存在的意义是
   * 让「超预算文档第二条路」在**已校验字节**上按 `page`/`slide`/`sheet` 定点续读——不再交路径给
   * 解析器二次开盘（后者绕过 O_NOFOLLOW/身份复核）。`aggregate:true` 时忽略它（聚合遍历全部单元）。
   */
  readonly selector?: LocalDocumentSelector;
  /**
   * 与文件入口 `parseLocalDocumentFile` 同义的可选聚合开关：不带（默认）时行为逐字不变，
   * 资料库入库调用方不受影响；带 `aggregate:true` 时对 pdf/docx/pptx/xlsx 在同一次解析内
   * 遍历全部定位单元并按 `maxOutputChars` 收口。文本/HTML 本就整篇读取，对它们是空操作。
   */
  readonly aggregate?: boolean;
}

export interface LocalDocumentSelector {
  readonly startLine?: number;
  readonly maxLines?: number;
  readonly startChar?: number;
  readonly page?: number;
  readonly slide?: number;
  readonly sheet?: number;
  readonly block?: number;
}

export interface LocalDocumentBudgets {
  readonly maxInputBytes: number;
  readonly maxZipEntries: number;
  readonly maxZipCompressedBytes: number;
  readonly maxZipEntryBytes: number;
  readonly maxZipExpandedBytes: number;
  readonly maxCompressionRatio: number;
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
}

export interface LocalDocumentParseResult {
  readonly text: string;
  readonly content: string;
  readonly format: LocalDocumentFormat;
  readonly engine: LocalDocumentEngine;
  readonly warnings: readonly string[];
  readonly locatorCoverage: Readonly<Record<string, number>>;
  readonly selectedRange: string;
  readonly truncated: boolean;
  readonly nextSelector: LocalDocumentSelector | null;
}

export const PROJECT_DOCUMENT_PARSE_BUDGETS: LocalDocumentBudgets = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxZipEntries: 2_000,
  maxZipCompressedBytes: 64 * 1024 * 1024,
  maxZipEntryBytes: 8 * 1024 * 1024,
  maxZipExpandedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
  timeoutMs: 15_000,
  maxOutputChars: 48 * 1024,
});

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

export function projectDocumentMimeType(fileName: string): string {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/** 兼容本机资料库的有界 bytes 入口；解析栈与项目文件读取共用，不复制实现。 */
export async function parseLocalDocument(
  input: LocalDocumentParseInput,
): Promise<LocalDocumentParseResult> {
  if (input.bytes.byteLength === 0) throw new Error('DOCUMENT_INVALID');
  if (input.bytes.byteLength > PROJECT_DOCUMENT_PARSE_BUDGETS.maxInputBytes) {
    throw new Error('DOCUMENT_PARSE_SIZE_LIMIT');
  }
  const extension = extname(input.fileName).toLowerCase();
  const mimeType = input.mimeType.toLowerCase();
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/') || isAudioVideo(extension)) {
    throw new Error('本地解析暂不支持音视频');
  }
  if (mimeType.startsWith('image/') || /^\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/u.test(extension)) {
    throw new Error('本地解析暂不支持图片');
  }
  if (extension === '.html' || extension === '.htm' || mimeType === 'text/html') {
    const content = boundContent(
      stripHtml(decodeUtf8(input.bytes)),
      PROJECT_DOCUMENT_PARSE_BUDGETS,
    );
    return result('html', content, 'document', 1, false, null);
  }
  validateFormat(extension, mimeType, input.bytes.subarray(0, 8));
  const format = formatForExtension(extension);
  const aggregate = input.aggregate === true;
  // 定位选择器与文件入口同义；聚合时忽略（聚合遍历全部单元）。缺省 `{}` 使既有 bytes 调用方
  // （资料库入库、002 聚合送达）逐字不变；带选择器时先经与文件入口同一套 `validateSelector`。
  const selector = aggregate ? {} : (input.selector ?? {});
  validateSelector(format, selector);
  if (format === 'pdf') {
    return parseHeavyDocument({
      bytes: input.bytes,
      format,
      selector,
      budgets: PROJECT_DOCUMENT_PARSE_BUDGETS,
      aggregate,
    });
  }
  if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
    const directory = await unzipper.Open.buffer(Buffer.from(input.bytes));
    const deadline = Date.now() + PROJECT_DOCUMENT_PARSE_BUDGETS.timeoutMs;
    if (format === 'xlsx') {
      await validateOfficeDirectory(directory, format, PROJECT_DOCUMENT_PARSE_BUDGETS, deadline);
      return parseHeavyDocument({
        bytes: input.bytes,
        format,
        selector,
        budgets: PROJECT_DOCUMENT_PARSE_BUDGETS,
        aggregate,
      });
    }
    return parseOfficeDirectory(
      directory,
      format,
      PROJECT_DOCUMENT_PARSE_BUDGETS,
      selector,
      deadline,
      aggregate,
    );
  }
  return parseTextValue(
    decodeUtf8Strict(input.bytes),
    format,
    PROJECT_DOCUMENT_PARSE_BUDGETS,
    selector,
  );
}

/**
 * Main 私有临时文件入口：先 stat/头部判型，再按格式走各自独立预算。
 *
 * `aggregate` 为纯增量的可选开关：不带（默认）时行为逐字不变，`read_document` 动态工具与
 * 资料库入库两条既有调用方不受影响。带 `aggregate:true` 时对 pdf/docx/pptx/xlsx 在**同一次**
 * worker 调用内遍历全部定位单元并拼接（每单元前加紧凑单元头），按 `budgets.maxOutputChars`
 * 收口：全覆盖 `truncated=false`、`nextSelector=null`；因预算提前停则 `truncated=true`、
 * `nextSelector` 指向下一个未覆盖单元。文本/HTML 本就整篇读取，`aggregate` 对它们是空操作。
 */
export async function parseLocalDocumentFile(input: {
  readonly filePath: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly selector?: LocalDocumentSelector;
  readonly budgets?: LocalDocumentBudgets;
  readonly aggregate?: boolean;
}): Promise<LocalDocumentParseResult> {
  const budgets = input.budgets ?? PROJECT_DOCUMENT_PARSE_BUDGETS;
  const info = await stat(input.filePath);
  if (!info.isFile() || info.size <= 0) throw new Error('DOCUMENT_INVALID');
  if (info.size > budgets.maxInputBytes) throw new Error('DOCUMENT_PARSE_SIZE_LIMIT');
  const headerHandle = await open(input.filePath, 'r');
  let header: Buffer;
  try {
    header = Buffer.alloc(Math.min(8, info.size));
    await headerHandle.read(header, 0, header.length, 0);
  } finally {
    await headerHandle.close();
  }
  const extension = extname(input.fileName).toLowerCase();
  const mimeType = input.mimeType.toLowerCase().split(';')[0]!;
  // html 靠后缀/内容类型判型，走「去标签取正文」整篇读——与 parseLocalDocument 的
  // bytes 入口同一分支（此前只有 bytes 入口有它，文件入口漏了，项目 HTML 资产因此
  // 一律 FORMAT_MISMATCH → 「文件不可读」）。size 已在上方按预算校验过。
  if (extension === '.html' || extension === '.htm' || mimeType === 'text/html') {
    const content = boundContent(stripHtml(decodeUtf8(await readFile(input.filePath))), budgets);
    return result('html', content, 'document', 1, false, null);
  }
  validateFormat(extension, mimeType, header);
  const format = formatForExtension(extension);
  validateSelector(format, input.selector ?? {});
  const deadline = Date.now() + budgets.timeoutMs;
  const aggregate = input.aggregate === true;
  if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
    const directory = await withinDeadline(unzipper.Open.file(input.filePath), deadline);
    if (format === 'xlsx') {
      await validateOfficeDirectory(directory, format, budgets, deadline);
      return parseHeavyDocument({
        filePath: input.filePath,
        format,
        selector: input.selector ?? {},
        budgets,
        aggregate,
      });
    }
    return parseOfficeDirectory(
      directory,
      format,
      budgets,
      input.selector ?? {},
      deadline,
      aggregate,
    );
  }
  if (format === 'pdf') {
    return parseHeavyDocument({
      filePath: input.filePath,
      format,
      selector: input.selector ?? {},
      budgets,
      aggregate,
    });
  }
  return parseTextFile(input.filePath, format, budgets, input.selector ?? {}, deadline);
}

function validateFormat(extension: string, mimeType: string, header: Uint8Array): void {
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (!expectedMime || mimeType !== expectedMime) throw new Error('DOCUMENT_FORMAT_MISMATCH');
  const zip = ['.docx', '.xlsx', '.pptx'].includes(extension);
  if (
    zip &&
    !(header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04)
  )
    throw new Error('DOCUMENT_MAGIC_MISMATCH');
  if (extension === '.pdf' && Buffer.from(header).toString('ascii', 0, 5) !== '%PDF-') {
    throw new Error('DOCUMENT_MAGIC_MISMATCH');
  }
  if (!zip && extension !== '.pdf' && header.includes(0))
    throw new Error('DOCUMENT_BINARY_DISGUISE');
}

// html/htm 不进 MIME_BY_EXTENSION（走上游各入口的 html 分支），故此处永不返回 'html'——
// 排除掉，下游 pdf/office 守卫后 format 才能收敛到 txt/md/csv/json 交给文本解析器。
function formatForExtension(extension: string): Exclude<LocalDocumentFormat, 'html'> {
  if (!(extension in MIME_BY_EXTENSION)) throw new Error('DOCUMENT_UNSUPPORTED');
  return extension.slice(1) as Exclude<LocalDocumentFormat, 'html'>;
}

async function parseTextFile(
  filePath: string,
  format: Extract<LocalDocumentFormat, 'txt' | 'md' | 'csv' | 'json'>,
  budgets: LocalDocumentBudgets,
  selector: LocalDocumentSelector,
  deadline: number,
): Promise<LocalDocumentParseResult> {
  const handle = await open(filePath, 'r');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const start = Math.max(1, selector.startLine ?? 1);
  const maxLines = Math.max(1, Math.min(selector.maxLines ?? 500, 5_000));
  const startChar = Math.max(1, selector.startChar ?? 1);
  const selected: string[] = [];
  const structuredChunks: string[] = [];
  let pending = '';
  let totalLines = 0;
  let outputChars = 0;
  let selectionOverflow = false;
  let nextSelector: LocalDocumentSelector | null = null;
  let position = 0;
  const acceptLine = (line: string): void => {
    totalLines += 1;
    if (totalLines < start || selected.length >= maxLines || selectionOverflow) return;
    const lineStartChar = totalLines === start ? startChar : 1;
    if (lineStartChar > line.length + 1) throw new Error('DOCUMENT_SELECTOR_RANGE');
    const selectedLine = line.slice(lineStartChar - 1);
    const separator = selected.length === 0 ? 0 : 1;
    if (outputChars + separator + selectedLine.length > budgets.maxOutputChars) {
      const remaining = Math.max(0, budgets.maxOutputChars - outputChars - separator);
      const partial = safePrefix(selectedLine, remaining);
      if (partial.length > 0) selected.push(partial);
      nextSelector = {
        startLine: totalLines,
        startChar: lineStartChar + partial.length,
        maxLines,
      };
      selectionOverflow = true;
      return;
    }
    selected.push(selectedLine);
    outputChars += separator + selectedLine.length;
  };
  try {
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      assertDeadline(deadline);
      const read = await handle.read(buffer, 0, buffer.length, position);
      if (read.bytesRead === 0) break;
      const slice = buffer.subarray(0, read.bytesRead);
      if (slice.includes(0)) throw new Error('DOCUMENT_BINARY_DISGUISE');
      const decoded = decoder.decode(slice, { stream: true });
      rejectBinaryText(decoded);
      if (format === 'json' || format === 'csv') {
        if (position + read.bytesRead > budgets.maxZipEntryBytes) {
          throw new Error('DOCUMENT_STRUCTURED_PARSE_LIMIT');
        }
        structuredChunks.push(decoded);
      }
      const parts = `${pending}${decoded}`.split(/\r\n|\n|\r/u);
      pending = parts.pop() ?? '';
      for (const line of parts) acceptLine(line);
      position += read.bytesRead;
    }
    const tail = decoder.decode();
    if (format === 'json' || format === 'csv') structuredChunks.push(tail);
    pending += tail;
    const finalText = pending.replace(/^\uFEFF/u, '');
    rejectBinaryText(finalText);
    acceptLine(finalText);
    if (format === 'json') JSON.parse(structuredChunks.join(''));
    if (format === 'csv') validateCsv(structuredChunks.join(''));
  } catch (error) {
    if (error instanceof TypeError) throw new Error('DOCUMENT_INVALID_UTF8');
    throw error;
  } finally {
    await handle.close();
  }
  if (start > totalLines) throw new Error('DOCUMENT_SELECTOR_RANGE');
  const content = selected.join('\n');
  const end = selected.length === 0 ? Math.min(start, totalLines) : start + selected.length - 1;
  const truncated = selectionOverflow || end < totalLines;
  return result(
    format,
    content,
    `lines:1-${totalLines}`,
    totalLines,
    truncated,
    truncated ? (nextSelector ?? { startLine: end + 1, maxLines }) : null,
    `lines:${start}-${end}`,
  );
}

function parseTextValue(
  value: string,
  format: Extract<LocalDocumentFormat, 'txt' | 'md' | 'csv' | 'json'>,
  budgets: LocalDocumentBudgets,
  selector: LocalDocumentSelector,
): LocalDocumentParseResult {
  if (format === 'json') JSON.parse(value);
  if (format === 'csv') validateCsv(value);
  rejectBinaryText(value);
  const lines = value.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  const start = Math.max(1, selector.startLine ?? 1);
  const maxLines = Math.max(1, Math.min(selector.maxLines ?? 500, 5_000));
  const selected = lines.slice(start - 1, start - 1 + maxLines).join('\n');
  const bounded = boundContent(selected, budgets);
  const consumedLines = Math.max(1, bounded.split('\n').length);
  const end = Math.min(lines.length, start + consumedLines - 1);
  const truncated = end < lines.length || bounded.length < selected.length;
  return result(
    format,
    bounded,
    `lines:1-${lines.length}`,
    lines.length,
    truncated,
    truncated ? { startLine: end + 1, maxLines } : null,
    `lines:${start}-${end}`,
  );
}

async function parseOfficeDirectory(
  directory: unzipper.CentralDirectory,
  format: Extract<LocalDocumentFormat, 'docx' | 'pptx'>,
  budgets: LocalDocumentBudgets,
  selector: LocalDocumentSelector,
  deadline: number,
  aggregate = false,
): Promise<LocalDocumentParseResult> {
  await validateOfficeDirectory(directory, format, budgets, deadline);
  const pattern = format === 'docx' ? /^word\/document\.xml$/u : /^ppt\/slides\/slide(\d+)\.xml$/u;
  const entries = directory.files
    .filter((entry) => entry.type === 'File' && pattern.test(entry.path))
    .sort((left, right) => numericEntryIndex(left.path) - numericEntryIndex(right.path));
  if (entries.length === 0) throw new Error('DOCUMENT_OFFICE_CORRUPT');
  if (aggregate) {
    // docx：全部 <w:p> 段落本就在同一份 document.xml 内，worker 拿整份自行拆块聚合。
    if (format === 'docx') {
      assertDeadline(deadline);
      return parseHeavyDocument({
        bytes: await readZipEntryBounded(entries[0]!, budgets, deadline),
        format,
        selector: {},
        budgets,
        aggregate: true,
      });
    }
    // pptx：每张幻灯片是独立 zip 条目，在此按序读齐后交给 worker 在一次调用内遍历。
    const unitBytes: Uint8Array[] = [];
    for (const slide of entries) {
      assertDeadline(deadline);
      unitBytes.push(await readZipEntryBounded(slide, budgets, deadline));
    }
    return parseHeavyDocument({
      format,
      selector: {},
      budgets,
      aggregate: true,
      unitBytes,
      unitCount: entries.length,
    });
  }
  const requested = format === 'docx' ? selector.block : selector.slide;
  const index = requested ?? 1;
  if (!Number.isInteger(index) || index < 1) throw new Error('DOCUMENT_SELECTOR_RANGE');
  const entry = entries[format === 'docx' ? 0 : index - 1];
  if (!entry) throw new Error('DOCUMENT_SELECTOR_RANGE');
  assertDeadline(deadline);
  return parseHeavyDocument({
    bytes: await readZipEntryBounded(entry, budgets, deadline),
    format,
    selector,
    budgets,
    unitCount: entries.length,
    unitIndex: index,
  });
}

async function validateOfficeDirectory(
  directory: unzipper.CentralDirectory,
  format: Extract<LocalDocumentFormat, 'docx' | 'pptx' | 'xlsx'>,
  budgets: LocalDocumentBudgets,
  deadline: number,
): Promise<void> {
  validateArchive(directory.files, budgets);
  await validateOfficePackage(directory.files, format, budgets, deadline);
}

function validateArchive(files: readonly unzipper.File[], budgets: LocalDocumentBudgets): void {
  if (files.length === 0 || files.length > budgets.maxZipEntries)
    throw new Error('DOCUMENT_ZIP_ENTRIES_LIMIT');
  const paths = new Set<string>();
  let compressed = 0;
  let expanded = 0;
  for (const entry of files) {
    validateArchivePath(entry.path, entry.type);
    if (paths.has(entry.path)) throw new Error('DOCUMENT_ZIP_DUPLICATE_ENTRY');
    paths.add(entry.path);
    if ((entry.flags & 0x01) !== 0) throw new Error('DOCUMENT_ZIP_ENCRYPTED');
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
      throw new Error('DOCUMENT_ZIP_COMPRESSION_UNSUPPORTED');
    if (entry.type !== 'File') continue;
    if (
      !Number.isSafeInteger(entry.compressedSize) ||
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.compressedSize < 0 ||
      entry.uncompressedSize < 0
    ) {
      throw new Error('DOCUMENT_ZIP_SIZE_INVALID');
    }
    compressed += entry.compressedSize;
    if (compressed > budgets.maxZipCompressedBytes)
      throw new Error('DOCUMENT_ZIP_COMPRESSED_LIMIT');
    if (entry.uncompressedSize > budgets.maxZipEntryBytes)
      throw new Error('DOCUMENT_ZIP_ENTRY_LIMIT');
    expanded += entry.uncompressedSize;
    if (expanded > budgets.maxZipExpandedBytes) throw new Error('DOCUMENT_ZIP_EXPANDED_LIMIT');
    const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
    if (ratio > budgets.maxCompressionRatio) throw new Error('DOCUMENT_ZIP_RATIO_LIMIT');
  }
}

async function validateOfficePackage(
  files: readonly unzipper.File[],
  format: Extract<LocalDocumentFormat, 'docx' | 'pptx' | 'xlsx'>,
  budgets: LocalDocumentBudgets,
  deadline: number,
): Promise<void> {
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const required =
    format === 'docx'
      ? ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
      : format === 'pptx'
        ? ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']
        : ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'];
  for (const path of required) {
    if (byPath.get(path)?.type !== 'File') throw new Error('DOCUMENT_OFFICE_CORRUPT');
  }
  const contentTypes = (
    await readZipEntryBounded(byPath.get('[Content_Types].xml')!, budgets, deadline)
  ).toString('utf8');
  const relationships = (
    await readZipEntryBounded(byPath.get('_rels/.rels')!, budgets, deadline)
  ).toString('utf8');
  const expected =
    format === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      : format === 'pptx'
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  if (
    !/<Types\b/u.test(contentTypes) ||
    !/<Relationships\b/u.test(relationships) ||
    !contentTypes.includes(expected)
  )
    throw new Error('DOCUMENT_OFFICE_CORRUPT');
}

function validateArchivePath(path: string, type: unzipper.File['type']): void {
  if (
    !path ||
    path.length > 4_096 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[a-z]:/iu.test(path) ||
    path.includes('//') ||
    (type === 'File' && path.endsWith('/')) ||
    (type === 'Directory' && !path.endsWith('/'))
  ) {
    throw new Error('DOCUMENT_ZIP_PATH_INVALID');
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('DOCUMENT_ZIP_PATH_INVALID');
  }
}

const TEXT_SELECTOR_KEYS = ['startLine', 'maxLines', 'startChar'] as const;

/**
 * 各格式认哪些定位参数——唯一一张表，`validateSelector` 与 `normalizeDocumentSelector` 共用。
 * `startChar` 全格式通用：它是**所选那一行/页/块内**的 1 起字符偏移，不是文件字节偏移。
 */
const SELECTOR_KEYS_BY_FORMAT: Record<LocalDocumentFormat, readonly LocalDocumentSelectorKey[]> = {
  pdf: ['page', 'startChar'],
  docx: ['block', 'startChar'],
  pptx: ['slide', 'startChar'],
  xlsx: ['sheet', 'startChar'],
  txt: TEXT_SELECTOR_KEYS,
  md: TEXT_SELECTOR_KEYS,
  csv: TEXT_SELECTOR_KEYS,
  json: TEXT_SELECTOR_KEYS,
  // html 读整篇、无定位：任何定位键都不适用，会被 normalizeDocumentSelector 剔除并回报。
  html: [],
};

export type LocalDocumentSelectorKey = keyof LocalDocumentSelector;

export interface NormalizedDocumentSelector {
  /** 只剩该格式认的、且非零的键。 */
  readonly selector: LocalDocumentSelector;
  /** 被剔除的键（对该格式没有意义），调用方原样回给模型，让它下次别再带。 */
  readonly ignored: readonly LocalDocumentSelectorKey[];
}

/** 文件名后缀 → 格式；不在支持表里返回 null（调用方决定怎么报）。 */
export function documentFormatForFileName(fileName: string): LocalDocumentFormat | null {
  const extension = extname(fileName).toLowerCase();
  // html 不进 MIME_BY_EXTENSION（那张表喂 pdf/office/文本机器），单列到位，.htm 归一到 html。
  if (extension === '.html' || extension === '.htm') return 'html';
  if (!(extension in MIME_BY_EXTENSION)) return null;
  return extension.slice(1) as LocalDocumentFormat;
}

/**
 * 按格式收敛模型给的定位参数：不适用的键**剔除并列出**，而不是整次拒掉。
 *
 * 2026-09-04 现场：模型读 .md 时把 page/slide/sheet/block 全带上（多数填 0），
 * 严格校验一律 MISMATCH → 兜底文案说「文件不可读」→ 模型换个参数再试 → 循环护栏
 * 把整轮停掉。0 与 undefined 一律视为「没给」；`format` 为 null（后缀不认识）时
 * 只剔零不剔键，让后面的格式判定去报「不支持」。
 */
export function normalizeDocumentSelector(
  format: LocalDocumentFormat | null,
  // 入参放宽到「键可带 undefined」：调用方直接把 zod 解出的可选字段铺进来即可。
  selector: { readonly [K in LocalDocumentSelectorKey]?: number | undefined },
): NormalizedDocumentSelector {
  const allowed = format === null ? null : new Set<string>(SELECTOR_KEYS_BY_FORMAT[format]);
  const kept: Record<string, number> = {};
  const ignored: LocalDocumentSelectorKey[] = [];
  for (const [key, value] of Object.entries(selector)) {
    if (value === undefined || value === 0) continue;
    if (allowed === null || allowed.has(key)) kept[key] = value;
    else ignored.push(key as LocalDocumentSelectorKey);
  }
  return { selector: kept, ignored };
}

function validateSelector(format: LocalDocumentFormat, selector: LocalDocumentSelector): void {
  const supplied = Object.entries(selector)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const allowed = new Set<string>(SELECTOR_KEYS_BY_FORMAT[format]);
  if (supplied.some((key) => !allowed.has(key))) throw new Error('DOCUMENT_SELECTOR_MISMATCH');
}

async function readZipEntryBounded(
  entry: unzipper.File,
  budgets: LocalDocumentBudgets,
  deadline: number,
): Promise<Buffer> {
  const stream = entry.stream();
  const chunks: Buffer[] = [];
  let total = 0;
  let crc = 0xffffffff;
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    stream.destroy();
    throw new Error('DOCUMENT_PARSE_TIMEOUT');
  }
  const timer = setTimeout(() => stream.destroy(new Error('DOCUMENT_PARSE_TIMEOUT')), remaining);
  timer.unref?.();
  try {
    for await (const value of stream) {
      assertDeadline(deadline);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      total += chunk.length;
      if (total > budgets.maxZipEntryBytes) throw new Error('DOCUMENT_ZIP_ENTRY_LIMIT');
      crc = updateCrc32(crc, chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (total !== entry.uncompressedSize) throw new Error('DOCUMENT_OFFICE_CORRUPT');
  if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32 >>> 0) throw new Error('DOCUMENT_OFFICE_CORRUPT');
  return Buffer.concat(chunks, total);
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function updateCrc32(initial: number, bytes: Uint8Array): number {
  let crc = initial;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return crc >>> 0;
}

function result(
  format: LocalDocumentParseResult['format'],
  content: string,
  coverage: string,
  count: number,
  truncated: boolean,
  nextSelector: LocalDocumentSelector | null,
  selectedRange = coverage,
): LocalDocumentParseResult {
  return {
    text: content,
    content,
    format,
    engine: 'native',
    warnings: [],
    locatorCoverage: { [coverage.split(':')[0]!]: count },
    selectedRange,
    truncated,
    nextSelector,
  };
}

interface HeavyDocumentWorkerInput {
  readonly filePath?: string;
  readonly bytes?: Uint8Array;
  readonly format: Extract<LocalDocumentFormat, 'pdf' | 'docx' | 'pptx' | 'xlsx'>;
  readonly selector: LocalDocumentSelector;
  readonly budgets: LocalDocumentBudgets;
  readonly unitCount?: number;
  readonly unitIndex?: number;
  // 聚合模式：worker 在一次调用内遍历全部定位单元；不带时逐字走既有单单元路径。
  readonly aggregate?: boolean;
  // pptx 聚合专用：各幻灯片的 XML 字节（主进程已按序读齐，worker 逐张拼接）。
  readonly unitBytes?: readonly Uint8Array[];
}

interface HeavyDocumentWorkerMessage {
  readonly ok: boolean;
  readonly result?: LocalDocumentParseResult;
  readonly error?: string;
}

function parseHeavyDocument(input: HeavyDocumentWorkerInput): Promise<LocalDocumentParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./localDocumentParserWorker.js', import.meta.url), {
      workerData: input,
    });
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().finally(complete);
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('DOCUMENT_PARSE_TIMEOUT')));
    }, input.budgets.timeoutMs);
    timer.unref?.();
    worker.on('message', (message: HeavyDocumentWorkerMessage) => {
      if (message.ok && message.result) {
        finish(() => resolve(message.result!));
        return;
      }
      const code =
        typeof message.error === 'string' && /^DOCUMENT_[A-Z0-9_]+$/u.test(message.error)
          ? message.error
          : 'DOCUMENT_PARSE_WORKER_FAILED';
      finish(() => reject(new Error(code)));
    });
    worker.on('error', () => {
      finish(() => reject(new Error('DOCUMENT_PARSE_WORKER_FAILED')));
    });
    worker.on('exit', () => {
      finish(() => reject(new Error('DOCUMENT_PARSE_WORKER_FAILED')));
    });
  });
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/u, '');
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error('DOCUMENT_BINARY_DISGUISE');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('DOCUMENT_INVALID_UTF8');
  }
}

function stripHtml(value: string): string {
  return stripXml(
    value
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, ' '),
  );
}

function stripXml(value: string): string {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/gu, ' ')
    .trim();
}

function boundContent(value: string, budgets: LocalDocumentBudgets): string {
  return value.length <= budgets.maxOutputChars ? value : value.slice(0, budgets.maxOutputChars);
}

function safePrefix(value: string, maxChars: number): string {
  let end = Math.max(0, Math.min(value.length, maxChars));
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

function rejectBinaryText(value: string): void {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    throw new Error('DOCUMENT_BINARY_DISGUISE');
  }
}

function validateCsv(value: string): void {
  let inQuotes = false;
  let afterQuote = false;
  let atFieldStart = true;
  for (const character of value) {
    if (inQuotes) {
      if (character === '"') {
        inQuotes = false;
        afterQuote = true;
      }
      continue;
    }
    if (afterQuote) {
      if (character === '"') {
        inQuotes = true;
        afterQuote = false;
      } else if (character === ',' || character === '\r' || character === '\n') {
        afterQuote = false;
        atFieldStart = true;
      } else {
        throw new Error('DOCUMENT_CSV_INVALID');
      }
      continue;
    }
    if (character === '"') {
      if (!atFieldStart) throw new Error('DOCUMENT_CSV_INVALID');
      inQuotes = true;
      atFieldStart = false;
    } else if (character === ',' || character === '\r' || character === '\n') {
      atFieldStart = true;
    } else {
      atFieldStart = false;
    }
  }
  if (inQuotes) throw new Error('DOCUMENT_CSV_INVALID');
}

function numericEntryIndex(path: string): number {
  return Number(/(\d+)\.xml$/u.exec(path)?.[1] ?? 0);
}

function isAudioVideo(extension: string): boolean {
  return /\.(?:aac|flac|m4a|mp3|ogg|wav|webm|avi|mkv|mov|mp4|mpeg|mpg)$/u.test(extension);
}

function assertDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new Error('DOCUMENT_PARSE_TIMEOUT');
}

async function withinDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('DOCUMENT_PARSE_TIMEOUT');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DOCUMENT_PARSE_TIMEOUT')), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function localDocumentTitle(fileName: string): string {
  return basename(fileName, extname(fileName));
}
