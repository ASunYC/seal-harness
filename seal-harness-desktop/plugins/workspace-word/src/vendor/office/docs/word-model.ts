import { generateTableModelXml, mergePPrFormat, patchDrawingExtent } from '../docx-engine/generate';
import type { Block, GeneratedBlock, ParaFormat, Run, TableCell, TableModel } from '../docx-engine/types';
import type { SaveBlock } from '../docx-engine/patch';

/** Adapted from the upstream docxIndex/original-block SavePlan contract. */
export interface WordNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WordNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface WordModel {
  document: WordNode;
  originals: ReadonlyMap<number, Block>;
  signatures: ReadonlyMap<number, string>;
  runs: ReadonlyMap<string, Run>;
  preserved: readonly number[];
}

const paragraphTypes = new Set(['paragraph', 'heading']);
function signature(node: WordNode): string {
  const attributes = (attrs?: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(attrs ?? {})
        .filter(
          ([key, value]) =>
            value !== null &&
            value !== undefined &&
            !(['colspan', 'rowspan'].includes(key) && value === 1),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return JSON.stringify({
    type: node.type,
    text: node.text ?? '',
    attrs: attributes(node.attrs),
    marks: (node.marks ?? [])
      .map((mark) => ({ type: mark.type, attrs: attributes(mark.attrs) }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    content: (node.content ?? []).map(signature),
  });
}
const editableRunKeys = new Set([
  'text',
  'rawRPr',
  'styleId',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'sizeHalfPoints',
  'font',
  'fontAscii',
  'eastAsiaFont',
  'eastAsiaLang',
  'fontCs',
  'themeRFonts',
  'themeColor',
  'csFont',
  'rtl',
  'charSpacingTwips',
  'kernHalfPoints',
  'caps',
  'charScalePct',
  'highlight',
  'shading',
  'cs',
  'vertAlign',
  'em',
  'eaSlotEmpty',
]);

function editableRuns(runs: readonly Run[]): boolean {
  return runs.every((run) => Object.keys(run).every((key) => editableRunKeys.has(key)));
}

function editableTable(model: TableModel): boolean {
  if (model.rowRevisions?.some((revision) => revision !== null)) return false;
  return model.rows.every((row) =>
    row.every(
      (cell) =>
        !cell.nestedTables?.length &&
        !cell.anchoredBoxes?.length &&
        !cell.cellRevision &&
        !cell.vMerge &&
        !cell.hMerge &&
        !cell.gridGap &&
        (cell.colSpan ?? 1) === 1 &&
        (cell.richParas ?? []).every((paragraph) => editableRuns(paragraph.runs)),
    ),
  );
}

function textNodes(runs: readonly Run[], prefix: string, store: Map<string, Run>): WordNode[] {
  return runs.flatMap<WordNode>((run, index) => {
    const id = `${prefix}:${index}`;
    store.set(id, run);
    const marks: NonNullable<WordNode['marks']> = [{ type: 'runOrigin', attrs: { id } }];
    for (const type of ['bold', 'italic', 'underline', 'strike'] as const) {
      if (run[type]) marks.push({ type });
    }
    marks.push({
      type: 'textStyle',
      attrs: {
        color: run.color ?? null,
        sizeHalfPoints: run.sizeHalfPoints ?? null,
        font: run.font ?? null,
      },
    });
    // A hard break is a real model node, not an HTML string or a lost newline.
    return run.text
      .split('\n')
      .flatMap((text, line) => [
        ...(line > 0 ? [{ type: 'hardBreak', marks }] : []),
        ...(text ? [{ type: 'text', text, marks }] : []),
      ]);
  });
}

function paragraph(
  runs: readonly Run[],
  sourceId: number | null,
  prefix: string,
  store: Map<string, Run>,
  format?: ParaFormat,
): WordNode {
  return {
    type: 'paragraph',
    attrs: { sourceId, align: format?.align ?? 'left' },
    content: textNodes(runs, prefix, store),
  };
}

/** Unknown structures remain indivisible atoms; their original OOXML is the save source. */
export function createWordModel(blocks: readonly Block[]): WordModel {
  const originals = new Map<number, Block>();
  const signatures = new Map<number, string>();
  const runs = new Map<string, Run>();
  const preserved: number[] = [];
  const content: WordNode[] = [];
  for (const block of blocks) {
    if (block.hidden) continue; // saveDocx appends the upstream hidden trailing elements.
    const id = block.docxIndex;
    if (id === null) throw new Error('文档包含无法定位的原始内容。');
    if (originals.has(id)) throw new Error('文档包含共享锚点的复合结构，请使用外部 Office 编辑。');
    originals.set(id, block);
    let node: WordNode;
    const structural =
      !!block.sdtShell ||
      !!block.blockRevision ||
      // These OOXML children are outside the reduced rich-text model. Regenerating
      // their paragraph/table would silently discard the nested object or wrapper.
      (block.type !== 'image' &&
        /<w:(?:drawing|pict|object|fldChar|instrText|hyperlink|sdt|customXml|ruby|altChunk|sectPr|pPrChange)\b/u.test(
          block.originalXml ?? '',
        ));
    if (!structural && paragraphTypes.has(block.type) && editableRuns(block.runs ?? [])) {
      node = paragraph(block.runs ?? [], id, String(id), runs, block.format);
    } else if (!structural && block.type === 'table' && block.table && editableTable(block.table)) {
      node = {
        type: 'table',
        attrs: { sourceId: id },
        content: block.table.rows.map((row, r) => ({
          type: 'tableRow',
          attrs: { originRow: r },
          content: row.map((cell, c) => ({
            type: 'tableCell',
            attrs: { originRow: r, originCell: c },
            content: (cell.richParas ?? cell.paras.map((text) => ({ runs: [{ text }] }))).map(
              (p, n) =>
                paragraph(p.runs, null, `${id}:${r}:${c}:${n}`, runs, {
                  align: alignment('align' in p ? p.align : undefined),
                }),
            ),
          })),
        })),
      };
    } else if (!structural && block.type === 'image' && block.imageDataUrl) {
      node = {
        type: 'image',
        attrs: {
          sourceId: id,
          src: block.imageDataUrl,
          width: block.imageWidthPx ?? 320,
          height: block.imageHeightPx ?? 200,
        },
      };
    } else {
      preserved.push(id);
      node = {
        type: 'preserved',
        attrs: {
          sourceId: id,
          label: block.label ?? '高级内容（保留原样）',
          preview: block.previewText ?? '',
          src: block.imageDataUrl ?? null,
        },
      };
    }
    signatures.set(id, signature(node));
    content.push(node);
  }
  if (content.length === 0) content.push({ type: 'paragraph', content: [] });
  return { document: { type: 'doc', content }, originals, signatures, runs, preserved };
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function alignment(value: unknown): NonNullable<ParaFormat['align']> {
  return value === 'center' || value === 'right' || value === 'justify' || value === 'distribute'
    ? value
    : 'left';
}

function paragraphRuns(node: WordNode, model: WordModel): Run[] {
  return (node.content ?? []).map((inline) => {
    if (inline.type !== 'text' && inline.type !== 'hardBreak') {
      throw new Error('此段落包含当前版本不支持保存的内容。');
    }
    const origin = inline.marks?.find((mark) => mark.type === 'runOrigin')?.attrs?.['id'];
    const original = typeof origin === 'string' ? model.runs.get(origin) : undefined;
    const run: Run = {
      ...original,
      text: inline.type === 'hardBreak' ? '\n' : (inline.text ?? ''),
    };
    for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
      const enabled = inline.marks?.some((mark) => mark.type === key) ?? false;
      // Unset and explicit false differ in OOXML: unset inherits the style.
      // Do not inject an off override into untouched runs of an edited paragraph.
      if (enabled || original?.[key] !== undefined) run[key] = enabled;
      else delete run[key];
    }
    const style = inline.marks?.find((mark) => mark.type === 'textStyle')?.attrs;
    const color = style?.['color'];
    if (typeof color === 'string' && /^[\da-f]{6}$/iu.test(color)) run.color = color;
    const size = style?.['sizeHalfPoints'];
    if (typeof size === 'number' && size >= 2 && size <= 800) run.sizeHalfPoints = size;
    const font = style?.['font'];
    if (typeof font === 'string' && font.length <= 100) run.font = font;
    return run;
  });
}

function tableFromNode(node: WordNode, model: WordModel, original?: TableModel): TableModel {
  const rows = (node.content ?? []).map((row) => {
    if (row.type !== 'tableRow') throw new Error('表格行结构无效。');
    return (row.content ?? []).map((cell): TableCell => {
      if (cell.type !== 'tableCell') throw new Error('表格单元格结构无效。');
      if ((cell.attrs?.['colspan'] ?? 1) !== 1 || (cell.attrs?.['rowspan'] ?? 1) !== 1) {
        throw new Error('合并单元格暂不支持保存，请撤销此次粘贴或编辑。');
      }
      const r = integer(cell.attrs?.['originRow']);
      const c = integer(cell.attrs?.['originCell']);
      const originalCell = r !== null && c !== null ? original?.rows[r]?.[c] : undefined;
      const richParas = (cell.content ?? []).map((p, index) => {
        if (p.type !== 'paragraph') throw new Error('不支持在此表格中嵌套其他内容。');
        return {
          ...originalCell?.richParas?.[index],
          runs: paragraphRuns(p, model),
          align: alignment(p.attrs?.['align']),
        };
      });
      return {
        ...originalCell,
        paras: richParas.map((p) => p.runs.map((r) => r.text).join('')),
        richParas,
      };
    });
  });
  if (!rows.length || rows.some((row) => !row.length || row.length !== rows[0]?.length)) {
    throw new Error('表格必须包含相同列数的非空行。');
  }
  const rowOrigins = (node.content ?? []).map((row) => integer(row.attrs?.['originRow']));
  const remapRows = <T>(values: readonly T[] | undefined): (T | null)[] | undefined =>
    values?.length
      ? rowOrigins.map((origin) => (origin === null ? null : (values[origin] ?? null)))
      : undefined;
  const columnOrigins = (rows[0] ?? []).map((_cell, column) => {
    for (const row of node.content ?? []) {
      const origin = integer(row.content?.[column]?.attrs?.['originCell']);
      if (origin !== null) return origin;
    }
    return null;
  });
  const remapColumns = (values: readonly number[] | undefined): number[] | undefined => {
    if (!values?.length) return undefined;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return columnOrigins.map((origin) => (origin === null ? average : (values[origin] ?? average)));
  };
  return {
    ...original,
    rows,
    rawTrPrs: remapRows(original?.rawTrPrs),
    rowHeightsTwips: remapRows(original?.rowHeightsTwips),
    rowHeightRules: remapRows(original?.rowHeightRules),
    repeatHeaderRows: remapRows(original?.repeatHeaderRows),
    rowRevisions: remapRows(original?.rowRevisions),
    colWidthsPct: remapColumns(original?.colWidthsPct),
    colWidthsTwips: remapColumns(original?.colWidthsTwips),
  };
}

/** Mirrors upstream original/generated/xml/image save plan, never whole-document text flattening. */
export function wordSaveBlocks(document: WordNode, model: WordModel): SaveBlock[] {
  if (document.type !== 'doc') throw new Error('文档结构无效。');
  const used = new Set<number>();
  const result: SaveBlock[] = [];
  for (const node of document.content ?? []) {
    const candidateId = integer(node.attrs?.['sourceId']);
    const id = candidateId !== null && !used.has(candidateId) ? candidateId : null;
    const original = id === null ? undefined : model.originals.get(id);
    if (id !== null) used.add(id);
    if (id !== null && original && model.signatures.get(id) === signature(node)) {
      result.push({ kind: 'original', docxIndex: id });
    } else if (node.type === 'preserved') {
      if (id === null || !original) throw new Error('高级内容的来源已失效。');
      result.push({ kind: 'original', docxIndex: id });
    } else if (node.type === 'paragraph') {
      const type = original && paragraphTypes.has(original.type) ? original.type : 'paragraph';
      if (type !== 'paragraph' && type !== 'heading' && type !== 'listItem')
        throw new Error('段落类型无效。');
      const format: ParaFormat = { ...original?.format, align: alignment(node.attrs?.['align']) };
      // The worker accepts GeneratedBlock, not the broader parsed Block shape.
      // Never carry display-only fields or source XML through the strict save contract.
      const block: GeneratedBlock = {
        type,
        level: original?.level,
        outlineOnly: original?.outlineOnly,
        styleId: original?.styleId,
        list: original?.list,
        bookmarks: original?.bookmarks,
        hiddenBookmarks: original?.hiddenBookmarks,
        commentStarts: original?.commentStarts,
        commentEnds: original?.commentEnds,
        format,
        runs: paragraphRuns(node, model),
      };
      if (original?.rawPPr !== undefined) {
        block.rawPPr = mergePPrFormat(original.rawPPr, format, original.format);
      }
      result.push({ kind: 'generated', block });
    } else if (node.type === 'table') {
      const xml = generateTableModelXml(
        tableFromNode(node, model, original?.table),
        original?.originalXml ?? undefined,
      );
      result.push(id === null ? { kind: 'xml', xml } : { kind: 'xml', xml, docxIndex: id });
    } else if (node.type === 'image') {
      const width = node.attrs?.['width'];
      const height = node.attrs?.['height'];
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        width < 1 ||
        height < 1 ||
        width > 4096 ||
        height > 4096
      )
        throw new Error('图片尺寸超出范围。');
      if (original?.type === 'image' && original.originalXml && id !== null) {
        result.push({
          kind: 'xml',
          docxIndex: id,
          xml: patchDrawingExtent(original.originalXml, width, height),
        });
      } else {
        const src = node.attrs?.['src'];
        const match =
          typeof src === 'string'
            ? /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/u.exec(src)
            : null;
        const mime = match?.[1];
        const base64 = match?.[2];
        if (!base64 || (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/gif')) {
          throw new Error('仅支持本地 PNG、JPEG 或 GIF 图片。');
        }
        result.push({ kind: 'image', image: { mime, base64, widthPx: width, heightPx: height } });
      }
    } else throw new Error('此内容尚不支持保存。');
  }
  if (model.preserved.some((id) => !used.has(id)))
    throw new Error('高级内容需保留原样，不能从此编辑器删除。');
  return result;
}
