# Word 编辑适配来源

上游：genspark-ai/genoffice，固定提交 `953595e2f1635140e2a6c1f86c2fa12b0cca77b8`。许可：Apache-2.0；完整 LICENSE/NOTICE 由本任务 `resources/licenses/office` 随包保留。

本子树是**裁剪后适配**，不是上游完整 Word App 的逐字复制，也不宣称完整排版兼容。

| 本地文件 | 来源与修改 |
|---|---|
| `save-until-persisted.ts` | 复制上游同名文件，仅按本仓格式化。保留 FIFO 保存与关闭前收敛语义。 |
| `word-schema.ts` | 按上游 `editor/extensions.ts`、`marks.ts` 的 docxIndex/富文本 marks/保留节点模式实现范围明确的 schema。改为无路径、无 AI、无 provider 的独立 Tiptap 编辑器；简单表格、图片和受保护原始块；不导入宽泛宿主 API。 |
| `word-model.ts` | 按上游 `editor/convert.ts` 的 original/generated/xml/image SavePlan 模式实现受限适配。保留原始块锚点和 run 原始属性；未知/高级结构保护而非转成普通段落。真正 OOXML 生成和修改仍使用裁剪后的原始 docx-engine。 |
| `WordRibbon.tsx` | Stratex 新编手工工具栏，调用实际 Tiptap/ProseMirror 命令；没有复制上游完整 Ribbon，未开放高级命令不显示。 |
| `*.test.ts` | Stratex 新增行为测试：真实富文本 DOM、undo/redo、表格结构、原始块/高级对象保留、真实 DOCX 往返。 |

宿主侧 `OfficeWordApp.tsx` 沿上游 `phased-content.ts` 的首 64/后 128 blocks 与完整装载保存屏障设计；取消/异常时不沿用上游失败后继续允许保存的回退。主进程 `loaded()` 必须在全量装载后调用。文件落盘、权限、模型路由均归 Stratex。

上游原文件 SHA-256：

| 原文件（相对上游根） | SHA-256 |
|---|---|
| `apps/docs/src/renderer/editor/marks.ts` | `20F106A2D977B511B25FB653D26DA9999C073A686471F18D8D37ED477AB0C80D` |
| `apps/docs/src/renderer/editor/convert.ts` | `2F1A77E8F76C133212401A0621FD84AD07774EFE889420FEDC339AA4D49B7793` |
| `apps/docs/src/renderer/editor/extensions.ts` | `21689B3770A63F66CB8590F07AB3AE22DFE18D2F2E31664A877550E8ADB7FB66` |
| `apps/docs/src/renderer/phased-content.ts` | `5A3388793CD77FBEA1393D38672D886437C6070B9ADA80B45561DB4081C01800` |
| `apps/docs/src/renderer/save-until-persisted.ts` | `347599FC869E5CEB4AB11138571BA7139119B17B071C46D68F7DB58054B12BE7` |

本切片已开放普通文本格式/段落插删/普通矩形表格行列与内容/本地图片插入与缩放。合并/嵌套表格、域、复杂绘图、内容控件、修订等保持原始 OOXML 且禁止从编辑器删除；编辑保护文档拒绝打开编辑。页面使用原纸张与边距，预览为 CSS 分栏，复杂分页明确提示以外部 Office 为准。字体使用当前系统可用字体，无 CDN；缺少的版式/字体/五格式能力仍属后续工作。
