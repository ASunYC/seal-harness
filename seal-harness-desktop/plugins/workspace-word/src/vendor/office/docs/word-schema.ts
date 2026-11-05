import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { UndoRedo } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { tableEditing } from '@tiptap/pm/tables';

const sourceAttribute = { default: null, rendered: false, parseHTML: () => null };

// Adapted from apps/docs/src/renderer/editor/marks.ts: standalone rich marks,
// with no provider/AI/UI configuration or upstream desktop API.
function simpleMark(name: string, tag: string, shortcut: string) {
  return Mark.create({
    name,
    parseHTML: () => [{ tag }],
    renderHTML: () => [tag, 0],
    addKeyboardShortcuts() {
      return shortcut ? { [shortcut]: () => this.editor.commands.toggleMark(name) } : {};
    },
  });
}

export const WordDocument = Node.create({ name: 'doc', topNode: true, content: 'block+' });
export const WordText = Node.create({ name: 'text', group: 'inline' });
export const WordParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  addAttributes: () => ({
    sourceId: sourceAttribute,
    align: {
      default: 'left',
      parseHTML: (element: HTMLElement) => element.style.textAlign || 'left',
      renderHTML: (attributes: Record<string, unknown>) => ({
        style: `text-align:${
          ['left', 'center', 'right', 'justify', 'distribute'].includes(String(attributes['align']))
            ? String(attributes['align'])
            : 'left'
        }`,
      }),
    },
  }),
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: ({ HTMLAttributes }) => ['p', HTMLAttributes, 0],
});

const RunOrigin = Mark.create({
  name: 'runOrigin',
  inclusive: true,
  addAttributes: () => ({ id: sourceAttribute }),
  parseHTML: () => [],
  renderHTML: () => ['span', 0],
});

const TextStyle = Mark.create({
  name: 'textStyle',
  addAttributes: () => ({
    color: { default: null, parseHTML: () => null, rendered: false },
    font: { default: null, parseHTML: () => null, rendered: false },
    sizeHalfPoints: { default: null, parseHTML: () => null, rendered: false },
  }),
  parseHTML: () => [],
  renderHTML: ({ mark }) => {
    const color: unknown = mark.attrs['color'];
    const font: unknown = mark.attrs['font'];
    const size: unknown = mark.attrs['sizeHalfPoints'];
    const styles = [];
    if (typeof color === 'string' && /^[\da-f]{6}$/iu.test(color)) styles.push(`color:#${color}`);
    if (typeof font === 'string' && /^[\p{L}\p{N} ._-]{1,100}$/u.test(font))
      styles.push(`font-family:"${font}"`);
    if (typeof size === 'number' && size >= 2 && size <= 800)
      styles.push(`font-size:${size / 2}pt`);
    return ['span', { style: styles.join(';') }, 0];
  },
});

const HardBreak = Node.create({
  name: 'hardBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: () => ['br'],
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.insertContent({ type: 'hardBreak' }) };
  },
});

const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  addAttributes: () => ({ sourceId: sourceAttribute }),
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: () => ['table', ['tbody', 0]],
});
const TableRow = Node.create({
  name: 'tableRow',
  content: 'tableCell+',
  addAttributes: () => ({ originRow: sourceAttribute }),
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0],
});
const TableCell = Node.create({
  name: 'tableCell',
  content: 'paragraph+',
  isolating: true,
  addAttributes: () => ({
    originRow: sourceAttribute,
    originCell: sourceAttribute,
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  }),
  parseHTML: () => [{ tag: 'td' }, { tag: 'th' }],
  renderHTML: () => ['td', 0],
});
const TableSupport = Extension.create({
  name: 'wordTableSupport',
  extendNodeSchema(extension) {
    if (extension.name === 'table') return { tableRole: 'table' };
    if (extension.name === 'tableRow') return { tableRole: 'row' };
    if (extension.name === 'tableCell') return { tableRole: 'cell' };
    return {};
  },
  addProseMirrorPlugins: () => [tableEditing()],
});

const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    sourceId: sourceAttribute,
    src: { default: '' },
    width: { default: 320 },
    height: { default: 200 },
  }),
  parseHTML: () => [], // image import goes through a bounded local file picker, never pasted URLs.
  renderHTML: ({ HTMLAttributes }) => {
    const source: unknown = HTMLAttributes['src'];
    const safe =
      typeof source === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,/u.test(source);
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        src: safe ? source : '',
        alt: safe ? '文档图片' : '此图片暂不支持显示，保存时保留原样',
      }),
    ];
  },
});

const Preserved = Node.create({
  name: 'preserved',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({
    sourceId: sourceAttribute,
    label: { default: '高级内容' },
    preview: { default: '' },
    src: { default: null },
  }),
  parseHTML: () => [],
  renderHTML: ({ node }) => {
    const label: unknown = node.attrs['label'];
    const preview: unknown = node.attrs['preview'];
    return [
      'section',
      { class: 'word-preserved', contenteditable: 'false' },
      ['strong', {}, typeof label === 'string' ? label : '高级内容'],
      ['p', {}, typeof preview === 'string' ? preview.slice(0, 4000) : ''],
      ['small', {}, '此内容保留原样；请使用外部 Office 编辑高级对象。'],
    ];
  },
});

export const PreserveOriginal = Extension.create({
  name: 'preserveOriginal',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey('preserveOriginal'),
      filterTransaction(transaction, state) {
        if (!transaction.docChanged || transaction.getMeta('officeLoad') === true) return true;
        const before = new Set<number>();
        state.doc.descendants((node) => {
          const id: unknown = node.attrs['sourceId'];
          if (node.type.name === 'preserved' && typeof id === 'number') before.add(id);
        });
        transaction.doc.descendants((node) => {
          const id: unknown = node.attrs['sourceId'];
          if (node.type.name === 'preserved' && typeof id === 'number') before.delete(id);
        });
        return before.size === 0;
      },
    }),
  ],
});

export const wordExtensions = [
  WordDocument,
  WordText,
  WordParagraph,
  HardBreak,
  simpleMark('bold', 'strong', 'Mod-b'),
  simpleMark('italic', 'em', 'Mod-i'),
  simpleMark('underline', 'u', 'Mod-u'),
  simpleMark('strike', 's', ''),
  RunOrigin,
  TextStyle,
  Table,
  TableRow,
  TableCell,
  TableSupport,
  Image,
  Preserved,
  PreserveOriginal,
  UndoRedo,
];
