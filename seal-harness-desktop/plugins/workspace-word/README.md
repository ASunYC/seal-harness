# 工作区 Office 文档

此插件以 DSH 原生聊天和工作区为入口。一次聊天成功生成 Office 文件后，复用 DSH 本轮产物或工作区变更记录，在当前会话的右侧页签打开文档；历史回放不自动打开。文件面板仍提供 DOCX、XLSX、PPTX 新建与导入，文件预览仍提供“编辑”按钮。保存写回本机工作区原文件，导出下载当前保存版本。它不创建账号文档库副本，也不注册整页“办公文档”导航；账号文档库 Host 能力仍由 `@seal-harness/office` 管理。

DOCX 编辑器沿 Stratex 的 Tiptap Word 模型、分批装载和 GenOffice 浏览器 Worker 解析/生成路径实现。XLSX 和 PPTX 复用 Office Host 的 GenOffice 结构化读写内核，当前可修改已有单元格和幻灯片文字。它们尚未移植 Stratex 的完整表格与幻灯片可视化画布、复杂排版或媒体编辑。PDF 和 Markdown 使用 Stratex 的其他引擎，不在此插件范围内。

Host 以会话工作区、账号 epoch、文件哈希和保存前复查约束写入，并在替换前保留恢复副本。原先独立的 8 MiB 限制已移除；当前整文件传输和 ZIP 解压预算仍将输入文件限制在 64 MiB。受保护文档拒绝编辑。远程执行空间没有本机路径映射时不提供写入。固定来源、Apache-2.0 许可证及修改记录见 `third-party/genoffice/` 和 `src/vendor/office/*/PROVENANCE.md`。
