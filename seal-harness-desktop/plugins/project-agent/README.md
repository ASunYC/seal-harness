# 项目 Agent

Seal Harness标准 Host 插件，将 Stratex `c656400bc4baf80733a9ac5d8a1440539126c7e0` 项目工具接入 DSH `0.1.7-alpha.2`。只使用已安装公开服务，未修改固定内核子模块。迁入文件及原始 SHA256 见 `provenance.json`；Stratex 标注 UNLICENSED，属于本次授权的内部产品迁移，不改变其许可。

## 工具

从 `managed-thread-config.ts`、`projectCollabToolExecutor.ts` 和 `project-reference-tools.ts` 核对，保留全部 20 个声明和执行语义：

| 范围 | 工具 |
| --- | --- |
| 讨论与成员 | `project_list_messages`、`project_list_members` |
| 需求和任务 | `project_list_todos`、`project_read_work_order`、`project_create_todo`、`project_update_todo` |
| 拆解与交付 | `project_draft_requirements`、`project_draft_tasks`、`project_submit_work_order`、`project_post_update` |
| 项目文件 | `project_list_files`、`project_read_file`、`project_save_asset` |
| 规划 | `project_list_milestones`、`project_list_iterations`、`project_draft_milestone`、`project_draft_iteration` |
| 本地只读参考 | `project_list_reference_files`、`project_search_reference_files`、`project_read_reference_file` |

业务执行器复用 projects Host 的 `clients`，没有第二套 HTTP 客户端。文件正文通过公开 `@seal-harness/projects/documents` 导出解析，复用同一份 worker 和解析依赖。

工具由 `agents.create/resume` 的 `setup` 注册到 `agentCtx.tools`，并核对 `exec.agent` 是实际绑定的 Agent；继承工具名称的未绑定子 Agent 不能借用父 Agent 项目。模型参数不含账号、项目或会话选择。工具输出声明 DSH schema/render，失败进入真实工具错误结果。写工具使用 `approval.request`，工具取消经 `ProjectService.withSignal(exec.signal, ...)` 传至共享 HTTP 客户端。

## 会话与 UI 桥

项目绑定持久化于 DSH Home 的 `seal-harness-project-agent/bindings.json`，按账号和真实会话 ID 定位，不存令牌。创建和恢复重新读取项目成员、说明与已发布 AI 规则。新建会话可提交一次首消息；打开会话不重复发送。不同项目的会话各自保留工具绑定，切号清除规划暂存并撤销原账号工具。原生 DSH 恢复也通过 `agent/created` 重新装配绑定。项目列表通过公开 `sessionQuery` 读取真实会话、最新标题及日志时间；绑定文件只保存关联，不复制可变会话元信息。

| 方法 | 通道 | 成功结果 |
| --- | --- | --- |
| `listProjectSessions({projectId})` | `project:session-list` | `{ok:true,sessions:[{sessionId,title,updatedAt}]}` |
| `createProjectSession({projectId,text?})` | `project:session-create` | `{ok:true,sessionId}` |
| `openProjectSession({projectId,sessionId})` | `project:session-open` | `{ok:true,sessionId}` |
| `listProjectLocalWorkspaces({collabProjectId})` | `project:workspace-list-local` | `{ok:true,workspaces:[{localProjectId,displayName}]}` |

会话失败使用 `{ok:false,code,message}`。创建前需选择项目工作目录；没有目录时返回 `workspaceRequired`。Client 使用 `ctx.uiWorkspace.openSession(sessionId)` 和 `ctx.layout.selectPanel(null)` 进入原生对话。

`resolve/selectProjectWorkspace`、`selectProjectLocalWorkspace`、项目及工作区关联目录的 list/add/remove、规划草稿 list/discard、规格辅助 readiness/generate/cancel 保持原请求/结果 schema 和原通道。最近目录直接来自真实 `workspaceRegistry` 的 UUID、path、title；没有另造工作空间列表。选择新目录使用公开原生 `directoryPicker`。

`project:agent-changed` 事件携带 `{projectId,sessionId,tool}`，UI 据此刷新项目数据和草稿。里程碑/迭代草稿仅暂存，人工审阅后由既有 projects 新建通道提交；需求/任务拆解仍走原远端草案协议。

原生 DSH 全局历史保留设备级语义；项目入口和项目工具按账号绑定，本插件不改全局历史可见性。

## 验证

插件目录执行：

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

正式集成由根 `seal-harness:check` 提供依赖和 launcher；产品仅需标准父目录 `seal-harness-desktop/node_modules`，不要求插件独立安装或锁文件。

2026-09-23：5 项真实运行时测试通过。使用真实 Cordis、DSH AgentLoop、Tools、Approval、SessionQuery、SessionTitle、JSONL persistence、WorkspaceRegistry、项目 HTTP 客户端及本机 HTTP 协议夹具；仅替代模型传输、身份会话和系统选目录。

已验证模型发现 20 工具、读取成员、审批后 HTTP 发布动态、只暂存里程碑草案、刷新事件、参考目录真实文件读取、多个项目会话各自访问所属项目、原生恢复重新注入、账号切换撤销、规格辅助无工具生成、审批拒绝和取消在飞 HTTP。项目列表验证了原生重命名、继续对话后的时间、冷会话标题及删除底层记录后的消失。TypeScript 严格检查通过；Host 构建产物可 import，文档解析器保持外部公共导入。

尚未执行真实后端登录/远端写入、完整产品 UI 操作或三平台安装；这几项不能由本地夹具结果替代。
