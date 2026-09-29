import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('DOCUMENT_WORKER_CHANNEL_MISSING');

try {
  let parsed;
  // pptx 聚合的幻灯片字节由主进程铺进 unitBytes，无单一 bytes 载体，单列一支。
  if (workerData.aggregate && workerData.format === 'pptx') {
    parsed = await aggregatePptx(workerData);
  } else {
    const bytes =
      typeof workerData.filePath === 'string'
        ? new Uint8Array(await readFile(workerData.filePath))
        : new Uint8Array(workerData.bytes);
    if (bytes.byteLength === 0) throw new Error('DOCUMENT_INVALID');
    if (bytes.byteLength > workerData.budgets.maxInputBytes) {
      throw new Error('DOCUMENT_PARSE_SIZE_LIMIT');
    }
    parsed = workerData.aggregate
      ? workerData.format === 'pdf'
        ? await aggregatePdf(bytes, workerData.budgets)
        : workerData.format === 'xlsx'
          ? await aggregateXlsx(bytes, workerData.budgets)
          : await aggregateDocx(bytes, workerData.budgets)
      : workerData.format === 'pdf'
        ? await parsePdf(bytes, workerData.selector, workerData.budgets)
        : workerData.format === 'xlsx'
          ? await parseXlsxWorkbook(bytes, workerData.selector, workerData.budgets)
          : parseOfficeXml(bytes, workerData);
  }
  parentPort.postMessage({ ok: true, result: parsed });
} catch (error) {
  parentPort.postMessage({ ok: false, error: parserErrorCode(error, workerData.format) });
}

async function parsePdf(bytes, selector, budgets) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    const pageNumber = selector.page ?? 1;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
      throw new Error('DOCUMENT_SELECTOR_RANGE');
    }
    const page = await document.getPage(pageNumber);
    try {
      const raw = await extractPdfPageText(page);
      if (!raw || !/[\p{L}\p{N}]/u.test(raw)) throw new Error('DOCUMENT_PDF_NO_TEXT_LAYER');
      const startChar = selector.startChar ?? 1;
      const selected = boundedSelection(raw, startChar, budgets.maxOutputChars);
      const hasNextPage = pageNumber < document.numPages;
      return makeResult(
        'pdf',
        selected.content,
        'pages',
        document.numPages,
        selected.truncated || hasNextPage,
        selected.truncated
          ? { page: pageNumber, startChar: selected.nextChar }
          : hasNextPage
            ? { page: pageNumber + 1 }
            : null,
        `page:${pageNumber} chars:${startChar}-${selected.endChar}`,
      );
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function parseXlsxWorkbook(bytes, selector, budgets) {
  const [{ openXlsxWorkbook, parseXlsx }, { default: SSF }] = await Promise.all([
    import('@silurus/ooxml/node'),
    import('ssf'),
  ]);
  const workbookIndex = parseXlsx(bytes);
  if (workbookIndex.workbook.parseError) throw new Error('DOCUMENT_OFFICE_CORRUPT');
  const session = await openXlsxWorkbook(bytes, {
    resourceLimits: {
      maxArchiveEntryBytes: budgets.maxZipEntryBytes,
      maxTotalInflatedBytes: budgets.maxZipExpandedBytes,
    },
  });
  try {
    const sheetNumber = selector.sheet ?? 1;
    if (!Number.isInteger(sheetNumber) || sheetNumber < 1 || sheetNumber > session.sheetCount) {
      throw new Error('DOCUMENT_SELECTOR_RANGE');
    }
    const sheetName = sheetNameOrThrow(session, workbookIndex, sheetNumber);
    const raw = await extractSheetRows(session, sheetNumber - 1, workbookIndex, SSF);
    if (!raw) throw new Error('DOCUMENT_OFFICE_NO_TEXT');
    const startChar = selector.startChar ?? 1;
    const selected = boundedSelection(raw, startChar, budgets.maxOutputChars);
    const hasNextSheet = sheetNumber < session.sheetCount;
    return makeResult(
      'xlsx',
      selected.content,
      'sheets',
      session.sheetCount,
      selected.truncated || hasNextSheet,
      selected.truncated
        ? { sheet: sheetNumber, startChar: selected.nextChar }
        : hasNextSheet
          ? { sheet: sheetNumber + 1 }
          : null,
      `sheet:${sheetNumber} name:${sheetName} chars:${startChar}-${selected.endChar}`,
    );
  } finally {
    await session.close();
  }
}

function parseOfficeXml(bytes, input) {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const blocks =
    input.format === 'docx'
      ? Array.from(xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/giu), (match) =>
          stripXml(match[0]),
        ).filter(Boolean)
      : [stripXml(xml)];
  const unitIndex = input.unitIndex;
  const raw = blocks[input.format === 'docx' ? unitIndex - 1 : 0];
  if (!raw) throw new Error('DOCUMENT_OFFICE_NO_TEXT');
  const startChar = input.selector.startChar ?? 1;
  const selected = boundedSelection(raw, startChar, input.budgets.maxOutputChars);
  const kind = input.format === 'docx' ? 'block' : 'slide';
  const unitCount = input.format === 'docx' ? blocks.length : input.unitCount;
  const hasNextUnit = unitIndex < unitCount;
  return makeResult(
    input.format,
    selected.content,
    `${kind}s`,
    unitCount,
    selected.truncated || hasNextUnit,
    selected.truncated
      ? { [kind]: unitIndex, startChar: selected.nextChar }
      : hasNextUnit
        ? { [kind]: unitIndex + 1 }
        : null,
    `${kind}:${unitIndex} chars:${startChar}-${selected.endChar}`,
  );
}

/** 单页正文抽取——单页与聚合两条路复用同一表达式，保证输出逐字一致。 */
async function extractPdfPageText(page) {
  const textContent = await page.getTextContent({ disableNormalization: false });
  return textContent.items
    .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
    .join('')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

function sheetNameOrThrow(session, workbookIndex, sheetNumber) {
  const sheetName = session.sheetNames[sheetNumber - 1];
  if (!sheetName || workbookIndex.workbook.sheets[sheetNumber - 1]?.name !== sheetName) {
    throw new Error('DOCUMENT_OFFICE_CORRUPT');
  }
  return sheetName;
}

/** 单表行文本抽取（0 起 sheet 下标）——单表与聚合两条路复用，保证输出逐字一致。 */
async function extractSheetRows(session, sheetIndex, workbookIndex, SSF) {
  const lines = [];
  for await (const chunk of session.worksheetRows(sheetIndex)) {
    if (chunk.kind !== 'rows') continue;
    for (const row of chunk.rows) {
      const cells = row.cells.filter((cell) => cell.value.type !== 'empty');
      if (cells.length === 0) continue;
      const lastColumn = cells.at(-1)?.col ?? 0;
      const values = Array.from({ length: lastColumn }, () => '');
      for (const cell of cells) {
        values[cell.col - 1] = displayCellValue(
          cell,
          workbookIndex.styles,
          workbookIndex.workbook.date1904 === true,
          SSF,
        );
      }
      lines.push(values.join('\t'));
    }
  }
  return lines.join('\n').trim();
}

/**
 * 聚合：同一份已加载文档内**惰性**遍历页，预算填满即停止取页——不再对后续页调
 * `getPage`/`extractPdfPageText`，因此大 PDF 不会把全部页正文同时解进堆。
 */
async function aggregatePdf(bytes, budgets) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    const total = document.numPages;
    const aggregated = await aggregateUnits(
      pdfPageUnits(document, total),
      budgets.maxOutputChars,
      'page',
      pdfBodyHasText,
    );
    // 预算在见到任何真实正文前耗尽时 `scannedAll=false`；旧判据带 `scannedAll &&` 会因此放过，
    // 静默收窄成「truncated + 无正文」——改前的单单元路径此时是会抛的。`sawText` 逐单元用
    // `hasText` 判定（pdf=正文含字母数字、office=正文非空），单元头是我方合成标记不计入；只要
    // 没有任一单元含真实正文，无论是否扫全都判无文本层，照抛既有错误码（调用方降级 unsupported-binary）。
    if (!aggregated.sawText) {
      throw new Error('DOCUMENT_PDF_NO_TEXT_LAYER');
    }
    return finalizeAggregate('pdf', aggregated, 'pages', total);
  } finally {
    await loadingTask.destroy();
  }
}

async function* pdfPageUnits(document, total) {
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    try {
      const body = await extractPdfPageText(page);
      yield { header: total > 1 ? `page:${pageNumber}` : null, body };
    } finally {
      page.cleanup();
    }
  }
}

function pdfBodyHasText(body) {
  return Boolean(body) && /[\p{L}\p{N}]/u.test(body);
}

/**
 * 聚合：同一 session 内**惰性**读表，预算填满即停止——不再对后续表调 `extractSheetRows`，
 * 因此大 xlsx 不会把全部表正文同时解进堆。
 */
async function aggregateXlsx(bytes, budgets) {
  const [{ openXlsxWorkbook, parseXlsx }, { default: SSF }] = await Promise.all([
    import('@silurus/ooxml/node'),
    import('ssf'),
  ]);
  const workbookIndex = parseXlsx(bytes);
  if (workbookIndex.workbook.parseError) throw new Error('DOCUMENT_OFFICE_CORRUPT');
  const session = await openXlsxWorkbook(bytes, {
    resourceLimits: {
      maxArchiveEntryBytes: budgets.maxZipEntryBytes,
      maxTotalInflatedBytes: budgets.maxZipExpandedBytes,
    },
  });
  try {
    const total = session.sheetCount;
    const aggregated = await aggregateUnits(
      xlsxSheetUnits(session, workbookIndex, SSF, total),
      budgets.maxOutputChars,
      'sheet',
      officeBodyHasText,
    );
    // 见 aggregatePdf 同款判据：`!sawText` 即无任一表含正文，不因预算提前停（scannedAll=false）而放过。
    if (!aggregated.sawText) throw new Error('DOCUMENT_OFFICE_NO_TEXT');
    return finalizeAggregate('xlsx', aggregated, 'sheets', total);
  } finally {
    await session.close();
  }
}

async function* xlsxSheetUnits(session, workbookIndex, SSF, total) {
  for (let sheetNumber = 1; sheetNumber <= total; sheetNumber += 1) {
    const sheetName = sheetNameOrThrow(session, workbookIndex, sheetNumber);
    const body = await extractSheetRows(session, sheetNumber - 1, workbookIndex, SSF);
    yield { header: total > 1 ? `sheet:${sheetNumber} name:${sheetName}` : null, body };
  }
}

/**
 * 聚合：docx 全部 <w:p> 段落本就在同一份 document.xml 内（受 8MiB 单条目上限约束），
 * 段块计数需先扫全（`total` 用于单单元不加头与 locatorCoverage），故先建有界的过滤段块表，
 * 再惰性喂入按预算收口的累加器——预算填满即停止拼接后续段块。
 */
async function aggregateDocx(bytes, budgets) {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const blocks = Array.from(xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/giu), (match) =>
    stripXml(match[0]),
  ).filter(Boolean);
  if (blocks.length === 0) throw new Error('DOCUMENT_OFFICE_NO_TEXT');
  const total = blocks.length;
  const aggregated = await aggregateUnits(
    docxBlockUnits(blocks, total),
    budgets.maxOutputChars,
    'block',
    officeBodyHasText,
  );
  return finalizeAggregate('docx', aggregated, 'blocks', total);
}

function* docxBlockUnits(blocks, total) {
  for (let index = 0; index < blocks.length; index += 1) {
    yield { header: total > 1 ? `block:${index + 1}` : null, body: blocks[index] };
  }
}

/**
 * 聚合：pptx 各幻灯片 XML 由主进程铺进 input.unitBytes，**惰性**逐张 stripXml——
 * 预算填满即停止，不再解码后续幻灯片。
 */
async function aggregatePptx(input) {
  const slides = input.unitBytes ?? [];
  const total = input.unitCount ?? slides.length;
  const aggregated = await aggregateUnits(
    pptxSlideUnits(slides, total),
    input.budgets.maxOutputChars,
    'slide',
    officeBodyHasText,
  );
  // 见 aggregatePdf 同款判据：`!sawText` 即无任一幻灯片含正文，不因预算提前停（scannedAll=false）而放过。
  if (!aggregated.sawText) throw new Error('DOCUMENT_OFFICE_NO_TEXT');
  return finalizeAggregate('pptx', aggregated, 'slides', total);
}

function* pptxSlideUnits(slides, total) {
  for (let index = 0; index < slides.length; index += 1) {
    const body = stripXml(new TextDecoder('utf-8', { fatal: true }).decode(slides[index]));
    yield { header: total > 1 ? `slide:${index + 1}` : null, body };
  }
}

function officeBodyHasText(body) {
  return body.length > 0;
}

/**
 * 把惰性累加结果封成一次输出：`coverageKey`=覆盖计数键（pages/sheets/blocks/slides）。
 */
function finalizeAggregate(format, aggregated, coverageKey, total) {
  return makeResult(
    format,
    aggregated.content,
    coverageKey,
    total,
    aggregated.truncated,
    aggregated.nextSelector,
    `${coverageKey}:1-${aggregated.lastCovered}`,
  );
}

/**
 * 从单元迭代器**惰性**按 `maxChars` 收口地拼接：逐个拉取单元，每单元前置紧凑单元头
 * （`header` 为 null 表示单单元不加头），单元间以空行分隔。整单元放不下时截取其正文前缀并把
 * `nextSelector` 指向该单元的续读位、连头都放不下时指向该单元本身，随即**停止拉取**后续单元
 * （`scannedAll=false`）——这正是有界内存的关键：任一时刻堆里只有一个单元正文加已累计输出。
 * 全覆盖则 `truncated=false`、`nextSelector=null`、`scannedAll=true`。
 * `hasText` 逐单元判定是否含正文，供调用方在全扫描且零正文时抛「无文本」——语义与旧的
 * 「全量 push 后再截」逐字一致（覆盖前缀、truncated、nextSelector、单元头规则均不变）。
 */
async function aggregateUnits(units, maxChars, kindKey, hasText) {
  let content = '';
  let truncated = false;
  let nextSelector = null;
  let lastCovered = 0;
  let sawText = false;
  let scannedAll = true;
  let unitNumber = 0;
  for await (const unit of units) {
    unitNumber += 1;
    if (hasText(unit.body)) sawText = true;
    const separator = content.length === 0 ? '' : '\n\n';
    const headerPrefix = unit.header ? `${unit.header}\n` : '';
    const overhead = separator.length + headerPrefix.length;
    const budgetLeft = maxChars - content.length;
    if (overhead + unit.body.length <= budgetLeft) {
      content += separator + headerPrefix + unit.body;
      lastCovered = unitNumber;
      continue;
    }
    const partial = overhead < budgetLeft ? safePrefix(unit.body, budgetLeft - overhead) : '';
    if (partial.length > 0) {
      content += separator + headerPrefix + partial;
      nextSelector = { [kindKey]: unitNumber, startChar: partial.length + 1 };
      lastCovered = unitNumber;
    } else {
      nextSelector = { [kindKey]: unitNumber };
    }
    truncated = true;
    scannedAll = false;
    break;
  }
  return { content, truncated, nextSelector, lastCovered, sawText, scannedAll };
}

function safePrefix(value, maxChars) {
  let end = Math.max(0, Math.min(value.length, maxChars));
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

function displayCellValue(cell, styles, date1904, SSF) {
  const value = cell.value;
  if (value.type === 'text') return value.text;
  if (value.type === 'bool') return value.bool ? 'TRUE' : 'FALSE';
  if (value.type === 'error') return value.error;
  if (value.type === 'empty') return '';
  if (value.type === 'shared') throw new Error('DOCUMENT_OFFICE_CORRUPT');
  const style = styles.cellXfs[cell.styleIndex ?? 0];
  const formatId = style?.numFmtId ?? 0;
  const format =
    styles.numFmts.find((candidate) => candidate.numFmtId === formatId)?.formatCode ??
    SSF._table[formatId];
  if (!format || format === 'General') return String(value.number);
  try {
    return SSF.format(format, value.number, { date1904 });
  } catch {
    try {
      return SSF.format(format.replace(/([¥₹₽₩])/gu, '"$1"'), value.number, { date1904 });
    } catch {
      return String(value.number);
    }
  }
}

function stripXml(value) {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/gu, ' ')
    .trim();
}

function boundedSelection(value, startChar, maxChars) {
  if (!Number.isInteger(startChar) || startChar < 1 || startChar > value.length) {
    throw new Error('DOCUMENT_SELECTOR_RANGE');
  }
  let length = Math.min(value.length - startChar + 1, maxChars);
  const endIndex = startChar - 1 + length;
  if (length > 0 && /[\uD800-\uDBFF]/u.test(value[endIndex - 1])) length -= 1;
  const content = value.slice(startChar - 1, startChar - 1 + length);
  const endChar = startChar + content.length - 1;
  return { content, endChar, nextChar: endChar + 1, truncated: endChar < value.length };
}

function makeResult(format, content, coverage, count, truncated, nextSelector, selectedRange) {
  return {
    text: content,
    content,
    format,
    engine: 'native',
    warnings: [],
    locatorCoverage: { [coverage]: count },
    selectedRange,
    truncated,
    nextSelector,
  };
}

function parserErrorCode(error, format) {
  const message = error instanceof Error ? error.message : '';
  if (/^DOCUMENT_[A-Z0-9_]+$/u.test(message)) return message;
  const name = error instanceof Error ? error.name : '';
  if (format === 'pdf' && (name === 'PasswordException' || /password/iu.test(message))) {
    return 'DOCUMENT_PDF_ENCRYPTED';
  }
  if (format === 'pdf') return 'DOCUMENT_PDF_CORRUPT';
  return 'DOCUMENT_OFFICE_CORRUPT';
}
