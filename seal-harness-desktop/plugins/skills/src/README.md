# 技能模块

`createModule(ctx, { home, backend })` 返回 `handlers`、仅 Host 可用的 `hostHandlers` 和 `dispose()`。Host 使用已安装的 `@deepseek-ai/dsh-skill-filesystem` 公开 `FileSystemSkillProvider`，通过当前 Cordis scope 的 `skills.registerProvider()` 注册；不修改上游，也不执行导入包中的代码。`SkillsPanel({ api, signedIn, openLogin })` 位于 `panel.jsx`。

| RPC 动作 | 输入 | 结果 |
| --- | --- | --- |
| `skills/list` | 无 | `revision`, `skills`, `pendingReports` |
| `skills/sources` | 无 | 全局标准根、当前工作区标准根和自选目录 |
| `skills/approveSource` | `path`, 可选 `label`, `expectedRevision` | 添加后的来源列表 |
| `skills/revokeSource` | `id`, 可选 `expectedRevision` | 移除后的来源列表；保留已导入副本 |
| `skills/discover` | 可选 `sourceId`、`projectRoot` | 按完整内容合并的位置列表与逐项诊断 |
| `skills/setDefaultCopy` | `contentHash`, `sourceId`, `key` | 当前账号的默认位置；刷新原生提供方 |
| `skills/inspect` | `path`、`zipBase64` 或 `sourceId` + `key` | 十分钟有效的导入 `token` 和候选 |
| `skills/import` | `token`，可选 `entries`, `enable`, `expectedRevision` | 导入的技能；默认停用 |
| `skills/detail` | `id`，可选相对 `path`、`edit` | 默认最多 16000 字符预览；编辑请求返回完整文本（单文件 16 MiB 上限） |
| `skills/setEnabled` | `id`, `enabled`，可选 `expectedRevision` | 当前列表；启用前验证副本哈希 |
| `skills/remove` | `id`，可选 `expectedRevision` | 仅移除Seal Harness副本后的列表 |
| `skills/export` | `id` | ZIP 的 `fileName`、`zipBase64` |
| `skills/install` | 商店 `id`, `version`，可选 `enable`, `expectedRevision` | 安装结果、`resolutionId` 和 `reported` |
| `skills/retryReports` | 无 | 当前账号的待发送回执是否全部完成 |

状态及副本位于 `<home>/capabilities/skills/`。来源目录只读；不覆写同名技能。管理请求串行且支持 revision 冲突拒绝。ZIP 与目录导入拒绝路径穿越、符号链接、特殊文件、Windows 保留名、大小写冲突，限制为 64 MiB、每文件 16 MiB 和 2000 文件。只读扫描最大深度 8、最多 5000 目录；导入最大深度 16。导入先复制到临时目录，完整成功后发布状态。

商店安装保留 `POST installations/resolve`、版本 `export` 下载和 `POST installations/{resolutionId}/result` 协议，校验每包大小及 SHA-256。结果回执和安装状态一起保存；断网后可手动重试。商店副本绑定账号；注销或切换账号后不能列出、管理或通过 skills 服务加载另一账号的副本。存在商店副本时不缓存提供方目录，加载正文时核对当前账号。原账号已加载进历史对话的内容不会被清除。

本地导入不依赖用户插件。运行时保留 DSH 的 scope、同名优先级、`disable-model-invocation`、`user-invocable` 和资源目录语义。技能声明的商店权限保留于详情；执行文件/命令仍走 DSH 自身工具与授权流程。

## 已验证

`node --test seal-harness-desktop/plugins/skills/tests/skills.test.mjs` 覆盖真实已安装 DSH 注册表与文件系统提供方的注册、加载、停用、卸载、作用域、资源读取、持久化；同时覆盖源目录不变、ZIP 安全、并发 revision、取消、后端安装哈希、账号切换和回执重试。`SkillsPanel` 通过 tsdown 编译和 React 服务端渲染检查。图形交互与真实后端由产品集成验收记录，模块测试不替代这些结果。

## 来源与会话语义

项目标准根从公开 `workspaceRegistry` 的工作区路径派生，包含 `.claude/skills`、`.codex/skills`、`.grok/skills`、`.pi/skills` 和 `.agents/skills`；全局 Pi 使用 `~/.pi/agent/skills`。项目技能按会话 `cwd` 进入原生技能目录，无需先复制导入。相同内容按文件内容哈希合并展示，默认位置按账号保存，覆盖同组提供方排序。用户目录、技能页扫描和默认选择均是来源管理，没有额外信任确认。

DSH 原生 `skill` 工具和 `agent/pre-step` 保存会话中的技能正文、处理显式技能调用及目录变化。独立 SKILL.md 包在读取时将资源目录指向内容快照，后续来源编辑/删除不影响已有快照。DSH 额外支持平铺 Markdown，它的 `resourceBase` 是整个来源根；本模块保留其原生共享目录语义，不复制整个技能集合。平铺文件可被原生提供方加载，管理导入仍使用独立 SKILL.md 包。

商店安装通过 Host `sealHarnessConnectors.installResolved` 安装 MCP 依赖；每个技能依赖保留自己的资产/版本来源，同版本并发安装复用现有副本。专家包由专家模块展开便携依赖。停用管理副本不修改其他提供方，原生同名优先级和 scope 继续有效。

版本回滚/回收站并非当前 Stratex skill-store 的独立管理入口，不能把下面社区插件的能力算作本次缺口。包容量限制及图形/跨平台验证边界见上文。

## 现有插件调研

只读查看了 [MichengAI/dsh-skills-manager](https://github.com/MichengAI/dsh-skills-manager)、[dsh-web 的 skill-explorer](https://github.com/zhu1090093659/dsh-web/tree/dev/packages/dsh-skill-explorer) 和 [AKS1st/dsh-skill-manager](https://github.com/AKS1st/dsh-skill-manager)。前者提供丰富的来源、GitHub 仓库、回滚及回收站管理，但依赖其固定 HTTP/WebRuntime/更新入口；后两者直接修改或移动所管理的技能源文件。它们的现有入口不能直接作为本模块的 Stratex backend 适配器。本模块复用已经安装的 DSH 文件系统提供方，没有安装或复制这些社区插件。

Host 专用服务包含 `runtimeSkill`（专家作用域加载）、`workflowResources`、`workflowExport`（流程部署）和 `installResolved`（连接器安装的技能依赖）。这些接口不注册为浏览器 RPC。

## 页面来源

本地页面结构、目录行、扫描范围与文件工作台来自 Stratex `070ba39e82a4d47dec812870b691eedcb7f7b28e` 的 `SkillCatalogExperience.vue`、`LocalSkillCatalog.vue`、`LocalSkillScopeGroup.vue`、`SkillWorkbench.vue` 和 `SkillFileEditor.vue`，受限 Markdown 渲染器移植自 `skill-markdown.ts`。样式保留来源尺寸与层级，并限制在 `.zz-resource-page.zz-skills`。侧栏仅显示“技能”；默认公开目录，个人下分“Seal Harness·开发者平台 Skill / 本地 Skill”。云端目录、详情与安装静态复用商店 StorePanel 和已有 RPC；本地保留“已安装 / 发现本地”管理。商店 Host 服务保留，Client 不注册独立 main/sidebar。技能 Client 订阅身份并在 account/epoch 改变时重建页面；未登录不请求云端，本地仍可访问。

`skills/inspect` 的候选额外提供最多 16000 字符 `instructionPreview`，供导入前查看正文。`tests/ui.test.mjs` 编译实际 React 页面，验证文件树、保存哈希/修订、未保存离开和来源导入。使用其他 worktree 已安装工具时设置 `SEAL_HARNESS_TEST_TOOLS_ROOT`，不会修改该目录依赖。商店复用本目录 `files.jsx` 的文件树/受限正文组件，构建内联，不构成运行时插件依赖。
