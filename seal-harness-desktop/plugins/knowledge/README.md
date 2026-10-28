# 知识库

`@seal-harness/knowledge` 是 Seal 自有 Host/Client 插件，作为一级菜单提供 WeKnora 知识库与文档管理、文本/文件导入、解析状态、文档片段预览、重新解析和带来源的检索。

它依赖现有 `@seal-harness/weknora` 提供的内部 `sealHarnessWeknora` 服务，复用当前本地账号保存的 API 地址与 Key。所有管理请求从 Host 发出；Client 不接收 Key。账号切换后旧页面被卸载，晚到结果由 Host 的账号/epoch 检查拒绝。插件不创建第二个数据库或向量引擎，库、文档和索引保存在所配置的 WeKnora 服务。

先在 **设置 → WeKnora** 配置连接。读取需要 Key 的 `retrieve` 能力；导入、删除和重新解析文档需要 `ingest`；新建、编辑和删除知识库需要 `manage_kbs`，并遵守 Key 的知识库范围。只读 Key 遇到写操作会明确返回权限不足，不自动提权或换凭据。

向量模型、问答模型及 OCR 使用 WeKnora 的原生设置。知识库设置中可填写实际管理页面地址，打开原生模型或 Key 管理页；本地默认 API 8080 与 Web 80 地址分开处理。Seal 不声称已提供本机 ONNX 下载能力。

单文件限制 16 MiB，支持当前 WeKnora 解析器能够处理的格式；文本导入上限 2 MiB，导入成功不代表索引完成，文档列表显示服务端解析状态，可刷新检查。预览最多读取前 50 个片段；文档列表每页 20 项。删除前要求确认。

Host RPC 路径 `/api/seal-harness-knowledge/{status,bases,saveBase,deleteBase,models,documents,importText,upload,readDocument,deleteDocument,reparse,search}`，沿用现有 client-request/server-response envelope。`upload` 使用 `{baseId,fileName,mimeType,data}`，data 是 Base64 字节，不接受任意本机文件路径。

内部 WeKnora 请求禁止 HTTP 重定向、限制响应为 8 MiB、支持请求取消和插件关闭。HTTP 401/403/404 与服务不可达分别给出明确提示；不显示服务端原始错误正文，避免泄漏服务端凭据或无关文档。

管理路径按 [WeKnora v0.8.3 官方路由](https://github.com/Tencent/WeKnora/blob/v0.8.3/internal/router/routes_knowledge.go) 与 [官方前端 API](https://github.com/Tencent/WeKnora/blob/v0.8.3/frontend/src/api/knowledge-base/index.ts) 对接；未复制 Octop/WeKnora UI、图标或服务端运行时。上游检索插件六个发布文件保留原字节与既有来源哈希。
