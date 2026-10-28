# Seal Harness 桌面构建契约

## 工程边界

根仓库直接继承 DSH Desktop；`deepseek-harness/` 是只读的固定提交子模块。产品身份、海豹图标、插件、bundle、Profile 与构建接入归 `seal-harness-desktop/`。它不是根 Yarn workspace，不安装第二套 DSH 运行时或创建第二份锁文件。优先使用上游公开服务、事件、slot 和插件组合。共享 Desktop 代码确需修改时，按根 `AGENTS.md` 执行 Beta 先行与双变体验证。

Node 要求 `^22.19.0 || >=24.0.0`，根 Yarn 固定 `4.18.0`。使用 `corepack yarn seal-harness:build` 编译产品插件并装配 Beta Desktop；`seal-harness:check` 是无图形产品验证入口；`seal-harness:start` 显式启动图形应用；各 `seal-harness:dist:*` 在目标操作系统打包。上游 `build` 与产品 `seal-harness:build` 共享编译目录，不并行运行。发布前仍按根发布流程准备 Agents Anywhere 产物，签名和跨平台安装分别实测。

内核 0.2.x 的 Desktop Host 在 `boot` 之前提供 `profileContext` 与 `appReady`，并在成功绑定 Host 后发出 ready；嵌入式 Host 和图形主进程必须走同一接入。官方 `pluginPackages` 服务沿 Profile 包解析器取得安装包元信息，包操作及热重载后刷新选择。恢复模式中的独立 CLI 使用新版 `manageDesktopProfile` 授权，并把随包 pnpm 脚本以绝对路径提供给 `packageManager`；Windows 上不能只靠 PATH 查找 `.cmd`。Stable/Beta 的该共享行为保持镜像，Next 实验壳保留自己的上游来源与运行时 pin。

Electron 44 内置 Node 24.18.1；Stable/Beta 必须直接使用支持它的 `node-addon-require-builtin` 0.1.9 或更新兼容版本。0.1.4 在 Windows Electron 下报 `Unsupported/no-realm`，`ModuleLoader.fromInternal()` 因此不可用，官方 `readPluginMeta()` 会为实验性插件返回 `Plugin metadata requires the Node module resolver`。两变体的无图形验证应在 `ELECTRON_RUN_AS_NODE=1` 下用各自 Electron 可执行文件读取一个实际插件的标题和图标；普通 Node 的同一测试不能覆盖该问题。保持插件元信息与 Host Profile 解析器一致，不把错误简单隐藏成空信息。

`product.json` 是产品名、应用 ID、数据目录与更新渠道的来源。名称是 Seal Harness，应用 ID 是 `com.seal-harness.desktop`，默认 Home 是 `~/.seal-harness`；显式 `DSH_HOME` 覆盖保留。社区 DSH 更新渠道不得作用于产品。海豹图标原图和派生资源由 `assets/`、`icon-provenance.json` 和 `scripts/export-product-icons.py` 管理；保留 Git LFS 与来源记录。构建产物不入库。

## Electron 浏览器 MCP 子进程

1. **范围与触发**：内置 Playwright MCP provider 用 `process.execPath` 运行 npm CLI。进程内 Electron Host 的该路径不是普通 Node；缺少子进程模式标志会导致 Connection closed，继而阻断 standard 会话创建。
2. **接口**：沿官方 `mountSessionMcp(ctx, { command, args, env })`，在 `dsh-experimental-browser-use-playwright-mcp@0.2.1-rc.2` 的 Yarn 补丁中补齐环境；不编辑只读子模块，不更改 provider Config 或 MCP 协议。
3. **契约**：当且仅当 `process.versions.electron !== undefined` 时，在该 MCP 的 `env` 写入 `ELECTRON_RUN_AS_NODE=1`。不向主进程全局环境写入该值，以免 Chromium、GPU 和网络子进程误入 Node 模式。
4. **错误矩阵**：普通 Node 不额外添加标志；Electron 的该 npm 子进程携带标志。真实 MCP 启动/同步错误仍由原来的 failOnStartupError 返回，不吞错、不禁用浏览器。
5. **案例**：同一 CLI 在普通 Electron 模式关闭连接；带局部标志后返回真实浏览器工具。标准会话创建成功且包含 browser_snapshot，不能只把 Renderer healthy 当成会话可用。
6. **必需测试**：产品 `verify-profile.mjs` 以 Electron Node 模式执行真实 Profile；CJS 引导先为基础 DSH_HOME 设置独立临时目录，再清除父进程的全局 Node 标志，随后创建 standard 会话并检查浏览器 MCP 工具，最终再确认 Host 环境未受污染。产品数据库按基础 Home 打开，不能只隔离 Profile 目录。保留 Creator、插件管理器及两轮 HMR 检查。新会话和决策入口还须图形实测。
7. **错误与正确实现**：错误：全局设置 ELECTRON_RUN_AS_NODE 或关闭浏览器 provider 来让会话创建通过。正确：保留旧版本已有的局部启动兼容补丁，为新运行时独立加入 patch resolution，校验不可变安装与实际握手。

## 公开 Loader 与配置 HMR

公开 Loader 没有内部 ESM 缓存；rc.2 的 HMR 在初始化时就计算入口模块，因此 `hasEsmCache()` 必须先排除缺省的内部接口。保留 Profile 配置监听，模块级 HMR 的内部接口要求不变；实际验证必须完成两轮配置热重载，不能通过禁用 HMR 条目消除未激活告警。

## 持久化兼容验证

持久化迁移与打包冒烟通过共享 `loadJsonlSessionPersistence()` 加载 JSONL 后端：Stable 使用默认类入口，rc.2 使用公开模块 `apply` 入口，并显式导入 `dsh-session-persistence` 的 Context 服务声明。保持真实迁移和原日志不变的断言；不要用任意类型转换或删除旧会话迁移检查来消除 API 差异。

## WebServer 绑定端口

DSH rc.2 的 `webServer.port` 在监听完成前可为 `undefined`。Desktop 通过 `requireDesktopWebPort` 验证后再生成渲染器 URL 或附加 LAN 边缘，不回退到默认端口；Market 路由在每次请求时读取绑定端口，未绑定或 Host/Origin 不匹配时拒绝。对应回归为两变体 `desktop-network.spec.ts` 和 Market `market-host-lifecycle.spec.ts` 的延迟绑定案例。

## AA 构建与版本来源

AA 产物准备时，临时构建项目将 `@deepseek-ai/*` 解析约束到 AA 源码的 `devDependencies` 类型图，运行时兼容范围仍由两通道的 `runtimePeers` 单独决定。否则放宽 peer 后可能加载两份 schemastery 全局声明并触发 TS6200。来源标记校验同时接受正式源版本的 `x.y.z-desktop.c<commit>.r<hash>` 和预发布源版本的 `x.y.z-alpha.desktop.c<commit>.r<hash>`；提交号和产物 SHA 校验必须保留。`scripts/agents-anywhere-release-policy.test.mjs` 覆盖这两种版本形式及构建/运行依赖分离。

## 产品 Host 模式契约

### 1. 范围与触发

Windows 旧 Profile 的独立 Host 冷启动曾在 120 秒 RPC 截止后进入恢复页，而同一 Profile 的进程内 Host 健康启动。Seal Harness 在 `product.json` 设置 `isolatedHost: false`，作为产品默认模式；此模式失去独立 Host 子进程的崩溃隔离。无自定义产品配置的 Stable/Beta 仍默认独立 Host。

### 2. 签名

`shouldIsolateDesktopHost(product: Pick<DesktopProductConfig, 'isolatedHost'>, override?: string): boolean` 在共享 Desktop Host 入口决定是否创建 `utilityProcess`。产品文件由 `readDesktopProduct(path)` 验证并写入构建 define。

### 3. 配置契约

`isolatedHost` 可省略或为布尔值。环境变量 `DSH_DESKTOP_ISOLATED_HOST=0` 强制进程内，`=1` 强制独立；未设置或其他值采用产品默认值。`DSH_HOME`、Profile、SQLite 和插件组合不因模式改变。

### 4. 校验与错误矩阵

| 输入 | 结果 |
| --- | --- |
| `isolatedHost` 非布尔值 | 构建配置拒绝 |
| Seal Harness 无显式覆盖 | 进程内 Host |
| 上游发行版无显式覆盖 | 独立 Host |
| 显式环境变量 `0` / `1` | 分别强制进程内 / 独立 Host |

### 5. 案例

正常：Seal Harness 读取原有 `~/.seal-harness`，无环境覆盖时启动到健康渲染器。基础：普通 DSH Desktop 保持独立 Host。错误：把 `isolatedHost` 写成字符串时构建失败。

### 6. 必需测试

Stable/Beta 均测试配置验证及模式优先级，再运行双变体、产品构建和产品检查；Windows 图形实测须用无覆盖的启动命令，并核对启动日志 `rendererStatus: healthy`。显式 `=1` 仍可诊断独立 Host；不把诊断生成文件提交。

### 7. 错误与正确实现

错误：只在开发脚本设置 `DSH_DESKTOP_ISOLATED_HOST=0`，安装包直接进入 Electron 主入口后仍会走独立 Host。正确：在构建时把产品默认值写入 Desktop 配置，由 Stable/Beta 主入口统一选择模式。

### Renderer 冷启动截止时间

1. **范围与触发**：首次原生窗口与客户端插件加载的健康等待。本机原 Profile 冷启动曾在约 35 秒后才加载页面，原截止时间先关闭 Host，后续页面停在 Loading plugins；另一次原预算实测在约 29 秒才健康，不能据此认定客户端插件损坏。
2. **签名**：`DesktopProductConfig.rendererBootTimeoutMs?: number`；`readDesktopProduct(path)` 在构建边界验证；`DESKTOP_RENDERER_BOOT_TIMEOUT_MS` 传给原生健康监测的默认参数。
3. **配置契约**：产品 JSON 声明 `"rendererBootTimeoutMs": 90000`，构建 define 写入两种启动路径共用的 Electron 产物。未指定的上游 Desktop 仍为 30000ms。只改变首次等待上限，不延迟明确插件失败、不伪造健康，不改变已经启动后的 Renderer 恢复策略。
4. **校验与错误矩阵**：省略采用默认；1–2147483647 的整数毫秒接受；字符串、零、负数、小数及超出 Node timer 上限的值在构建时抛出 `Invalid Desktop product configuration`。真实插件失败立即失败，预算耗尽仍进入恢复。
5. **正常、基础、错误案例**：产品 45 秒完成加载后报告健康可通过；上游仍在 30 秒截止；产品 90 秒未就绪进入恢复，明确的 `failed` 报告无须等到截止。
6. **必需测试**：两变体的 `product-config.spec.ts` 验证传递/默认/非法值，`renderer-health.spec.ts` 用虚拟计时验证慢启动、插件失败和耗尽；`electron-runtime.spec.ts` 保留主进程失败链路。产品构建/检查及原 Profile、默认 Host 模式的 Windows GUI 验收须核对 `rendererStatus: healthy`。
7. **错误与正确实现**：错误：只修改忽略目录的已编译 JS 计时后声称永久修复，或仅因进程存活而判定就绪。正确：产品配置经构建边界验证并进入实际产物，仍由原 Loader 报告和原生挂载共同提交健康证据。

产品发布版本的唯一来源为 `seal-harness-desktop/package.json`。构建入口在忽略目录生成带 `version` 的 Desktop 产品配置；定制构建的原生 Host 与 electron-builder `extraMetadata.version` 使用这个值。Seal Harness 的标题栏及其版本悬浮面板改用 `displayVersion`，由产品构建从选定 Desktop 实际安装的 `@deepseek-ai/dsh/package.json` 自动读取内核版本，不手工维护副本。两变体的配置边界校验该可选版本，兼容、扩展和高级模式共用同一个标题栏组件；未指定时仍显示 Host 的 Desktop 版本。显示版本不改变产品发布版本、Profile 检查点或更新身份；不得用 DSH Desktop 社区更新渠道更新 Seal Harness。

原生远程控制确认弹窗由 Desktop Host 显示，不能通过网页品牌 slot 改写。其文案在 `remote-control-offer.ts` 从自定义 `DESKTOP_PRODUCT.name` 读取产品名；无自定义产品配置时保留上游 DeepSeek Harness 文案。此共享接缝必须同步 Stable/Beta，并分别验证中英文。

## 当前插件组合

Seal Harness 在产品 `cordis.patch.yml` 禁用 `ui-message-feedback`、`command-feedback` 和 `session-telemetry-otel`：不提供点赞/点踩、反馈弹窗或 `/feedback` 命令，也不通过该反馈 OTel 通道向上游上传会话日志。保留历史反馈记录，不修改上游子模块。产品 `verify.mjs` 在未传遥测禁用开关的 Profile 组合中核对三项禁用；这不代替独立的官方模型 API Session Log 设置。

构建顺序由 `seal-harness-desktop/scripts/build.mjs` 的 `productPlugins` 和 `cordis.patch.yml` 对齐。`local-data` 在 `identity` 之前加载，之后装配账号界面、组织架构、能力插件和会话选择。项目及旧产品智能体插件不装配；知识库通过新的 WeKnora 管理插件提供，四个工作台插件的接入见 [工作台插件契约](workbench-plugins.md)。保留 DSH 原生工作区、会话与 Agent 供普通对话和专家使用。删除插件时还需从已装配目录清理旧包，防止旧构建残留进入安装包。

`packages/dsh-plugin-ask-jev/` 是可单独打包并通过 `dsh plugin add` 安装的 DSH bundle。它使用公开的 Connection RPC、credentials、tools 和 Client slots，Host 固定 TypeSafe/阿里百炼端点并注册 `ask_jev_decide` 工具。原生 `settings.section` 承载决策模型与凭据设置；Client 在普通 DSH 中保留侧栏表单，在 Seal Harness 中借可选 `sealHarnessNavigation` 将一级入口接到原生会话。结构化决策工具只返回真实模型结果，自然语言解释由普通会话模型承担。产品构建先生成该包，再复制到 Beta 装配目录；安装包必须包含同一包的 Host、Client、patch、许可证。不要让此可复用包依赖 Seal Harness 身份或导航服务。
此独立包不加入根 Yarn workspaces，也不创建第二份锁文件；其构建复用已安装的 Beta Desktop 工具链。普通 DSH 安装后的 Host 不依赖 Seal Harness 私有服务或额外运行包，Client 仅依赖 DSH 提供的 React 模块。

`@seal-harness/navigation` 在专家/技能/连接器 Client 之前加载，提供 `sealHarnessNavigation` 注册服务。一级窄栏依次显示首页、问问决策、自动化任务、Token 统计、知识库、远程桌面、ACP、空间、插件市场；问问决策复用 DSH Session/Workspace 服务打开原生对话，重进时复用该会话，切换普通会话或点击首页则退出决策导航状态。首页侧栏同时显示专家、技能、连接器、插件等功能入口与 DSH 原生工作区及会话列表，不提供概览页或重复的会话菜单。顶部“新会话”按钮进入 DSH 对话，点击一级首页可返回当前对话。资源插件在自身 Client 生命周期内通过导航服务注册，导航插件用公开 `sidebar.panellist` 和 keyed `main` slot 组成入口与页面；问问决策不进入首页资源列表，改由一级 rail 进入。一级“自动化任务”直接选中上游 keyed `main` 的 `schedules` 页面；上游同名侧栏行在产品中隐藏，上游页面、会话提醒工具和任务记录保留。产品 `seal-harness-schedules` 页面当前不作为可见导航入口，已有 SQLite 任务数据与服务不删除。宽侧栏仅首页（含首页资源页）显示，其他一级页面和账号页将该列裁为零宽，主内容跨过侧栏轨道并隐藏左侧拖拽线；保留侧栏挂载，使固定设置面板与账号入口仍能工作，不通过 toggle 改写用户的宽度/收起偏好，右栏轨道保持原样。首页不覆盖 `sidebar.workspaces`，非首页覆盖为空列表。插件管理仍复用 DSH 原生 `plugins` 主面板，其侧栏行在首页由产品同 ID 注册覆盖，在其他一级菜单隐藏。产品样式在 Desktop frame 左侧预留窄栏宽度并补偿侧栏拖拽线；兼容/扩展/高级模式、窄窗口和三平台标题栏是回归重点。

插件市场通过公开 `settings.plugins.tab` 注册表取得 `community-market` 组件及其 `locale/inject/store` 元信息，投影为 `seal-harness-market` keyed `main` 页面；旧 `.dshMarketLauncher` 底部按钮在产品样式中隐藏，市场设置页仍可用。导航订阅注册变化，市场晚加载时补入一级菜单，卸载时释放主页面并在当前选中市场时返回首页；不复制市场源码或更改其安装、来源与凭据逻辑。导航 Client 测试须覆盖菜单顺序、注入复用、首页往返、设置打开与市场卸载；实际浏览器检查非首页内容区不留侧栏空隙。

设置与账号图标放在一级窄栏底部。导航插件通过上游 `settings.launcher` 插槽取得设置打开回调，并触发产品 `sidebar.footer.action` 账号按钮；原按钮行在宽侧栏隐藏但保持挂载，因此设置弹窗、登录分支和用户详情页仍由各自插件管理。

`local-data` 在基础 Home 管理唯一的 `seal-harness.sqlite`。`users`、`experts`、`skills` 及状态、迁移记录表共用该库；历史 `projects` 表保留以避免删除已有用户数据。数据库版本用 `PRAGMA user_version` 顺序迁移，启用外键与 WAL。Host 插件通过 `sealHarnessDatabase` 共享连接和事务。数据库是用户、专家版本和技能包的持久来源；物化到文件系统的技能/专家目录是可重建缓存。自动迁移旧本地文件只复制、不删除原文件。

专家页上方以本机个人专家显示默认收起的“已安装”摘要，单行显示数量与专家头像首字，展开后复用个人专家卡片；下方仍只有“系统”和“个人”页签。系统内置专家尚未装配时显示空态，个人读取当前本机账号的 SQLite 专家，导入包也归个人。页面不提供公开目录、同步状态或手工创建/编辑页。创建专家按钮新建原生会话并填入可编辑模板，不自动发送；Host 暴露模型工具 `list_available_expert_capabilities` 与 `create_expert`，后者经当前账号和能力校验后复用专家 `create` RPC 保存。只有工具返回成功才能报告创建完成；重开个人页从 SQLite 读取，不依赖模型输出文本作为持久来源。

技能页保留独立的“已安装”区块，默认收起为显示数量、最多八个技能图标及溢出数量的单行；展开后显示原列表或空态。下方只有“系统 / 个人”页签；系统目录提供 cc-haha 的固定工具包和精选在线技能，具体契约见 capability-catalog.md。个人读取当前本机账号的 SQLite 技能，ZIP/目录导入仍直接安装但默认不启用。创建技能按钮新建原生会话并填入可编辑模板，不自动发送；Host 的 `create_skill` 模型工具走既有 `skills/create` 校验与持久化，将个人技能标记为未安装。用户从个人列表显式安装后才进入已安装区块和 DSH 运行时目录。旧技能状态未记录 `installed` 时按已安装解释，避免迁移时隐藏已有技能。技能页不显示同步状态，也不提供手工新建页；已有技能详情与文件编辑仍可用。

连接器页也使用默认收起的“已安装”单行摘要，显示数量、最多八个真实连接器图标及溢出数量；展开后显示原管理卡片或空态。下方为“系统 / 个人”页签；系统目录提供 cc-haha 的全部连接器配置与安装方式，具体契约见 capability-catalog.md。公开目录、被授权和同步状态不出现在连接器页，商店安装仍通过独立插件市场与现有 Host 接口执行。现有本地和商店连接器缺少 `installed` 字段时按已安装处理，凭据继续保存在 DSH Host credentials grant record。创建连接器按钮新建原生会话并填入可编辑模板，不自动发送；Host 的 `create_connector` 工具只保存当前本机账号的无凭据个人配置。未安装的个人连接器不注册工具，也不进入会话选择器、专家能力或流程资源；用户显式安装后，再通过既有管理面板配置凭据与启用。本地 STDIO 包导入仍沿用校验和安装流程。

`identity` 提供本地用户名密码认证与首次管理员创建，密码以独立 salt 和 scrypt 哈希存储。活动会话驻留 Host 内存；用户勾选记住登录时，渲染器持久分区保存随机凭证，SQLite 只保存哈希、所属账号及 30 天有效期。重启经 `resume` 换发凭证，退出、改密和到期后失效。登录页滑块仅为本地界面交互，不充当服务端验证码。企业微信、SSO 和远端密码不属于当前产品。专家、技能状态与包按用户存入 SQLite；旧专家知识库绑定和云端目录不属于默认 UI，独立知识库页复用当前账号的 WeKnora 授权。DSH 原生工作区与会话历史由上游管理，产品不提供项目管理插件。

`@seal-harness/organization` 是独立的 Host/Client 产品插件，在首页资源侧栏注册“组织架构”。Host 依赖当前本地账号和 `sealHarnessDatabase`，提供公司名称、层级部门、人员资料的 CRUD RPC；Client 展示部门树、搜索、人数、资料和编辑操作。SQLite v6 前向迁移新增组织表，组织资料按账号隔离；部门不能移动到自己或后代下，非空部门不能删除，跨账号部门引用拒绝。人员是目录资料，不是可登录账号；消息、群聊、在线状态与跨设备同步不由此插件提供。测试覆盖旧库升级、Host RPC、权限边界和页面操作。

品牌 Client 使用上游公开的 `settings.models.footer` 槽，为手动列出的 pi-ai 模型提供逐模型推理档位设置。使用 `remote.settings.describe/mutate` 读取和写入原有 Profile 的 `reasoningEfforts`，对模型数组做最小字段变更并以 namespace revision 拒绝并发覆盖。用户须依据服务商文档填写实际 wire 值；产品不从供应商名称推断推理能力，也不向远端探测。未声明能力的模型在对话菜单中继续不显示推理档位。

模型选择菜单的分组标题由上游 CSS 设为粘性半透明层；长列表滚动时下方模型文字会透出。品牌 Client 只在该菜单的滚动分组标题上叠加与原菜单色一致的实底，不修改只读上游子模块，也不影响模型选择或推理等级逻辑。

Seal Harness 不显示上游 DeepSeek Harness 的内测声明。品牌 Client 通过公开的 `settings.onboarding` 槽，以更低优先级覆盖 `welcome-notice` 并调用 `complete`，让引导继续；不修改上游源码，也不写入用户的声明确认状态。

## 资源页标题与决策导航

资源页标题统一放在顶部导航栏：专家、技能、连接器和应用标题为 20px，内容区不重复展示大标题与介绍；原有搜索、创建、安装和分类操作保留。独立决策插件通过 `ctx.inject(['sealHarnessNavigation'], callback)` 接入晚到的产品导航服务，并释放普通 DSH 的侧栏与主面板注册；不能只在首次 `apply` 时读取一次服务，否则启动顺序变化会丢失决策一级入口。回归须用真实 Cordis 容器先加载决策 Client、后提供导航服务。

## 会话专家选择器

产品新增或变更 Host RPC 时，Client 重新加载不代表正在运行的进程已导入新 Host 模块。公开 Loader 模式下保留 ESM 缓存边界；应在无生成任务且草稿已保留时重启实际产品实例，并验证真实窗口的请求返回200且浮层无错误。隔离Profile冒烟通过只能证明新实例，不能作为旧窗口已更新的证据；不得用客户端假数据、重复路由或吞掉404代替Host接入。

输入栏“专家”打开原位浮层，按“系统 / 个人”分组与搜索，用单选项选择唯一当前专家，另设“不使用专家”清空；不导航专家页，不改输入草稿。当前系统专家未提供种子时显示空态，个人数据来自当前账号的专家列表。

`experts/sessionList({sessionId})` 返回专家列表与 `selectedIds`（零或一项）；`experts/sessionSet({sessionId,name,version?,expectedDigest?,selected})` 在选中时校验不可变版本与摘要，再替换原专家。只移除当前匹配的专家，过期的移除请求不能清掉新专家。未发布多选原型的历史记录读取时仅保留最后选择项，不同时装配多个人设。选择以现有 credentials grant 按账号/会话持久化，保存前核对账号 epoch。原生 preset 首轮后不可切换，因此通过公开 `createScope(agent.ctx, agent)` 注册 required、literal 上下文和绑定技能/MCP，保留原模型、历史与权限。变更从后续消息生效，使用 Agent `runMaintenance`，忙碌时拒绝；装配或保存失败恢复原作用域与引用，Agent 恢复时重建，账号变化/卸载时释放。已被会话引用的专家必须先从会话移除再删除，避免遗留无法恢复的版本引用。

连接器内部 `setSessionExperts` 仅供 Host 服务调用，检查当前账号与连接器可用性，不生成客户端路由。会话记录的 `ids`（手动选择）与 `expertIds`（专家引用）分开保存，工具可见性取并集；切换或移除专家只变更专家引用，不能覆盖手动选择。专家指令与技能正文不经过模板变量插值，不把个人资料注入其他会话。回归须覆盖已发言会话的单专家替换与移除、跨会话/账号、持久恢复、绑定工具与失败回滚，以及构建后的浮层单选、无专家选项与无跳转交互。

## 定时任务契约

### 1. 范围与触发

`@seal-harness/scheduled-tasks` 是产品自有插件，在 identity/navigation 后装配。它仍保留已有服务和页面注册，但不提供可见导航入口；一级时钟直接打开上游 `ui-schedule` 的自动化任务页。Host 使用 `sealHarnessDatabase` 的 v3 表，任务和查询按当前本地账号隔离；应用启动将尚未结算的 running 记录标记 interrupted。后续若要统一两个任务系统，应先确定数据迁移与执行语义，不把两套任务误显示为同一份列表。

### 2. 接口与存储签名

POST `/api/seal-harness-scheduled-tasks/{action}` 使用现有 client-request/server-response RPC envelope。`list` 接收 `{}`；`save` 接收 `{ id?, name, prompt, workspaceId, schedule, enabled? }`；`runs/delete/run/stop` 接收 `{ id }`；`toggle` 接收 `{ id, enabled }`。结果为 `{ ok: true, value }` 或 `{ ok: false, error: { code: 'scheduledTaskFailed', message, details: {} } }`。

`scheduled_tasks` 保存账号、工作区、schedule JSON、启用状态和下一次时间；`scheduled_runs` 保存任务快照名称、唯一 session_id、session_available、fire_key、status、开始/结束时间与错误。`UNIQUE(task_id, fire_key)` 防止重复自动触发，partial unique index 禁止同任务多个 running 记录。

### 3. 请求与执行约束

执行频率支持 daily、weekly、interval、once。daily/weekly 保存 IANA 时区并按当地时间计算，夏令时不存在的分钟跳过、重复分钟同日只运行一次。运行中每 10 秒检查，超过 60 秒的过期触发只推进；启动和账号变更重新计算过期计划，不补跑未登录、关闭或休眠期间的执行。

`schedule` 为 `{ kind: 'daily', time, timeZone }`、`{ kind: 'weekly', time, timeZone, weekdays }`、`{ kind: 'interval', minutes }` 或 `{ kind: 'once', at }`。时间戳返回 epoch milliseconds，once 输入为 UTC ISO 字符串，日/周计划的 time 为 `HH:mm`。`list` 返回任务数组及各自 lastRun，`runs` 返回最近 100 条运行记录；会话创建成功才公开 sessionId。

自动推进计划和领取运行记录同 SQLite 事务提交；每个任务只允许一个 running 记录。预先保存唯一会话 ID，通过公开 `sessionController.create/rename/prompt/cancel/resolveAgent` 创建及执行原生会话，不启动另一套 CLI。等待 `turn/end` 和 Agent `whenIdle()` 后结算；取消/超时使用原有取消接口，权限策略和默认模型保持原生选择。记录仅保存状态与会话引用，完整输出由上游会话持久化。关闭插件清理定时器、账号订阅和正在执行的任务。

### 4. 校验与错误矩阵

| 边界 | 行为 |
| --- | --- |
| 未登录、跨账号 ID | 拒绝任务读写或执行 |
| 名称 1–120 字符、提示词 1–30000 字符、现存 workspaceId | strict schema 校验；不接受调用方指定账号 |
| daily/weekly | 校验 HH:mm、有效时区；weekly 至少一天，日编号 0–6 |
| interval / once | 间隔为 1–10080 整数分钟；启用的 once 必须在未来 |
| 同任务运行中 | 拒绝手动重复运行和删除；自动触发推进计划但不重叠 |
| 模型错误、取消、超时、重启 | 分别记录 failed/cancelled/timeout/interrupted，原生会话保留 |

### 5. 正常、基础与错误案例

基础：每天 Asia/Shanghai 09:00 执行，下一次保存为对应 UTC 时间。正常：暂停后手动运行仍可新建独立会话，执行记录可打开该会话；删除计划只删除计划/记录。错误：一次执行时间已经过去、工作区消失或另一账号请求任务 ID 时明确拒绝。

### 6. 必需测试

回归覆盖 v2 迁移、账号隔离、重启恢复、重复/重叠防护、时区与夏令时、实际 RPC 提示词、取消等待和页面创建/运行/记录/删除交互。产品 build/check 和 Profile 激活仍是必需门禁；真实模型执行与跨平台安装分别记录。

### 7. 错误与正确实现

错误：在 SQLite 事务内先创建外部会话，随后提交数据库；提交失败会留下无记录的执行。正确：事务内只推进时间和领取记录，提交成功后再调用会话服务，并测试回滚时外部执行次数为 0。

## 验证

每次修改产品装配后运行 `corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`，并检查 `scripts/verify-profile.mjs` 的实际插件组合。数据库迁移测试须覆盖原文件保留、重启后从 SQLite 恢复、不同用户隔离。认证测试须覆盖首次创建、错误密码、会话退出与重启、改密。产品包核对 `lib` 与装配目录没有已删除的项目及旧产品智能体模块，四个工作台插件按当前 manifest 完整装配。构建/类型检查不等于真实 UI、模型回复、签名安装或跨平台通过；各自记录实测范围。

只提交本任务路径。遵守根 `AGENTS.md` 的版本规则：普通迭代仅递增补丁号；中间/主版本变更先取得用户明确同意。提交、推送和发布分别按授权执行。
