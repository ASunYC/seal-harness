# 设计与来源

## Stratex 当前实现

- `src/renderer/src/components/workspace/WorkspaceFilePreview.vue` 在工作区预览识别可编辑 Office 文件，并用当前 primary binding 打开；会话目录与当前工作台目录不一致时锁编辑。
- `src/main/services/office/office-composition.ts` 持有编辑会话、身份和 binding；`office-binary-commit-service.ts` 校验候选文件、源版本、备份和原子提交。
- `src/renderer/src/office/word/OfficeWordApp.tsx` 用 Tiptap 操作真实编辑模型，`docx-worker.ts` 在独立 Worker 解析/生成；`vendor/office/docx-engine` 来自 GenOffice 固定提交 `953595e2f1635140e2a6c1f86c2fa12b0cca77b8`（Apache-2.0），`vendor/office/docs` 是裁剪适配层。
- `WorkspaceFilePreview.vue` 在原文件面板切换预览/编辑；`OfficeViewHost.vue` 把独立 Office 视图嵌入该面板。手工编辑格式包括 DOCX、XLSX、PPTX、PDF、Markdown；PDF 和 Markdown 使用不同引擎。项目文件上传/下载属于文件传输链路，Office 编辑器的另存为写入工作区。

## Seal 接入

- `@seal-harness/workspace-word` 是工作区 DOCX 的 Host/Client 插件，随 `seal-harness-desktop` bundle 装配。远端 `@seal-harness/office` 继续管理账号文档库的 DOCX/XLSX/PPTX；其 GenOffice Node 引擎与本插件的 Stratex 浏览器 Worker 版本和用途不同，不共享文件存储或保存动作。`deepseek-harness/` 固定子模块保持只读。
- `workspace-word` Client 不注册独立的整页文档库入口；`office` 保留 Host 能力，聊天与工作区文件都留在原生会话。右侧页签承载文档阅读和编辑，关闭后回到原会话。
- 复用 DSH `conversation.chat.turnTail` 与 `deliverables` 的本轮产物数据，只在当前可见会话追加成功的 `turn/end` 后自动打开最后一份 Office 文件。历史装载是 replace/prepend，不触发打开；Host 再校验绝对路径、工作区范围和文件类型。
- DSH `ui-sidebar-files` 已经把文件交给 `tabActions.openResource`；`ui-sidebar-documentpreview` 有 `sidebar.right.tab.document.actions` 公开 slot，可将三格式的“编辑”按钮接到右侧独立文档页签。`sidebar.right.tab.files.actions` 在当前目录提供新建和导入。页签保留文件路径与授权会话 id，不另建一份工作区。
- DSH `workspace-files` Remote 只读。Seal Host 需要自己的二进制写入 RPC；从会话 header 取得工作区根，拒绝越界和最终符号链接，并将工作区与原文件版本作为每次保存的前提。只允许本机工作区文件；远程执行空间不可假定映射到本机路径。
- 浏览器侧 Worker 装载 GenOffice DOCX 引擎。候选文件在 Worker 与 Host 两端校验。Host 对每个目标串行化提交，写入同目录临时文件后同步并替换；冲突只报告，不覆盖源文件。

## 边界

Stratex 的 Electron 子窗口、Vue 工作台、账号/AI/渠道 IPC 不移入 Seal；用 Seal 的 Cordis 插件、Client slot、原生会话和本地认证接入。DOCX 编辑不能用“先转 HTML 再保存”替代，因为那会丢失 OOXML 结构。未知或复杂块保持只读原始锚点，编辑保护文档拒绝保存。
