# 插件内部界面对齐

来源固定为 Stratex `070ba39e82a4d47dec812870b691eedcb7f7b28e`。本轮迁移六个产品插件内部页面，并按用户后续要求补齐项目会话列表空态图标，保留 DSH 窗口框架和其余侧栏；隐藏产品独立“能力商店”菜单，公开目录由技能、连接器、专家承接。保留原生会话与输入框。现有 Host 协议与身份数据继续使用；文件预览、连接器元数据及工具试运行只补充来源主要操作所需的兼容接口。

## 来源与页面覆盖

| 插件 | 来源页面与组件 | 目标覆盖 |
| --- | --- | --- |
| 商店服务/技能云端 | StoreView、SkillCatalogExperience、技能详情抽屉 | 不注册独立导航；复用于技能页的公开/个人目录、分类双栏行、筛选、概览/文件/版本、云端草稿与发布弹窗 |
| 技能 | SkillCatalogExperience、SkillDetailsDrawer、文件工作台 | 已安装/本地来源、表格与位置副本、导入、新建、预览/编辑/未保存保护、批量启停 |
| 连接器 | ConnectorsView、MCP 目录/详情/管理组件 | 个人/被授权/公开分区、安装横条、新建/导入、工具选择、连接配置、参数表单和试运行结果 |
| 专家 | ExpertsView、ExpertEditorView、专家详情/管理组件 | 目录、详情、快捷问题、完整双栏编辑与能力绑定、云端管理、版本和导入弹窗 |
| 知识库 | LibraryView → VaultLibraryView、VaultLibraryCollections/Dialogs | 范围/场景筛选、资料集概览/文件、上传队列、预览、授权与服务管理 |
| 智能体 | AgentInstancesView、AgentInstanceCenter、WorkflowCreationModal、LocalWorkflowPanel | 运行概览、分组卡、类型选择、发布位置与分步配置、真实任务进度、流程管理/资源 |

逐页来源、交互及接受差异记录在`.trellis/tasks/archive/2026-09/09-26-plugin-ui-*` 子任务的 `ui-matrix.md` 和 `icon-matrix.md`；来源许可和样式出处随各插件保留。资源页基础尺寸/间距复用来源 CSS，仅颜色接入 DSH 主题。各插件作用域隔离，未增加独立 Vue 运行时或新依赖。

## 真实桌面验证

验收时 Home 为 `/tmp/seal-harness-plugin-ui-acceptance/home`，原账号配置只复制至该隔离目录。验收后已停止两个 Electron 实例并删除来源/目标临时 Home、配置副本和测试数据，保留日志与截图。当前来源 renderer 在临时目录从固定 HEAD 编译，配对来源已有 main/preload 进行 UI 检查；这不代表来源后台也从当前 HEAD 重编。早期旧产物截图标为 `legacy-*`，不用于通过结论。

截图目录：`/Users/xieyuqi/.codex/visualizations/2026/09/26/01a0db2e-d2a0-7ff1-a7dd-3c4188f94d30/ui-evidence`。截图可能包含用户目录、资料和侧栏信息，仅保存在本机，不提交 Git。`before-fix` 文件记录缺陷，不作为最终通过证据。

- 智能体：真实创建隔离本机自主型实例，打开 DSH 原生会话并保留模型/工作区控件；检查类型选择、三位置向导、本机运行环境检查。没有完成 Docker/SSH/智枢远端部署，流程详情与资源交互的覆盖来自实际 React 定向测试。
- 知识库：读取真实公开目录，打开资料集概览、文件和原文预览，验证 Esc 关闭/还焦、创建表单和双栏服务管理。未改已有资料或分享权限。上传队列、取消/迟到结果隔离、授权修改/撤销由定向交互测试覆盖。
- 技能：在隔离 Home 真实新建并保存技能，打开紧凑概览与 Markdown 文件工作台；隐藏独立商店后，真实从“技能”默认进入公开目录；公开/个人平台顶栏的“创建 Skill”“导入 Skill 包”可直接进入原有本地工作台/导入弹窗，三个入口均已实际点击。长文件名省略并保留完整 title，详情底部安装/导出保持可见。
- 商店：真实目录和详情读取通过；首次实网发现单独版本 GET 返回 405；已统一从资产详情读取版本，公开技能文件树与 Markdown 内容回验成功。
- 专家：真实全页编辑并保存隔离专家，验证管理、版本历史和详情的原生工作区入口。公开目录挂载自动加载，实网读取 13 项，按来源名称/描述/标签分类为办公 9、开发 4，与来源同一“界面设计专家”的头像、分类、标签和正文层级已对照。
- 连接器：创建布局、失败保留草稿及退出确认已验证；无关工具 schema 导致保存后列表失败，已收窄到本插件注册工具后读取公共 tools.get。真实编辑保存停用连接器、返回列表及刷新均成功；冷启动自动读取公开目录 15 项。

## 产品适配边界

知识库检索保留为详情第三页签，使用现有 DSH 会话选择和草稿追加；上传沿用资料集分类。智能体本机自主型使用 DSH 原生会话，部署权限与运行协议不移植另一套门禁。云端技能文件写入继续使用已有 ZIP 替换协议，二进制或大文本可导出查看。连接器工具测试复用 DSH ToolRuntime；需要审批或限定工作区的调用仍由原生限制拒绝。

本机 macOS UI 与定向测试不代表跨平台安装、真实远端部署、生产分享权限或模型回复验收。隔离 Home 的应用内重启发现既有账号路径重复拼接，验收采用同一基础 Home 冷启动；本轮未修改继承 Desktop 启动路径。

## 图标与项目定制边界

资源页共用固定来源 Lucide 1.31.0 SVG 节点，保留 ISC 许可证；Skill 文件树、详情和 MCP 工具动作使用来源内联 SVG 的原 viewBox/path。来源首字头像与纯文字按钮保留；字符模拟图标改成 SVG。三个资源页通过公开 layout.selectPanel(null) 返回原生会话。

项目补查核对非定制区域 20 个含图标的同名 Vue 文件，其中 17 个 AppIcon/内联 SVG 标签一致；AppIcon 是现有静态适配，ProjectDetailView 的差异属于定制助理区域而保留。唯一补齐为 ProjectSessionsPane 会话列表空态：恢复来源 56×56 显示器 SVG，复用既有 pjsess__art。现有项目对话框、右侧会话、输入框的布局、样式、交互及内部图标均不回迁。真实项目列表及详情的页签、表格/看板、筛选、搜索、管理图标已检查；截图为 seal-harness-projects-icons-list/detail.png。项目会话页有 5 条本机记录，seal-harness-projects-sessions-list.png 证明实际列表和保留的项目助理；空态 SVG 仅按来源代码及构建核对，未声称真实空态截图通过。

## 最终检查与交付

最终代码提交 `e661ac04ff`：`corepack yarn seal-harness:build`、`corepack yarn seal-harness:check` 均退出 0。检查包含 154 项 Node 测试、1210 项 Vitest 测试，品牌与 10 个业务插件、Profile 组合、资源及零更新请求、两代 Profile HMR 验证通过。日志分别为 `/tmp/seal-harness-ui-final5-build.log`、`/tmp/seal-harness-ui-final5-check.log`。此前真实 UI 发现的问题均重新验证；无模型回复、生产写入或跨平台安装结论。

以下最终截图位于上述本机证据目录；专家、连接器、知识库和技能文件截图来自 `3a1809ea45`，随后 `e661ac04ff` 仅补技能入口，技能列表/创建/导入及智能体截图来自该最终构建。

| 验证对象 | 截图文件 |
| --- | --- |
| 技能公开目录及顶栏动作 | `seal-harness-skills-public-list.png` |
| 公开页直接创建与导入 | `seal-harness-skills-public-create.png`、`seal-harness-skills-public-import.png` |
| 文件树、Markdown、长文件名、完整底部操作 | `seal-harness-skills-public-files.png` |
| 专家个人空态/9:4 场景及公共详情 | `seal-harness-experts-public-list.png`、`seal-harness-experts-public-detail.png`，来源配对 `stratex-current-experts-detail.png` |
| 连接器列表动作与创建 | `seal-harness-connectors-list.png`、`seal-harness-connectors-create.png` |
| 知识库场景/卡片/详情 | `seal-harness-knowledge-list.png`、`seal-harness-knowledge-public.png`、`seal-harness-knowledge-detail.png` |
| 智能体列表、类型和发布位置 | `seal-harness-agents-list.png`、`seal-harness-agents-create.png`、`seal-harness-agents-deploy.png` |

五个可见子任务均串行 rebase/ff-only 合入。清理前各树干净且全部提交为根 HEAD 祖先；对应 worktree/分支已删除，Codex 与 Trellis 子任务已归档。心跳 `automation-4` 已暂停。

上级复核实际 diff、逐页来源矩阵和最终截图后，将根提交 `b666f5f64e` 快进合入 `feature/sync`。在 `/Volumes/workspace/code/seal-harness` 重新运行 `corepack yarn seal-harness:build` 和 `corepack yarn seal-harness:check`，均退出 0；154 项 Node、1210 项 Vitest 及两代 Profile HMR 再次通过，日志为 `/tmp/seal-harness-ui-land-build.log`、`/tmp/seal-harness-ui-land-check.log`。根工作树和分支已安全删除，根 Codex 任务已归档；未 push。项目定制对话框保留，真实验收的边界仍以上文为准。
