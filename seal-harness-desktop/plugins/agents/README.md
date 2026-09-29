# 智能体实例插件

来源为 Stratex `c41b6bc098256495a168116bf2daed5f17df9193` 的 `AgentInstancesView.vue`、实例服务和发布资源。`stratex/provenance.json` 记录迁移服务源文件 SHA256；迁移为产品 JS 源码后由Seal Harness维护，不依赖外部源码目录。来源仓库未单独声明根 LICENSE；此目录保留来源归属，不重新授予第三方代码许可证。

- 本机自主型使用 DSH `agents.create/resume`、现有模型/工具与原生 `uiWorkspace.openSession`。创建和恢复都会通过 `workspaceRegistry` 绑定会话，并显式落盘空会话。实例目录位于当前 Home 的 `seal-harness-agents/native-agents.json`，删除目录记录保留会话历史。
- 本机流程型使用随附 `workflow-cli` 和已发布 `stratex-langgraph:0.1.14`；准备组件优先导入显式目录中的 tar，否则拉取发布清单里的镜像并核对 image ID。Docker 需可用，镜像仓库使用已有 Docker 登录。
- 固定主机使用来源 SSH2 发布协议与 `autonomous-linux` / `workflow-linux` 资源；只部署既有镜像，不携带或修改 Agent 内核。移除了来源 Hermes 内核 patches、模型授权门禁、Windows 自主运行器和文件权限修复逻辑。远端 `.env` 和 stdin 临时凭据文件的保护属于实际部署凭据处理，保留。
- 智枢使用原 `api/v1/terminal-instances` 协议，自主型 `mode: react`，流程型 `mode: planner`。服务地址来自 `sealHarnessServices.terminalBaseUrl`；流程运行包显式目录来自 `workflowRuntimePackDirectory`。没有第二套服务配置或保存机制。
- 资源通过独立 `sealHarnessSkills` / `sealHarnessConnectors` / `sealHarnessKnowledge` Host 服务按选择导出，含凭据的部署包不经过 Client RPC。

构建将 `resources/` 复制到 `lib/resources/`。`ssh2` 为实际运行依赖；DSH 和 pi-ai 公共模型目录复用产品安装版本。插件卸载移除标准 Connection Fetch RPC、取消 HTTP / SSH / 流程 CLI 操作，并关闭本机实例目录中的 Agent，保留普通对话。

定向检查：`node --test seal-harness-desktop/plugins/agents/tests/*.test.mjs`。协议夹具、真实 Cordis 装卸和已编译 React UI 已覆盖；真实平台部署、镜像行为及桌面对话由产品集成验收记录，不以夹具替代。

产品 Profile 停用默认 `agent`，加载 Host 子入口 `@seal-harness/agents/registry`。它继承公开 `AgentRegistry`，通过 `super.create/resume` 保留原始句柄和调用方归属；`releaseInstance(id)` 取消在途初始化并调用原始 disposer。因此从原生历史列表恢复的实例也可停止、删除和重启。旧代清理按 Agent 对象身份匹配，不影响同 ID 的新实例；没有复制运行时或访问私有字段。
