# 项目 Host 迁移

来源 `/Volumes/workspace/code/Stratex`，提交 `c656400bc4baf80733a9ac5d8a1440539126c7e0`。来源 package.json 声明 `UNLICENSED`；本迁移不重新许可来源代码。逐文件原始 SHA256 见 `stratex/shared/source-manifest.json`，原注释保留。

## 共享接口

`src/index.ts` 是标准 Cordis Host 插件，inject 为 connection、credentials、sealHarnessIdentity、sealHarnessServices。使用身份插件的同步 getSession 和异步 getAccessToken；令牌只在 Host。账号 epoch 改变中止请求、销毁旧进度 sender、重建远端 SSE，并清理临时传输文件。

`src/host/service.ts` 提供 `ProjectService` 和 `ProjectHandler`。Agent 使用 `clients={client,planning,testing,dictionaries,dataSources}`、`getAccount()`、`accessToken()`、`register(channel,(event,payload)=>Promise<unknown>)`、`emit(channel,payload)`。事件上下文含 `signal` 和非 Electron `sender`。工具执行使用 `withSignal(exec.signal,operation)`，同一组 clients 自动合并真实 Agent 停止信号。

保留原实体信封、cursor/page/query_revision、expected_version/currentVersion、排期 conflicts、幂等请求 ID、远端四角色、服务能力、资产恢复和配额。`shared/ipc/api.ts` 只提取项目 API，channels 只提取业务键。规划草稿会话 ID 使用 DSH 0.1.7-alpha.2 的 branded string，不导入旧 local-session 或完整 Office API。

## Client 桥与事件

`createProjectBridge({invoke,subscribe})` 返回原项目方法及 Agent 会话/local workspace 方法。invoke 使用 `rpc.call('/api','seal-harness-projects/invoke',{channel,payload})`，取 RPC 成功结果 value 交给 bridge。领域 `{ok:false,...}` 保留原形，不能当成 RPC 传输错误。Host 通过精确 `POST /api/seal-harness-projects/invoke` Fetch 路由接收原 RPC 信封，仅 dispatch 已注册业务 channel；共享 `/api` interceptor 由官方 ApiGateway 独占。

Client 维护一个 `EventSource('api/seal-harness-projects/events')`，沿 DSH Connection Cookie 认证。每帧为 `{channel,payload}`，subscribe 按 channel 分发并返回退订。首帧及身份切换发 `project:account-changed`，payload 为 `{accountId:string|null,epoch:number}`，签出为 `{accountId:null,epoch:0}`；UI 收到即清理旧账号视图。`project:event` 是原领域事件和连接状态，Agent 另外发布 `project:agent-changed`。Host 仅有一条远端 Bearer SSE，保留游标重连、退避、resync、退出停止。卸载调用 bridge.dispose() 并关闭 EventSource。

## 文件与系统能力

实际 Host 是 utilityProcess，不能调用 Electron 主进程 dialog/shell/safeStorage。没有新增上游接缝。浏览器桥以公开文件选择、XHR、anchor 下载和 Notification 接入。

- 上传保持原 `uploadProjectFile/uploadProjectAssetVersion` 调用。桥选 File 后 POST `api/seal-harness-projects/upload?channel=project:file-upload` 或 `project:asset-version-upload`，原始 File body；`x-project-request` 是 encodeURIComponent(JSON.stringify(原请求))，`x-project-filename` 是 encodeURIComponent(file.name)。Host 流式暂存至自己创建的目录，原 client 以 raw bytes、Content-Length 上传远端。全程上限 1 GiB。renderer 不提交本地路径。
- XHR 本地传输进度和远端上传进度都使用原 progress 通道。cancel 同时中止 XHR 和原业务操作。资产两阶段失败保留原 resume；重试与丢弃使用原 RPC。保留临时源文件供上传阶段重试，成功、丢弃、切号或卸载时清理。
- 下载沿原 client 的流式写入、大小预算、净化文件名和失败清理，成功仅回 `{ok:true,savedPath:文件名,downloadUrl}`。桥以 anchor.download 访问认证 `api/seal-harness-projects/download?receipt=...`，Host 流式输出并删除临时文件。浏览器控制最终目录，UI 应显示“已交给浏览器下载”，不能宣称 Host 知道保存路径。
- 证据外链沿原语法判定，Host 返回规范化 url 后桥实际打开。没有任意 URL 下载或本机路径代理。
- 预览仍为原文本层 PDF/DOCX/PPTX/XLSX/TXT/MD/CSV/JSON 格式边界及预算，不提供 Office 排版保真。根构建负责 parser worker、unzipper、pdfjs-dist、@silurus/ooxml、ssf 的运行可达性。
- 数据源票据按账号键使用现有 DSH credentials provider 保存，遵从本次明确要求，不另建加密或 fallback。票据不回传 renderer。通知偏好按账号保存；浏览器通知沿原 mention/assigned/reviewRequested/draftsReady 规则与固定文案，点击发 notification-navigate。通知是否显示依赖平台权限，未做三平台系统验收。

## 验证

来源回归首轮 1159 通过。迁移 fixture、旧 UUID、Electron policy 和跨平台假路径适配后，针对失败的 6 组来源回归及 1 组 Host 检查合计 242 通过，包含真实 DOCX/PPTX/PDF 字节预览。新增 Host 检查使用真实 Cordis/Connection 及本地 HTTP 服务，覆盖项目列表、反代 `/root/api/v1`、上传原字节、下载原字节、SSE 首帧/取消和插件卸载。单独 TypeScript strict 检查通过。

根安装依赖后可从仓库根运行：

```sh
node dsh-plugin-desktop-beta/node_modules/vitest/vitest.mjs run --config seal-harness-desktop/plugins/projects/tests/host/vitest.config.mjs
```

这些是源码与本地 HTTP 夹具证据。真实账号远端验收、完整产品装配和 Windows/macOS/Linux 安装运行由根集成验收；本切片不把夹具结果报成线上通过。
