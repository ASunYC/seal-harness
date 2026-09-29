# 能力插件迁移进度

2026-09-26 对照 Stratex `c41b6bc098256495a168116bf2daed5f17df9193` 补齐产品入口。四个插件位于 `seal-harness-desktop/plugins/{store,skills,connectors,experts}`，通过产品 Cordis bundle 分别加载 Host 和 Client。没有修改 Stratex、固定子模块或继承的 Desktop 源码。

## 独立插件

| 插件 | 职责 |
| --- | --- |
| `@seal-harness/store` | 能力目录、详情、版本与发布管理；安装通过对应插件的 RPC 执行 |
| `@seal-harness/skills` | 技能来源、导入安装、编辑、启停及官方技能 provider |
| `@seal-harness/connectors` | 连接器配置、凭据与 MCP 运行时 |
| `@seal-harness/experts` | 专家包、版本、能力绑定、云端操作及原生 Agent preset；导出 `./expert-runtime` |

四个插件默认一起安装，但没有彼此的强制加载依赖，可分别禁用、卸载和重载。停用某类能力插件后，商店仍可浏览目录，但该类安装操作需要恢复对应插件。

`plugins/capability-shared/src` 保留共用后端协议、RPC 边界、面板注册与样式，构建时内联到各包，不是第五个运行时插件。四个包各自拥有模块实例、路由、请求取消和界面清理作用域；身份和服务地址仍由身份插件提供。

沿用 `seal-harness-capabilities/<模块>/<操作>` RPC、原侧栏 key、技能目录 `capabilities/skills`、专家目录 `seal-harness-capabilities/experts` 和连接器凭据键。拆包不搬迁或删除用户数据。构建只从 Desktop 装配目录清理旧聚合包，不保留其入口。

## 配置与用户插件接入

运行 `corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`。显式启动使用 `corepack yarn seal-harness:start`。

服务配置集中由身份插件的 `sealHarnessServices` 提供，能力插件读取 `storeBaseUrl` 和 `mcpCenterBaseUrl`。地址是服务根，例如 `https://example.test/collab/`，不要填写 `api/v1/stratex/`；客户端会追加业务路径。旧能力插件 `backendUrl/mcpCenterUrl` 及单独环境变量不再作为配置入口。数据跟随 `DSH_HOME`，默认 `~/.seal-harness`。

标准身份插件在能力插件之前提供 Host 服务 `sealHarnessIdentity`：

- `getSession()` 同步返回 `{ accountId, epoch, accessToken, subject }` 或 `null`；登录、退出和账号切换更新 `epoch`，普通刷新不改变它。
- `refreshSession()` 用于明确认证失效时的一次刷新，403 保留后端拒绝结果。
- `subscribe(listener)` 返回取消订阅函数；退出、账号切换通知订阅者。云端连接器与专家启用要求此契约，以及时卸载运行时。

令牌不发往 Client，不向 MCP Center 转发 Stratex 凭据。本地资源不依赖身份服务；云端资源绑定导入账号。当前不伪造用户或授权数据。

## 用户入口

| 模块 | 可用操作 |
| --- | --- |
| 商店 | published/mine/已安装、快照分页、搜索分类与排序、资产创建编辑删除、版本及依赖编辑、ZIP预检上传与导出、validate/release/publish/yank/delete、ETag冲突反馈、MCP Center安装、HTTP工具表单/测试请求及标准ZIP保存 |
| 技能 | 本地目录/ZIP预览导入、全局/项目来源扫描、相同内容位置合并和默认位置、独立包资源快照、完整文件编辑、新建、批量启停、详情/导出/移除、官方provider、云端解析及混合MCP依赖安装、安装结果同步、流程资源导出 |
| 连接器 | 本地/商店/MCP Center安装，stdio/Streamable HTTP/SSE、OAuth发现与固定元数据、token exchange、HTTP adapter、凭据字段、环境与参数、工具选择、启停/重连、工作区绑定和初始化 |
| 专家 | 创建编辑、人设/模型/推理强度、快捷问题、不可变版本及旧版本选择、导入导出/云上传/可见性、技能/MCP/知识绑定、便携依赖、原生预设和开始对话 |

商店安装直接执行所选操作，不新增信任确认。连接器使用 DSH 原生工具和执行决定，不叠加产品强制审批。专家运行复用原生工具、技能和知识库，不因旧包的工具策略字段拒绝整包激活。HTTP工具执行和模型错误如实显示；连接器初始化成功不代表此后持续在线。

Git 入口复用已经迁移的项目 Git 界面；对话里的 Git 操作由 DSH 原生工具承担，不再复制来源工作台及其审批流程。当前 Stratex 已收敛为单专家，旧专家团、多Agent计划和社区插件宣传的技能回收站不计入此次来源功能。

技能、连接器向流程部署提供 `workflowResources/workflowExport`，便携专家依赖通过对应模块解析和安装。携带凭据的导出只在 Host 间调用，不暴露为 Client RPC。共享代码随模块内联，未建立另一个能力服务。

## 验证边界

2026-09-26：最终 `seal-harness:build`、`seal-harness:check` 通过，共 1345 项测试，包含 41 项商店/连接器/技能模块回归；HTTP 工具实际请求、标准工件与双向并发依赖安装通过本地协议验证。Electron 中验证真实商店安装及专家原生对话，详见本轮验证记录。

2026-09-24：四插件拆分后 `seal-harness:build`、`seal-harness:check` 通过，完整产品 1270 项测试及类型检查通过，实际 Profile 和两次 HMR 通过。能力回归 37 项覆盖独立 Host/Client 装卸、重载、原数据恢复、商店安装确认及目标插件不可用时的错误显示。本次未启动图形应用或执行分发安装验收。

2026-09-23：`seal-harness:build`、`seal-harness:check` 通过，能力模块 37 项测试全绿。

本地检查覆盖真实 Cordis 技能注册、stdio/HTTP/SSE MCP初始化与调用、HTTP adapter、OAuth及token exchange、工作区初始化、凭据隔离、账号变化、官方专家预设 roster/resolve/重载、标准RPC挂载卸载和已编译Client交互。`seal-harness:build` 与 `seal-harness:check` 是产品入口。

历史记录中的后端测试使用本地HTTP协议夹具；本轮实际商店、知识服务、Electron界面及原生会话的结果单列在[验证记录](validation.md)。DOM测试不等于Electron视觉验收。没有执行Windows/Linux打包、签名、安装或升级验收。社区候选与热度见[插件选型](capability-plugin-research.md)。
