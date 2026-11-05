import type { Editor } from '@tiptap/core';
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn } from '@tiptap/pm/tables';

export interface WordRibbonProps {
  editor: Editor;
  disabled: boolean;
  onImage(): void;
  onError(message: string): void;
}

/** Manual editing controls over the real PM document; unavailable advanced commands are absent. */
export function WordRibbon({ editor, disabled, onImage, onError }: WordRibbonProps) {
  const command = (run: () => boolean): void => {
    if (!run()) onError('请先将光标放入支持此操作的内容。');
  };
  const tableCommand = (run: typeof addRowAfter): void => {
    editor.commands.focus();
    command(() => run(editor.state, editor.view.dispatch));
  };
  return (
    <div className="word-ribbon" role="toolbar" aria-label="Word 编辑工具">
      <fieldset disabled={disabled}>
        <legend>编辑</legend>
        <button type="button" onClick={() => command(() => editor.chain().focus().undo().run())}>
          撤销
        </button>
        <button type="button" onClick={() => command(() => editor.chain().focus().redo().run())}>
          重做
        </button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>文字</legend>
        {(['bold', 'italic', 'underline', 'strike'] as const).map((mark, index) => (
          <button
            type="button"
            key={mark}
            aria-pressed={editor.isActive(mark)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(() => editor.chain().focus().toggleMark(mark).run())}
          >
            {['加粗', '斜体', '下划线', '删除线'][index]}
          </button>
        ))}
        <label>
          字号{' '}
          <select
            aria-label="字号"
            defaultValue="24"
            onChange={(event) =>
              command(() =>
                editor
                  .chain()
                  .focus()
                  .setMark('textStyle', { sizeHalfPoints: Number(event.target.value) })
                  .run(),
              )
            }
          >
            {[18, 21, 24, 28, 32, 36, 44, 52, 72].map((size) => (
              <option key={size} value={size}>
                {size / 2}
              </option>
            ))}
          </select>
        </label>
        <label>
          颜色{' '}
          <input
            type="color"
            aria-label="文字颜色"
            defaultValue="#1e293b"
            onChange={(event) =>
              command(() =>
                editor
                  .chain()
                  .focus()
                  .setMark('textStyle', { color: event.target.value.slice(1) })
                  .run(),
              )
            }
          />
        </label>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>段落</legend>
        {(['left', 'center', 'right', 'justify'] as const).map((align, index) => (
          <button
            type="button"
            key={align}
            onClick={() =>
              command(() => editor.chain().focus().updateAttributes('paragraph', { align }).run())
            }
          >
            {['左对齐', '居中', '右对齐', '两端对齐'][index]}
          </button>
        ))}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>插入</legend>
        <button
          type="button"
          onClick={() =>
            command(() =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: 'table',
                  content: Array.from({ length: 3 }, () => ({
                    type: 'tableRow',
                    content: Array.from({ length: 3 }, () => ({
                      type: 'tableCell',
                      content: [{ type: 'paragraph' }],
                    })),
                  })),
                })
                .run(),
            )
          }
        >
          插入表格
        </button>
        <button type="button" onClick={onImage}>
          插入图片
        </button>
      </fieldset>
      <fieldset disabled={disabled || !editor.isActive('table')}>
        <legend>表格</legend>
        <button type="button" onClick={() => tableCommand(addRowAfter)}>
          添加行
        </button>
        <button type="button" onClick={() => tableCommand(addColumnAfter)}>
          添加列
        </button>
        <button type="button" onClick={() => tableCommand(deleteRow)}>
          删除行
        </button>
        <button type="button" onClick={() => tableCommand(deleteColumn)}>
          删除列
        </button>
      </fieldset>
      <fieldset disabled={disabled || !editor.isActive('image')}>
        <legend>图片</legend>
        <button
          type="button"
          onClick={() => {
            const current: Record<string, unknown> = editor.getAttributes('image');
            const width = current['width'];
            const height = current['height'];
            if (typeof width === 'number' && typeof height === 'number') {
              command(() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('image', {
                    width: Math.max(1, width * 0.9),
                    height: Math.max(1, height * 0.9),
                  })
                  .run(),
              );
            }
          }}
        >
          缩小 10%
        </button>
        <button
          type="button"
          onClick={() => {
            const current: Record<string, unknown> = editor.getAttributes('image');
            const width = current['width'];
            const height = current['height'];
            if (typeof width === 'number' && typeof height === 'number') {
              command(() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('image', {
                    width: Math.min(4096, width * 1.1),
                    height: Math.min(4096, height * 1.1),
                  })
                  .run(),
              );
            }
          }}
        >
          放大 10%
        </button>
      </fieldset>
    </div>
  );
}
