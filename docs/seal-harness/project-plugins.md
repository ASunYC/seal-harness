# Seal Harness账号与项目插件

项目业务来自 Stratex `c656400bc4baf80733a9ac5d8a1440539126c7e0`。Seal Harness通过标准 DSH Host/Client 插件接入，沿用远端身份、项目协作、商店和连接器接口。

## 使用

1. 执行 `corepack yarn seal-harness:build`，再用 `corepack yarn seal-harness:start` 启动。
2. 在侧栏“账号”登录；服务地址集中配置于 `DSH_HOME/services.yml`，默认 Home 为 `~/.seal-harness`。配置示例见[身份插件](../../seal-harness-desktop/plugins/identity/README.md)。
3. 打开“项目”，选择项目并绑定项目工作空间。
4. 在“项目助理”输入工作要求，点击“发送并打开会话”。该入口创建真实 DSH 会话，并绑定当前账号、项目和工作空间。
5. 在项目“会话”页签恢复已有项目会话。项目说明和已发布 AI 规则随绑定注入；模型沿用 DSH 的默认模型设置。

项目页保留动态、里程碑、需求、任务、测试、交流、会话和资产八个业务页签，以及成员邀请、项目约定、数据源、字典和规划草案审阅。远端接口负责角色、版本冲突、配额和业务状态约束。

## 插件分工

| 插件 | 职责 |
| --- | --- |
| `@seal-harness/identity` | 登录、刷新、退出、改密与集中服务配置 |
| `@seal-harness/store` | 能力商店，调用各能力插件安装 |
| `@seal-harness/skills` | 技能管理与运行时接入 |
| `@seal-harness/connectors` | 连接器与 MCP 运行时 |
| `@seal-harness/experts` | 专家管理与 Agent preset |
| `@seal-harness/projects` | 项目 HTTP 协议、事件同步、文件及原 Vue 业务界面 |
| `@seal-harness/project-agent` | DSH 项目工具、上下文、会话、工作空间及规划草案 |

产品组合见 `seal-harness-desktop/cordis.patch.yml`。Vue 业务子树通过 React slot 挂载；项目 HTTP 和登录令牌留在 Host，客户端使用 DSH Connection。

Agent 复用原有 20 个项目工具，覆盖成员、交流、需求任务、工单、文件、计划与参考目录。直接写操作使用 DSH 审批；规划工具先生成草案，待用户审阅采纳。原生 DSH 历史仍是设备级历史，项目入口和工具绑定按账号与项目区分。

登录与个人票据复用 DSH credentials；默认凭据文件不是 OS 加密存储。密码不保存。记住登录后的恢复仍通过真实刷新接口验证。

集团统一认证使用系统浏览器，返回地址为 `seal-harness://auth/netauth/callback`；部署端需允许该地址。企业微信登录使用临时原生窗口，在同一 Cookie 会话内完成交换。真实账号授权、服务端回跳白名单与安装后的系统协议回跳尚未验收。

## 构建与验收

产品仍使用根 Yarn 单一锁文件，产品包不加入根 workspace。文档解析公共入口为 `@seal-harness/projects/documents`，构建时保留同目录 worker 及其声明的运行依赖。第三方来源、原始哈希与各模块检查入口位于插件内的 README、HOST、UI 和来源清单。

`corepack yarn seal-harness:check` 是产品检查入口。具体迁移覆盖和当前验收边界见[任务功能清单](../../.trellis/tasks/archive/2026-09/09-23-stratex-project-migration/feature-matrix.md)。协议夹具、模拟模型下的真实 DSH 引擎执行、真实后端账号验收和跨平台安装验收分别记录。

2026-09-23：产品构建、1261 项检查、完整类型检查、实际 Profile 与两次 HMR、188 个双变体共享文件检查通过。本机 Electron 44 的隔离启动、账号入口与原生登录本地夹具通过；未执行真实账号登录、远端写入或三平台分发包验收。
