# Seal Harness知识库

独立 DSH Host/Client 插件。UI 用 sidebar/main，原生会话引用用 `sessions.retain`、`slash/input-insert-text`、`uiWorkspace.openSession`；不创建聊天内核或消息列表。下载用 Connection Fetch 流直接转发，上传用浏览器分块与标准 RPC，不落中转文件。

## 来源与功能

业务与远端协议沿用 Stratex `c41b6bc098256495a168116bf2daed5f17df9193` 的已迁移实现；界面按 `070ba39e82a4d47dec812870b691eedcb7f7b28e` 对齐，逐组件来源与差异见 [SOURCE.md](SOURCE.md)。

- `src/renderer/src/features/vault/VaultLibraryView.vue`：个人/被授权/公开目录、场景与安装筛选，创建编辑归档，文件上传/索引重试/预览下载删除，分析结果，引用。
- `VaultKnowledgeServiceSelector.vue`：服务新增编辑、切换、移除。配置集中在 `sealHarnessServices`，不另建 profile 文件。
- `src/main/services/knowledgeServiceClient.ts`：Knowledge Contract v1，分块上传、安装、共享授权码、兑换、停止分享、检索与原文续读。
- `src/main/services/aepWikiService.ts`：平台用户搜索 `api/v1/wiki/library/share-users`，按姓名选择用户后授权，不暴露 issuer/subject 表单。
- `src/main/services/workflowResourceService.ts`：安装知识的只读文件快照用于智能体实例部署。450000 字节上限与来源相同，不截断正文。

## Host

`inject`: `connection`, `credentials`, `sealHarnessIdentity`, `sealHarnessServices`, `tools`。

`apply` 只注册服务、路由和工具，不联网。`knowledgeBaseUrl`/`knowledgeTargetType` 来自统一服务配置。standalone 首次使用以 `POST v1/clients` 注册；凭据以服务地址哈希为键放在 DSH credentials，绝不返回 Client。platform 使用身份服务 token，路径 `api/v1/`；standalone 路径 `v1/` 和 `x-knowledge-client-credential`。切换服务取消旧请求，使用对应凭据。

`POST /api/seal-harness-knowledge/<action>` 是标准 DSH RPC；`GET /api/seal-harness-knowledge/file?groupId=...&fileId=...` 是 DSH Connection 认证下的流式下载。Body 和方法按 `contracts.js` 验证，业务失败保留失败，不显示成功。

`ctx.sealHarnessKnowledge` 提供：

- `invoke(action,payload,signal)`：同一套资料集、文件、查询业务。
- `workflowResources(signal)`：已安装集合内的文件列表；version 为集合 revision。
- `workflowExport(selection,signal)`：单文件 `snapshot.json`、稳定 UUID 与内容 SHA256；前后校验集合 revision 与文件就绪状态。

工具：`knowledge_list`、`knowledge_search`、`knowledge_navigate`。工具通过 `exec.signal` 使用同一服务，结果由 DSH 原生工具展示。专家可在预设的系统提示中声明绑定 groupIds 并复用这些工具。

## 检查

`node --test seal-harness-desktop/plugins/knowledge/tests/*.test.mjs`

覆盖真实 Cordis/Connection 的离线安全激活、RPC、工具、流式下载、卸载；standalone 登记与 credentials、平台路径、分块偏移、共享授权/共享码、检索与导航、导出 revision/容量；服务切换取消与凭据分离；React 真实表单、目录筛选、详情/上传/预览/分享/服务管理、确认队列后上传与取消、迟到预览及跨服务列表隔离、StrictMode 初始配置，以及保留已有草稿的原生插入事件。

协议服务器与 DOM 是夹具；真实知识服务、桌面索引完整链路与跨平台安装由父集成任务验收，不能从这些检查推导已通过。
